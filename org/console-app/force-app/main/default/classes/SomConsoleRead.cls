/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Read endpoint for the Salesforce Order Management Operations Console when it runs inside Salesforce (a Multi-Framework app). The app domain's session
// can't call /services/data/vXX.X/query or /describe, so the console's read layer (om-core.js) sends the same SOQL here.
// Read-only by construction: it runs one SELECT, one SOSL FIND (OM Service Console's customer search), or describes one object, as
// the calling user (USER_MODE enforces object, field and sharing access), and there is no DML anywhere in this class.
// /limits reports the org's limits (OrgLimits, no query) in the REST API's /limits shape. Every response carries an
// X-SomConsole-Limits header with this transaction's governor use and the daily API count, so the console can show them live.
// /features says whether SomConsoleConnect is deployed, which stands in for Omnichannel Inventory and Delivery Estimation being on,
// and whether OM Service Console's order policy objects are (from the schema, whatever the user can read).
// More reads are lookups the page can't make itself (its session can't call the Connect REST API): stock in Omnichannel
// Inventory and a delivery estimate (POSTs in the REST API), which run in SomConsoleConnect (ConnectApi; only orgs with those
// features deploy it); Order Management's product search and details for a store (ConnectApi.Repricing), each with only the
// fields it takes; and OM Service Console's duplicate check of a new customer, which runs the org's duplicate rules on the unsaved
// record (Datacloud.FindDuplicates) and saves nothing. Results follow the REST API's shapes. The batch POST carries several
// such reads in one call; it changes nothing either.
@RestResource(urlMapping='/somconsole/*')
global with sharing class SomConsoleRead {
    @TestVisible static final Integer BATCH = 2000; // the REST API's batch size; om-core.js flags results that hit it
    @TestVisible static final Integer MAX_BATCH = 10; // reads per batch call: keeps one call well inside the 100-query and heap limits

    @HttpGet
    global static void get() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        String path = req.requestURI.substringAfter('/somconsole/');
        try {
            if (path == 'query') {
                res.responseBody = Blob.valueOf(query(req.params.get('q')));
            } else if (path == 'search') {
                res.responseBody = Blob.valueOf(search(req.params.get('q')));
            } else if (path.startsWith('describe/')) {
                res.responseBody = Blob.valueOf(describe(path.substringAfter('describe/')));
            } else if (path == 'limits') {
                res.responseBody = Blob.valueOf(limits('api'.equals(req.params.get('only'))));
            } else if (path == 'features') {
                // policies: whether OM Service Console's order policy objects (org/policies) exist, from the schema, whatever the user can
                // read, so the page can tell an org without policies from one whose policies this user can't see.
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'connect' => Type.forName('SomConsoleConnect') != null,
                    'policies' => Schema.getGlobalDescribe().containsKey('som_return_policy__c') }));
            } else {
                fail(res, 404, 'NOT_FOUND', 'Unknown resource');
            }
        } catch (NotFoundException e) {
            fail(res, 404, 'NOT_FOUND', e.getMessage());
        } catch (Exception e) {
            fail(res, 400, 'BAD_REQUEST', e.getMessage());
        }
        stamp(res);
    }

    // Several reads in one call, so a page load costs a few API calls instead of one per query. Still read-only: each item is
    // a SELECT or a describe, answered with its own status, so one bad item never fails the others.
    // Body: {"items": [{"q": "SELECT …"} | {"s": "FIND …"} | {"describe": "ObjectName"} | {"inventory": {…}} | {"estimate": {"setup": ref, "input": {…}}}
    //   | {"products": {"store", "account", "searchTerm", "page", "pageSize"}} | {"product": {"store", "account", "sku", "excludeMedia", "excludePrices"}}
    //   | {"duplicates": {"apiName": "Account" | "Contact", "fields": {…}}}, …]}
    //   →  {"results": [{"status": 200, "body": …}, …]}
    @HttpPost
    global static void batch() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        List<Object> items;
        try {
            items = (List<Object>) ((Map<String, Object>) JSON.deserializeUntyped(RestContext.request.requestBody.toString())).get('items');
        } catch (Exception e) {
            items = null;
        }
        if (items == null || items.isEmpty() || items.size() > MAX_BATCH) {
            fail(res, 400, 'BAD_REQUEST', 'Send 1 to ' + MAX_BATCH + ' items');
            stamp(res);
            return;
        }
        List<Object> results = new List<Object>();
        for (Object o : items) {
            Map<String, Object> item = (Map<String, Object>) o;
            try {
                String body = item.containsKey('describe') ? describe((String) item.get('describe'))
                    : item.containsKey('s') ? search((String) item.get('s'))
                    : item.containsKey('inventory') ? connect('inventory', item.get('inventory'))
                    : item.containsKey('estimate') ? connect('estimate', item.get('estimate'))
                    : item.containsKey('products') ? products(item.get('products'))
                    : item.containsKey('product') ? product(item.get('product'))
                    : item.containsKey('duplicates') ? duplicates(item.get('duplicates')) : query((String) item.get('q'));
                results.add(new Map<String, Object>{ 'status' => 200, 'body' => JSON.deserializeUntyped(body) });
            } catch (NotFoundException e) {
                results.add(new Map<String, Object>{ 'status' => 404, 'body' => errors('NOT_FOUND', e.getMessage()) });
            } catch (Exception e) {
                results.add(new Map<String, Object>{ 'status' => 400, 'body' => errors('BAD_REQUEST', e.getMessage()) });
            }
        }
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'results' => results }));
        stamp(res);
    }

    // The org's limits in the REST API's /limits shape: {"Name": {"Max": n, "Remaining": n}}. `apiOnly` answers just the daily
    // API request count, which is what the console's live view polls. OrgLimits runs no query and changes nothing.
    @TestVisible
    static String limits(Boolean apiOnly) {
        Map<String, Object> out = new Map<String, Object>();
        for (System.OrgLimit l : apiOnly ? onlyApi() : System.OrgLimits.getAll()) {
            out.put(l.getName(), new Map<String, Object>{ 'Max' => l.getLimit(), 'Remaining' => l.getLimit() - l.getValue() });
        }
        return JSON.serialize(out);
    }
    static List<System.OrgLimit> onlyApi() {
        System.OrgLimit api = System.OrgLimits.getMap().get('DailyApiRequests');
        return api == null ? new List<System.OrgLimit>() : new List<System.OrgLimit>{ api };
    }

    // Header X-SomConsole-Limits: this transaction's governor use, and the org's daily API requests used / allowed.
    // Never fails a read: if any figure can't be read the header is left off.
    static void stamp(RestResponse res) {
        try {
            String h = 'rows=' + Limits.getQueryRows() + '/' + Limits.getLimitQueryRows()
                + ';queries=' + Limits.getQueries() + '/' + Limits.getLimitQueries()
                + ';cpu=' + Limits.getCpuTime() + '/' + Limits.getLimitCpuTime()
                + ';heap=' + Limits.getHeapSize() + '/' + Limits.getLimitHeapSize();
            System.OrgLimit api = System.OrgLimits.getMap().get('DailyApiRequests');
            if (api != null) h += ';api=' + api.getValue() + '/' + api.getLimit();
            res.addHeader('X-SomConsole-Limits', h);
        } catch (Exception e) {
            // a missing header only means the live view has no governor figures for this call
        }
    }

    @TestVisible
    static String query(String q) {
        if (q == null || !Pattern.matches('(?is)\\s*SELECT\\s.+', q) || q.contains(';')) {
            throw new IllegalArgumentException('Only a single SELECT query is allowed');
        }
        if (Pattern.matches('(?is)\\s*SELECT\\s+COUNT\\(\\s*\\)\\s+FROM\\s.+', q)) {
            Integer n = Database.countQuery(q, AccessLevel.USER_MODE);
            return JSON.serialize(new Map<String, Object>{ 'totalSize' => n, 'done' => true, 'records' => new List<Object>() });
        }
        List<SObject> rows = Database.query(q, AccessLevel.USER_MODE);
        Boolean more = rows.size() > BATCH;
        List<SObject> page = more ? new List<SObject>() : rows;
        if (more) {
            for (Integer i = 0; i < BATCH; i++) page.add(rows[i]);
        }
        return JSON.serialize(new Map<String, Object>{ 'totalSize' => rows.size(), 'done' => !more, 'records' => page });
    }

    // One SOSL FIND, answered in the REST API's /search shape: every matching record, of every object, in searchRecords.
    @TestVisible
    static String search(String q) {
        if (q == null || !Pattern.matches('(?is)\\s*FIND\\s.+', q) || q.contains(';')) {
            throw new IllegalArgumentException('Only a single FIND search is allowed');
        }
        List<SObject> found = new List<SObject>();
        for (List<SObject> rows : Search.query(q, AccessLevel.USER_MODE)) found.addAll(rows);
        return JSON.serialize(new Map<String, Object>{ 'searchRecords' => found });
    }

    @TestVisible
    static String describe(String name) {
        List<Schema.DescribeSObjectResult> found;
        try {
            found = Schema.describeSObjects(new List<String>{ name }, SObjectDescribeOptions.DEFERRED);
        } catch (Exception e) {
            throw new NotFoundException('The requested resource does not exist');
        }
        Schema.DescribeSObjectResult d = found[0];
        if (!d.isAccessible()) throw new NotFoundException('The requested resource does not exist');
        List<Map<String, Object>> fields = new List<Map<String, Object>>();
        for (Schema.SObjectField f : d.fields.getMap().values()) {
            Schema.DescribeFieldResult r = f.getDescribe();
            if (!r.isAccessible()) continue;
            List<String> to = new List<String>();
            for (Schema.SObjectType t : r.getReferenceTo()) to.add(t.getDescribe(SObjectDescribeOptions.DEFERRED).getName());
            // A picklist's active values, as the REST describe lists them: the record pages' status pickers and the reason
            // lists come from them. Dependent picklists (an address's state codes run to thousands) are left out: none is used.
            List<Map<String, Object>> values = new List<Map<String, Object>>();
            Schema.DisplayType kind = r.getType();
            if ((kind == Schema.DisplayType.PICKLIST || kind == Schema.DisplayType.MULTIPICKLIST) && !r.isDependentPicklist())
                for (Schema.PicklistEntry p : r.getPicklistValues()) if (p.isActive()) values.add(new Map<String, Object>{ 'value' => p.getValue(), 'active' => true });
            fields.add(new Map<String, Object>{ 'name' => r.getName(), 'type' => String.valueOf(kind).toLowerCase(),
                'relationshipName' => r.getRelationshipName(), 'referenceTo' => to, 'picklistValues' => values });
        }
        // Whether the user may create the object, and its record types, as the REST describe says them.
        List<Map<String, Object>> types = new List<Map<String, Object>>();
        for (Schema.RecordTypeInfo t : d.getRecordTypeInfos()) {
            types.add(new Map<String, Object>{ 'recordTypeId' => t.getRecordTypeId(), 'developerName' => t.getDeveloperName(), 'available' => t.isAvailable(),
                'defaultRecordTypeMapping' => t.isDefaultRecordTypeMapping(), 'master' => t.isMaster(), 'active' => t.isActive() });
        }
        return JSON.serialize(new Map<String, Object>{ 'name' => d.getName(), 'fields' => fields, 'createable' => d.isCreateable(), 'recordTypeInfos' => types });
    }

    // OM Service Console's duplicate check of a new customer: the org's active duplicate rules run on the unsaved record, which gets
    // only the fields OM Service Console would write. Datacloud.FindDuplicates saves nothing, and this class writes no query for it.
    // Answered in UI API's predupe shape; with no active rule for the object it fails with NO_ACTIVE_DUPLICATE_RULE, as predupe
    // does, and the app then checks email and phone itself.
    static final Map<String, Set<String>> DUPLICATE_FIELDS = new Map<String, Set<String>>{
        'Account' => new Set<String>{ 'RecordTypeId', 'FirstName', 'LastName', 'PersonEmail', 'Name', 'Phone', 'BillingStreet', 'BillingCity', 'BillingState', 'BillingPostalCode', 'BillingCountry' },
        'Contact' => new Set<String>{ 'FirstName', 'LastName', 'Email', 'Phone' } };
    @TestVisible
    static String duplicates(Object arg) {
        Map<String, Object> m = arg instanceof Map<String, Object> ? (Map<String, Object>) arg : new Map<String, Object>();
        Object apiName = m.get('apiName');
        if (!(apiName instanceof String) || !DUPLICATE_FIELDS.containsKey((String) apiName) || !(m.get('fields') instanceof Map<String, Object>)) {
            throw new IllegalArgumentException('Send {apiName: Account or Contact, fields}');
        }
        String obj = (String) apiName;
        Map<String, Object> fields = (Map<String, Object>) m.get('fields');
        SObject rec = Schema.getGlobalDescribe().get(obj).newSObject();
        for (String k : fields.keySet()) {
            if (!DUPLICATE_FIELDS.get(obj).contains(k) || !(fields.get(k) instanceof String)) throw new IllegalArgumentException('A duplicate check doesn\'t take ' + k);
            rec.put(k, k == 'RecordTypeId' ? (Object) Id.valueOf((String) fields.get(k)) : fields.get(k));
        }
        List<Datacloud.FindDuplicatesResult> found;
        try {
            found = Datacloud.FindDuplicates.findDuplicates(new List<SObject>{ rec });
        } catch (Exception e) {
            if (e.getMessage().containsIgnoreCase('No active duplicate rules')) throw new IllegalArgumentException('NO_ACTIVE_DUPLICATE_RULE: ' + e.getMessage());
            throw e;
        }
        Boolean allowSave = true;
        List<String> rules = new List<String>();
        List<Object> matches = new List<Object>();
        for (Datacloud.FindDuplicatesResult f : found) {
            for (Datacloud.DuplicateResult d : f.getDuplicateResults()) {
                List<Object> ids = new List<Object>();
                String matchRule = null, matched = obj;
                for (Datacloud.MatchResult mr : d.getMatchResults()) {
                    matchRule = mr.getRule();
                    for (Datacloud.MatchRecord r : mr.getMatchRecords()) {
                        ids.add(r.getRecord().Id);
                        matched = r.getRecord().getSObjectType().getDescribe(SObjectDescribeOptions.DEFERRED).getName();
                    }
                }
                // Every rule that ran is named, matched or not: an empty list means no rule covers the record.
                if (!rules.contains(d.getDuplicateRule())) rules.add(d.getDuplicateRule());
                if (ids.isEmpty()) continue;
                if (!d.isAllowSave()) allowSave = false;
                matches.add(new Map<String, Object>{ 'objectApiName' => matched, 'recordIds' => ids, 'duplicateResultInfos' => new Map<String, Object>{ d.getDuplicateRule() =>
                    new Map<String, Object>{ 'allowSave' => d.isAllowSave(), 'rule' => d.getDuplicateRule(), 'matchResultInfo' => new Map<String, Object>{ 'recordIds' => ids, 'rule' => matchRule } } } });
            }
        }
        return JSON.serialize(new Map<String, Object>{ 'allowSave' => allowSave, 'duplicateError' => !matches.isEmpty(), 'duplicateRules' => rules, 'matches' => matches });
    }

    // Stock and delivery estimates need ConnectApi types that only some orgs have (Omnichannel Inventory, Delivery Estimation).
    // They live in SomConsoleConnect, deployed only where those types exist, so this class compiles in every Order Management org. Where it is
    // missing, the lookup answers 404 and the console shows no stock or estimate, as it does for any feature an org lacks.
    static String connect(String action, Object arg) {
        Type t = Type.forName('SomConsoleConnect');
        if (t == null) throw new NotFoundException('Not available in this org');
        return (String) ((Callable) t.newInstance()).call(action, new Map<String, Object>{ 'arg' => arg });
    }

    // Order Management's product search and details for a store, as the customer sees it (Order on Behalf Of's product picker):
    // ConnectApi.Repricing, the Apex form of /commerce/order-management/webstores/{id}/products. Never excludeAttributeSetInfo:
    // with it, every variation value comes back as not orderable.
    static String products(Object o) {
        Map<String, Object> m = only(o, new Set<String>{ 'store', 'account', 'searchTerm', 'page', 'pageSize' });
        String term = m.get('searchTerm') instanceof String ? ((String) m.get('searchTerm')).trim() : '';
        if (term.length() < 2 || term.length() > 80) throw new IllegalArgumentException('Search for 2 to 80 characters');
        return JSON.serialize(ConnectApi.Repricing.searchProducts(anId(m.get('store'), 'store'), term, whole(m.get('page'), 0, 100), whole(m.get('pageSize'), 1, 50), anId(m.get('account'), 'account'), null));
    }
    static String product(Object o) {
        Map<String, Object> m = only(o, new Set<String>{ 'store', 'account', 'sku', 'excludeMedia', 'excludePrices' });
        if (!(m.get('sku') instanceof String) || !Pattern.matches('[^/?]{1,80}', (String) m.get('sku'))) throw new IllegalArgumentException('Bad SKU or product Id');
        return JSON.serialize(ConnectApi.Repricing.productDetails(anId(m.get('store'), 'store'), (String) m.get('sku'), anId(m.get('account'), 'account'), null, null,
            false, m.get('excludeMedia') == true, false, false, m.get('excludePrices') == true, false));
    }
    static String anId(Object v, String what) {
        if (!(v instanceof String) || !Pattern.matches('[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?', (String) v)) throw new IllegalArgumentException('Bad ' + what + ' Id');
        return (String) v;
    }
    static Integer whole(Object v, Integer min, Integer max) {
        Integer n = v instanceof Integer ? (Integer) v : null;
        if (n == null || n < min || n > max) throw new IllegalArgumentException('Expected a whole number from ' + min + ' to ' + max);
        return n;
    }

    static Map<String, Object> only(Object o, Set<String> allowed) {
        if (!(o instanceof Map<String, Object>)) throw new IllegalArgumentException('Expected an object');
        Map<String, Object> m = (Map<String, Object>) o;
        for (String k : m.keySet()) if (!allowed.contains(k)) throw new IllegalArgumentException('Unexpected field ' + k);
        return m;
    }

    static List<Map<String, String>> errors(String code, String message) {
        return new List<Map<String, String>>{ new Map<String, String>{ 'errorCode' => code, 'message' => message } };
    }

    static void fail(RestResponse res, Integer status, String code, String message) {
        res.statusCode = status;
        res.responseBody = Blob.valueOf(JSON.serialize(errors(code, message)));
    }

    public class NotFoundException extends Exception {}
}
