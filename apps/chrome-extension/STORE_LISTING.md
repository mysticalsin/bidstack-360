# Chrome Web Store Listing — BidStack 360° CRM

## Extension Name
BidStack 360° CRM

## Summary (132 chars max)
Add contacts, create leads, and manage your BidStack CRM directly from Gmail, Outlook, LinkedIn, and HubSpot.

## Description (detailed)

**Work your deals from anywhere — without switching tabs.**

BidStack 360° is the bid-focused CRM built for presales and business development teams. This extension brings BidStack directly into the tools you already use.

### What it does

**Gmail & Outlook**
One click adds a sender as a lead in your BidStack CRM. The extension reads the sender's name and email from the open email and pre-fills the lead form. No copy-pasting.

**LinkedIn**
A "Add to BidStack" button appears on any LinkedIn profile or company page. Click it to instantly capture the person's name, title, and company as a new lead — including their LinkedIn URL for follow-up.

**HubSpot**
If you're evaluating a switch to BidStack, a non-intrusive banner on HubSpot lets you learn more without interrupting your workflow. Dismiss it in one click.

**Popup: Search + Quick-Create + Today's Tasks**
Click the extension icon to:
- Search across all your CRM records (leads, contacts, deals)
- Quick-create a lead from the popup form
- See all tasks due today without opening the full app

### Privacy
This extension:
- Stores ONLY your API key and API URL in your browser's local storage (`chrome.storage.local`)
- Never sends data to any server except the BidStack API endpoint you configured
- Never reads, stores, or transmits email content beyond what you explicitly choose to add to CRM
- Uses minimum required permissions — only accesses the four sites listed in host_permissions

### Permissions Used
- **storage** — saves your API key locally in the browser
- **identity** — enables OAuth login flow (future feature)
- **host_permissions (Gmail, Outlook, LinkedIn, HubSpot)** — injects the "Add to BidStack" button only on these specific sites

## Category
Productivity

## Language
English

## Screenshots (6 required — placeholders, capture before submission)
1. `screenshot-01-gmail-inject.png` — Gmail email open with "Add to BidStack" button visible in toolbar
2. `screenshot-02-linkedin-inject.png` — LinkedIn profile page with button in actions section
3. `screenshot-03-outlook-inject.png` — Outlook Web email with button in action bar
4. `screenshot-04-popup-search.png` — Extension popup showing search results
5. `screenshot-05-popup-tasks.png` — Extension popup showing today's tasks
6. `screenshot-06-options.png` — Options page with API key configuration

Screenshots must be 1280×800 or 640×400. Use Chrome DevTools to capture at exact size.

## Privacy Policy URL
https://bidstack.io/privacy

## Support URL
https://docs.bidstack.io/chrome-extension

## Homepage URL
https://bidstack.io

## Pricing
Free

## Permissions Justification (for review team)
- `storage` — Required to persist the user's API key and custom API URL between browser sessions. Alternative (sessionStorage) would require re-entry on every browser restart, degrading UX. No user data other than configuration is stored.
- `identity` — Reserved for a future OAuth flow that will replace manual API key entry. Currently no identity API calls are made.
- `host_permissions (mail.google.com, outlook.live.com, outlook.office.com, outlook.office365.com, www.linkedin.com/in/*, www.linkedin.com/company/*, app.hubspot.com)` — Content scripts inject the "Add to BidStack" button only on these four CRM-adjacent sites. The extension does not read email body content; it reads only the sender name/email from the email header DOM to pre-fill the lead form.
