# Salesforce Order Management Operations Console inside Salesforce

The Operations Console (`app/public/`'s console page) as a Multi-Framework app, opened from the App Launcher, reading through the read-only Apex REST class `SomConsoleRead`.
- **What gets deployed:**
  - the UIBundle `SOM_Console` (built, not committed);
  - the CustomApplication `SOM_Console`;
  - the Apex classes `SomConsoleRead` and `SomConsoleAgent`, with their tests (and `SomConsoleConnect`, where the org can compile it);
  - the web tab `SOM_Console_Web`, which the permission set lists, and which frames the app inside the Order Management Lightning app (`org/oms-app`);
  - the permission set `SOM_Console_Access`.
- **Not part of these steps:** the LWC `somConsoleFrame` and the trusted URL `SOM_Console_App` (see [`org/oms-app`](../oms-app/README.md)).

## Prerequisites

Do these before the steps. The slow one comes first, so you can use its wait.

### A. Start the slow one first (about 15 minutes of waiting)

In Setup, as an admin:
1. **Setup > Salesforce Multi-Framework Apps:** click **Enable Domain** if the button shows. The status must be Active.
2. **Setup > My Domain > Routing and Policies:** tick **Use Salesforce Edge Network (Hyperforce AWS)**. Choose **Global** if users come from several regions, or **US only** if a residency rule says so. Save.
   - Saving locks My Domain changes for about 15 minutes ("We're processing your last request"). It is done when the page says "This org uses Salesforce Edge Network".
   - It changes routing for every user of the org, so in production get the owner's yes first.

During the wait, do B and C and steps 1 to 4 below. Building the bundle and the Apex dry run don't touch this setting. Hold the app deploy (step 5) until the wait is over.

### B. Access

- A clone of this repository.
- An org user who can deploy metadata and Apex and assign permission sets (System Administrator works), with API access.
- If the org is production, the owner's yes for each real deploy and for the permission set assignment. Every deploy below has a dry run first.

### C. Tools

- Node 18 or newer (`node --version`), git, and the Salesforce CLI (`sf`), logged in: `sf org login web --alias <alias> --instance-url https://<mydomain>.my.salesforce.com`.
- `sd` (a find-and-replace tool) is optional; without it, edit the tab file by hand in step 3.

### D. Know before you start

- The org's My Domain name and the alias you logged in with (`<mydomain>` and `<alias>` below).
- The usernames to give access to. Skip anyone on a Platform licence (W-23932028).
- Optional, only for the Agentforce chat panel: an Agentforce Employee Agent, **Require first-party use of Salesforce cookies** turned off, and the app domain in Trusted Domains for Inline Frames. The console's views work without them.

## Deploy (ask before each step if the org is shared)

Run `sf` from `org/console-app`; from the repository root it fails with "not a valid Salesforce DX project". Add `--dry-run` to a deploy to check it without changing the org.

### 1. Check the org

```bash
sf data query --target-org <alias> --query "SELECT Name, IsSandbox, InstanceName FROM Organization"
sf data query --target-org <alias> --query "SELECT Name, StartUrl FROM AppMenuItem WHERE Name = 'SOM_Console'"
sf data query --target-org <alias> --query "SELECT Name FROM ApexClass WHERE Name LIKE 'SomConsole%'"
```

Good: one row from the first query. An org that isn't a sandbox is production. The other two return no rows on a first install; rows mean an upgrade.

### 2. Build the UI bundle

From the repository root: `node app/tools/build-ui-bundle.mjs`. Good: it prints `Built .../uiBundles/SOM_Console (46 files)` and exits 0.

### 3. Set the tab address (a local edit; don't commit it)

Replace `yourdomain` in `force-app/main/default/tabs/SOM_Console_Web.tab-meta.xml` with your My Domain. A tab left on the placeholder deploys without an error (a dry run accepts it), then frames an address that doesn't exist. The file in git stays a template. From `org/console-app`:

```bash
sd 'yourdomain--c' '<mydomain>--c' force-app/main/default/tabs/SOM_Console_Web.tab-meta.xml
```

Leave the edit in place until the real deploy in step 5 is done; the cleanup is there.

The `<url>` then reads `https://<mydomain>--c.my.salesforce.app/app/c__SOM_Console`.

### 4. Deploy the Apex

Production runs tests. List both test classes, or `SomConsoleAgent` fails the 75% coverage rule. Dry-run first, then run it without `--dry-run`:

```bash
sf project deploy start --dry-run --source-dir force-app/main/default/classes \
  --test-level RunSpecifiedTests --tests SomConsoleReadTest --tests SomConsoleAgentTest --target-org <alias>
```

Good: Succeeded, 23 tests pass (`SomConsoleReadTest` and `SomConsoleAgentTest`). If it fails with `Type is not visible: ConnectApi.OmnichannelInventoryService`, use the four-class command under "If `SomConsoleConnect` doesn't compile" below. After the real deploy the classes show as Active (`SELECT Name, Status FROM ApexClass WHERE Name LIKE 'SomConsole%'`).

### 5. Deploy the app, tab and permission set

Do this after step 4 is really deployed, and after prerequisite A has finished. The permission set grants the Apex classes, so its dry run fails with `no ApexClass named SomConsoleAgent found` until then. It also lists the tab, so `tabs` must be in the same deploy; without it you get `no CustomTab named SOM_Console_Web found`.

```bash
sf project deploy start --dry-run \
  --source-dir force-app/main/default/uiBundles \
  --source-dir force-app/main/default/applications \
  --source-dir force-app/main/default/tabs \
  --source-dir force-app/main/default/permissionsets --target-org <alias>
```

Good: Succeeded, 51 components. Then run it again without `--dry-run`. Once the real deploy has succeeded, put the tab file back to the template so the edit can't be committed:

```bash
git checkout force-app/main/default/tabs/SOM_Console_Web.tab-meta.xml
```

### 6. Give people access

```bash
sf org assign permset --name SOM_Console_Access --target-org <alias> --on-behalf-of <username>
```

Check: `SELECT Assignee.Username FROM PermissionSetAssignment WHERE PermissionSet.Name = 'SOM_Console_Access'`.

### 7. Open it

The app opens at `https://<mydomain>--c.my.salesforce.app/app/c__SOM_Console`. In the Order Management Lightning app, the App Launcher lists the tab as **Salesforce OM Operations Console** under **Items**, not Apps. Searching "SOM" finds nothing; search "Salesforce OM" or "Operations Console". The tab (`https://<mydomain>.lightning.force.com/lightning/n/SOM_Console_Web`) frames the same page.

### If `SomConsoleConnect` doesn't compile

`SomConsoleConnect` reads stock (`ConnectApi.OmnichannelInventoryService`) and delivery estimates (`ConnectApi.ExtendedCommerceDelivery`). An org without Omnichannel Inventory or Delivery Estimation fails with `Type is not visible: ConnectApi.OmnichannelInventoryService`, and `SomConsoleConnectTest` fails as a dependent. A deploy is all-or-nothing, so no class is deployed and no test runs. Deploy the four classes by name instead, with a dry run first (the same command without `--dry-run` is the real deploy):

```bash
sf project deploy start --dry-run --target-org <alias> \
  --metadata ApexClass:SomConsoleRead --metadata ApexClass:SomConsoleReadTest \
  --metadata ApexClass:SomConsoleAgent --metadata ApexClass:SomConsoleAgentTest \
  --test-level RunSpecifiedTests --tests SomConsoleReadTest --tests SomConsoleAgentTest
```

Good: Succeeded, 4 components, 23 tests.

The console's stock and delivery-estimate lookups don't work until `SomConsoleConnect` is deployed; its other views do.

### Redeploying after a front-end change

Build the bundle again and deploy `uiBundles` only (step 5 without the other folders). Apex and the permission set need no redeploy for that.

## Check after a deploy

Seen on a first install in a production org (Enterprise, no Omnichannel Inventory): the four-class Apex deploy created 4 classes and passed 23 tests, and step 5 deployed 51 components. The `AppMenuItem` query returned the app address, and the app and the Lightning tab both loaded the Operations Console, Dashboard, Service Console and Limits views. "Agent_Proposal__c not deployed" on the Operations Console is expected in an org without that object.

1. **Deployment Status** (Setup): both deploys Succeeded, with the Apex tests passed.
2. **Open the app** at its address: the Operations Console, Dashboard, Service Console and Limits views show data. Leave Auto-refresh off on a large org: each panel is its own request.
3. **An empty panel** can mean a permission or field-level-security gap instead of no data.
4. **Large orgs:** aggregates go through UI API GraphQL because Apex caps a transaction at 50,000 scanned rows (`docs/apex-limits.md`). Check the Limits view on a large org before calling a change done.

## Common problems

| You see | Cause | Fix |
|---|---|---|
| Not a valid Salesforce DX project | Ran `sf` from the repository root | `cd org/console-app` |
| Apex dry run fails, `SomConsoleAgent` at 0% coverage | Only one test class listed | List both test classes |
| `Type is not visible: ConnectApi...` | The org lacks Omnichannel Inventory or Delivery Estimation | The four-class deploy above |
| No CustomTab named SOM_Console_Web | `tabs` left out of step 5 | Add the `tabs` folder |
| No ApexClass named SomConsoleAgent | Step 5 dry run before step 4 is really deployed | Deploy the Apex first |
| Can't change My Domain, "wait 15 minutes" | The Edge Network change is processing | Wait |
| The app isn't in the App Launcher | You searched "SOM" | Search "Operations Console"; it lists under Items |
| Can't assign the permission set | A Platform licence user | Skip that user |
| "Agent_Proposal__c not deployed" | That object isn't in the org | Expected |
