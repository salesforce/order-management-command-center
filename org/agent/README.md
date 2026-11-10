# OM Console Assistant (agent source)

The Agentforce agent behind the console's Agentforce panel: `OM_Console_Assistant_Classic`, a classic topic-based employee agent. It has three topics, and every action in them only **reads**: the standard read actions, plus two of its own in `classes/`:
- **Order Lookup** and **Analysis**, for the console;
- **Service Desk**, which the console doesn't use.

Its own two actions are in every topic:
- **Run Query** (`SomAgentQuery`) runs one SOQL `SELECT` the agent writes, as the user (`AccessLevel.USER_MODE`), and returns up to 200 rows as JSON. It only reads: there's no DML, and `FOR UPDATE`, `FOR VIEW`, `FOR REFERENCE`, `UPDATE TRACKING`, `UPDATE VIEWSTAT` and `ALL ROWS` are refused. Every object the query names must be in `OBJECTS`, Order Management's objects and the ones its answers name, or be a child relationship to one. So must every object a lookup path passes through: `Owner.Username` and `CreatedBy.Name` are refused because they read User. Personal fields (emails, phones, street addresses, postal codes, coordinates) are refused, and so are `FIELDS()` and `TYPEOF`, which would pick fields or objects the query doesn't name.
- **Describe Object** (`SomAgentDescribe`) lists those objects, or one object's readable fields, lookups, active picklist values and child relationships, with personal fields left out.

`SOM_Agent_Access` grants the two classes and nothing else. Every user who asks Agentforce needs it. `app/test/shared/unit/agent-query.test.mjs` checks that every action in the bundle is a read, that each action's schema matches its class, that the classes have no DML and query only in user mode, and that the instructions name only objects in `OBJECTS`.

The panel's read-only promise depends on that, so never add Update Record Fields or any other write action.

In every topic the agent names records (an order by its number, a store or channel by its name) and links each as `[name](ObjectApiName/Id)`. The panel turns a link to a record its page can open into a button that opens it (`renderText()` and `recordRef()` in `app/public/shared/agent/agent-panel.js`). Any other link shows only its label. Analysis also has a guide to Order Management's objects and fields: the webstore is `SalesStore.Name`, the sales channel is `SalesChannel.SalesChannelName`, and a fulfillment order's location is `FulfilledFromLocation.Name`. A breakdown groups by those names, never by Id.

The org keeps a topic's instructions in the order they appear in the file and renumbers their `sortOrder` to match (a demo org, 2026-10-27), so put an instruction where it should come. To compare with what's deployed, retrieve the bundle with `--api-version 66.0` into a folder of its own (`--target-metadata-dir`); at the org's 68.0 the CLI retrieves nothing.

The commands use the org alias `om-console`. Deploying changes the org, so ask first if it's shared:

An active agent can't be updated, so switch it off, deploy the planner bundle (topics and instructions) and switch it back on. Run from `org/agent`. The agent is off for everyone in between, so always run the last step, even if the deploy fails:

```bash
sf project deploy start --source-dir force-app/main/default/classes --source-dir force-app/main/default/permissionsets --test-level RunSpecifiedTests --tests SomAgentQueryTest --target-org om-console
sf agent deactivate --api-name OM_Console_Assistant_Classic --target-org om-console
sf project deploy start --source-dir force-app/main/default/genAiPlannerBundles --target-org om-console
sf agent activate --api-name OM_Console_Assistant_Classic --target-org om-console
```

The first step deploys the Apex classes and `SOM_Agent_Access`. The agent stays on while it runs, and the bundle can't deploy until the classes are there. Then assign `SOM_Agent_Access` to the people who use Agentforce (`sf org assign permset --name SOM_Agent_Access --on-behalf-of <username> …`). To check the classes without changing the org, run the first step with `validate` in place of `start`.

`BotVersion.Status` can still read Active after the deactivate, and the deploy goes through anyway. Deploying the whole project (`sf project deploy start` without `--source-dir`) also touches the active bot version and fails.

After deploying, check two things:
- The agent is active.
- Under Setup → Agentforce Agents → OM Console Assistant → Connections, **Salesforce Order Management Operations Console** is listed under API.

Don't deploy `bots/` from here. `OM_Console_Assistant_Classic.bot-meta.xml` is a subset of the org's Bot, which also has context variables and a conversation variable, and the bot version can't be deployed while it's active.

## Its model, and testing it

The agent reasons with the org's Salesforce Default model, GPT-4o for a legacy-builder agent. Its description ends in `#agent_new_gpt_model:on#`, which asks for GPT-5.6 Luna instead; on a demo org that went in on 2026-10-27, not yet confirmed to take effect. [docs/shared/agent-model.md](../../docs/shared/agent-model.md) has the choices, how the tag was deployed, and the results.

After changing the agent (its instructions or its model), run `app/tools/agent-check.mjs` before and after, and compare. It asks the console the same questions through the real page and checks each answer. It submits nothing.
