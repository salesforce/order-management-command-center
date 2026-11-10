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
// Agentforce's Describe Object action: what it can query with Run Query (SomAgentQuery), so it writes SOQL from the org's own
// schema instead of guessing. With no object it lists the Order Management objects this org has; with one, that object's
// fields the user can read (name, label, type, what a lookup points to, active picklist values) and its child
// relationships to other Order Management objects, for subqueries. Personal fields are left out, as Run Query refuses them.
// It reads metadata only: no query, no DML.
public with sharing class SomAgentDescribe {
    @TestVisible static final Integer VALUES = 25; // picklist values per field
    @TestVisible static final Integer CHARS = 30000;

    public class Request {
        @InvocableVariable(label='Object' description='The API name of an Order Management object, such as OrderSummary or FulfillmentOrder; leave empty to list the objects')
        public String objectName;
    }
    public class Result {
        @InvocableVariable(label='Schema' description='JSON: the objects, or the object\'s fields and child relationships')
        public String schema;
        @InvocableVariable(label='Error' description='Why the object could not be described')
        public String error;
    }

    @InvocableMethod(label='Describe Order Management Object' description='Lists the Order Management objects, or one object\'s fields, lookups, picklist values and child relationships, for writing a Run Query SOQL.')
    public static List<Result> run(List<Request> requests) {
        List<Result> out = new List<Result>();
        for (Request r : requests) out.add(describeOne(r == null ? null : r.objectName));
        return out;
    }

    @TestVisible
    static Result describeOne(String objectName) {
        Result res = new Result();
        try {
            res.schema = String.isBlank(objectName) ? objects() : fields(canonical(objectName.trim()));
        } catch (Exception e) {
            res.error = e.getMessage();
        }
        return res;
    }

    static String canonical(String name) {
        for (String o : SomAgentQuery.OBJECTS) if (o.equalsIgnoreCase(name)) return o;
        throw new IllegalArgumentException(name + ' is not an Order Management object. Describe Object with no object lists them.');
    }

    static String objects() {
        Map<String, Schema.SObjectType> all = Schema.getGlobalDescribe();
        List<Object> out = new List<Object>();
        List<String> names = new List<String>(SomAgentQuery.OBJECTS);
        names.sort();
        for (String n : names) {
            Schema.SObjectType t = all.get(n.toLowerCase());
            if (t == null) continue; // not in this org
            Schema.DescribeSObjectResult d = t.getDescribe(SObjectDescribeOptions.DEFERRED);
            if (d.isAccessible()) out.add(new Map<String, Object>{ 'name' => n, 'label' => d.getLabel() });
        }
        return JSON.serialize(new Map<String, Object>{ 'objects' => out });
    }

    static String fields(String name) {
        Schema.DescribeSObjectResult d = Schema.describeSObjects(new List<String>{ name }, SObjectDescribeOptions.DEFERRED)[0];
        if (!d.isAccessible()) throw new IllegalArgumentException('You can\'t read ' + name + '.');
        Set<String> allowed = SomAgentQuery.lower(SomAgentQuery.OBJECTS);
        List<Object> fs = new List<Object>();
        for (Schema.SObjectField sf : d.fields.getMap().values()) {
            Schema.DescribeFieldResult f = sf.getDescribe();
            if (!f.isAccessible() || SomAgentQuery.PERSONAL.matcher(f.getName()).matches()) continue;
            Map<String, Object> one = new Map<String, Object>{ 'name' => f.getName(), 'label' => f.getLabel(), 'type' => String.valueOf(f.getType()).toLowerCase() };
            List<String> to = new List<String>();
            for (Schema.SObjectType t : f.getReferenceTo()) to.add(String.valueOf(t));
            if (!to.isEmpty()) {
                one.put('referenceTo', to);
                one.put('relationshipName', f.getRelationshipName());
            }
            List<String> vals = new List<String>();
            for (Schema.PicklistEntry p : f.getPicklistValues()) {
                if (p.isActive() && vals.size() < VALUES) vals.add(p.getValue());
            }
            if (!vals.isEmpty()) one.put('values', vals);
            fs.add(one);
        }
        List<Object> children = new List<Object>();
        for (Schema.ChildRelationship c : d.getChildRelationships()) {
            String child = String.valueOf(c.getChildSObject());
            if (c.getRelationshipName() != null && allowed.contains(child.toLowerCase())) {
                children.add(new Map<String, Object>{ 'relationshipName' => c.getRelationshipName(), 'object' => child, 'field' => String.valueOf(c.getField()) });
            }
        }
        String out = JSON.serialize(new Map<String, Object>{ 'object' => name, 'label' => d.getLabel(), 'fields' => fs, 'childRelationships' => children });
        // A very wide object: drop the picklist values first, then cut.
        if (out.length() > CHARS) {
            for (Object o : fs) ((Map<String, Object>) o).remove('values');
            out = JSON.serialize(new Map<String, Object>{ 'object' => name, 'label' => d.getLabel(), 'fields' => fs, 'childRelationships' => children });
        }
        return out.length() > CHARS ? out.left(CHARS) : out;
    }
}
