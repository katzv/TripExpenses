# Trip Expense Manager — Requirements

## Overview

A mobile-first web app for tracking family trip expenses in real time.
Runs entirely on Google Apps Script — no servers, no subscriptions, no installs.
Data is shared between two users (owner + wife) via a single URL.

---

## Features

### Trips
- Create a trip with: title, destination country, optional start/end dates
- Country input auto-suggests from a built-in list; detects the local currency automatically
- View all trips in a list with country, currency, date range, and day count
- Delete a trip (also deletes all its expenses)
- Navigate into a trip to see its expense list

### Expenses
- Add expenses to a trip with: date, name/description, type, amount, currency, ILS amount, optional notes
- Edit any existing expense (tap to open)
- Delete an expense from the edit view
- Supported expense types (built-in): Flight, Lodging, Car Rental, Insurance, Petrol, Toll Roads, Parking, Public Transport, Meals, Souvenirs, Attractions, Other
- Add custom expense types (stored persistently)
- Type-specific additional fields:
  - **Lodging**: dates of stay (free text)
  - **Meals**: meal type (Breakfast / Lunch / Dinner / Supermarket / Snacks)
  - **Petrol**: liters (number)

### Currency & Exchange Rates

**Two-stage rate system:**

1. **Preview rate** (while filling in the form):
   - When a trip is opened, today's rates are pre-fetched for: trip currency → ILS, EUR → ILS, USD → ILS
   - Stored in memory as `defaultRates`
   - When the user types an amount, the ILS estimate is shown instantly using these pre-fetched rates (no async delay, no timing issues)
   - Displayed with a "~ today's rate" badge

2. **Save rate** (on clicking Save Expense):
   - The actual historical rate for the **expense's date** is fetched from frankfurter.app
   - This date-accurate rate is used for the stored `amountILS` value
   - Fallback: if the live fetch fails, falls back to the pre-fetched default rate
   - If the live rate is unavailable (weekend/holiday), the last cached rate is used with a "cached" badge

**Special cases:**
- Currency = ILS: no conversion, amount is stored as-is
- Manual ILS entry: user can type the ILS amount directly; skips rate fetch on save
- Rate badge states: `✓ live rate`, `⚠ cached rate`, `~ today's rate`, `✎ manual`, `= same currency`, `✗ unavailable`

**Supported currencies:** ILS, EUR, USD, GBP, JPY, THB, CHF, NOK, SEK, DKK, PLN, CZK, HUF, RON, BGN, AUD, CAD, NZD, SGD, HKD, CNY, INR, KRW, MXN, BRL, TRY, ZAR, IDR, MYR, PHP, ISK, AED, QAR, SAR, KWD, BHD, OMR, JOD, EGP

### Expense List View
- Summary banner: total ILS, expense count, date range
- Filter chips to filter by expense type
- Expenses grouped by date (descending)
- Each card shows: category icon, name, type/meal/notes, original currency amount, ILS amount
- Tap any card to edit

### Report
- Banner: trip title, country, days planned, expense count, date range
- Totals in ILS, USD, and EUR
- Pie chart of spending by category (Chart.js)
- Breakdown table: category, count, ILS, USD, EUR
- Conversion rates note (date + source)

### Navigation
- Header with back button and contextual action buttons
- Back button navigates deterministically: `expense/report → trip`, everything else → `trips`
- FAB (+) button to add expense (visible on trip view only)
- Slide-in fade animation between views

### Data Storage (PropertiesService)
| Key | Contents |
|---|---|
| `trips` | JSON array of trip objects |
| `exp_{tripId}` | JSON array of expense objects for that trip |
| `settings` | JSON object with `customTypes` array |
| `ratecache` | JSON object with cached exchange rates by currency pair |

---

## Bugs Fixed

### Bug 1 — ILS currency conversion race condition
**Problem:** When the user changed the currency dropdown to ILS after typing an amount, an in-flight async rate response from the previous currency selection would arrive and overwrite the correct ILS value.
**Fix (v1):** Callback checks if the currency has changed since the request was made; ignores stale responses.
**Fix (v2, preferred):** Replaced async-on-type with pre-fetched default rates (see Rate System above). The form never makes async rate calls while typing.

### Bug 2 — Back button not responding
**Problem:** Back button used a `navStack` array that accumulated entries inconsistently (every `navigate()` call pushes to the stack, including those made inside `goBack()` itself), causing the back button to navigate to unexpected views or do nothing.
**Fix:** Replaced stack-based navigation with deterministic logic based on the current active view DOM element. `expense`/`report` → go to `trip`; everything else → go to `trips`.

### Bug 3 — Toast notification stays on screen permanently
**Problem:** The hidden toast used `translateY(60px)` but with `bottom: 88px`, the toast's bottom edge only moved to 28px above the viewport bottom — still visible on screen.
**Fix:** Changed to `translateY(200px)` so the toast slides well below the viewport and is completely hidden.