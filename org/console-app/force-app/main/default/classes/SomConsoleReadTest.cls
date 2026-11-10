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
@IsTest
private class SomConsoleReadTest {
    static RestResponse call(String uri, Map<String, String> params) {
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/somconsole/' + uri;
        req.httpMethod = 'GET';
        if (params != null) req.params.putAll(params);
        RestContext.request = req;
        RestContext.response = new RestResponse();
        SomConsoleRead.get();
        return RestContext.response;
    }

    @IsTest
    static void runsSelectQueries() {
        RestResponse res = call('query', new Map<String, String>{ 'q' => 'SELECT Id, Name FROM User WHERE Id = \'' + UserInfo.getUserId() + '\'' });
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.responseBody.toString());
        Assert.areEqual(1, body.get('totalSize'));
        Assert.areEqual(true, body.get('done'));
        Assert.areEqual(1, ((List<Object>) body.get('records')).size());
    }

    @IsTest
    static void countsWithCountQuery() {
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(SomConsoleRead.query('SELECT COUNT() FROM User WHERE Id = \'' + UserInfo.getUserId() + '\''));
        Assert.areEqual(1, body.get('totalSize'));
    }

    @IsTest
    static void groupsAggregates() {
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(SomConsoleRead.query('SELECT IsActive s, COUNT(Id) c FROM User WHERE Id = \'' + UserInfo.getUserId() + '\' GROUP BY IsActive'));
        Map<String, Object> row = (Map<String, Object>) ((List<Object>) body.get('records'))[0];
        Assert.areEqual(1, row.get('c'));
    }

    @IsTest
    static void refusesAnythingButOneSelect() {
        Assert.areEqual(400, call('query', new Map<String, String>{ 'q' => 'DELETE FROM User' }).statusCode);
        Assert.areEqual(400, call('query', new Map<String, String>{ 'q' => 'SELECT Id FROM User; SELECT Id FROM Account' }).statusCode);
        Assert.areEqual(400, call('query', null).statusCode);
    }

    @IsTest
    static void describesObjectsAndReports404ForMissingOnes() {
        RestResponse res = call('describe/User', null);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.responseBody.toString());
        Assert.areEqual('User', body.get('name'));
        Assert.isTrue(((List<Object>) body.get('fields')).size() > 5);
        Assert.areEqual(404, call('describe/No_Such_Object__c', null).statusCode);
        Assert.areEqual(404, call('nothing-here', null).statusCode);
    }

    @IsTest
    static void searchesWithFindAsTheUser() {
        Test.setFixedSearchResults(new List<Id>{ UserInfo.getUserId() });
        RestResponse res = call('search', new Map<String, String>{ 'q' => 'FIND {Someone} IN NAME FIELDS RETURNING User(Id, Name)' });
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.responseBody.toString());
        List<Object> rows = (List<Object>) body.get('searchRecords');
        Assert.areEqual(1, rows.size());
        Assert.areEqual('User', ((Map<String, Object>) ((Map<String, Object>) rows[0]).get('attributes')).get('type'));
        Assert.areEqual(400, call('search', new Map<String, String>{ 'q' => 'SELECT Id FROM User' }).statusCode);
        Assert.areEqual(400, call('search', new Map<String, String>{ 'q' => 'FIND {a} RETURNING User(Id); FIND {b}' }).statusCode);
        Assert.areEqual(400, call('search', null).statusCode);
    }

    @IsTest
    static void reportsOrgLimitsInTheRestShape() {
        Map<String, Object> all = (Map<String, Object>) JSON.deserializeUntyped(call('limits', null).responseBody.toString());
        Map<String, Object> api = (Map<String, Object>) all.get('DailyApiRequests');
        Assert.isTrue(Decimal.valueOf(String.valueOf(api.get('Max'))) > 0);
        Assert.isNotNull(api.get('Remaining'));
        Assert.isTrue(all.size() > 1);
        Map<String, Object> only = (Map<String, Object>) JSON.deserializeUntyped(call('limits', new Map<String, String>{ 'only' => 'api' }).responseBody.toString());
        Assert.areEqual(new Set<String>{ 'DailyApiRequests' }, only.keySet());
    }

    @IsTest
    static void everyResponseCarriesTheGovernorHeader() {
        Pattern shape = Pattern.compile('rows=\\d+/\\d+;queries=\\d+/\\d+;cpu=\\d+/\\d+;heap=\\d+/\\d+;api=\\d+/\\d+');
        RestResponse ok = call('query', new Map<String, String>{ 'q' => 'SELECT Id FROM User WHERE Id = \'' + UserInfo.getUserId() + '\'' });
        Assert.isTrue(shape.matcher(ok.headers.get('X-SomConsole-Limits')).matches(), ok.headers.get('X-SomConsole-Limits'));
        Assert.isNotNull(call('nothing-here', null).headers.get('X-SomConsole-Limits'), 'errors carry it too');
        RestContext.request = new RestRequest();
        RestContext.request.requestBody = Blob.valueOf('{"items":[{"describe":"User"}]}');
        RestContext.response = new RestResponse();
        SomConsoleRead.batch();
        Assert.isNotNull(RestContext.response.headers.get('X-SomConsole-Limits'), 'so does the batch');
    }

    // More rows than the REST API's batch: the first 2,000, not done, as om-core.js flags a capped result. The rows are price
    // books made here: every org has the object, and nothing runs when one is saved.
    @IsTest
    static void capsResultsAtTheRestBatchSize() {
        Assert.areEqual(2000, SomConsoleRead.BATCH);
        List<Pricebook2> books = new List<Pricebook2>();
        for (Integer i = 0; i <= SomConsoleRead.BATCH; i++) books.add(new Pricebook2(Name = 'Zyxw Cap ' + i));
        insert books;
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(SomConsoleRead.query('SELECT Id FROM Pricebook2 WHERE Name LIKE \'Zyxw Cap %\''));
        Assert.areEqual(SomConsoleRead.BATCH + 1, body.get('totalSize'));
        Assert.areEqual(false, body.get('done'));
        Assert.areEqual(SomConsoleRead.BATCH, ((List<Object>) body.get('records')).size());
    }

    @IsTest
    static void batchesQueriesAndDescribesInOneCall() {
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/somconsole/batch';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'items' => new List<Object>{
            new Map<String, String>{ 'q' => 'SELECT COUNT() FROM User WHERE Id = \'' + UserInfo.getUserId() + '\'' },
            new Map<String, String>{ 'describe' => 'User' },
            new Map<String, String>{ 'describe' => 'No_Such_Object__c' },
            new Map<String, String>{ 'q' => 'DELETE FROM User' } } }));
        RestContext.request = req;
        RestContext.response = new RestResponse();
        SomConsoleRead.batch();
        List<Object> results = (List<Object>) ((Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString())).get('results');
        Assert.areEqual(4, results.size());
        Assert.areEqual(200, ((Map<String, Object>) results[0]).get('status'));
        Assert.areEqual(1, ((Map<String, Object>) ((Map<String, Object>) results[0]).get('body')).get('totalSize'));
        Assert.areEqual(200, ((Map<String, Object>) results[1]).get('status'));
        Assert.areEqual(404, ((Map<String, Object>) results[2]).get('status'));
        Assert.areEqual(400, ((Map<String, Object>) results[3]).get('status'));
    }

    @IsTest
    static void refusesOversizedBatches() {
        List<Object> items = new List<Object>();
        for (Integer i = 0; i <= SomConsoleRead.MAX_BATCH; i++) items.add(new Map<String, String>{ 'describe' => 'User' });
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/somconsole/batch';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'items' => items }));
        RestContext.request = req;
        RestContext.response = new RestResponse();
        SomConsoleRead.batch();
        Assert.areEqual(400, RestContext.response.statusCode);
        req.requestBody = Blob.valueOf('not json');
        RestContext.response = new RestResponse();
        SomConsoleRead.batch();
        Assert.areEqual(400, RestContext.response.statusCode);
    }

    // Stock and delivery estimates run in SomConsoleConnect, which only some orgs deploy. Through the batch, each is its own
    // answer: 404 where that class is missing, 400 where it refuses the input. Never the whole batch, never a 200 for bad input.
    @IsTest
    static void answersStockAndEstimateLookupsPerItemWhetherOrNotConnectIsDeployed() {
        RestContext.request = new RestRequest();
        RestContext.response = new RestResponse();
        RestContext.request.requestBody = Blob.valueOf('{"items":[{"inventory":{"stockKeepingUnits":["A"],"useCache":false}},{"estimate":{"setup":"bad ref!","input":{}}},{"inventory":{"stockKeepingUnits":["A"]}},{"estimate":{"setup":"alpine","input":{"shippingCarrier":{"externalReference":"c","shippingCarrierMethods":[]},"products":[]}}}]}');
        SomConsoleRead.batch();
        List<Object> results = (List<Object>) ((Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString())).get('results');
        System.assertEquals(4, results.size());
        Boolean present = Type.forName('SomConsoleConnect') != null;
        System.assertEquals(present ? 400 : 404, ((Map<String, Object>) results[0]).get('status'));
        System.assertEquals(present ? 400 : 404, ((Map<String, Object>) results[1]).get('status'));
    }

    // /features reports whether SomConsoleConnect is deployed, the console's stand-in for Inventory and Delivery Estimation.
    @IsTest
    static void featuresSaysWhetherConnectIsDeployed() {
        RestContext.request = new RestRequest();
        RestContext.request.requestURI = '/services/apexrest/somconsole/features';
        RestContext.response = new RestResponse();
        SomConsoleRead.get();
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        System.assertEquals(Type.forName('SomConsoleConnect') != null, body.get('connect'));
        System.assertEquals(Schema.getGlobalDescribe().containsKey('som_return_policy__c'), body.get('policies'));
    }
    @IsTest
    static void checksDuplicatesWithoutSaving() {
        String body;
        try {
            body = SomConsoleRead.duplicates(new Map<String, Object>{ 'apiName' => 'Contact', 'fields' => new Map<String, Object>{ 'LastName' => 'Zyxw Nobody', 'Email' => 'zyxw.nobody@example.com' } });
        } catch (IllegalArgumentException e) {
            Assert.isTrue(e.getMessage().startsWith('NO_ACTIVE_DUPLICATE_RULE'), e.getMessage()); // an org with no rule for contacts
            return;
        }
        Map<String, Object> r = (Map<String, Object>) JSON.deserializeUntyped(body);
        Assert.areEqual(true, r.get('allowSave'));
        Assert.areEqual(0, ((List<Object>) r.get('matches')).size());
        Assert.isFalse(((List<Object>) r.get('duplicateRules')).isEmpty(), 'the rules that ran are named even with no match');
        Assert.areEqual(0, [SELECT COUNT() FROM Contact WHERE LastName = 'Zyxw Nobody']);
    }

    // A business the org's rules match comes back with the record it matched, in predupe's shape; the check still saves nothing.
    @IsTest
    static void namesTheRecordsADuplicateCheckMatches() {
        Map<String, Object> fields = new Map<String, Object>{ 'Name' => 'Zyxw Duplicate Outfitters', 'Phone' => '(512) 555-0199', 'BillingStreet' => '1 Zyxw Way',
            'BillingCity' => 'Austin', 'BillingPostalCode' => '78701' };
        Schema.RecordTypeInfo rt = Schema.SObjectType.Account.getRecordTypeInfosByDeveloperName().get('Business_Account');
        if (rt != null && rt.isAvailable()) fields.put('RecordTypeId', String.valueOf(rt.getRecordTypeId()));
        Account seed = new Account();
        for (String k : fields.keySet()) seed.put(k, k == 'RecordTypeId' ? (Object) Id.valueOf((String) fields.get(k)) : fields.get(k));
        Database.DMLOptions dml = new Database.DMLOptions();
        dml.DuplicateRuleHeader.allowSave = true;
        Database.insert(seed, dml);
        String body;
        try {
            body = SomConsoleRead.duplicates(new Map<String, Object>{ 'apiName' => 'Account', 'fields' => fields });
        } catch (IllegalArgumentException e) {
            Assert.isTrue(e.getMessage().startsWith('NO_ACTIVE_DUPLICATE_RULE'), e.getMessage()); // an org with no rule for accounts
            return;
        }
        Map<String, Object> r = (Map<String, Object>) JSON.deserializeUntyped(body);
        List<Object> matches = (List<Object>) r.get('matches');
        Assert.areEqual(1, matches.size(), body);
        Map<String, Object> m = (Map<String, Object>) matches[0];
        Assert.areEqual('Account', m.get('objectApiName'));
        Assert.isTrue(((List<Object>) m.get('recordIds')).contains(seed.Id), body);
        Assert.areEqual(true, r.get('duplicateError'));
        Assert.areEqual(1, [SELECT COUNT() FROM Account WHERE Name = 'Zyxw Duplicate Outfitters']);
    }

    @IsTest
    static void refusesDuplicateChecksItDoesNotKnow() {
        List<Object> args = new List<Object>{ null, new Map<String, Object>{ 'apiName' => 'User', 'fields' => new Map<String, Object>() },
            new Map<String, Object>{ 'apiName' => 'Contact', 'fields' => new Map<String, Object>{ 'OwnerId' => UserInfo.getUserId() } },
            new Map<String, Object>{ 'apiName' => 'Contact', 'fields' => new Map<String, Object>{ 'LastName' => 5 } } };
        for (Object arg : args) {
            try {
                SomConsoleRead.duplicates(arg);
                Assert.fail('should refuse ' + JSON.serialize(arg));
            } catch (IllegalArgumentException e) {
                Assert.isFalse(e.getMessage().startsWith('NO_ACTIVE'), e.getMessage());
            }
        }
    }

    @IsTest
    static void describeSaysWhatTheUserMayCreate() {
        Map<String, Object> d = (Map<String, Object>) JSON.deserializeUntyped(SomConsoleRead.describe('Account'));
        Assert.isTrue(d.get('createable') instanceof Boolean);
        Assert.isTrue(d.get('recordTypeInfos') instanceof List<Object>);
    }

    // Picklists carry their active values, as the REST describe's do: OM Service Console's status pickers are read from them.
    @IsTest
    static void describeListsEachPicklistsActiveValues() {
        Map<String, Object> d = (Map<String, Object>) JSON.deserializeUntyped(SomConsoleRead.describe('User'));
        Map<String, List<Object>> values = new Map<String, List<Object>>();
        for (Object o : (List<Object>) d.get('fields')) {
            Map<String, Object> f = (Map<String, Object>) o;
            values.put((String) f.get('name'), (List<Object>) f.get('picklistValues'));
        }
        Assert.isFalse(values.get('TimeZoneSidKey').isEmpty());
        Assert.areEqual(true, ((Map<String, Object>) values.get('TimeZoneSidKey')[0]).get('active'));
        Assert.isTrue(values.get('Username').isEmpty());
    }

    // Product search and details take only what om-core.js sends, with checked Ids; anything else is its own 400.
    @IsTest
    static void refusesProductLookupsItDoesNotSend() {
        RestContext.request = new RestRequest();
        RestContext.response = new RestResponse();
        RestContext.request.requestBody = Blob.valueOf('{"items":['
            + '{"products":{"store":"0ZEB0000000LYyWOAW","account":"001Ws00004443vsIAA","searchTerm":"chai","page":0,"pageSize":12,"sort":"x"}},'
            + '{"products":{"store":"bad","account":"001Ws00004443vsIAA","searchTerm":"chai","page":0,"pageSize":12}},'
            + '{"products":{"store":"0ZEB0000000LYyWOAW","account":"001Ws00004443vsIAA","searchTerm":"c","page":0,"pageSize":12}},'
            + '{"product":{"store":"0ZEB0000000LYyWOAW","account":"001Ws00004443vsIAA","sku":"a/b"}},'
            + '{"product":{"store":"0ZEB0000000LYyWOAW","account":"001Ws00004443vsIAA","sku":"6010013-6","excludeMedia":true}},'
            + '{"products":{"store":"0ZEB0000000LYyWOAW","account":"001Ws00004443vsIAA","searchTerm":"chai","page":0,"pageSize":12}}]}');
        SomConsoleRead.batch();
        List<Object> results = (List<Object>) ((Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString())).get('results');
        System.assertEquals(6, results.size());
        for (Integer i = 0; i < 4; i++) System.assertEquals(400, ((Map<String, Object>) results[i]).get('status'), 'item ' + i);
    }
}
