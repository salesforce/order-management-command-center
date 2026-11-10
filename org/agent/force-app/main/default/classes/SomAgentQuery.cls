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
// Agentforce's Run Query action: one SOQL SELECT the agent writes, on Order Management's objects only, run as the user.
// It only reads, by construction:
//   - Database.query can't change data, and there is no DML in this class;
//   - the clauses that write as they read (FOR UPDATE, FOR VIEW, FOR REFERENCE, UPDATE TRACKING, UPDATE VIEWSTAT) are refused;
//   - AccessLevel.USER_MODE holds the query to the user's own object, field and sharing access.
// Every object it names (FROM, subqueries and semi-joins) must be in OBJECTS, or a child relationship to one that is, and
// every lookup path it follows (Account.Name, FulfilledFromLocation.Name) must stay inside OBJECTS: Owner.Username or
// CreatedBy.Name would read User. Personal fields (emails, phones, street addresses, postal codes, coordinates) are
// refused, so an answer can't carry them, and so are FIELDS(…) and TYPEOF, which would pick fields or objects unnamed.
// At most ROWS rows and CHARS characters go back; `more` says there were more.
public with sharing class SomAgentQuery {
    @TestVisible static Integer ROWS = 200;
    @TestVisible static final Integer CHARS = 20000;

    // Order Management's objects and the ones its answers name. A new object is an entry here; the agent's instructions
    // name only these (app/test/agent-query.test.mjs holds the two together). People's contact records, cards and
    // conversations stay out: the agent reads those through its standard actions, under its instructions.
    public static final Set<String> OBJECTS = new Set<String>{
        'OrderSummary', 'OrderItemSummary', 'OrderItemSummaryChange', 'OrderItemAdjustmentLineSummary', 'OrderItemTaxLineItemSummary',
        'OrderAdjustmentGroupSummary', 'OrderDeliveryGroupSummary', 'OrderPaymentSummary', 'OrderSummaryRelationship',
        'OrderItemSummaryRelationship', 'OrderSummaryRoutingSchedule', 'Order', 'OrderItem', 'OrderDeliveryGroup', 'OrderDeliveryMethod',
        'FulfillmentOrder', 'FulfillmentOrderLineItem', 'FulfillmentOrderItemAdjustment', 'FulfillmentOrderItemTax',
        'ReturnOrder', 'ReturnOrderLineItem', 'ReturnOrderItemAdjustment', 'ReturnOrderItemTax', 'Shipment', 'ShipmentItem',
        'ProcessException', 'Invoice', 'InvoiceLine', 'CreditMemo', 'CreditMemoLine', 'Payment', 'PaymentAuthorization',
        'PaymentGroup', 'PaymentLineInvoice', 'PaymentCredit', 'Refund', 'RefundLinePayment', 'PaymentGatewayLog',
        'Location', 'LocationGroup', 'LocationGroupAssignment', 'WebStore', 'SalesChannel', 'Product2', 'Pricebook2',
        'PricebookEntry', 'Account', 'Case', 'RecordType'
    };
    // A field name with any of these in it is personal. Matched on each part of a field path (Account.PersonEmail).
    public static final Pattern PERSONAL = Pattern.compile('(?i).*(email|phone|street|postalcode|latitude|longitude|fax|ipaddress|address).*');
    static final Pattern WRITES = Pattern.compile('(?is).*\\b(FOR\\s+(UPDATE|VIEW|REFERENCE)|UPDATE\\s+(TRACKING|VIEWSTAT)|ALL\\s+ROWS)\\b.*');
    static final Pattern UNNAMED = Pattern.compile('(?is).*\\b(FIELDS\\s*\\(|TYPEOF\\b).*');
    static final Pattern FROM_NAME = Pattern.compile('(?i)\\bFROM\\s+([A-Za-z_][A-Za-z0-9_]*)');
    static final Pattern WORD = Pattern.compile('[A-Za-z_][A-Za-z0-9_.]*');
    static final Pattern AGGREGATE = Pattern.compile('(?i)\\b(COUNT|COUNT_DISTINCT|SUM|AVG|MIN|MAX)\\s*\\(');
    static final Pattern END_LIMIT = Pattern.compile('(?is)^(.*\\bLIMIT\\s+)(\\d+)(\\s+OFFSET\\s+\\d+)?\\s*$');

    public class Request {
        @InvocableVariable(label='SOQL query' description='One SOQL SELECT on Order Management objects, such as SELECT SalesStore.Name s, COUNT(Id) n FROM OrderSummary WHERE OrderedDate = LAST_N_DAYS:30 GROUP BY SalesStore.Name ORDER BY COUNT(Id) DESC' required=true)
        public String query;
    }
    public class Result {
        @InvocableVariable(label='Rows' description='The rows as a JSON array; an aggregate row names each value by its alias, else expr0, expr1 and so on')
        public String rows;
        @InvocableVariable(label='Row count' description='How many rows are in Rows; for SELECT COUNT(), the count')
        public Integer rowCount;
        @InvocableVariable(label='More' description='True when the query matched more rows than were returned')
        public Boolean more;
        @InvocableVariable(label='Error' description='Why the query was refused or failed; fix the query and run it again')
        public String error;
    }

    @InvocableMethod(label='Run Order Management Query' description='Runs one read-only SOQL SELECT on Order Management objects as the user and returns the rows as JSON.')
    public static List<Result> run(List<Request> requests) {
        List<Result> out = new List<Result>();
        for (Request r : requests) out.add(runOne(r == null ? null : r.query));
        return out;
    }

    @TestVisible
    static Result runOne(String query) {
        Result res = new Result();
        res.rowCount = 0;
        res.more = false;
        res.rows = '[]';
        try {
            String q = check(query);
            if (Pattern.matches('(?is)\\s*SELECT\\s+COUNT\\(\\s*\\)\\s+FROM\\s.+', q)) {
                res.rowCount = Database.countQuery(q, AccessLevel.USER_MODE);
                res.rows = JSON.serialize(new List<Object>{ new Map<String, Object>{ 'count' => res.rowCount } });
                return res;
            }
            List<SObject> found = Database.query(capped(q), AccessLevel.USER_MODE);
            List<String> parts = new List<String>();
            Integer size = 2;
            for (SObject row : found) {
                if (parts.size() == ROWS) break;
                String one = JSON.serialize(row).replaceAll(',"url":"[^"]*"', '');
                if (size + one.length() + 1 > CHARS) break;
                parts.add(one);
                size += one.length() + 1;
            }
            res.rowCount = parts.size();
            res.more = found.size() > parts.size();
            res.rows = '[' + String.join(parts, ',') + ']';
        } catch (Exception e) {
            res.error = e.getMessage();
        }
        return res;
    }

    // The query as it will run, or an IllegalArgumentException saying why it can't.
    @TestVisible
    static String check(String query) {
        String q = query == null ? '' : query.trim();
        if (!Pattern.matches('(?is)SELECT\\s.+', q) || q.contains(';')) throw new IllegalArgumentException('Only one SOQL SELECT is allowed.');
        if (q.length() > 4000) throw new IllegalArgumentException('The query is longer than 4000 characters.');
        String bare = q.replaceAll('\'(?:\\\\.|[^\'\\\\])*\'', '\'\''); // string literals can't name objects or fields
        if (WRITES.matcher(bare).matches()) throw new IllegalArgumentException('FOR UPDATE, FOR VIEW, FOR REFERENCE, UPDATE TRACKING, UPDATE VIEWSTAT and ALL ROWS are not allowed.');
        Matcher w = WORD.matcher(bare);
        while (w.find()) {
            for (String part : w.group().split('\\.')) {
                if (PERSONAL.matcher(part).matches()) throw new IllegalArgumentException('Personal fields (emails, phones, addresses, postal codes, coordinates) can\'t be queried: ' + w.group());
            }
        }
        if (UNNAMED.matcher(bare).matches()) throw new IllegalArgumentException('FIELDS() and TYPEOF are not allowed: name each field.');
        Set<String> named = new Set<String>();
        Matcher f = FROM_NAME.matcher(bare);
        while (f.find()) named.add(f.group(1));
        if (named.isEmpty()) throw new IllegalArgumentException('Only one SOQL SELECT is allowed.');
        Map<String, String> canon = canonical();
        Set<String> main = new Set<String>(), rest = new Set<String>();
        for (String n : named) {
            if (canon.containsKey(n.toLowerCase())) main.add(canon.get(n.toLowerCase()));
            else rest.add(n);
        }
        // The objects the query reads from: those it names, and the children its subqueries reach.
        Set<String> scope = new Set<String>(main);
        if (!rest.isEmpty()) {
            Map<String, String> children = childRelationships(main);
            for (String n : rest) {
                if (!children.containsKey(n.toLowerCase())) throw new IllegalArgumentException(n + ' is not an Order Management object. Describe Object lists the ones you can query.');
                scope.add(children.get(n.toLowerCase()));
            }
        }
        Matcher p = WORD.matcher(bare);
        while (p.find()) {
            if (p.group().contains('.')) checkPath(p.group(), scope);
        }
        return q;
    }

    // A lookup path (FulfilledFromLocation.Name, OrderSummary.Account.Name) followed from every object the query reads
    // whose lookup it names: each object it passes through must be in OBJECTS, polymorphic lookups included (Owner can be
    // a User). A path no object in the query has is refused too, so nothing is followed that wasn't checked.
    @TestVisible
    static void checkPath(String path, Set<String> scope) {
        List<String> parts = path.split('\\.');
        Boolean found = false;
        for (String start : scope) {
            Set<String> at = new Set<String>{ start };
            for (Integer i = 0; i < parts.size() - 1 && !at.isEmpty(); i++) {
                Set<String> next = new Set<String>();
                for (String o : at) {
                    List<String> to = lookups(o).get(parts[i].toLowerCase());
                    if (to != null) next.addAll(to);
                }
                if (i == 0 && next.isEmpty()) break; // this object has no such lookup: the path is another object's
                if (i == 0) found = true;
                for (String o : next) {
                    if (!OBJECTS.contains(o)) throw new IllegalArgumentException(path + ' reads ' + o + ', which is not an Order Management object.');
                }
                if (next.isEmpty()) throw new IllegalArgumentException(path + ' follows a lookup that isn\'t there.');
                at = next;
            }
        }
        if (!found) throw new IllegalArgumentException(path + ' is not a lookup on the objects this query reads.');
    }

    static Map<String, Map<String, List<String>>> lookupCache = new Map<String, Map<String, List<String>>>();
    // An object's lookups by relationship name (lower case): the objects each can point to.
    static Map<String, List<String>> lookups(String obj) {
        if (lookupCache.containsKey(obj)) return lookupCache.get(obj);
        Map<String, List<String>> out = new Map<String, List<String>>();
        Schema.SObjectType t = Schema.getGlobalDescribe().get(obj.toLowerCase());
        if (t != null) {
            for (Schema.SObjectField sf : t.getDescribe(SObjectDescribeOptions.DEFERRED).fields.getMap().values()) {
                Schema.DescribeFieldResult d = sf.getDescribe();
                if (d.getRelationshipName() == null) continue;
                List<String> to = new List<String>();
                for (Schema.SObjectType r : d.getReferenceTo()) to.add(String.valueOf(r));
                out.put(d.getRelationshipName().toLowerCase(), to);
            }
        }
        lookupCache.put(obj, out);
        return out;
    }

    static Map<String, String> canonical() {
        Map<String, String> out = new Map<String, String>();
        for (String o : OBJECTS) out.put(o.toLowerCase(), o);
        return out;
    }

    // At most ROWS + 1 rows, so `more` can be told: a LIMIT at the end is lowered to that, and a query with none gets one.
    // An aggregate over the whole query (SELECT COUNT(Id) … with no GROUP BY) answers one row, and Salesforce refuses it
    // with a LIMIT, in an error Apex can't catch: it goes without one, and a LIMIT it was given is dropped.
    @TestVisible
    static String capped(String q) {
        Matcher m = END_LIMIT.matcher(q);
        if (overallAggregate(q)) return m.matches() ? m.group(1).replaceAll('(?is)\\bLIMIT\\s+$', '').trim() : q;
        if (m.matches()) {
            Integer n = Integer.valueOf(m.group(2));
            return n <= ROWS ? q : m.group(1) + (ROWS + 1) + (m.group(3) == null ? '' : m.group(3));
        }
        return q + ' LIMIT ' + (ROWS + 1);
    }

    // The outer query, without its string literals and subqueries, uses an aggregate function and has no GROUP BY.
    @TestVisible
    static Boolean overallAggregate(String q) {
        String bare = q.replaceAll('\'(?:\\\\.|[^\'\\\\])*\'', '\'\'');
        String top = '';
        Integer depth = 0, sub = 0; // sub: the depth a subquery opened at, 0 when outside one
        for (Integer i = 0; i < bare.length(); i++) {
            String c = bare.substring(i, i + 1);
            if (c == '(') {
                depth++;
                if (sub == 0 && Pattern.matches('(?is)\\s*SELECT\\s.*', bare.substring(i + 1))) sub = depth;
            }
            if (sub == 0) top += c;
            if (c == ')') {
                if (depth == sub) sub = 0;
                depth--;
            }
        }
        return AGGREGATE.matcher(top).find() && !Pattern.compile('(?i)\\bGROUP\\s+BY\\b').matcher(top).find();
    }

    // The child relationships (Cases, FulfillmentOrderLineItems …) of the objects named, by name in lower case, to the child
    // object, for the children in OBJECTS.
    static Map<String, String> childRelationships(Set<String> parents) {
        Map<String, String> out = new Map<String, String>();
        if (parents.isEmpty()) return out;
        for (Schema.DescribeSObjectResult d : Schema.describeSObjects(new List<String>(parents), SObjectDescribeOptions.DEFERRED)) {
            for (Schema.ChildRelationship c : d.getChildRelationships()) {
                String child = String.valueOf(c.getChildSObject());
                if (c.getRelationshipName() != null && OBJECTS.contains(child)) out.put(c.getRelationshipName().toLowerCase(), child);
            }
        }
        return out;
    }

    public static Set<String> lower(Set<String> names) {
        Set<String> out = new Set<String>();
        for (String n : names) out.add(n.toLowerCase());
        return out;
    }
}
