# Agentforce's reasoning model

Which model Agentforce's agent (`OM_Console_Assistant_Classic`, org/agent) reasons with, how to change it, and the test to run before and after. Collected 2026-10-27 on a demo org from the Winter '27 release notes, the help article "Select Agentforce Model Option", core's source and the org itself.

## What it runs on

The agent was built in the legacy Agentforce Builder. Nothing in `org/agent` names a model: the planner bundle only sets `plannerType` (`AiCopilot__ReAct`). The model comes from the org:
- **Salesforce Default:** legacy agents reason with GPT-4o (new-builder agents with GPT-4.1). Setup → Agentforce Agents shows "GPT-4o is being deprecated in Legacy agents": OpenAI retires GPT-4o in March 2027, and after that every legacy agent is moved to GPT-5.6 Luna.
- **The org-wide picker** ("Select the Model for Agentforce" on Einstein Audit, Analytics, and Monitoring Setup) offers Salesforce Default, AWS-Hosted (Claude Haiku 4.5 on Bedrock) or Google Gemini (Gemini 3.5 Flash, new builder only), for every agent in the org. The demo org doesn't have that page: Setup search doesn't find it, and core shows it only with the `EinsteinFeedbackInDC` permission and Data Cloud. So the demo org is on Salesforce Default.

## Changing it

- **This agent, legacy builder:** the description ending in `#agent_new_gpt_model:on#` turns on GPT-5.6 Luna (release note `rn_einstein_models_legacy_builder_model_change`). It's the only per-agent choice a legacy agent has.
- **The new builder:** Agent Script sets a model per agent or subagent (`model_config: model: "model://sfdc_ai__DefaultBedrockAnthropicClaude45Haiku"`). Salesforce recommends GPT-4.1, Claude Haiku 4.5 and Gemini 3.5 Flash, "tested with agents", and allows any supported model. The org has an inactive new-builder copy, `OM_Console_Assistant` (planner `OM_Console_Assistant_v1`). Moving to it is a separate piece of work.
- **GPT-6:** GPT-6 Luna, Sol and Astra and GPT-6.1 Sol are generally available (Winter '27) for prompt templates, AI Models and the Models API. Neither the release notes nor the Agent Script guide name them for an agent's reasoning, and a legacy agent can't use them.

### How the tag went in on a demo org

`BotDefinition.Description` can't be written through the API. In Setup, the agent's details page only edits while the agent is off, and on this agent Save stayed disabled after the description changed (on another agent the same steps enabled it). What worked, with the agent active the whole time, was the org's own Bot definition with only the description changed and its version left out:

```bash
sf project retrieve start --metadata Bot:OM_Console_Assistant_Classic --target-org om-console --target-metadata-dir /tmp/bot --unzip
# In /tmp/bot/unpackaged/unpackaged/bots/OM_Console_Assistant_Classic.bot: add the tag to the Bot's own <description>
# (the last one, after its contextVariables), and delete the <botVersions> block. An active version can't be deployed.
sf project deploy start --metadata-dir /tmp/bot/unpackaged/unpackaged --target-org om-console --dry-run
sf project deploy start --metadata-dir /tmp/bot/unpackaged/unpackaged --target-org om-console
```

Retrieve it again afterwards and compare: only the description should differ (the context variables' mappings come back in another order). Never deploy `org/agent`'s `OM_Console_Assistant_Classic.bot-meta.xml` itself. It carries the tag, but it's a subset of the org's Bot: the org has context variables and a conversation variable that it doesn't.

### Whether it took

Not confirmed. After the deploy, and again after a deactivate/activate cycle, the answers read as before: the same sentences and the same times (below). The demo org keeps no generative AI audit records in Data Cloud (no `GenAIGatewayRequest__dlm`), so there's no record of the model, and the agent won't say which model it is. To confirm it, look at a session's details where the org has audit data, or ask Salesforce. The switch rolls out to Winter '27 orgs from the week of October 12, 2026.

## Testing Agentforce

`app/tools/agent-check.mjs` asks Agentforce the console's questions through the real page and the real agent, and checks
each answer. It submits nothing: the agent's actions are all reads.

```bash
node app/server.mjs                                   # on the org, not ?demo=1
PLAYWRIGHT=<playwright-core's index.mjs> node app/tools/agent-check.mjs --label gpt-4o --order <OrderSummaryId>
# … change the agent …
PLAYWRIGHT=… node app/tools/agent-check.mjs --label gpt-5.6-luna --order <OrderSummaryId>
node app/tools/agent-check.mjs --compare /tmp/agent-check/gpt-4o.json /tmp/agent-check/gpt-5.6-luna.json
node app/tools/agent-check.mjs --rescore /tmp/agent-check/gpt-4o.json   # saved replies checked again, after a check changes
```

`--only console` asks one page's questions only, and `--base` points at a server on another port
(`PORT=5188 node app/server.mjs`). The JSON goes to the OS's temp folder (`os.tmpdir()`, `/var/folders/…` on a Mac), not
`/tmp`.

| Where | Question | A good answer |
|---|---|---|
| Console | What is the status of order summary N? | names the order and its status |
| Console | Which locations have the most open fulfillment orders? | ranks locations with counts |

Every answer also fails if it's empty or names an action that isn't a read. Each run saves `<label>.json` (the question,
what the page sent, the reply, the screen after it) and a screenshot per page.

- **The brief.** On an order or a record the panel asks for a brief as it opens. Two messages out at once in one agent session, and one of them comes back empty ("No answer"). Since then the panel sends a session's questions one at a time (`createSessions()` in `agent-panel.js`), so a question asked during the brief waits for it. The tool still waits until Agentforce isn't typing before each question, so each time is that answer's alone.
- **Playwright** isn't a dependency: point `PLAYWRIGHT` at any `playwright-core` whose Chromium is downloaded (the `chromium-headless-shell` revision in its `browsers.json` is a folder in `~/Library/Caches/ms-playwright`). The tool uses Playwright's own Chromium. With `channel: 'chrome'` (Chrome 156, Playwright 1.62.1) the page closed on Salesforce's cross-site sign-in redirect.

### Results, 2026-10-27

Two runs on GPT-4o, then three with the tag (the third after a deactivate/activate cycle). Both console questions passed
in every run:

| Question | GPT-4o 1 | GPT-4o 2 | Tag 1 | Tag 2 | Tag 3 |
|---|---|---|---|---|---|
| Status of order summary 00035607 | ok 13 s | ok 13 s | ok 13 s | ok 14 s | ok 11 s |
| Locations with the most open fulfillment orders | ok 7 s | ok 7 s | ok 7 s | ok 6 s | ok 7 s |
