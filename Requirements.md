# Trip Expense Manager — Requirements

## Overview

A mobile-first single-page web app (SPA) for tracking family trip expenses and check-ins in real time.
Runs entirely on Google Apps Script — no servers, no subscriptions, no installs.
Data is shared between two users (owner + wife) via a single deployed web app URL.
All data is stored in Google Apps Script `PropertiesService` (script properties, shared across all users of the deployment).

---

## Google Apps Script Configuration (appsscript.json)

```json
{
  "timeZone": "Asia/Jerusalem",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE"
  }
}
```

> OAuth scopes (`script.external_request` for UrlFetchApp rates; `spreadsheets` for calendar export) are auto-detected by GAS from the code — no need to declare them manually in `appsscript.json`.

---

## Architecture

- **Modular frontend**: 12 HTML files assembled server-side. `Index.html` is a GAS template shell using `<?!= include('FileName') ?>` directives. `include(filename)` in `Code.gs` calls `HtmlService.createHtmlOutputFromFile(filename).getContent()`. Script execution order: `<head>` files (Constants → State → MapService → Core) define globals; `<body>` screen files define view functions; `<script>init();</script>` at end of body triggers startup.
- **Backend**: `Code.gs` — all server-side logic called from the frontend via `google.script.run`
- **Data storage**: `PropertiesService.getScriptProperties()` — JSON-serialized objects stored as string values
- **No external database, no Sheets for data** (Sheets used only for calendar export)
- **Global state object**: `S` — single JS object holding all app runtime state
- **Navigation**: deterministic view switching via `navigate(viewName)` + `goBack()`

### Critical GAS HtmlService Constraint
`HtmlService` sanitizes `<script>` tag content: it strips `<![CDATA[`, `]]>`, AND XML processing instructions (`<?xml version="1.0" encoding="UTF-8"?>`). **All KML or XML string assembly inside `<script>` tags MUST use plain string concatenation — never template literals containing XML-like syntax.**

---

## Data Storage Schema (PropertiesService)

| Key | Type | Contents |
|---|---|---|
| `trips` | JSON array | Array of trip objects |
| `exp_{tripId}` | JSON array | Array of expense objects for that trip |
| `checkins_{tripId}` | JSON object | Keyed map `{id: checkinObject}` — NOT an array |
| `caldesc_{tripId}` | JSON object | Keyed by date string `YYYY-MM-DD`, value = description text |
| `plan_{tripId}` | JSON object | `{ bank: [...], assignments: { "YYYY-MM-DD": [...placeIds] } }` |
| `settings` | JSON object | `{ customTypes: [...] }` |
| `ratecache` | JSON object | Keyed by `"FROM_TO"`, value = `{ rate, date }` |

### Why keyed map for check-ins?
Stored as `{id → entry}` object (not array) to give O(1) lookup/update/delete without index maintenance. `loadCheckins()` returns a sorted array for the client.

---

## Backend Functions (Code.gs)

### Utility
- `uuid()` — returns `Utilities.getUuid()`
- `nowISO()` — returns `new Date().toISOString()`
- `load(key, fallback)` — reads + JSON-parses a PropertiesService key, returns fallback if missing
- `save(key, data)` — JSON-stringifies and writes to PropertiesService

### Trips
- `getTrips()` — returns array of trip objects
- `createTrip(d)` — creates trip with `{id, title, country, currency, startDate, endDate, createdAt}`, returns `{success, id}`
- `updateTrip(d)` — updates `title`, `country`, `startDate`, `endDate`, `defaultView` for trip by id; preserves existing `country` if `d.country` is empty
- `deleteTrip(id)` — deletes trip, its expenses (`exp_{id}`), its check-ins (`checkins_{id}`), its calendar descriptions (`caldesc_{id}`), and its plan data (`plan_{id}`)

### Calendar Day Descriptions
- `getCalDescs(tripId)` — returns `{dateStr: text}` object
- `saveCalDesc(tripId, date, text)` — saves or deletes a day description (deletes if text is empty)

### Tracker Check-ins
- `loadCheckins(tripId)` — returns array sorted ascending by timestamp
- `saveCheckin(d)` — creates new check-in with `{id, tripId, timestamp, name, type, lat, lng, gpsSource, createdAt}`, returns `{success, id}`
- `updateCheckin(d)` — O(1) update by id, preserves `createdAt`
- `deleteCheckin(checkinId, tripId)` — O(1) delete by id
- `deleteCheckinFile(tripId)` — deletes entire `checkins_{tripId}` property (called by `deleteTrip`)

### Expenses
- `getExpenses(tripId)` — returns array of expense objects
- `addExpense(d)` — creates expense with `{id, tripId, date, expense, type, amount, currency, amountILS, rate, rateDate, rateSource, info2, info3, createdAt}`
- `updateExpense(d)` — updates expense by id, preserves `createdAt`
- `deleteExpense(expenseId, tripId)` — deletes by id; falls back to scanning all `exp_*` keys if tripId not provided

### Exchange Rates (frankfurter.app — free, no API key)
- `getDefaultRates(tripCurrency)` — fetches today's rates for: trip currency → ILS, EUR → ILS, USD → ILS. Returns `{CUR: {rate, source, date}}` map. Always includes `ILS: {rate:1, source:'same'}`.
- `getExchangeRate(from, to, date)` — fetches historical rate for given date; falls back to cache if API fails; returns `{rate, source, date}` where source is `'live'`, `'cached'`, or `null`
- `getRatesILStoUSDEUR()` — fetches current ILS→USD and ILS→EUR rates (used for report)
- `saveRateCache(from, to, rate, date)` — stores in `ratecache` property
- `loadRateCache(from, to)` — retrieves from `ratecache`

### Expense Types
- `getExpenseTypes()` — returns default types concatenated with custom types from settings
- `addExpenseType(name)` — adds to `settings.customTypes`
- `deleteExpenseType(name)` — removes from `settings.customTypes`
- Default types: `['Flight','Lodging','Car Rental','Insurance','Petrol','Toll Roads','Parking','Transportation','Meals','Souvenirs','Attractions','Phone','Other']`
- **Type merge on load**: client always merges `defaultTypes()` + server custom types so new built-in types are never missing even for old accounts: `S.expenseTypes = [..._defaults, ..._custom]`

### Report
- `getReport(tripId)` — returns `{trip, days, expenseCount, categories, totalILS, totalUSD, totalEUR, ratesDate}`. Each category has `{type, count, totalILS, totalUSD, totalEUR}`.

### JSON Import / Historical Rates
- `_buildRateFetcher(currencies, startDate, endDate)` — shared rate-fetch helper; makes one date-range API call per currency (`startDate..endDate` via frankfurter.app) covering the trip duration; results cached in memory. Returns a `getRate(cur, dateStr)` closure: for in-range dates it looks up the nearest prior ECB business day in the range map; for out-of-range dates (pre-trip bookings) it falls back to individual `getExchangeRate` calls, deduplicated by `cur|dateStr` key.
- `importFromJson(data)` — validates `{title, country, expenses[]}`. Calls `_buildRateFetcher(currencies, startDate, endDate)` to fetch historical rates; each expense gets the rate for its specific date. Each imported expense stored with `rateSource: 'historical'` and specific `rateDate`. Returns `{ imported, skipped, trips }`.
- `rerateImportedExpenses(tripId)` — re-rates all non-ILS expenses for an existing trip using the same `_buildRateFetcher` logic. Reads trip `startDate`/`endDate`, fetches historical per-date rates, updates `amountILS`, `rate`, `rateDate`, `rateSource` on every non-ILS expense, saves, returns `{ success, updated }`.

### Trip Planner
- `getPlan(tripId)` — returns `{ bank: [...], assignments: {...} }` or `{ bank: [], assignments: {} }` if none
- `savePlanPlace(d)` — creates (no `d.id`) or updates (with `d.id`) a place in the bank. Fields: `{tripId, id?, name, type, lat, lng, description}`. New places get a uuid. Returns `{success}`
- `deletePlanPlace(placeId, tripId)` — removes place from bank AND from all day assignments in `plan_{tripId}`
- `removePlaceFromDay(tripId, date, placeId)` — removes a single placeId from `assignments[date]`; cleans up empty date keys
- `setPlanDayAssignment(tripId, date, placeIds)` — bulk-sets the full list for one day; deletes the date key if `placeIds` is empty

### Calendar Sheet Export
- `exportCalendarToSheet(params)` — creates a new Google Sheet named `"{tripTitle} - Trip Schedule"`, sheet named "Calendar"
- Column widths: 172px for all 7 columns
- **3 rows per week**: header row (DD/MM + day description, blue bg), body row (non-hotel check-ins as icon+name, height 80px), footer row (hotel check-in if any, green bg, height 26px)
- Out-of-range days shown in grey
- Date values prefixed with apostrophe (`'DD/MM`) to prevent auto-conversion in Sheets, number format set to `@`
- Row 1: frozen DOW header (Sun–Sat)
- Returns `{success, url}` on success

---

## Frontend (Index.html)

### CSS Variables
```css
--primary: #1565C0
--primary-d: #0D47A1
--accent: #FF6D00
--success: #2E7D32
--danger: #C62828
--bg: #EEF2F7
--card: #FFFFFF
--border: #E5E7EB
--text: #1A1A2E
--muted: #6B7280
--shadow: 0 2px 10px rgba(0,0,0,0.10)
--radius: 14px
```

### Global State Object (S)
```javascript
const S = {
  trips, expenses, expenseTypes, currentTrip,
  currentExpenseId,  // null = new, string = editing
  expenseTab,        // 'list' | 'report' — active sub-tab of view-trip
  filter, rateTimer, manualILS, lastRateInfo,
  defaultRates, pieChart,
  // Tracker:
  checkins, trackerTab, editingCheckinId,
  gpsCoords, gpsSource, leafletMap, leafletMarkers,
  _routeLine, _trackerInfoWindow,  // InfoWindow stored so map click listener can close it
  suggestTimer, calLang,
  calFilterFrom, calFilterTo, calDescs,
  calWeeks,           // stored for export
  _listFormVisible,   // persists form state across tab switches
  _editingTripId,     // used by trip edit modal
  // Planner:
  planBank,           // array of place objects
  planAssignments,    // { "YYYY-MM-DD": [...placeIds] }
  plannerTab,         // 'cal' | 'map'
  plannerMap,         // google.maps.Map instance for planner map (separate from leafletMap)
  plannerMarkers,     // array of google.maps.Marker instances for planner
  _planInfoWindow,    // google.maps.InfoWindow for planner map (stored to allow .close() from openDayPickerForPlace)
  planGpsCoords,      // { lat, lng } — separate from tracker gpsCoords
  planGpsSource,      // 'gps' | 'nominatim' | 'manual' | 'saved' | 'none'
  planSuggestTimer,
  editingPlaceId,     // null = adding new, string = editing existing
  _planFormVisible,   // persists form state across tab switches
  planCalFilterFrom,
  planCalFilterTo,
  _planPhotoCache,    // { [bankPlaceId]: null | url } — undefined = not yet fetched, null = no photo, string = URL
  _ctxMenuPhotoUrl,   // photo URL captured from context menu when adding a new place; propagated to pin cache
  _planPendingPhotoAssign  // { name, photoUrl } — pending after savePlanPlace; matched by name in loadPlan
}
```

### Loading Screen
- Fixed overlay with animated progress bar (`#load-bar`)
- Progress ticks from 25→88% over 15s while waiting for server calls
- Shows percentage and status text
- `hideLoading()` fades out after data loaded
- Parallel init: fires `getTrips` and `getExpenseTypes` simultaneously; `navigate('trips')` only after both return

### Views
Six views, only one active at a time (CSS `display:none`/`display:block` + `fadeIn` animation):
1. `view-trips` — trip list
2. `view-new-trip` — create new trip
3. `view-trip` — expenses + report tabs (was two separate views; report is now a sub-tab)
4. `view-expense` — add/edit expense form
5. `view-tracker` — tracker (list/calendar/map tabs)
6. `view-planner` — trip planner (calendar/map tabs)

### Header
- Fixed top, 58px height, blue gradient background
- Back button (circle, `hbtn back`) — hidden by default, shown contextually
- Title (`htitle`) — ellipsis overflow
- Action buttons (`hActions`) — injected per view:
  - trips: "↓ Import" + "+ New Trip"
  - trip (expenses): "✎ Edit", "📋 Plan", "📍 Track"
  - tracker: "💰 Exp" (navigate to expenses), "+ Check-in"
  - planner: "💰 Exp" (navigate to expenses), "+ Add Place"
  - expense/new-trip: none (back button only)
  - Note: "📊 Report" is no longer a separate header button — it is a sub-tab within the Expenses view

### Navigation
- `navigate(view)` — sets active view, updates header, triggers data loads
- `goBack()` — deterministic, reads active view from DOM:
  - `expense` → always `trip` (back to expense list)
  - `trip | tracker | planner` → if current view is `S.currentTrip.defaultView`, goes to `trips`; otherwise goes to `defaultView`
  - everything else → `trips`
- **Back button does NOT use a navigation stack** — reads current active view from DOM
- Note: `report` is no longer a standalone view, so it is not listed in the goBack dispatch
- **Default View**: stored on each trip as `S.currentTrip.defaultView` (values: `'trip'`, `'tracker'`, `'planner'`, `'report'`); defaults to `'trip'` (expenses) if not set. `openTrip()` navigates directly to the defaultView.

### FAB
- Orange circle, bottom-right, visible on `view-trip` **only when the Expenses sub-tab is active** (`S.expenseTab === 'list'`)
- Hidden when the Report sub-tab is active
- Calls `showAddExpense()`

### Toast
- Fixed bottom, slide-up animation using `opacity + visibility + translateY`
- Classes: `.ok` (green), `.err` (red), default (dark)
- Auto-dismisses after 3.2s
- **Implementation**: uses `opacity/visibility` CSS transition approach (NOT `translateY` for show/hide) to avoid black rectangle flash on Android

### Modal (Bottom Sheet)
- Slide-up from bottom, backdrop overlay
- Used for: edit trip, delete trip, delete expense, delete check-in, manage expense types, edit calendar day note
- Close on backdrop tap or Escape key

---

## Trips Feature

### Trip Object
```javascript
{ id, title, country, currency, startDate, endDate, defaultView, createdAt }
```
`defaultView`: optional; one of `'trip'` (expenses), `'tracker'`, `'planner'`, `'report'`. Defaults to `'trip'` if absent.

### Trip List View
- Shows all trips with: title, country+currency, date range, day count
- Edit button (✎) — opens Edit Trip modal (title + dates)
- Delete button (🗑) — confirms then deletes trip + all its data
- Tap anywhere on card → `openTrip(id)` which resets `S.defaultRates = {}`

### New Trip Form
- Fields: Title (required), Countries (required, tag/chip input), Travel Dates (date range picker)
- **Country tag input**: type a country name and press Enter or comma to add it as a chip; click × on a chip to remove it; `_ctagList` array holds the entries; `addCtag()` / `removeCtag()` / `renderCtags()` manage state; supports multiple countries (e.g. Austria + Czech Republic)
- First country in `_ctagList` determines default currency via `countryToCur()`; hint shown below field
- `countryToCur()` maps country name → currency code (39 countries mapped)
- Travel Dates use the **date range picker** (see below) — hidden inputs `fTripStart` / `fTripEnd` receive the values
- On create: calls `createTrip`, then re-fetches trips, navigates to `view-trip`

### Edit Trip
- Modal with Title, Countries (plain comma-separated text input), Travel Dates (date range picker), Default View (select)
- **Default View** dropdown: options Expenses / Tracker / Planner / Report (values `trip/tracker/planner/report`). Pre-selected from `t.defaultView`. Controls which view opens when tapping the trip card and where the back button leads from non-default trip views.
- Optimistic update: reflects title, country, dates, and defaultView immediately in `S.trips` and `S.currentTrip` (if that trip is currently open); then calls `updateTrip` in background
- View-aware render: only calls `renderExpenses()` (and updates `hTitle`) if `view-trip` is the active DOM view; otherwise calls `renderTrips()`. This prevents a stale `S.currentTrip` (which persists after going back to the trips list) from routing the re-render to the wrong view.
- **Re-rate button**: small muted text button on the left of the Save/Cancel row. Calls `rerateImportedExpenses(tripId)`; shows "Fetching historical rates…" while running; on success closes the modal, reloads expenses, and shows a toast with the count of re-rated expenses.

### Date Range Picker
- Single-window calendar overlay (`#drpOverlay`), fixed full-screen with semi-transparent backdrop
- State object `_drp = { year, month, from, to, ctx }` — `ctx` is `'trip'` or `'edit'`
- `openDrp(ctx)` — reads existing start/end from hidden inputs, initializes month to the `from` date (or current month), opens overlay
- 1st tap on a day sets `_drp.from` (start date); 2nd tap sets `_drp.to` (end date)
- If 2nd tap is earlier than `from`, resets and sets the tapped day as the new `from`
- Tapping the current `from` again clears both dates
- In-range days highlighted with blue fill; `from` and `to` shown as solid circles
- Confirm button disabled until both `from` and `to` are selected
- `drpConfirm()` writes values to hidden inputs and updates the display label; `closeDrp()` dismisses without saving
- Hint text below grid: "Tap a start date" → "Tap an end date" → blank once both selected
- Navigation: `drpShiftMonth(delta)` moves calendar forward/back one month

### Import Trip from JSON

#### How to import (user steps)
1. Open the app and go to the **Trips** screen (home screen).
2. Tap **↓ Import** in the top-right header.
3. In the modal, either:
   - Tap **Choose file** and select a `.json` file from your device, **or**
   - Paste the JSON text directly into the paste area below.
4. The app parses the file immediately and shows a **preview card**: trip title, country, currency, date range, how many expenses will be imported, which currencies are present, and how many rows will be skipped (rows with no amount or no date).
5. If the preview looks correct, tap **↓ Import N Expenses**.
6. The app fetches today's exchange rate for each non-ILS currency, creates the trip, and imports all expenses. A toast confirms success.
7. The new trip appears at the top of the Trips list. Tap it to open and review.

> **Note on ILS amounts:** Exchange rates are fetched from ECB historical data (via frankfurter.app) at the actual expense date: one range call covers all trip-duration expenses, plus individual calls for pre-trip bookings (flights, insurance, etc.). The original `amount` and `currency` of every expense are always preserved. If you have an existing trip imported before this feature was added, use the **↻ Re-rate** button in Edit Trip to update its ILS amounts with historical rates.

---

#### How to convert a Google Sheet to JSON using Claude

Use this when you have an existing trip expense table (e.g. a Google Sheet with Hebrew or English categories) and want to import it into the app.

**Step 1 — Open Claude** (claude.ai or any Claude interface)

**Step 2 — Paste this prompt, followed by your table data:**

```
Convert the expense table below into the Trip Expense Manager JSON import format.

Rules:
- Output valid JSON only (no explanation, no markdown fences).
- Map each expense type to the closest match from this exact list (case-sensitive):
  Flight, Lodging, Car Rental, Insurance, Petrol, Toll Roads, Parking,
  Transportation, Meals, Souvenirs, Attractions, Phone, Other
- Hebrew type names to use as reference:
    טיסה → Flight
    לינה / מלון → Lodging
    השכרת רכב → Car Rental
    ביטוח נסיעות → Insurance
    דלק → Petrol
    כביש אגרה / אגרת כביש → Toll Roads
    חניה → Parking
    תחבורה / הסעות → Transportation
    אוכל / מסעדה / סופרמרקט → Meals
    מזכרות / קניות → Souvenirs
    אטרקציות / כניסות → Attractions
    טלפון / סים → Phone
    שונות / אחר → Other
- date format: YYYY-MM-DD
- Rows with no amount or no date: skip them.
- Empty-date rows carry forward the last known date.
- The "ILS" column in the sheet is a formula — ignore it; do not copy it as the amount.
  Use the original amount and currency columns only.
- notes: copy the content of the "notes / remarks" column if present; otherwise "".

Required JSON structure:
{
  "title": "<trip name>",
  "country": "<country>",
  "currency": "<main trip currency, e.g. EUR>",
  "startDate": "<YYYY-MM-DD>",
  "endDate": "<YYYY-MM-DD>",
  "expenses": [
    { "date": "YYYY-MM-DD", "description": "...", "type": "...", "amount": 0.00, "currency": "EUR", "notes": "" }
  ]
}

Table data:
[PASTE YOUR TABLE HERE]
```

**Step 3 — Copy Claude's output** (the raw JSON text)

**Step 4 — Import into the app:**
- Tap **↓ Import** on the Trips screen
- Paste the copied JSON into the paste area
- Verify the preview, then tap **↓ Import N Expenses**

---

#### Import File Format (`.json`) — full specification

```json
{
  "title": "Austria 2025",
  "country": "Austria",
  "currency": "EUR",
  "startDate": "2025-04-09",
  "endDate": "2025-04-16",
  "expenses": [
    { "date": "2024-12-30", "description": "Lufthansa flight", "type": "Flight",    "amount": 1411.84, "currency": "EUR", "notes": "" },
    { "date": "2025-01-03", "description": "Travel insurance",  "type": "Insurance", "amount": 87.84,   "currency": "USD", "notes": "" },
    { "date": "2025-04-09", "description": "Transfer to airport","type": "Transportation","amount": 500, "currency": "ILS", "notes": "" },
    { "date": "2025-04-10", "description": "Lidl snacks",       "type": "Meals",     "amount": 74.29,   "currency": "EUR", "notes": "" }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `title` | ✓ | Trip name shown in the app |
| `country` | ✓ | Destination country |
| `currency` | — | Main trip currency (e.g. `"EUR"`). Defaults to `"EUR"` if omitted |
| `startDate` | — | `YYYY-MM-DD`. Used for avg/day calculation in the report |
| `endDate` | — | `YYYY-MM-DD` |
| `expenses[].date` | ✓ | `YYYY-MM-DD`. Row skipped if missing |
| `expenses[].description` | — | Expense name / label |
| `expenses[].type` | ✓ | Exact match from the 13 categories. Falls back to `"Other"` if unrecognised |
| `expenses[].amount` | ✓ | Numeric, in the given `currency`. Row skipped if zero or missing |
| `expenses[].currency` | — | ISO currency code (e.g. `"EUR"`, `"USD"`, `"ILS"`). Defaults to `"ILS"` |
| `expenses[].notes` | — | Optional free text. Maps to `info3` in the expense object |

**Valid type values (13, case-sensitive):**
`Flight` · `Lodging` · `Car Rental` · `Insurance` · `Petrol` · `Toll Roads` · `Parking` · `Transportation` · `Meals` · `Souvenirs` · `Attractions` · `Phone` · `Other`

**ILS conversion:** one `getExchangeRate(currency, 'ILS', '')` call per unique non-ILS currency at import time (today's live rate). The original `amount` + `currency` are always stored on the expense so future recalculation is possible.

**Pre-trip expenses** (booked before `startDate`, e.g. flights, hotels, insurance) are fully supported — they appear in the expense list with their actual booking date.

---

## Expenses Feature

### Sub-Tabs (view-trip)
`view-trip` contains two sub-tabs rendered by a `.tracker-tabs` tab bar:
- **💰 Expenses** (`id="tab-exp-list"`) — the expense list + summary banner; active by default (`S.expenseTab = 'list'`)
- **📊 Report** (`id="tab-exp-report"`) — the expense report (pie chart + breakdown); formerly a standalone `view-report`

`switchExpenseTab(tab)` sets `S.expenseTab`, toggles `.on` class on tab buttons, shows/hides `#exp-list-panel` / `#exp-report-panel`, loads report data on first switch to 'report', updates FAB visibility.

Tab bar CSS: `.tracker-tabs` inside `#view-trip` uses `padding: 0 14px` (same as Tracker and Planner) — overrides base `.tracker-tabs { padding: 4px }` to remove vertical white gap above/below active tab and add consistent side margins. See [Responsive / Tab Bar Alignment](#tab-bar-alignment).

### Expense Object
```javascript
{ id, tripId, date, expense, type, amount, currency, amountILS, rate, rateDate, rateSource, info2, info3, createdAt }
```

### Expense List
- Summary banner: total ILS (formatted with commas), expense count, date range
- Filter chips: "All" + one per type present in expenses
  - Wrapped in `.chips-outer` (flex row): left arrow button + `.chips` scroll container + right arrow button
  - Arrow buttons (`.chips-arrow`) auto-hide when scrolled to the respective end (`.hide` class, `opacity:0; pointer-events:none`)
  - `scrollChips(dx)` — programmatically scrolls `.chips` by dx pixels; `updateChipArrows()` refreshes arrow visibility after each scroll or scroll event
  - Chips container: `overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; touch-action:pan-x`
- Expenses grouped by date, sorted descending
- Each card: category icon + color, name, type/info2/info3 concatenated, original currency amount, ILS amount
- Tap card → edit expense

### Add/Edit Expense Form
Fields:
- Date (required)
- Name/Description (required)
- Type (select from list, + custom type button)
- Amount + Currency (side by side)
- ILS Amount (auto-calculated, manual override allowed)
- Rate indicator row: badge + text showing rate source/value
- Info 2 (conditional, type-specific):
  - **Lodging**: "Dates of Stay" — two `<input type="date">` fields (from / to), stored as `"YYYY-MM-DD to YYYY-MM-DD"` in `info2`
  - **Meals**: "Meal Type" (select: Breakfast/Lunch/Dinner/Supermarket/Snack/Coffee)
  - **Petrol**: "Liters" (number input)
- Notes (optional text)
- Save button, Cancel button
- Delete button (edit mode only, shown below separator)

### Currency & Exchange Rate System

**Two-stage rate system:**

**Stage 1 — Preview (form display):**
- On `openTrip()`, calls `getDefaultRates(tripCurrency)` to pre-fetch today's rates for: trip currency, EUR, USD → ILS
- Stored in `S.defaultRates` (reset only on trip switch, not on every `loadExpenses`)
- When user types an amount: `scheduleRate()` shows ILS estimate instantly from `S.defaultRates` — no async delay
- Badge shows "~ today's rate"
- If currency not in defaultRates: async fetch via `getExchangeRate` with 650ms debounce

**Stage 2 — Save:**
- On Save: checks if `defaultRates[cur].date === expenseDate`; if so, uses it directly (no network call)
- Otherwise: calls `getExchangeRate(cur, 'ILS', expenseDate)` for historical rate
- Badge states: `✓ live rate`, `⚠ cached rate`, `~ today's rate`, `✎ manual`, `= same currency`, `✗ unavailable`

**Special cases:**
- Currency = ILS: no conversion, stored as-is, rate = 1, source = 'same'
- Manual ILS entry: user can type ILS amount directly; sets `S.manualILS = true`; skips all rate fetching on save

**Supported currencies (39):** ILS, EUR, USD, GBP, JPY, THB, CHF, NOK, SEK, DKK, PLN, CZK, HUF, RON, BGN, AUD, CAD, NZD, SGD, HKD, CNY, INR, KRW, MXN, BRL, TRY, ZAR, IDR, MYR, PHP, ISK, AED, QAR, SAR, KWD, BHD, OMR, JOD, EGP

### Expense Categories
13 built-in types with fixed colors and icons:

| Type | Display Label | Icon | Color |
|---|---|---|---|
| Flight | Flight | ✈️ | #2196F3 |
| Lodging | Lodging/Hotel | 🏨 | #9C27B0 |
| Car Rental | Car Rental | 🚗 | #FF9800 |
| Insurance | Insurance | 🛡️ | #607D8B |
| Petrol | Petrol | ⛽ | #F44336 |
| Toll Roads | Toll Roads | 🛣️ | #795548 |
| Parking | Parking | 🅿️ | #FF5722 |
| Transportation | Transportation | 🚌 | #00BCD4 |
| Meals | Meals | 🍽️ | #4CAF50 |
| Souvenirs | Souvenirs | 🎁 | #E91E63 |
| Attractions | Attractions | 🎡 | #FFC107 |
| Phone | Phone | 📱 | #2196F3 |
| Other | Other | 📌 | #9E9E9E |

- `TYPE_LABELS` map: `{ 'Lodging': 'Lodging/Hotel' }` — display-only rename; data key stays `'Lodging'` for backwards compatibility
- `typeLabel(t)` helper: `TYPE_LABELS[t] || t` — used everywhere a type is displayed

### Custom Expense Types
- "Manage Types" modal: lists custom types with delete, input for new type name
- Optimistic update for add and delete
- Stored in `settings.customTypes` via `addExpenseType` / `deleteExpenseType`

---

## Report Feature

> The Report is now the **📊 Report sub-tab** within `view-trip`, not a standalone view. It is lazy-loaded on the first switch to that tab.

- Requires `getReport(tripId)` — one server call, includes everything
- **Banner** (blue gradient header):
  - Trip title, country, planned days, expense count, date range
  - Three tiles in a 3-column grid: ILS ₪ / USD $ / EUR €
  - Each tile shows: currency label, total amount (large bold), avg/day beneath in smaller font (hidden if `days = 0`)
- **Pie chart** (Chart.js, lazy-loaded from CDN):
  - Categories sorted by `totalILS` **descending** before chart and legend are built
  - Chart.js default legend disabled; custom HTML legend rendered in `#pieLegend`
  - **Currency selector** dropdown above chart (ILS / USD / EUR / local currency if not one of the above) — stored in `S.reportCurrency`; changing it calls `renderPieLegend()` without rebuilding the chart
  - Tooltip: shows amount in selected currency + percentage of total ILS
- **Custom pie legend** (`renderPieLegend()`):
  - One card per category (flex-wrap grid, min-width 130px)
  - Category label: colored dot + icon + name (category color applied to label text, not to numbers)
  - Total value in selected currency: black, bold, large; with `(X%)` in small muted text
  - Avg/day: `{value} (avg/day)` — left-aligned, muted; hidden if `days = 0` or value unavailable
- **Breakdown table**: Category | Count | ILS | USD | EUR | TOTAL row
- Rate note: date + "ECB official rates"
- `S.pieChart` destroyed and recreated on each report load; `S._reportData` caches report for `renderPieLegend` re-calls; `S.reportCurrency` persists across report re-opens

---

## Tracker Feature

Three tabs: **List**, **Calendar**, **Map**

### Check-in Object
```javascript
{ id, tripId, timestamp, name, type, lat, lng, gpsSource, createdAt }
```

### Check-in Types (with colors and icons)
| Type | Color | Icon |
|---|---|---|
| place | #1565C0 | 📌 |
| hotel | #9C27B0 | 🏨 |
| restaurant | #4CAF50 | 🍽️ |
| attraction | #FF9800 | 🎡 |
| transport | #F44336 | 🚗 |
| flight-in | #0288D1 | 🛬 |
| flight-out | #1565C0 | 🛫 |
| hike | #2E7D32 | 🥾 |
| groceries | #F57C00 | 🛒 |
| other | #9E9E9E | 🗂️ |

### Check-in Form
- Shown/hidden (not navigated) within the Tracker view
- Fields: Place Name (with suggestion dropdown), Date, Time, Type
- GPS status row: colored dot (spin/ok/err) + status text + "📍 Pick on Map" button
- GPS acquired automatically on form open via `navigator.geolocation.getCurrentPosition` (10s timeout, high accuracy)
- Form persists visibility state when switching tabs (`S._listFormVisible`)

### Place Name Autocomplete
- **Nearby suggestions** (when GPS available, no text typed): `PlacesService.nearbySearch()`, **300m radius**, max 8 results
  - Filters out generic result types with `skipTypes` (same list as Planner: `route`, `street_address`, `locality`, `sublocality`, `country`, `political`, `geocode`, `postal_code`)
  - Returns name, type subtitle (from `_googleTypeToCheckin(result.types)`), and coords from `geometry.location`
  - `gpsSource: 'google'` set when a nearby suggestion is selected
- **Name search** (when user types): `AutocompleteService.getPlacePredictions()`, `language: 'en'`, session token (`_trackerToken()`)
  - `structured_formatting.main_text` as name, `.secondary_text` as subtitle; no coords in predictions
- **Selection with `place_id`**: `PlacesService.getDetails({ placeId, fields: ['geometry', 'types'], sessionToken: _trackerToken() })` resolves lat/lng AND place types; `_trackerAcToken = null` cleared after call
  - `types` field: passed to `_googleTypeToCheckin(types)` to auto-set the check-in type dropdown
  - `gpsSource: 'google'` set on selection
- **`_googleTypeToCheckin(types)`**: maps Google place `types[]` → check-in type key (lodging→hotel, restaurant/food→restaurant, etc.). Falls back to `'place'`.
- **`CI_TYPE_LABELS`**: global map `{ place:'Place', hotel:'Hotel', restaurant:'Restaurant', ... }` — used in map InfoWindow to display readable type name
- Selecting a suggestion: fills name field, updates `S.gpsCoords`, GPS status to "ok", auto-sets type dropdown
- Click outside suggestion list closes it (via `document.addEventListener('click')`)

### List Tab
- Check-ins grouped by local date, sorted ascending
- Date labels show: "Apr 19, 2026 · Sun (יום א׳)" (English DOW + Hebrew DOW)
- Each card: colored icon, name, formatted time, GPS coordinates (if available)
- Edit (✎) and Delete (🗑) buttons on each card
- Edit: pre-fills form, shows GPS status based on stored coords
- Delete: confirms via modal, optimistic update; `doDeleteCheckin` uses `setTimeout(fn, 0)` to close the modal before calling `google.script.run` (prevents UI freeze if delete is slow)

### Calendar Tab (7-column grid)
- Columns: Sun–Mon–Tue–Wed–Thu–Fri–Sat
- Sticky DOW header row (z-index 10, synced horizontal scroll)
- Date range filter bar (From/To date inputs, Clear button, Export button)
- Default range: first to last check-in date
- Grid starts on Sunday on/before `fFrom`, ends on Saturday on/after `fTo`
- Out-of-range days: grey "vacant" style
- Cell font sizes: header 12px, pills 13px, hotel footer 12px
- Each cell:
  - Header: DD/MM + italic day description (if any) — clickable to edit note on in-range days
  - Body: check-in pills (colored bg, type icon + name), excluding hotels
  - Footer: hotel check-in if any (green background)
- Day notes: modal textarea, "Clear" button if note exists, saved via `saveCalDesc`
- Scroll sync: DOW sticky table mirrors horizontal scroll of calendar table using `translateX`

### Map Tab
- Google Maps JavaScript API, lazy-loaded via `loadGoogleMaps()`
- Map height: `calc(100svh - 130px)`, min 300px
- "Export KML" button above map
- On tab switch: `setTimeout(initTrackerMap, 50)`
- Markers: `SymbolPath.CIRCLE`, colored fill (per CI_COLORS), white stroke 2.5px, scale 14; label = sequence number (white, 11px bold)
- Route polyline: `google.maps.Polyline`, strokeColor #1565C0, strokeOpacity 0.55, strokeWeight 2.5, chronological order
- InfoWindow (`S._trackerInfoWindow`): shared single instance (re-created on each `_renderLeafletMap` call), shows name (bold) + type icon + **type label** (from `CI_TYPE_LABELS[checkin.type]`) + formatted time + **"✏️ Edit" button** (calls `editCheckin(id)`, closes InfoWindow); clicking map background closes it (map `click` listener, registered once on first map creation)
- `fitBounds`, maxZoom 14 enforced via `bounds_changed` one-time listener
- Map instance (`S.leafletMap`) reused; markers (`S.leafletMarkers`) and polyline (`S._routeLine`) removed and re-added on each render

### Map Picker Overlay (`#mapPickerOverlay`)
- `position:fixed; inset:0; z-index:300` — full screen, above everything
- `display:none` → `display:flex; flex-direction:column` when opened
- **Header bar** (blue gradient): back button (←), "Pick Location" title, **"🌍 My Location" button**
- **Map area** (`#mapPicker`): `flex:1; min-height:0` — Google Maps map
- **Bottom bar**: coords display + "✓ Use This Location" confirm button
- **Context-aware**: `openMapPicker(context)` where context is `'checkin'` (default) or `'planner'`
  - Module-level var `_mpContext` tracks which context opened the picker
  - **Opening center logic (planner context)**:
    1. Reads stored coords (`S.planGpsCoords`) and source (`S.planGpsSource`)
    2. Coords are treated as "intentional" only if source is `'manual'`, `'nominatim'`, or `'saved'` — GPS auto-acquired (`'gps'`) is NOT treated as intentional (unreliable when the user just opened the form in their home country)
    3. If intentional coords exist: center at zoom 13
    4. If not intentional: call `_getTripCountryCenter()` → center on trip country at zoom 7
    5. Fallback: `{lat:30, lng:20}` world view at zoom 2
  - `_getTripCountryCenter()` — reads first country from `S.currentTrip.country`, looks up `COUNTRY_CENTERS` map (40+ entries, country name → `{lat, lng}`); returns `null` if not found
  - Checkin context: always uses `S.gpsCoords` at zoom 13, or world view if none
  - `confirmMapPin()` routes to `S.planGpsCoords` + `setPlanGpsStatus()` or `S.gpsCoords` + `setGpsStatus()` based on `_mpContext`
- Tap map → drops/moves marker, updates coords display, enables confirm button
- Marker is draggable — `dragend` updates coords
- **"My Location" button** (`id="myLocBtn"`): calls `navigator.geolocation.getCurrentPosition`, centers map at zoom 15, drops/moves marker. Shows "Locating…" while waiting. Placed in header (not bottom) to always be visible regardless of screen height.
- `_mpMap` (`google.maps.Map`), `_mpMarker` (`google.maps.Marker`), `_mpCoords`, `_mpContext` are module-level vars (separate from `S.leafletMap`)
- On reopen: removes previous marker (`_mpMarker.setMap(null)`, resets to clean state)

### KML Export (`exportTrackerKml()`)
- Only exports check-ins that have `lat` and `lng`
- KML structure: single `<Folder>` named after trip (= one toggleable layer in Google My Maps)
- Placemarks sorted by timestamp (chronological)
- Each placemark description: `"🎡 Attraction · Apr 19, 2:30 PM"`

**Icon URLs** (all from `maps.google.com/mapfiles/kml/`):
| Type | Icon |
|---|---|
| place | `paddle/blu-blank.png` (blue teardrop) |
| hotel | `shapes/lodging.png` |
| restaurant | `shapes/dining.png` |
| attraction | `shapes/arts.png` |
| transport | `shapes/cabs.png` |
| flight-in | `shapes/airports.png` |
| flight-out | `shapes/airports.png` |
| hike | `shapes/hiker.png` |
| groceries | `shapes/grocery.png` |
| other | `shapes/info_circle.png` |

**Colors** (KML ABGR format via `toKmlColor(hex)`):
- All types: `#1A73E8` (Google blue) → `ffE8731A`
- Hotel exception: `#7B1FA2` (purple) → `ffA21F7B` (avoids lodging.png default red)
- `KML_TYPE_COLORS = { 'hotel': KML_PURPLE }` — other types fall back to `KML_BLUE`

**CRITICAL**: All KML string assembly uses plain string concatenation — NO template literals. This is required because GAS HtmlService strips XML processing instructions and CDATA sequences from script tag content.

**Style structure**: one `<StyleMap>` per type, referencing normal (scale 1, label hidden) and highlight (scale 1, label shown) styles.

**Download**: `Blob` + `URL.createObjectURL` + programmatic `<a>` click, filename = trip title (sanitized) + `.kml`

---

## Places View — UI Component Vocabulary

Use these names in conversations to avoid long descriptions.

| Name | What it is |
|---|---|
| **Tab bar** | The `Places` / `Calendar` tab switcher |
| **FAB** | The `+` floating action button (bottom-right) |
| **Ribbon** | The full strip of place chips above the map |
| **Chip** | A single place badge in the ribbon |
| **Chip ×** | The `×` delete button inside a chip |
| **Ribbon toggle** | The `▼ Bank (N)` collapse/expand button |
| **Map** | The Google Maps canvas |
| **Pin** | A marker on the map for a saved place |
| **Pin label** | The emoji icon rendered inside a pin |
| **Place Menu** | Right-click (desktop) or long-press (mobile) context menu on an *unknown* map location — shows "Add to Bank". Has 120px photo strip, website link, and 44×44 × button. |
| **Pin Menu** | Right-click (desktop) or long-press (mobile) context menu on a *saved* pin — shows Assign / Edit / Remove. Has lazy-loaded 80px photo strip (via `findPlaceFromQuery`), linkified description, and 44×44 × button. |
| **Add Form** | The floating sheet for adding or editing a place |
| **Day Picker** | The modal calendar for assigning a place to trip days |
| **Delete Confirm** | The inline popover that confirms place deletion |

### Chip Interaction Behaviour
- **Left-click**: focus (pan map to matching Pin, highlight Chip in Ribbon)
- **Right-click**: open Pin Menu at mouse position

### Add Form Open Behaviour
- Closes any open Pin Menu or Place Menu before showing

### Map Picker (Pick Location overlay)
- Esc key acts as Back button (same as ← in header)

---

## Trip Planner Feature

Accessed via "📋 Plan" button on the trip header. Separate from the Tracker — focuses on planning places to visit before/during a trip, not recording where you've been.

Three tabs: **Bank**, **Calendar**, **Map**

### Place Bank Object
```javascript
{
  id,          // uuid
  tripId,
  name,        // display name
  type,        // key from PLAN_TYPES
  lat, lng,    // optional GPS coords
  description  // optional text, supports Hebrew/RTL via dir="auto"
}
```

### PLAN_TYPES (23 types)
| Key | Icon | Color | Label |
|---|---|---|---|
| nature-hike | 🥾 | #2E7D32 | Nature Hike |
| lake-river | 🏞️ | #0288D1 | Lake/River |
| cablecar | 🚡 | #7B1FA2 | Cablecar |
| restaurant | 🍽️ | #4CAF50 | Restaurant |
| coffee | ☕ | #795548 | Coffee |
| sweet | 🍦 | #E91E63 | Sweet |
| beer | 🍺 | #F57F17 | Beer |
| market | 🏪 | #FF6D00 | Market |
| supermarket | 🛒 | #F57C00 | Supermarket |
| shop | 🛍️ | #9C27B0 | Shop |
| petrol | ⛽ | #616161 | Petrol Station |
| gas-station | ⛽ | #FF6F00 | Gas Station |
| hotel | 🏨 | #9C27B0 | Hotel |
| attraction | 🎡 | #FF9800 | Attraction |
| cave | 🦇 | #4E342E | Cave |
| fortress | 🏰 | #8D6E63 | Fortress/Temple |
| museum | 🏛️ | #5D4037 | Museum |
| viewpoint | 👁️ | #00BCD4 | Viewpoint |
| airport | ✈️ | #0288D1 | Airport |
| car-rental | 🚗 | #F44336 | Car Rental |
| city-walk | 🚶 | #1565C0 | City Walk |
| village | 🏘️ | #558B2F | Village |
| parking | 🅿️ | #37474F | Parking |

Note: `petrol` (Petrol Station) and `gas-station` (Gas Station) are distinct types kept for backward compatibility. `gas-station` was added later to match Google Maps `gas_station` POI type.

### Bank Tab
- Lists all places with icon, name, type label, GPS indicator (📡 if coords present)
- Description preview (first 80 chars) shown below type label
- Tap card → opens edit form pre-filled
- Delete button (🗑) per card → confirms via modal (warns about day assignment removal)
- Empty state with "+ Add Place" button

### Add / Edit Place Form
- Shown inline (not a new view) within the bank tab; `plan-form-wrap` div
- Fields: Place Name (with suggestion dropdown), Type (**searchable dropdown**), Description (textarea, `dir="auto"`, resizable, Hebrew-compatible)
- GPS status row: same pattern as check-in form (dot + text + "📍 Pick on Map" button)
- GPS acquired automatically via `acquirePlanGPS()` when opening for a new place
- "Pick on Map" calls `openMapPicker('planner')` — uses `S.planGpsCoords` context
- Form title: "📍 Place Details"; save button: "+ Add to Bank" (new) or "✓ Save Changes" (edit)
- **Type field** — custom searchable dropdown (not `<select>`):
  - HTML: text input (`#planTypeInput`) + hidden input (`#planType`) + `.suggest-list` div (`#planTypeList`)
  - Types sorted alphabetically by label; stored in `_planTypeKeys` array (initialized in `init()`)
  - On focus: shows full sorted list; on input: filters by label (strips leading emoji via `replace(/^[^\w]+\s*/,'')`)
  - Arrow key navigation (`.active` class + `scrollIntoView({ block: 'nearest' })`), Enter to select, Escape to close
  - `_selectPlanType(key)` — sets hidden + visible input, hides dropdown, resets `_planTypeKbIdx = -1`
  - Clicking outside closes dropdown (via `document.addEventListener('click')`)
- Button row: Cancel | **Remove** (edit mode only, red, `id="planDelBtn"`) | Save — all inline in one `.btn-row`
- `S._planFormVisible` persists form across tab switches (same pattern as check-in form)
- After save: calls `loadPlan()` to refresh from server

### Place Name Autocomplete (Planner)
- Same mechanisms as Tracker: `PlacesService.nearbySearch()` for nearby (600m) + `AutocompleteService.getPlacePredictions()` for name search
- No country-scoping — Google Places returns globally relevant results by default
- Separate suggestion element (`#planSuggest`), separate state (`S.planSuggestTimer`), separate session token (`_plannerToken()` / `_plannerAcToken`)
- Selection with `place_id`: `PlacesService.getDetails({ placeId, fields: ['geometry', 'photos'], sessionToken: _plannerToken() })` resolves coords and fetches photo; `_plannerAcToken = null` cleared after call
  - If `photos[0]` available: stores photo URL in `S._ctxMenuPhotoUrl` (same propagation path as context menu)
- Selecting fills `#planName` and sets `S.planGpsCoords` + `setPlanGpsStatus('ok', ...)` if coords available

### Calendar Tab (Planner)
- Same 7-column weekly grid layout as Tracker calendar
- Date range: defaults to trip `startDate`/`endDate`; falls back to assigned date range if no trip dates set
- Date range filter bar (From/To inputs) — same pattern as Tracker calendar
- Each in-range cell:
  - Header: DD/MM (no clickable note; notes are a Tracker-only feature)
  - Body: non-hotel places as colored pills (type color, icon + name); each pill has "×" remove button (`removePlaceFromDayUI`)
  - Footer (green): hotel places each shown with "×" remove button (`removePlaceFromDayUI`); multiple hotels joined by " / " separator
  - "+ add" button (dashed border) → opens assignment modal
- Assignment modal: scrollable checklist of all bank places with checkboxes; pre-checks currently assigned
  - On "Done": calls `setPlanDayAssignment` (bulk replace for that day)
  - On "×" pill button: calls `removePlaceFromDay` (single remove)
- Vacant (out-of-range) cells: grey, no add button

### Map Tab (Planner)
- Google Maps showing all bank places that have GPS coords
- Markers: `SymbolPath.CIRCLE`, colored per PLAN_TYPES, white stroke 2.5px, scale 14; label = type emoji (13px)
- InfoWindow (`S._planInfoWindow`, `maxWidth: 300`): place name + type icon/label + full description (linkified, `max-height: 120px; overflow-y: auto`) + assigned days list + "📅 Assign to Day" button
  - Content wrapped in `<div style="min-width:240px">` to prevent narrow/misaligned popup
  - Stored on `S._planInfoWindow` so `openDayPickerForPlace()` can call `.close()` before showing the modal
  - Clicking map background calls `S._planInfoWindow.close()` (map `click` listener, registered once on first map creation)
  - CSS `!important` overrides: `.gm-style .gm-style-iw-c { max-height: 320px !important }` and `.gm-style .gm-style-iw-d { max-height: 290px !important }` — required because Google Maps sets inline `max-height` that would otherwise clip content
  - `maxWidth: 300` on InfoWindow constructor
- `fitBounds`, maxZoom 14 enforced via `bounds_changed` one-time listener
- Separate instance `S.plannerMap` (does not share with `S.leafletMap` or `_mpMap`)
- No GPS data → "No places with GPS data yet" message

#### Right-click / Long-press Context Menu (Place Menu)

**CRITICAL**: `google.maps.Map` `rightclick` and `contextmenu` events are **dead in GAS iframe** — they never fire. Use DOM `contextmenu` event on the map container instead.

**Entry points**:
- Desktop: `container.addEventListener('contextmenu', fn)` — fired on right-click. `e.preventDefault()` suppresses browser context menu. Pixel coords from `e.clientX / e.clientY`. Calls `_handleMapContextAt(cx, cy)`.
- Mobile: `touchstart` → 600ms timer → `_lpFired = true` + vibrate(30ms) → `touchend` handler. Pixel coords from first touch in `touchstart` (`e.changedTouches[0].clientX/Y`). Also calls `_handleMapContextAt(cx, cy)`.

**Long-press mobile mechanics** (`_lpTimer`, `_lpFired`, `_lpTouch`, `_lpTime`):
- `touchstart`: record `_lpTouch = {cx, cy}`, stamp `_lpTime = Date.now()`, start `_lpTimer = setTimeout(600ms)`
- Timer fires: `_lpFired = true`, vibrate, call `_handleMapContextAt(_lpTouch.cx, _lpTouch.cy)`
- `touchmove`: if finger moved more than 10px, `clearTimeout`, cancel (`_lpFired` stays false)
- `touchend`: `clearTimeout`. If `_lpFired`:
  - **Re-stamp `_lpTime = Date.now()`** — this is the critical fix: re-measures 800ms guard from the actual finger-lift moment, not the 600ms timer fire
  - `e.preventDefault()`
  - `_lpFired = false`
- Map `click` handler: guard `if (Date.now() - _lpTime < 800) return` — suppresses the synthetic click that Maps API fires on `touchend` for named POIs even after `preventDefault()`

**`_pixelToLatLng(cx, cy)`**: converts viewport pixel coords to `google.maps.LatLng` using map projection — `overlay.getProjection().fromContainerPixelToLatLng(new google.maps.Point(cx, cy))`. `_overlayView` is a lazily-created `google.maps.OverlayView` attached to the map once and never removed.

**`_handleMapContextAt(cx, cy)`**:
1. Converts pixel → LatLng via `_pixelToLatLng(cx, cy)`
2. Shows loading state in `#plannerContextMenu`: positioned at `(cx, cy)`, contains only × button + "Loading…" text
3. Calls `PlacesService.nearbySearch({ location, radius: 300, rankBy: PROMINENCE })` to find if there's a known POI at the tap point
   - `skipTypes`: filters out overly generic result types: `'route'`, `'street_address'`, `'locality'`, `'sublocality'`, `'country'`, `'political'`, `'geocode'`, `'postal_code'`
   - If nearbySearch returns a result not in skipTypes: calls `getDetails({ placeId, fields: ['name','geometry','types','photos','website','formatted_address','editorial_summary'] })`
     - `photos[0].getUrl({ maxWidth: 320, maxHeight: 120 })` for the photo strip (120px height)
     - `website` shown as a clickable link if present
     - `editorial_summary.overview` or `formatted_address` used as description suggestion
     - `types` → `_googleTypeToPlanner(types)` → PLAN_TYPES key
     - Stores result in `S._ctxMenuData = { lat, lng, name, type, description, photoUrl, website }`
   - If no POI found / all results in skipTypes: uses geocoded coords only, `S._ctxMenuData = { lat, lng }`; shows "Add a Place" menu without name/photo
4. Renders the full Place Menu (see below)

**`_googleTypeToPlanner(types)`**: priority-ordered mapping from Google place `types[]` array → PLAN_TYPES key:
- `lodging` → `hotel`; `campground` → `nature-hike`; `cafe` / `bakery` / `coffee_shop` → `coffee`
- `bar` / `night_club` → `beer`; `restaurant` / `food` → `restaurant`; `supermarket` / `grocery_or_supermarket` → `supermarket`
- `museum` → `museum`; `church` / `mosque` / `synagogue` / `place_of_worship` → `fortress`
- `airport` / `transit_station` → `airport`; `car_rental` → `car-rental`; `parking` → `parking`
- `gas_station` → `gas-station`; `shopping_mall` / `clothing_store` → `shop`; `store` / `market` → `market`
- `natural_feature` / `park` → `nature-hike`; `viewpoint` → `viewpoint`; `tourist_attraction` / `amusement_park` → `attraction`
- Falls back to first key in `Object.keys(PLAN_TYPES)[0]`

**Place Menu HTML** (`#plannerContextMenu`, `position:absolute; z-index:200; width:260px; border-radius:12px; box-shadow; background:white`):
- **Photo strip** (if available): `height:120px; overflow:hidden; background:#e5e7eb` — `<img>` with `object-fit:cover`; `onerror` hides the strip
- **× button**: `position:absolute; top:0; right:0; font-size:22px; padding:10px 12px; min-width:44px; min-height:44px; display:flex; align-items:center; justify-content:center; z-index:1` — tap target is 44×44px to meet mobile accessibility guidelines
- **Name** (bold 13px): `padding:10px 14px 2px; padding-right:40px` — right-padding avoids overlap with × button
- **Type chip** (11px, primary color): icon + label
- **Website link** (if present): rendered as clickable `<a target="_blank">`, truncated to 40 chars for display
- **Description/address snippet** (11px, 2 lines max)
- **Action row**: "📍 Add to Bank" button spanning full width
- Positioned at `(cx+4, cy)` if room to the right of tap point; otherwise `(cx - menuW - 4, cy)`. Y clamped to viewport. After render: setTimeout repositions if `bottom > innerHeight - 4`.
- Menu dismissed by: × button, tapping outside (`document.addEventListener('click')`, one-shot), or long-press map click guard

**`_contextMenuAddToBank()`**: called by "Add to Bank" action button:
- Hides menu, reads `S._ctxMenuData`
- Stores `S._ctxMenuPhotoUrl = data.photoUrl || null` — carries photo URL into the new place
- Builds `descParts` from website + description/address; passes as prefill to `showPlannerForm(coords, name, type, descParts.join('\n'))`
- `showPlannerForm` pre-fills all form fields with the suggestion data

**Photo propagation path (context menu → pin cache)**:
1. `_contextMenuAddToBank()` sets `S._ctxMenuPhotoUrl = photoUrl`
2. User submits form → `savePlanPlaceUI` success handler: `S._planPendingPhotoAssign = { name, photoUrl: S._ctxMenuPhotoUrl }`; clears `S._ctxMenuPhotoUrl`
3. `loadPlan` success handler: finds `S.planBank` entry whose `name` matches `S._planPendingPhotoAssign.name` and whose id is not yet in `S._planPhotoCache`; sets `S._planPhotoCache[found.id] = photoUrl`
4. `cancelPlannerForm()` also clears `S._ctxMenuPhotoUrl` in case user cancels

#### Pin Menu (right-click on a saved marker)

Separate from Place Menu. Triggered by `rightclick` on a `google.maps.Marker` (desktop) or marker long-press (mobile, same `_lpTimer` logic). Shows info and actions for an existing bank place.

**HTML structure** (`#plannerContextMenu` reused):
- **Photo strip** (80px height, lazy-loaded): `<div id="pin-photo-wrap">` — `display:none` until photo loads
- **× button**: same 44×44px style as Place Menu; `position:absolute; top:0; right:0; z-index:1`
- **Name** (bold 13px): `padding-right:40px` to clear × button
- **Type chip** (11px, primary color)
- **Description** (11px, max 100 chars, linkified via `_linkifyDesc()`): `max-height:56px; overflow:hidden; line-height:1.5`
- **Day assignment** list (if any assigned days)
- **Action row** (3 buttons, `flex`): "📅 Assign" | "✏️ Edit" | "✕ Remove"
- **Google Maps link**: `<a>` to `https://maps.google.com/?q=lat,lng`

`showPinMenu(placeId, cx, cy)`:
- Looks up place in `S.planBank` by id
- Sets `menu._pinId = placeId` (used by async photo callback to check if menu is still open for this place)
- Renders full HTML
- If `S._planPhotoCache[placeId] === undefined` (never fetched) and `p.name` exists: sets cache to `null` (prevents re-fetch), calls `_fetchPinPhoto(placeId, name, lat, lng)`
- If cached URL already: renders photo in strip immediately
- If cached `null`: leaves strip hidden

**`_fetchPinPhoto(bankPlaceId, name, lat, lng)`**:
- Calls `loadGoogleMaps(() => { ... })` to ensure API loaded
- `PlacesService.findPlaceFromQuery({ query: name, fields: ['photos'], locationBias: { lat, lng } })`
- On result: stores URL (or `null`) in `S._planPhotoCache[bankPlaceId]`
- If photo found AND `#plannerContextMenu` is still visible AND `menu._pinId === bankPlaceId`: updates `#pin-photo-wrap` DOM in place (no full re-render)

**`_linkifyDesc(text)`**: splits text on `/(https?:\/\/[^\s]+)/g`, wraps URL parts in `<a href="..." target="_blank" rel="noopener">`, passes non-URL parts through `esc()`. Used in both Pin Menu description and Planner map InfoWindow.

#### Add Place via + Button (photo fetch)

When user taps the "+ Add Place" header button:
1. `showPlannerForm()` opens with empty fields
2. On form submit (`savePlanPlaceUI`): no `S._ctxMenuPhotoUrl` available (path bypassed context menu)
3. Photo is fetched lazily when the Pin Menu is first opened for that place (via `_fetchPinPhoto`)

When user adds via context menu "Add to Bank" (see above): photo is already available from `getDetails` and gets cached immediately via `S._planPendingPhotoAssign` propagation path.

### Planner Layout
- Full viewport width (`width:100vw; margin-left:calc(50% - 50vw)`) — same as Tracker
- Tabs/form/bank panel: max-width 620px, centered
- Calendar/map panels: full width with 14px side padding
- Map height: `calc(100svh - 130px)`, min 300px

---

## External Libraries (Lazy-Loaded)

### Chart.js
- URL: `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js`
- Loaded on first report view
- Instance stored in `S.pieChart`, destroyed before re-creation

### Google Maps JavaScript API
- URL: `https://maps.googleapis.com/maps/api/js?key=AIzaSyD_DRzG7TqWgNiQMdeyOzk4MLW2pezem6U&libraries=places&callback=_gmapsReady`
- Loaded lazily on first map/autocomplete use via `loadGoogleMaps(cb)`
- Async + callback pattern: `window._gmapsReady` drains the `_gmapsCallbacks[]` queue; `_gmapsLoaded` flag prevents double-loading
- Already-loaded check: `if (window.google && window.google.maps && window.google.maps.places)`
- Libraries: `places` — `PlacesService`, `AutocompleteService`, `AutocompleteSessionToken`
- Three separate `google.maps.Map` instances: `S.leafletMap` (tracker), `S.plannerMap` (planner), `_mpMap` (picker)
- `S.leafletMarkers` / `S.plannerMarkers` — arrays of `google.maps.Marker` instances
- `S._routeLine` — `google.maps.Polyline` (tracker route)
- Session tokens: `_trackerAcToken` and `_plannerAcToken` — `AutocompleteSessionToken` instances, cleared to `null` after each `getDetails` call

---

## Supported Countries (COUNTRIES array, 99 entries)

Full list includes Afghanistan through Zimbabwe. Used for `<datalist>` autocomplete on trip creation (now shown as suggestions in the country tag input).

---

## Country Lookup Maps

### COUNTRY_ISO (40+ entries)
Maps lowercase country name → ISO 3166-1 alpha-2 code. Previously used to scope Nominatim search by country — no longer used after migration to Google Places API (function `_getTripCountryCodes()` remains in code but is not called).

Examples: `"austria" → "at"`, `"czech republic" → "cz"`, `"greece" → "gr"`, `"israel" → "il"`, `"france" → "fr"`, etc.

### COUNTRY_CENTERS (40+ entries)
Maps lowercase country name → `{ lat, lng }` geographic center. Used by `_getTripCountryCenter()` to set the default map picker viewport.

Examples: `"austria" → {lat:47.5, lng:14.5}`, `"greece" → {lat:39.0, lng:22.0}`, `"france" → {lat:46.2, lng:2.2}`, etc.

---

## Bugs Fixed (non-negotiable implementation constraints)

### Bug 1 — ILS currency conversion race condition
**Problem:** When user changed currency to ILS after typing an amount, an in-flight async rate response from the previous currency overwrote the correct ILS value.
**Fix v1:** Callback checks if currency changed since request; ignores stale responses.
**Fix v2 (implemented):** Replaced async-on-type with pre-fetched `defaultRates`. `scheduleRate()` is synchronous when currency is in `defaultRates`. No async calls while typing.

### Bug 2 — Back button not responding
**Problem:** `navStack` accumulated entries inconsistently (every `navigate()` call pushed, including calls inside `goBack()`). Back button navigated to unexpected views or did nothing.
**Fix:** Replaced stack-based logic with deterministic DOM-based logic: read current active view via `document.querySelector('.view.active').id`. `expense`/`report`/`tracker` → `trip`; everything else → `trips`.

### Bug 3 — Toast notification stays on screen permanently
**Problem:** Toast used `opacity/visibility` transition approach but initial offset was too small, leaving the toast partially visible.
**Fix:** Toast uses `opacity:0; visibility:hidden; transform:translateX(-50%) translateY(16px)` hidden state and `opacity:1; visibility:visible; transform:translateX(-50%) translateY(0)` shown state. The `visibility:hidden` approach (not `display:none`) avoids black rectangle flash on Android WebView.

### Bug 4 — App stuck at loading (KML export breaks GAS HtmlService)
**Problem:** KML generation code used template literals containing `<?xml version="1.0" encoding="UTF-8"?>`. GAS HtmlService strips XML processing instructions and CDATA sequences from `<script>` tag content during HTML output creation, corrupting the JavaScript.
**Fix:** Converted ALL KML string assembly to plain string concatenation:
```javascript
const kml = '<?xml version="1.0" encoding="UTF-8"?>' + '\n' +
  '<kml xmlns="http://www.opengis.net/kml/2.2">' + '\n' + ...
```
No template literals may contain `<?`, `<![CDATA[`, or `]]>`.

### Bug 5 — Attraction check-ins not appearing in Google My Maps after KML import
**Problem:** `camera.png` icon is not supported by Google My Maps importer.
**Fix:** Changed attraction icon to `arts.png`.

### Bug 6 — Hotel KML icon appearing red in Google My Maps
**Problem:** `shapes/lodging.png` has a built-in red color; Google My Maps ignores `<color>` tinting for shapes icons.
**Fix:** Applied `KML_TYPE_COLORS = { 'hotel': KML_PURPLE }` (purple `#7B1FA2`) in the `<IconStyle><color>` element. Purple visually distinguishes from red. The icon href remains `shapes/lodging.png` — only the color changes.
**Note:** Using `paddle/purple-blank.png` was rejected because it changes the icon shape, not just the color.

### Bug 7 — KML layers not toggleable as one group in Google My Maps
**Problem:** Google My Maps does not support nested `<Folder>` elements — it creates one layer per `<Folder>` in the `<Document>` regardless of nesting depth. Per-type sub-folders created many layers that had to be toggled individually.
**Fix:** All placemarks placed in a single `<Folder>` named after the trip. Icons/styles still differentiate types visually, but the entire trip is one toggleable layer.

### Bug 13 — Maps API `rightclick`/`contextmenu` events dead in GAS iframe
**Problem:** `google.maps.Map` fires `rightclick` and `contextmenu` events in normal web pages, but these events **never fire** when the app runs inside a Google Apps Script HtmlService iframe.
**Fix:** Attach a DOM `contextmenu` listener directly to the map container `div` (not to the `google.maps.Map` object). `e.preventDefault()` suppresses the browser menu. Convert pixel coords `(e.clientX, e.clientY)` → LatLng via `_pixelToLatLng()` using a lazily-created `OverlayView`. This is the **only reliable approach** for right-click in GAS; do not revert to Maps API events.

### Bug 14 — Mobile long-press on named Google Maps POI closes Place Menu immediately
**Problem:** After the 600ms long-press timer fires and opens the Place Menu, lifting the finger caused the menu to disappear. Root cause: `_lpTime` was stamped at timer fire (600ms after touch start). If the user held for, say, 900ms, `Date.now() - _lpTime` was already > 800ms when the Maps API fired a synthetic `click` event on `touchend` for named POIs. The map `click` handler's 800ms guard (`if (Date.now() - _lpTime < 800) return`) did not suppress it, so `_hideContextMenu()` ran.
**Fix:** Re-stamp `_lpTime = Date.now()` inside the `touchend` handler (only when `_lpFired === true`). This resets the 800ms window to the actual finger-lift moment, so the guard reliably catches the synthetic click regardless of how long the user held.
**Note:** For empty map areas, Maps respects `touchend.preventDefault()` and does not fire a synthetic click — only named POIs trigger this problem.

### Bug 11 — "Assign to Day" button in planner map InfoWindow does nothing
**Problem:** `openDayPickerForPlace()` called `S.plannerMap.closePopup()` — a Leaflet method — to dismiss the popup before opening the modal. After migration to Google Maps this became a no-op / TypeError.
**Fix:** Stored the InfoWindow reference as `S._planInfoWindow` when created in `_renderPlannerLeaflet()`. `openDayPickerForPlace()` now calls `if (S._planInfoWindow) S._planInfoWindow.close()`.

### Bug 12 — Planner map InfoWindow clips content / "Assign to Day" button not visible
**Problem:** Google Maps sets inline `max-height` CSS on `.gm-style-iw-c` and `.gm-style-iw-d` elements (~200px), clipping InfoWindow content that includes the "Assign to Day" button.
**Fix:** Added CSS `!important` class rules that override the inline style:
```css
.gm-style .gm-style-iw-c { max-height: 320px !important; }
.gm-style .gm-style-iw-d { overflow: auto !important; max-height: 290px !important; }
```
Also set `maxWidth: 240` on the `InfoWindow` constructor to constrain width.

### Bug 9 — New built-in type (Phone) missing from type dropdown
**Problem:** `getExpenseTypes()` returns server-saved custom types merged with defaults. If the user's saved types didn't include `Phone` (added after account creation), the new default was invisible.
**Fix:** Client always rebuilds the full list as `S.expenseTypes = [...defaultTypes(), ...customOnly]` where `customOnly` = server types not already in `defaultTypes()`. Built-in types are always present regardless of what's stored.

### Bug 10 — Edit trip title from trips list doesn't update immediately
**Problem:** After editing a trip from the trips list, the updated title was not shown until the next full reload. Root cause: `S.currentTrip` persists after navigating back to the trips list. The condition `if (S.currentTrip && S.currentTrip.id === data.id)` matched (same trip), routing the re-render to `renderExpenses()` (trip view) instead of `renderTrips()`.
**Fix:** Added active-view check: `const inTripView = document.getElementById('view-trip').classList.contains('active')`. Only calls `renderExpenses()` and updates `hTitle` when the trip view is actually the active DOM view; otherwise calls `renderTrips()`.

### Bug 8 — "My Location" button in map picker not visible on small screens
**Problem:** Button was in the bottom bar below the confirm button. On small screens or with device safe-area insets, the bottom bar could be tall enough to push the button off-screen.
**Fix:** Moved "My Location" button (`id="myLocBtn"`) to the map picker header bar (right side, white semi-transparent style matching header button aesthetics). Always visible regardless of screen height.

---

## UI Component Details

### Check-in Card
- Colored icon square (40×40, border-radius 10px, 22% opacity bg)
- Name (bold, ellipsis)
- Formatted timestamp
- GPS coordinates if available (small blue text, 📡 prefix)
- Edit and Delete buttons (right side, btn-outline / btn-danger, btn-sm)

### Expense Card
- Colored icon square (42×42, border-radius 11px)
- Name (bold, ellipsis)
- Meta line: type · info2 · info3
- "tap to edit" hint (small, blue, low opacity)
- Right side: original amount (small grey) + ILS amount (bold, colored)

### Summary Banner (trip view)
- Blue gradient, shows: country + currency, total ILS (large bold), expense count + date range

### Empty States
- Trip list, expense list, check-in list all have emoji + title + subtitle + action button

---

## Formatting Helpers

- `fmt(n)` — integer format with commas (toLocaleString en-US, 0 decimals), returns "—" for null/empty
- `num(n)` — up to 2 decimal places (no trailing zeros)
- `esc(s)` — HTML-escapes `&`, `<`, `>`, `"`
- `fmtDate(d)` — `"Apr 19, 2026"` format (uses `T12:00:00Z` to avoid timezone shifts)
- `dateRange(s, e)` — formatted range, handles missing start/end
- `today()` — `new Date().toISOString().split('T')[0]`
- `localDateStr(ts)` — extracts local `YYYY-MM-DD` from ISO timestamp using local Date methods
- `fmtCheckinTime(ts)` — `"Apr 19, 02:30 PM"` format (toLocaleString en-US)

---

## Responsive Design

- Max content width: 620px, centered
- `@media (min-width: 600px)`: increased padding, FAB repositioned to right of 620px column
- Tracker view: full viewport width (`width:100vw; margin-left:calc(50% - 50vw)`)
- Tracker tabs/form/list panels: max-width 620px, centered within tracker view
- No horizontal scroll on main content

### Tab Bar Alignment
Base rule: `.tracker-tabs { padding: 4px }` — this creates a 4px white gap above and below the active tab indicator, which looks misaligned against the surrounding layout.

Override applied to all three tab-bar hosts:
```css
#view-tracker .tracker-tabs { padding: 0 14px; }
#view-planner .tracker-tabs { padding: 0 14px; }
#view-trip    .tracker-tabs { padding: 0 14px; }
```
Effect: `padding: 0 14px` removes the vertical gap (blue active tab fills edge-to-edge) and widens side margins to 14px. All three views must have this override — if `#view-trip` is missing it, the Expenses/Report tab bar will have visible white margins that the other views do not.

---

## Calendar DOW Labels
- English: `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']`
- Hebrew: `['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']`
- Check-in list date labels show both: `"Sun (יום א׳)"`

---

## Data Files (JSON Import Sources)

Pre-converted trip JSON files stored in the project root for re-import or reference:

| File | Trip | Dates | Expenses | Notes |
|---|---|---|---|---|
| `austria_2024.json` | Austria 2024 | Apr 2024 | — | — |
| `austria_2025.json` | Austria 2025 | Apr 2025 | — | — |
| `north_italy_2023.json` | North Italy 2023 | Jun 17–Jul 1 2023 | 93 | EUR; pre-trip bookings from Apr 2023 |
| `greece_peloponnese_2025.json` | Greece, Peloponnese 2025 | Sep 29–Oct 13 2025 | — | EUR + USD + ILS |
