# ✈ Trip Expense Manager

A mobile-first web app for tracking family trip expenses in real time.
Runs entirely on Google Drive — no servers, no subscriptions, no installs.

---

## Technical Stack

| Layer | Technology |
|---|---|
| Frontend | Single-page app (SPA) in `Index.html` — vanilla JS, no framework |
| Backend | Google Apps Script (`Code.gs`) |
| Storage | `PropertiesService.getScriptProperties()` — shared JSON blobs |
| Exchange rates | [frankfurter.app](https://frankfurter.app) — free, ECB official rates, no API key |
| Charts | Chart.js 4.4 (CDN) |
| Deployment | Google Apps Script Web App |

---

## Access & Permissions

- **Execution**: `executeAs: USER_DEPLOYING` — script always runs as the owner
- **Access**: `ANYONE` — any signed-in Google account can use the URL
- **Data sharing**: PropertiesService is shared across all visitors; owner and wife see the same data
- **OAuth scope**: `script.external_request` only (for UrlFetchApp exchange rate calls)
- **GCP setup**: Custom GCP project required (not "Default"); OAuth consent screen configured as External with owner added as test user

---

## Requirements

- A Google account
- A web browser (Chrome recommended on Pixel 6)
- No coding knowledge needed beyond copy-paste

---

## Setup (one-time, ~5 minutes)

### Step 1 — Create the Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Click **Blank** to create a new spreadsheet
3. Rename it to **Trip Expenses** (click the title at the top)

> This spreadsheet is your database. All trips and expenses are stored here automatically.

---

### Step 2 — Open the Script Editor

1. In the spreadsheet, click the menu: **Extensions → Apps Script**
2. A new tab opens with the script editor
3. You'll see a default file called `Code.gs` with an empty function

---

### Step 3 — Add the Backend (Code.gs)

1. In the script editor, click on `Code.gs` in the left panel
2. **Select all** the existing code and **delete it**
3. Open the file `Code.gs` from this folder and **copy its entire contents**
4. Paste it into the script editor's `Code.gs` tab
5. Click the **Save** button (floppy disk icon, or Ctrl+S)

---

### Step 4 — Add the Frontend (Index.html)

1. In the script editor, click the **+** button next to "Files" in the left panel
2. Choose **HTML**
3. Name it exactly: `Index` (no capital H, no .html extension — the editor adds it)
4. **Select all** the placeholder code and **delete it**
5. Open the file `Index.html` from this folder and **copy its entire contents**
6. Paste it into the `Index.html` tab in the script editor
7. Click **Save**

You should now have two files in the left panel:
```
Code.gs
Index.html
```

---

### Step 5 — Deploy as a Web App

1. Click **Deploy** (top right) → **New deployment**
2. Click the gear icon next to "Type" → select **Web app**
3. Fill in the settings:
   - **Description:** Trip Expenses v1
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone with Google account
4. Click **Deploy**
5. Google will ask you to **authorize** the app — click through and allow it
6. Copy the **Web app URL** that appears — this is your app's permanent link

> Save this URL somewhere. It looks like:
> `https://script.google.com/macros/s/AKfycb.../exec`

---

### Step 6 — Add to Phone Home Screen

On your Pixel 6:
1. Open **Chrome** and navigate to your web app URL
2. Tap the **three-dot menu** (top right)
3. Tap **Add to Home screen**
4. Name it "Trip Expenses" → tap **Add**

It will appear on your home screen like a native app.

---

### Step 7 — Share with Your Wife

**Option A — Share the web app URL** (simplest):
- Send her the web app URL. She can open it in Chrome and add to her home screen too.

**Option B — Share the spreadsheet** (for direct data access):
1. In the Google Spreadsheet, click **Share** (top right)
2. Enter her Google account email
3. Set her role to **Editor**
4. Click **Send**

> The app runs as your Google account, so she can use the web app URL freely.
> If you want her to see/edit the raw spreadsheet data too, use Option B.

---

## How to Update the App in the Future

If you make changes to `Code.gs` or `Index.html`:
1. Save the files in the script editor
2. Click **Deploy → Manage deployments**
3. Click the **pencil/edit** icon on your deployment
4. Change **Version** to **New version**
5. Click **Deploy**

> Without deploying a new version, changes won't appear in the live app.

---

## Data Storage

The app automatically creates three sheets in your spreadsheet:

| Sheet | Contents |
|-------|----------|
| **Trips** | One row per trip (ID, title, country, currency, dates) |
| **Expenses** | One row per expense (all fields including ILS amount and exchange rate) |
| **Settings** | Cached exchange rates, custom expense types |

You can view, sort, and filter the raw data directly in the spreadsheet at any time.

---

## Exchange Rates

- Rates are fetched from [frankfurter.app](https://frankfurter.app) — free, no API key, uses ECB official rates
- Historical rates are used (matched to the expense date)
- If the live rate is unavailable (offline, weekend, etc.), the last cached rate is used with a warning
- You can always override the ILS amount manually
- Supported currencies include: ILS, EUR, USD, GBP, JPY, THB, CHF, and 30+ more

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Authorization required" on first open | Click through Google's authorization prompts |
| Exchange rate shows "cached" | Normal for weekends/holidays — ECB doesn't publish on non-business days |
| App not updating after code change | Re-deploy as a new version (see "How to Update" above) |
| Blank screen on phone | Hard-refresh: hold the browser back button → refresh |
| Wife can't open the app | Make sure "Who has access" is set to "Anyone with Google account" in deployment |

---

## File Reference

```
TripExpenses/
├── Code.gs       ← Paste into Google Apps Script editor
├── Index.html    ← Paste as new HTML file in script editor
└── README.md     ← This file
```
