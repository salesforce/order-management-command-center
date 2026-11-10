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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeOrg, SCHEMA } from "../../support/fake-org.mjs";

const BOT = [{ name: 'Id' }, { name: 'DeveloperName' }];
const SOQL = "SELECT Id FROM BotDefinition WHERE DeveloperName = 'OM_Console_Assistant_Classic' LIMIT 1";
const ACTIVE = "SELECT Id FROM BotDefinition WHERE DeveloperName = 'OM_Console_Assistant_Classic' AND Id IN (SELECT BotDefinitionId FROM BotVersion WHERE Status = 'Active') LIMIT 1";
const withVersions = (rows) => fakeOrg({ objects: [...Object.keys(SCHEMA), 'BotDefinition', 'BotVersion'], schema: { BotDefinition: BOT, BotVersion: [{ name: 'Id' }, { name: 'BotDefinitionId' }, { name: 'Status' }] }, queries: [[/FROM BotDefinition/, rows]] });

test('agentInfo asks for an Active version when BotVersion is in the org', async () => {
  const org = withVersions([{ Id: '0XxWs000001NmPxKAK' }]);
  assert.deepEqual(await org.core.route('/api/agent/info'), { agent: { id: '0XxWs000001NmPxKAK' } });
  assert.deepEqual(org.soql(), [ACTIVE]);
});

test('agentInfo is null when the agent has no Active version', async () => {
  const org = withVersions([]);
  assert.deepEqual(await org.core.route('/api/agent/info'), { agent: null });
  assert.deepEqual(org.soql(), [ACTIVE]);
});

test('a miss is asked again, so an agent activated later is found', async () => {
  let rows = [];
  const org = fakeOrg({ objects: [...Object.keys(SCHEMA), 'BotDefinition', 'BotVersion'], schema: { BotDefinition: BOT, BotVersion: [{ name: 'Id' }] }, queries: [[/FROM BotDefinition/, () => rows]] });
  assert.deepEqual(await org.core.route('/api/agent/info'), { agent: null });
  rows = [{ Id: '0XxWs000001NmPxKAK' }];
  assert.deepEqual(await org.core.route('/api/agent/info'), { agent: { id: '0XxWs000001NmPxKAK' } });
});

test('agentInfo looks the agent up by developer name', async () => {
  const org = fakeOrg({ objects: [...Object.keys(SCHEMA), 'BotDefinition'], schema: { BotDefinition: BOT }, queries: [[/FROM BotDefinition/, [{ Id: '0XxWs000001NmPxKAK' }]]] });
  assert.deepEqual(await org.core.route('/api/agent/info'), { agent: { id: '0XxWs000001NmPxKAK' } });
  assert.deepEqual(org.soql(), [SOQL]);
});

test('agentInfo is null when the agent is missing', async () => {
  const none = fakeOrg({ objects: [...Object.keys(SCHEMA), 'BotDefinition'], schema: { BotDefinition: BOT }, queries: [[/FROM BotDefinition/, []]] });
  assert.deepEqual(await none.core.route('/api/agent/info'), { agent: null });
});

test('agentInfo is null when BotDefinition is not in the org, without querying', async () => {
  const org = fakeOrg();
  assert.deepEqual(await org.core.route('/api/agent/info'), { agent: null });
  assert.deepEqual(org.soql(), []);
});

test('a found agent is kept, so later calls do not query again', async () => {
  const org = fakeOrg({ objects: [...Object.keys(SCHEMA), 'BotDefinition'], schema: { BotDefinition: BOT }, queries: [[/FROM BotDefinition/, [{ Id: '0XxWs000001NmPxKAK' }]]] });
  await org.core.route('/api/agent/info');
  assert.deepEqual(await org.core.route('/api/agent/info'), { agent: { id: '0XxWs000001NmPxKAK' } });
  assert.equal(org.soql().length, 1);
});
