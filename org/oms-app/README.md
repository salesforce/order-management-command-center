# Salesforce Order Management Operations Console inside the Order Management app

The console as a tab in Order Management's navigation menu, so an agent opens it without leaving the console app.
- **What's here:**
  - the standard Order Management app (`standard__OMConsole`, a Lightning console app) as a demo org had it on 2026-10-14, with the console's tab added after its analytics tab;
  - its Order Summary record page, as the org has it. Salesforce Order Management Operations Console was briefly a tab there ([below](#salesforce-order-management-operations-console-on-the-order-summary-record-page)).
- **The tab itself** lives with the console: `SOM_Console_Web` is in `org/console-app`, and `SOM_Console_Access` makes it
  visible.

## How it works

- **The tab is a web tab** framing the app's address (`AppMenuItem.StartUrl`, for example `https://yourdomain--c.my.salesforce.app/app/c__SOM_Console`).
  - The app domain allows it: its pages send `frame-ancestors 'self' https://yourdomain.lightning.force.com`.
  - The sign-in carries into the frame. Checked 2026-10-14 in headless Chromium: the console loaded live data inside Order Management.
- **The URLs are placeholders.** Change `<url>` in the tab to your org's StartUrl.

## Salesforce Order Management Operations Console on the Order Summary record page

**Not on the page for now.** `flexipages/Order_Summary_Record_Page` is the page Order Management opens Order Summary records with (the app's View override), as a demo org has it (retrieved 2026-10-22).
- **2026-10-22:** an Salesforce Order Management Operations Console tab after Service History was deployed and checked live. It was taken off the same day: the original page went back. The tab is the 36 lines commit `39a3a46` added to this page.
- **Still in the org, unused:** the LWC `somConsoleFrame` and the trusted URL `SOM_Console_App`, both in `org/console-app`.

How the tab worked:
- **`somConsoleFrame`** frames the console's app at `?order=<recordId>&view=details`, so the console opens on that order (`openFromUrl()` in `index.html`). It only frames `https://…my.salesforce.app/app/…` addresses (`frameUrl.js`).
- **Lightning needs a trusted URL for the frame.** Lightning's `frame-src` lists `*.force.com`, `*.salesforce.com` and the org's trusted URLs, but not `*.my.salesforce.app`. A frame added to this page without one was refused (`frame-src`, a demo org, 2026-10-22). `SOM_Console_App` allows the app's origin for frames only, in Lightning Experience only.
- **The deep link survives the app domain's sign-in.** Live, the frame loaded `…/app/c__SOM_Console?order=<Id>&view=details` and the console opened that order with live data.
- **Set every property on the page.** App Builder writes `consoleUrl`, `view` and `height` into the page; the component's defaults apply only there. Without `consoleUrl`, the tab says the address isn't set.
- **Who can see it:** everyone who opens the page sees the tab. Only users with `SOM_Console_Access` can open the console inside it.
- **Fit:** the frame is as wide as the page's main column, so the order panel covers most of the console's dashboard.

**To put it back:**
1. Retrieve the org's page and check it still matches this file.
2. Add the tab and its facet from `39a3a46` again.
3. Deploy the page: `sf project deploy start --source-dir force-app --test-level RunSpecifiedTests --tests SomConsoleReadTest --target-org om-console`.

The component is already in the org. If it isn't (another org), deploy it with the trusted URL and the page from one temporary project, because the page depends on it and they're in different projects. Quick deploy refused a validation of the three, most likely because there's no Apex in it. A deploy replaces the page's whole definition, so retrieve it first.

## In-org limits

Inside Salesforce, the app's own session can call GraphQL and Apex REST, but Connect REST answers `INVALID_SESSION_ID` (a demo org, 2026-10-14), and Apex gets the same session. So in-org every read goes through Apex or GraphQL:

| What | In-org path |
|---|---|
| Reads | `SomConsoleRead` (SOQL, describe), aggregates through UI API GraphQL |
| Stock, delivery estimates | `SomConsoleRead`: `OmnichannelInventoryService.getInventoryAvailability`, `ExtendedCommerceDelivery.estimateDeliveryDate` |
| Product search and details | `SomConsoleRead`: `ConnectApi.Repricing.searchProducts`, `productDetails` (Order Management's own search, B2C Commerce stores included) |

See [in-org.md](../../docs/shared/gotchas/in-org.md) for why.

## Deploy (ask first if the org is shared)

Replace `yourdomain` with your org's My Domain before deploying.

Deploy the tab and permission set with `org/console-app` first, then the app:

```bash
cd org/oms-app
sf project deploy start --source-dir force-app --test-level RunSpecifiedTests --tests SomConsoleReadTest --target-org om-console
```

**This replaces the app's whole definition.** Retrieve `CustomApplication:standard__OMConsole` first, and merge in anything changed in the org since 2026-10-14.

**To remove the tab from Order Management:** delete its `<tabs>` line and its `<mappings>` entry, then deploy again.
