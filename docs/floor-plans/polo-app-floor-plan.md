# Polo app floor plan

This is the floor plan of the shell on `main`. A new screen does not get a route until a floor plan for that screen is written **before any new screen** is built. The gate is `apps/web/src/components/layout/navConfig.floor-plan.test.ts`. It fails when `NAV_SECTIONS` or `ADMIN_SETTINGS` in `apps/web/src/components/layout/navConfig.ts` gains a route this file does not name in backticks.

Names below are rooms in the product, not customer records. Sample rows in the app stay synthetic.

## Shell

The signed-in app is one room with a rail on the left and a canvas on the right. The rail is the same list on desktop and in the phone drawer. Items with a feature key stay off the drawing until Settings turns that module on.

```
+---------------------------+----------------------------------------------+
| Polo rail                 | Top bar: search, org, the signed-in person   |
|                           |----------------------------------------------|
| Home                      |                                              |
|   Dashboard               |                                              |
|   Quick Start             |              Page canvas                     |
| Sales                     |                                              |
| Accounts                  |   One primary route fills this area.         |
| Agreements                |   Detail pages open inside the same canvas.  |
| Pipeline                  |                                              |
| Bids & RFP                |                                              |
| Workspace                 |                                              |
|                           |                                              |
| Settings                  |                                              |
+---------------------------+----------------------------------------------+
```

Phone: the rail collapses to a drawer. The canvas is the only room on screen. Touch targets stay at least 44px. The drawer and the rail read the same `NAV_SECTIONS` list, so a room that exists on one and not the other is a bug.

## Rooms

### Home

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Dashboard | `/dashboard` | Open pipeline, tasks that are due, and the charts already on the home page. |
| Quick Start | `/quick-start` | First-run steps for an empty workspace. No sample company is required. |

### Sales

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Forecasts | `/forecasts` | Quarter bars and the commit. Amounts stay in integer micros until the label. |
| Win/Loss Review | `/win-loss` | Won and lost counts, reasons, and cycle length. |
| Sales Toolkits | `/sales-toolkits` | Toolkit list for the signed-in org. |

### Accounts

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Accounts | `/accounts` | Account list. Key and Top are views of this room (`?view=key` and `?view=top`), not extra doors. |
| KAM Initiatives | `/kam` | Initiative board. It is not the Key Accounts view. |
| Companies | `/companies` | Company list and the company cockpit, including revenue, margin, and open jobs. |
| Sector View | `/sector-view` | Accounts grouped by sector. |
| Cross-sell | `/cross-sell` | Cross-sell suggestions for accounts the caller can see. |
| Contacts | `/contacts` | People, with the buying committee on the contact. |
| Meetings | `/meetings` | Who was met, what they raised, and sister-account flags. |
| Reference Library | `/references` | Reference stories the org has stored. |

### Agreements

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Agreements | `/agreements` | MSAs, frameworks, SOWs, amendments, expiry, and notice. |

### Pipeline

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Leads | `/leads` | Lead list and qualification. |
| Opportunities | `/opportunities` | List and board. The board is this room's toggle, not a second rail door. `/pipeline` still opens that board. |
| Territories | `/territories` | Territory assignment. |

### Bids and RFP

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Bid/No-Bid Matrix | `/bid-matrix` | Weighted score and the no-bid decision. |
| Proposals | `/proposals` | Proposal workspace and the RFP pipeline. `/rfp-response` redirects here. |
| SERUM Mission Control | `/serum` | Hidden until the serum module is on. |
| Agent Studio | `/agent-studio` | Hidden until the agent studio module is on. |

### Workspace

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Tasks | `/tasks` | Task list. The rail badge is the overdue count. |
| Team Workload | `/workload` | Work by person. |
| Calendar | `/calendar` | Calendar for the org. |
| Workflows | `/workflows` | Trigger and action list. |
| Custom Objects | `/settings/custom-objects` | Object definitions. The screen lives under Settings in the URL and under Workspace in the rail. |
| Document Intake | `/intake` | Upload and intake status. |
| Analytics & Reports | `/analytics` | Dashboard switcher, Add widget, and links to saved reports. |
| CRM Insights | `/workspace/insights` | Insight cards for the workspace. |
| Collaborate | `/workspace` | Hidden until the collaborative workspace module is on. |

Calls stay on the opportunity, not in the rail. The global `/calls` list is reached from search, not from a door on this plan.

### Settings

| Room | Route | What the canvas holds |
| --- | --- | --- |
| Settings | `/settings` | One door for every member. Admin tabs (webhooks, audit log, RFP analytics) are inside this room, not extra rail doors. |

## Before any new screen

Do not add a route, a rail item, or a full-page canvas until this section has a filled copy of the template below, in this file or in a new file under `docs/floor-plans/` that the gate test also reads.

Copy this block, fill every line, and only then open the implementation pull request. Stack that pull request on the one that already owns the screen if #348–#441 (or a later open pull request) already edits it.

```
### New screen: <name>

- Route:
- Rail section, or "no rail door" and the path that opens it:
- Opens from:
- Replaces or sits beside:
- Empty state:
- Loading state:
- Error state:
- Who can see it:
- Data on the canvas (synthetic only in the public repo):
- What this screen must not invent (sample revenue, a provider, a second nav list):
```

A screen that only adds a tab inside an existing room still needs the template. The route line can name the parent route plus the tab.
