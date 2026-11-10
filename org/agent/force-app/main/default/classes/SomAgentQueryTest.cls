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
private class SomAgentQueryTest {
    @TestSetup
    static void data() {
        List<Account> accts = new List<Account>{ new Account(Name = 'Agent Query A'), new Account(Name = 'Agent Query B'), new Account(Name = 'Agent Query C') };
        insert accts;
        insert new Case(Subject = 'Agent query case', AccountId = accts[0].Id);
    }

    @IsTest
    static void runsASelectAsTheUser() {
        SomAgentQuery.Result r = SomAgentQuery.run(new List<SomAgentQuery.Request>{ request('SELECT Id, Name FROM Account WHERE Name LIKE \'Agent Query%\' ORDER BY Name') })[0];
        Assert.isNull(r.error, 'error: ' + r.error);
        Assert.areEqual(3, r.rowCount);
        Assert.isFalse(r.more);
        Assert.isTrue(r.rows.contains('Agent Query A'));
        Assert.isFalse(r.rows.contains('"url"'), 'no record addresses go back');
    }

    @IsTest
    static void capsTheRows() {
        SomAgentQuery.ROWS = 2;
        SomAgentQuery.Result r = SomAgentQuery.runOne('SELECT Id FROM Account WHERE Name LIKE \'Agent Query%\'');
        Assert.areEqual(2, r.rowCount);
        Assert.isTrue(r.more);
        Assert.areEqual('SELECT Id FROM Account LIMIT 3', SomAgentQuery.capped('SELECT Id FROM Account LIMIT 500'));
        Assert.areEqual('SELECT Id FROM Account LIMIT 1', SomAgentQuery.capped('SELECT Id FROM Account LIMIT 1'));
        Assert.areEqual('SELECT Id FROM Account LIMIT 3 OFFSET 10', SomAgentQuery.capped('SELECT Id FROM Account LIMIT 50 OFFSET 10'));
    }

    @IsTest
    static void countsAndGroups() {
        SomAgentQuery.Result c = SomAgentQuery.runOne('SELECT COUNT() FROM Account WHERE Name LIKE \'Agent Query%\'');
        Assert.isNull(c.error, 'error: ' + c.error);
        Assert.areEqual(3, c.rowCount);
        SomAgentQuery.Result g = SomAgentQuery.runOne('SELECT Name n, COUNT(Id) c FROM Account WHERE Name LIKE \'Agent Query%\' GROUP BY Name');
        Assert.isNull(g.error, 'error: ' + g.error);
        Assert.areEqual(3, g.rowCount);
        // An aggregate over the whole query takes no LIMIT ("how many orders today"): Salesforce refuses one, uncatchably.
        for (String q : new List<String>{
            'SELECT COUNT(Id) n FROM Account WHERE Name LIKE \'Agent Query%\'',
            'SELECT COUNT(Id) n, MAX(CreatedDate) latest FROM Account WHERE Name LIKE \'Agent Query%\' LIMIT 10',
            'SELECT COUNT(Id) FROM Account WHERE CreatedDate = TODAY AND Name LIKE \'Agent Query%\''
        }) {
            SomAgentQuery.Result o = SomAgentQuery.runOne(q);
            Assert.isNull(o.error, q + ': ' + o.error);
            Assert.areEqual(1, o.rowCount, q);
            Assert.isTrue(o.rows.contains('3'), q + ': ' + o.rows);
        }
        Assert.areEqual('SELECT SUM(Amount__c) FROM X', SomAgentQuery.capped('SELECT SUM(Amount__c) FROM X LIMIT 5 OFFSET 2'));
        // Grouped, or the aggregate only in a subquery or a literal: capped as usual.
        Assert.isFalse(SomAgentQuery.overallAggregate('SELECT Name, COUNT(Id) FROM Account GROUP BY Name'));
        Assert.isFalse(SomAgentQuery.overallAggregate('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Case WHERE Subject = \'max(\')'));
        Assert.isFalse(SomAgentQuery.overallAggregate('SELECT Name, (SELECT Id FROM Cases) FROM Account WHERE Name = \'count(x)\''));
        Assert.isTrue(SomAgentQuery.overallAggregate('SELECT count (Id) FROM Account WHERE Id IN (SELECT AccountId FROM Case GROUP BY AccountId)'));
    }

    @IsTest
    static void followsChildRelationshipsAndSemiJoins() {
        SomAgentQuery.Result r = SomAgentQuery.runOne('SELECT Name, (SELECT Subject FROM Cases) FROM Account WHERE Id IN (SELECT AccountId FROM Case) AND Name LIKE \'Agent Query%\'');
        Assert.isNull(r.error, 'error: ' + r.error);
        Assert.areEqual(1, r.rowCount);
        Assert.isTrue(r.rows.contains('Agent query case'));
    }

    @IsTest
    static void refusesWhatIsNotARead() {
        for (String q : new List<String>{
            null, '', 'DELETE FROM Account', 'FIND {x}', 'SELECT Id FROM Account; SELECT Id FROM Case',
            'SELECT Id FROM Account FOR UPDATE', 'SELECT Id FROM Account FOR VIEW', 'SELECT Id FROM Account FOR REFERENCE',
            'SELECT Id FROM Account UPDATE TRACKING', 'SELECT Id FROM Account UPDATE VIEWSTAT', 'SELECT Id FROM Account ALL ROWS'
        }) {
            SomAgentQuery.Result r = SomAgentQuery.runOne(q);
            Assert.isNotNull(r.error, 'refused: ' + q);
            Assert.areEqual(0, r.rowCount);
        }
    }

    @IsTest
    static void refusesOtherObjectsAndPersonalFields() {
        for (String q : new List<String>{
            'SELECT Id FROM Contact', 'SELECT Id FROM User', 'SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact)',
            'SELECT Id, Name, (SELECT Id FROM Contacts) FROM Account',
            'SELECT Phone FROM Account', 'SELECT Id FROM Account WHERE BillingStreet != null', 'SELECT Account.PersonEmail FROM Case'
        }) {
            Assert.isNotNull(SomAgentQuery.runOne(q).error, 'refused: ' + q);
        }
        // A literal is not a field: an @ in a value is fine.
        Assert.isNull(SomAgentQuery.runOne('SELECT Id FROM Account WHERE Name = \'a@b email phone\'').error);
    }

    @IsTest
    static void refusesFieldsItDidNotName() {
        for (String q : new List<String>{
            'SELECT FIELDS(STANDARD) FROM Account LIMIT 1', 'SELECT fields(all) FROM Case LIMIT 1', 'SELECT Id, FIELDS (CUSTOM) FROM Account LIMIT 1',
            'SELECT TYPEOF Owner WHEN User THEN Name END FROM Case'
        }) {
            Assert.isNotNull(SomAgentQuery.runOne(q).error, 'refused: ' + q);
        }
    }

    @IsTest
    static void followsLookupsOnlyInsideTheObjects() {
        // A lookup to an object outside OBJECTS is refused, a polymorphic one (Owner: User or Group) too.
        for (String q : new List<String>{
            'SELECT Owner.Username FROM Account', 'SELECT CreatedBy.Name FROM Case', 'SELECT Id FROM Case WHERE Owner.Name = \'x\'',
            'SELECT Account.Owner.Name FROM Case', 'SELECT Name, (SELECT Owner.Name FROM Cases) FROM Account', 'SELECT Contact.Name FROM Case',
            'SELECT NoSuch.Name FROM Account'
        }) {
            Assert.isNotNull(SomAgentQuery.runOne(q).error, 'refused: ' + q);
        }
        // Inside them it runs: a lookup, one in a subquery, and a record type's name.
        for (String q : new List<String>{
            'SELECT Account.Name FROM Case WHERE Account.Name LIKE \'Agent Query%\'',
            'SELECT Name, (SELECT Account.Name FROM Cases) FROM Account WHERE Name LIKE \'Agent Query%\'',
            'SELECT Account.Name a, COUNT(Id) n FROM Case GROUP BY Account.Name'
        }) {
            SomAgentQuery.Result r = SomAgentQuery.runOne(q);
            Assert.isNull(r.error, q + ': ' + r.error);
            Assert.isTrue(r.rowCount > 0, q);
        }
    }

    @IsTest
    static void reportsAQueryError() {
        SomAgentQuery.Result r = SomAgentQuery.runOne('SELECT NoSuchField__c FROM Account');
        Assert.isNotNull(r.error);
        Assert.areEqual('[]', r.rows);
    }

    @IsTest
    static void describesTheObjects() {
        SomAgentDescribe.Result all = SomAgentDescribe.run(new List<SomAgentDescribe.Request>{ new SomAgentDescribe.Request() })[0];
        Assert.isNull(all.error, 'error: ' + all.error);
        Assert.isTrue(all.schema.contains('"Account"'));
        Assert.isFalse(all.schema.contains('"Contact"'));

        SomAgentDescribe.Request one = new SomAgentDescribe.Request();
        one.objectName = 'account';
        SomAgentDescribe.Result a = SomAgentDescribe.run(new List<SomAgentDescribe.Request>{ one })[0];
        Assert.isNull(a.error, 'error: ' + a.error);
        Map<String, Object> s = (Map<String, Object>) JSON.deserializeUntyped(a.schema);
        Assert.areEqual('Account', s.get('object'));
        Set<String> names = new Set<String>();
        for (Object f : (List<Object>) s.get('fields')) names.add((String) ((Map<String, Object>) f).get('name'));
        Assert.isTrue(names.contains('Name'));
        Assert.isFalse(names.contains('Phone'), 'personal fields are left out');
        Assert.isFalse(names.contains('BillingStreet'));
        Assert.isTrue(a.schema.contains('"Cases"'), 'child relationships to Order Management objects');
        Assert.isFalse(a.schema.contains('"Contacts"'));

        Assert.isNotNull(SomAgentDescribe.describeOne('Contact').error);
    }

    static SomAgentQuery.Request request(String q) {
        SomAgentQuery.Request r = new SomAgentQuery.Request();
        r.query = q;
        return r;
    }
}
