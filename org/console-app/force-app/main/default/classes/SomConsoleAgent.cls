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
// Agentforce's chat when the Salesforce Order Management Operations Console runs inside Salesforce. The app domain can't reach the Agent API, so the page sends each
// question here and this class asks the agent through its invocable action (generateAiAgentResponse/<agent>). It relays text
// and nothing else: no DML, no record access of its own. What the agent can do is limited by the agent (org/agent), which
// has only read actions, and by the user's own permissions.
// POST /services/apexrest/somconsole/agent  {"text": "...", "sessionId": "<agent session Id or null>"}  →  {"text", "sessionId"}
@RestResource(urlMapping='/somconsole/agent')
global with sharing class SomConsoleAgent {
    @TestVisible static final String AGENT = 'OM_Console_Assistant_Classic';
    @TestVisible static Map<String, Object> testReply; // tests stand in for the agent

    @HttpPost
    global static void ask() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        Map<String, Object> body;
        try {
            body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.request.requestBody.toString());
        } catch (Exception e) {
            body = null;
        }
        String text = body == null ? null : (String) body.get('text');
        if (String.isBlank(text) || text.length() > 4000) {
            fail(res, 400, 'BAD_REQUEST', 'Send a question of 1 to 4000 characters');
            return;
        }
        try {
            Map<String, Object> out = reply(text, (String) body.get('sessionId'));
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'text' => unwrap((String) out.get('agentResponse')), 'sessionId' => out.get('sessionId') }));
        } catch (Exception e) {
            fail(res, 503, 'UNAVAILABLE', 'The agent could not answer: ' + e.getMessage());
        }
    }

    static Map<String, Object> reply(String text, String sessionId) {
        if (Test.isRunningTest() && testReply != null) return testReply;
        Invocable.Action action = Invocable.Action.createCustomAction('generateAiAgentResponse', AGENT);
        action.setInvocationParameter('userMessage', text);
        if (String.isNotBlank(sessionId)) action.setInvocationParameter('sessionId', sessionId);
        Invocable.Action.Result result = action.invoke()[0];
        if (!result.isSuccess()) {
            List<String> messages = new List<String>();
            for (Invocable.Action.Error e : result.getErrors()) messages.add(e.getMessage());
            throw new AgentException(String.join(messages, '; '));
        }
        return result.getOutputParameters();
    }

    // The action answers with typed JSON text: {"type":"Text","value":"…"} or a list of them. Return the words; anything
    // else passes through untouched.
    @TestVisible
    static String unwrap(String raw) {
        if (raw == null) return '';
        String t = raw.trim();
        if (!t.startsWith('{') && !t.startsWith('[')) return t;
        try {
            Object parsed = JSON.deserializeUntyped(t);
            List<Object> parts = parsed instanceof List<Object> ? (List<Object>) parsed : new List<Object>{ parsed };
            List<String> words = new List<String>();
            for (Object p : parts) {
                if (p instanceof Map<String, Object> && ((Map<String, Object>) p).get('value') instanceof String) words.add((String) ((Map<String, Object>) p).get('value'));
            }
            return words.isEmpty() ? t : String.join(words, '\n\n');
        } catch (Exception e) {
            return t;
        }
    }

    static void fail(RestResponse res, Integer status, String code, String message) {
        res.statusCode = status;
        res.responseBody = Blob.valueOf(JSON.serialize(new List<Map<String, String>>{ new Map<String, String>{ 'errorCode' => code, 'message' => message } }));
    }

    public class AgentException extends Exception {}
}
