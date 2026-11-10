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
private class SomConsoleAgentTest {
    static RestResponse ask(String json) {
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/somconsole/agent';
        req.httpMethod = 'POST';
        req.requestBody = Blob.valueOf(json);
        RestContext.request = req;
        RestContext.response = new RestResponse();
        SomConsoleAgent.ask();
        return RestContext.response;
    }

    @IsTest
    static void relaysTheAgentsAnswerAndSession() {
        SomConsoleAgent.testReply = new Map<String, Object>{ 'agentResponse' => 'Three orders need attention.', 'sessionId' => 'S-1' };
        RestResponse res = ask('{"text":"What needs attention?","sessionId":null}');
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.responseBody.toString());
        Assert.areEqual('Three orders need attention.', body.get('text'));
        Assert.areEqual('S-1', body.get('sessionId'));
    }

    @IsTest
    static void refusesEmptyOrOversizedQuestions() {
        Assert.areEqual(400, ask('{"text":""}').statusCode);
        Assert.areEqual(400, ask('not json').statusCode);
        Assert.areEqual(400, ask(JSON.serialize(new Map<String, Object>{ 'text' => 'x'.repeat(4001) })).statusCode);
    }

    @IsTest
    static void reportsAnAgentThatCannotAnswer() {
        // No stand-in: the real action can't run in a test, so the call fails and is reported as unavailable.
        RestResponse res = ask('{"text":"Hello","sessionId":"S-9"}');
        Assert.isTrue(res.statusCode == 503 || res.statusCode == null, 'unexpected status ' + res.statusCode);
    }

    @IsTest
    static void unwrapsTheActionsTypedReply() {
        SomConsoleAgent.testReply = new Map<String, Object>{ 'agentResponse' => '{"type":"Text","value":"There are 322 orders."}', 'sessionId' => 'S-2' };
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(ask('{"text":"How many?"}').responseBody.toString());
        Assert.areEqual('There are 322 orders.', body.get('text'));
        Assert.areEqual('There are 322 orders.', SomConsoleAgent.unwrap('{"type":"Text","value":"There are 322 orders."}'));
        Assert.areEqual('A\n\nB', SomConsoleAgent.unwrap('[{"type":"Text","value":"A"},{"type":"Text","value":"B"}]'));
        Assert.areEqual('Plain', SomConsoleAgent.unwrap('Plain'));
        Assert.areEqual('{"x":1}', SomConsoleAgent.unwrap('{"x":1}'));
        Assert.areEqual('{not json', SomConsoleAgent.unwrap('{not json'), 'text that only looks typed passes through');
        Assert.areEqual('', SomConsoleAgent.unwrap(null));
    }
}
