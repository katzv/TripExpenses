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
  "timeZone": "UTC",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets"
  ]
}
```

---

## Architecture

- **Single file frontend**: `Index.html` — all CSS, HTML, and JavaScript in one file, served via `HtmlService.createHtmlOutputFromFile('Index')`
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
- `updateTrip(d)` — updates `title`, `startDate`, `endDate` for trip by id
- `deleteTrip(id)` — deletes trip, its expenses (`exp_{id}`), its check-ins (`checkins_{id}`), and its calendar descriptions (`caldesc_{id}`)

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
- Default types: `['Flight','Lodging','Car Rental','Insurance','Petrol','Toll Roads','Parking','Public Transport','Meals','Souvenirs','Attractions','Other']`

### Report
- `getReport(tripId)` — returns `{trip, days, expenseCount, categories, totalILS, totalUSD, totalEUR, ratesDate}`. Categories sorted alphabetically, each with `{type, count, totalILS, totalUSD, totalEUR}`.

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
  filter, rateTimer, manualILS, lastRateInfo,
  defaultRates, pieChart,
  // Tracker:
  checkins, trackerTab, editingCheckinId,
  gpsCoords, gpsSource, leafletMap, leafletMarkers,
  _routeLine, suggestTimer, calLang,
  calFilterFrom, calFilterTo, calDescs,
  calWeeks,           // stored for export
  _listFormVisible,   // persists form state across tab switches
  _editingTripId      // used by trip edit modal
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
3. `view-trip` — expense list for current trip
4. `view-expense` — add/edit expense form
5. `view-report` — expense report
6. `view-tracker` — tracker (list/calendar/map tabs)

### Header
- Fixed top, 58px height, blue gradient background
- Back button (circle, `hbtn back`) — hidden by default, shown contextually
- Title (`htitle`) — ellipsis overflow
- Action buttons (`hActions`) — injected per view:
  - trips: "+ New Trip"
  - trip: "✎ Edit", "📍 Track", "📊 Report"
  - tracker: "+ Check-in"
  - expense/report/new-trip: none (back button only)

### Navigation
- `navigate(view)` — sets active view, updates header, triggers data loads
- `goBack()` — deterministic: `expense/report/tracker → trip`; everything else → `trips`
- **Back button does NOT use a navigation stack** — reads current active view from DOM

### FAB
- Orange circle, bottom-right, only visible on `view-trip`
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
{ id, title, country, currency, startDate, endDate, createdAt }
```

### Trip List View
- Shows all trips with: title, country+currency, date range, day count
- Edit button (✎) — opens Edit Trip modal (title + dates)
- Delete button (🗑) — confirms then deletes trip + all its data
- Tap anywhere on card → `openTrip(id)` which resets `S.defaultRates = {}`

### New Trip Form
- Fields: Title (required), Destination Country (required, with datalist autocomplete), From Date, To Date
- Country input auto-detects currency: shown as hint below field
- `countryToCur()` maps country name → currency code (39 countries mapped)
- On create: calls `createTrip`, then re-fetches trips, navigates to `view-trip`

### Edit Trip
- Modal with Title, From Date, To Date
- Optimistic update: reflects immediately in UI, then calls `updateTrip` in background

---

## Expenses Feature

### Expense Object
```javascript
{ id, tripId, date, expense, type, amount, currency, amountILS, rate, rateDate, rateSource, info2, info3, createdAt }
```

### Expense List
- Summary banner: total ILS (formatted with commas), expense count, date range
- Filter chips: "All" + one per type present in expenses (horizontal scroll)
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
  - **Lodging**: "Dates of Stay" (text input)
  - **Meals**: "Meal Type" (select: Breakfast/Lunch/Dinner/Supermarket/Snacks)
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

### Custom Expense Types
- "Manage Types" modal: lists custom types with delete, input for new type name
- Optimistic update for add and delete
- Stored in `settings.customTypes` via `addExpenseType` / `deleteExpenseType`

---

## Report Feature

- Requires `getReport(tripId)` — one server call, includes everything
- Banner: trip title, country, planned days, expense count, date range
- Three totals: ILS, USD, EUR
- Pie chart (Chart.js, lazy-loaded from CDN) — spending by category, legend at bottom, tooltip shows ILS + %
- Breakdown table: Category | Count | ILS | USD | EUR | TOTAL row
- Rate note: date + "ECB official rates"
- `S.pieChart` destroyed and recreated on each report load

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
- **Nearby suggestions** (when GPS available, no text typed): Overpass API, 300m radius, max 8 results
  - Query: `node["name"](around:300,lat,lng)` + `way["name"](around:300,lat,lng)`
  - Shows name + amenity/tourism/place/shop tag as subtitle
- **Name search** (when user types): Nominatim search, max 6 results, biased toward GPS viewport (±0.5°)
  - First part of display_name as name, next 2 parts as subtitle
- Selecting a suggestion: fills name field, updates `S.gpsCoords` and GPS status to "ok"
- Click outside suggestion list closes it

### List Tab
- Check-ins grouped by local date, sorted ascending
- Date labels show: "Apr 19, 2026 · Sun (יום א׳)" (English DOW + Hebrew DOW)
- Each card: colored icon, name, formatted time, GPS coordinates (if available)
- Edit (✎) and Delete (🗑) buttons on each card
- Edit: pre-fills form, shows GPS status based on stored coords
- Delete: confirms via modal, optimistic update

### Calendar Tab (7-column grid)
- Columns: Sun–Mon–Tue–Wed–Thu–Fri–Sat
- Sticky DOW header row (z-index 10, synced horizontal scroll)
- Date range filter bar (From/To date inputs, Clear button, Export button)
- Default range: first to last check-in date
- Grid starts on Sunday on/before `fFrom`, ends on Saturday on/after `fTo`
- Out-of-range days: grey "vacant" style
- Each cell:
  - Header: DD/MM + italic day description (if any) — clickable to edit note on in-range days
  - Body: check-in pills (colored bg, type icon + name), excluding hotels
  - Footer: hotel check-in if any (green background)
- Day notes: modal textarea, "Clear" button if note exists, saved via `saveCalDesc`
- Scroll sync: DOW sticky table mirrors horizontal scroll of calendar table using `translateX`

### Map Tab
- Leaflet.js map, lazy-loaded from `unpkg.com/leaflet@1.9.4`
- Tiles: CartoDB light (`{s}.basemaps.cartocdn.com/light_all`)
- Map height: `calc(100svh - 130px)`, min 300px
- "Export KML" button above map
- On tab switch: `setTimeout(initTrackerMap, 50)`
- Markers: colored circles (34×34px) with emoji icon + white sequence number badge (top-right)
- Route polyline: blue dashed (#1565C0, weight 2.5, opacity 0.55, dashArray '6 5'), chronological order
- Popups: name (bold) + type icon + type label + formatted time, no close button
- `fitBounds` with 40px padding, maxZoom 14
- Map instance reused across tab switches (markers/polyline removed and re-added)

### Map Picker Overlay (`#mapPickerOverlay`)
- `position:fixed; inset:0; z-index:300` — full screen, above everything
- `display:none` → `display:flex; flex-direction:column` when opened
- **Header bar** (blue gradient): back button (←), "Pick Location" title, **"🌍 My Location" button**
- **Map area** (`#mapPicker`): `flex:1; min-height:0` — Leaflet map
- **Bottom bar**: coords display + "✓ Use This Location" confirm button
- Opening: centers on `S.gpsCoords` (zoom 13) if available, else world view (zoom 2)
- Tap map → drops/moves marker, updates coords display, enables confirm button
- Marker is draggable — `dragend` updates coords
- **"My Location" button** (`id="myLocBtn"`): calls `navigator.geolocation.getCurrentPosition`, centers map at zoom 15, drops/moves marker. Shows "Locating…" while waiting. Placed in header (not bottom) to always be visible regardless of screen height.
- Confirm → sets `S.gpsCoords`, `S.gpsSource = 'manual'`, updates GPS status in check-in form
- `_mpMap`, `_mpMarker`, `_mpCoords` are module-level vars (separate from `S.leafletMap`)
- `_mpMap.invalidateSize()` called after overlay displayed
- On reopen: removes previous marker (resets to clean state)

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

## External Libraries (Lazy-Loaded)

### Chart.js
- URL: `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js`
- Loaded on first report view
- Instance stored in `S.pieChart`, destroyed before re-creation

### Leaflet.js
- CSS: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` (id="leaflet-css")
- JS: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`
- Loaded on first map/picker open
- Single load check: `if (window.L) { cb(); return; }`
- `S.leafletMap` for tracker map; `_mpMap` for picker (separate instances)

---

## Supported Countries (COUNTRIES array, 99 entries)

Full list includes Afghanistan through Zimbabwe. Used for `<datalist>` autocomplete on trip creation.

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

---

## Calendar DOW Labels
- English: `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']`
- Hebrew: `['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']`
- Check-in list date labels show both: `"Sun (יום א׳)"`
