# ✈ Trip Expense Manager

A mobile-first web app for tracking family trip expenses, check-ins, and trip planning in real time.
Runs entirely on Google Apps Script — no servers, no subscriptions, no installs.

---

## Technical Stack

| Layer | Technology |
|---|---|
| Frontend | SPA split across 12 HTML files, assembled server-side via `HtmlService` template `include()` |
| Backend | Google Apps Script (`Code.gs`) |
| Storage | `PropertiesService.getScriptProperties()` — JSON blobs, shared across all users |
| Exchange rates | [frankfurter.app](https://frankfurter.app) — free, ECB official rates, no API key |
| Maps | Google Maps JavaScript API (Places, Autocomplete, Maps) |
| Charts | Chart.js 4.4 (CDN, lazy-loaded) |
| Deployment | Google Apps Script Web App (standalone project, not bound to a Sheet) |
| Dev tooling | [clasp](https://github.com/google/clasp) v3 — push/pull local files to/from GAS |

> **Note:** Google Sheets is **not** the primary data store. Sheets is used only for the calendar export feature (`exportCalendarToSheet`). All trip, expense, tracker, and planner data lives in `PropertiesService`.

---

## Access & Permissions

- **Execution**: `executeAs: USER_DEPLOYING` — script always runs as the owner
- **Access**: `ANYONE` — any signed-in Google account can use the URL
- **Data sharing**: PropertiesService is shared across all visitors; owner and wife see the same data
- **OAuth scopes**: `script.external_request` (UrlFetchApp for exchange rates) + `spreadsheets` (calendar export only)
- **GCP setup**: Custom GCP project required (not "Default"); OAuth consent screen configured as External with owner added as test user

---

## Requirements

- A Google account (owner)
- Node.js (for clasp) — or manual copy-paste as fallback
- A web browser (Chrome recommended on mobile)

---

## Local Dev Setup

### Prerequisites

1. Install [Node.js](https://nodejs.org) (v18+)
2. Install clasp globally:
   ```
   npm install -g @google/clasp
   ```
3. Log in to clasp:
   ```
   clasp login
   ```
   This opens a browser for Google OAuth. Auth stored at `C:\Users\User\.clasprc.json`.

### VS Code Terminal

clasp and git commands work from the VS Code integrated terminal. Node.js and npm bin paths are configured in `.vscode/settings.json`. If commands aren't found after setup, do a full VS Code restart (not just terminal close).

---

## First-Time Deployment (new GAS project)

1. **Create a standalone Apps Script project:**
   - Go to [script.google.com](https://script.google.com) → click **New project**
   - Note the Script ID from the URL: `https://script.google.com/home/projects/{SCRIPT_ID}/edit`

2. **Configure `.clasp.json`** in the project root:
   ```json
   { "scriptId": "YOUR_SCRIPT_ID", "rootDir": "." }
   ```

3. **Configure GCP project** (required for Google Maps API):
   - In the GAS editor: **Project Settings → Change project** → enter your GCP project number
   - See [Google API Configuration](#google-api-configuration) below

4. **Push all files:**
   ```
   clasp push --force
   ```

5. **Deploy as Web App:**
   - In the GAS editor: **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone with Google account**
   - Click **Deploy** → authorize if prompted → copy the Web App URL

---

## Updating the App

After making local code changes:

```
clasp push
```

Then redeploy:
- GAS editor → **Deploy → Manage deployments** → pencil icon → **New version** → **Deploy**

> Without a new deployment version, live users continue to see the old code.

---

## Google API Configuration

The app uses the **Google Maps JavaScript API** (Places, Autocomplete, Maps). This requires:

### Step 1 — Create a GCP Project (if not already done)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** → **New Project** → name it (e.g. "TripExpenses")
3. Note the **Project Number** (shown on the project dashboard)

### Step 2 — Enable Required APIs

In GCP Console → **APIs & Services → Library**, enable:
- **Maps JavaScript API**
- **Places API**

### Step 3 — Create an API Key

1. GCP Console → **APIs & Services → Credentials → Create Credentials → API key**
2. Copy the key
3. Paste it into [MapService.html](MapService.html) — the `loadGoogleMaps()` function builds the Maps script URL with this key

### Step 4 — Restrict the API Key (recommended)

In the API key settings:
- **Application restrictions**: HTTP referrers → add your Web App URL (`https://script.google.com/macros/s/...`)
- **API restrictions**: Restrict to Maps JavaScript API + Places API

### Step 5 — Link GCP Project to GAS

1. GAS editor → **Project Settings → Google Cloud Platform (GCP) Project**
2. Click **Change project** → enter the GCP **Project Number**
3. This links the GAS project so it uses your GCP APIs and OAuth consent screen

### Step 6 — OAuth Consent Screen

1. GCP Console → **APIs & Services → OAuth consent screen**
2. User type: **External**
3. Add the owner's Google account as a **Test user**
4. Required scopes will be auto-detected on first deploy

### Step 7 — Authorize the App

When first opening the Web App URL:
- Click through Google's authorization prompts
- Grant the requested permissions (UrlFetchApp, Spreadsheets for calendar export)

---

## Add to Phone Home Screen

On Android (Chrome):
1. Open the Web App URL in Chrome
2. Tap the **three-dot menu** → **Add to Home screen**
3. Name it "Trip Expenses" → tap **Add**

On iOS (Safari):
1. Open the URL in Safari
2. Tap **Share** → **Add to Home Screen**

---

## Share with Partner

**Share the Web App URL** — send the URL. She opens it in Chrome, adds to home screen. No Google account access needed.

> Data is shared automatically — both users read/write the same PropertiesService data via the same deployed URL.

---

## Data Storage

All data lives in `PropertiesService.getScriptProperties()` (script-level properties, shared across all deployments):

| Key | Type | Contents |
|-----|------|----------|
| `trips` | JSON array | All trip objects |
| `exp_{tripId}` | JSON array | Expense objects for that trip |
| `checkins_{tripId}` | JSON object | Check-in map `{id → object}` |
| `caldesc_{tripId}` | JSON object | Calendar day notes `{YYYY-MM-DD → text}` |
| `plan_{tripId}` | JSON object | `{ bank: [...], assignments: {...} }` |
| `settings` | JSON object | `{ customTypes: [...] }` |
| `ratecache` | JSON object | Exchange rate cache `{FROM_TO → {rate, date}}` |

> Google Sheets is used **only** for the calendar export feature — it creates a new Sheet on demand via `SpreadsheetApp.create()`. It is **not** the primary database.

---

## Exchange Rates

- Rates from [frankfurter.app](https://frankfurter.app) — free, no API key, ECB official rates
- Historical rates used (matched to expense date)
- Last cached rate used if API unavailable (weekends, holidays)
- Manual ILS override always available
- 39 supported currencies: ILS, EUR, USD, GBP, JPY, THB, CHF, and more

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Authorization required" on first open | Click through Google's authorization prompts |
| Exchange rate shows "cached" | Normal for weekends/holidays — ECB doesn't publish daily |
| App not updating after code change | Re-deploy as a new version |
| Blank screen on phone | Hard-refresh: hold browser back → refresh |
| Partner can't open the app | Confirm "Who has access" = "Anyone with Google account" in deployment |
| clasp not found in VS Code terminal | Full VS Code restart required after PATH change in settings.json |
| clasp push "Conflicting files found" | Ensure `appsscript.json` exists locally; run `clasp push --force` |
| Maps not loading | Check API key in MapService.html; confirm Maps JS API + Places API are enabled in GCP |

---

## File Reference

```
TripExpenses/
├── Code.gs              ← Backend: all server-side functions
├── Index.html           ← Shell template: assembles the SPA via <?!= include('...') ?>
├── Shared.html          ← Global CSS styles
├── Constants.html       ← PLAN_TYPES, CI_COLORS, CI_ICONS, CURRENCIES, COUNTRIES maps
├── State.html           ← Global state object S + MapService tokens
├── MapService.html      ← Google Maps lazy-loader, PlacesService helper
├── Core.html            ← init(), navigate(), goBack(), modal, toast, helpers
├── TripsScreen.html     ← Trips list, New Trip form, Edit Trip modal, Date Range Picker
├── ExpenseScreen.html   ← Expense list, Add/Edit Expense form
├── ReportScreen.html    ← Expense report, pie chart, breakdown table
├── TrackerScreen.html   ← Check-in form, List/Calendar/Map tabs, KML export
├── PlannerScreen.html   ← Place bank, Planner Calendar, Planner Map
├── MapPicker.html       ← Full-screen map picker overlay (used by tracker + planner)
├── appsscript.json      ← GAS manifest (timezone, webapp config, OAuth scopes)
├── .clasp.json          ← clasp config: scriptId + rootDir
├── .claspignore         ← Files to exclude from clasp push (currently empty = push all)
├── .vscode/
│   └── settings.json   ← VS Code: terminal PATH (Node.js + npm), git decorations
├── README.md            ← This file
└── Requirements.md      ← Full technical spec and architecture reference
```
