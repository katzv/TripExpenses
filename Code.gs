// =============================================
// Trip Expense Manager - Google Apps Script
// Backend using PropertiesService (no Sheets OAuth scope)
// =============================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Trip Expense Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- Storage helpers ----
// Data is stored as JSON in Script Properties.
// Script Properties are shared across all users of this web app deployment,
// so the owner and wife both read/write the same data.

var props = PropertiesService.getScriptProperties();

function load(key, fallback) {
  var raw = props.getProperty(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch(e) { return fallback; }
}

function save(key, data) {
  props.setProperty(key, JSON.stringify(data));
}

function uuid() {
  return Utilities.getUuid();
}

function nowISO() {
  return new Date().toISOString();
}

// ---- TRIPS ----
// Stored as: props['trips'] = JSON array of trip objects

function getTrips() {
  return load('trips', []);
}

function createTrip(d) {
  var trips = getTrips();
  var id = uuid();
  trips.push({
    id:        id,
    title:     d.title,
    country:   d.country,
    currency:  d.currency,
    startDate: d.startDate || '',
    endDate:   d.endDate   || '',
    createdAt: nowISO()
  });
  save('trips', trips);
  return { success: true, id: id };
}

function updateTrip(d) {
  var trips = getTrips();
  for (var i = 0; i < trips.length; i++) {
    if (trips[i].id === d.id) {
      trips[i].title     = d.title;
      trips[i].startDate = d.startDate || '';
      trips[i].endDate   = d.endDate   || '';
      break;
    }
  }
  save('trips', trips);
  return { success: true };
}

function deleteTrip(id) {
  var trips = getTrips().filter(function(t) { return t.id !== id; });
  save('trips', trips);
  props.deleteProperty('exp_' + id);
  deleteCheckinFile(id);
  props.deleteProperty('caldesc_' + id);
  return { success: true };
}

// ---- CALENDAR DAY DESCRIPTIONS ----
// Stored as: props['caldesc_{tripId}'] = JSON object keyed by date string (YYYY-MM-DD)

function getCalDescs(tripId) {
  return load('caldesc_' + tripId, {});
}

function saveCalDesc(tripId, date, text) {
  var descs = getCalDescs(tripId);
  var trimmed = (text || '').replace(/^\s+|\s+$/g, '');
  if (trimmed) {
    descs[date] = trimmed;
  } else {
    delete descs[date];
  }
  save('caldesc_' + tripId, descs);
  return { success: true };
}

// ---- TRACKER CHECK-INS ----
// Stored as: props['checkins_{tripId}'] = JSON object keyed by check-in ID
//   { "id1": {...}, "id2": {...} }
//
// Keyed storage (vs array) gives O(1) lookup/update/delete without index maintenance.
// loadCheckins() returns a sorted array so the client is unaware of the internal shape.

// Internal: load the {id → entry} map from PropertiesService
function loadCheckinsMap(tripId) {
  return load('checkins_' + tripId, {});
}

// Internal: write the {id → entry} map back to PropertiesService
function saveCheckinsMap(tripId, map) {
  save('checkins_' + tripId, map);
}

// ---- Public tracker functions (called via google.script.run) ----

// Returns array sorted ascending by timestamp
function loadCheckins(tripId) {
  var map = loadCheckinsMap(tripId);
  return Object.keys(map).map(function(k) { return map[k]; }).sort(function(a, b) {
    return a.timestamp < b.timestamp ? -1 : 1;
  });
}

function saveCheckin(d) {
  var map = loadCheckinsMap(d.tripId);
  var id = uuid();
  map[id] = {
    id:        id,
    tripId:    d.tripId,
    timestamp: d.timestamp || nowISO(),
    name:      d.name,
    type:      d.type,
    lat:       d.lat       || null,
    lng:       d.lng       || null,
    gpsSource: d.gpsSource || 'none',
    createdAt: nowISO()
  };
  saveCheckinsMap(d.tripId, map);
  return { success: true, id: id };
}

// O(1) lookup by id — no linear scan needed
function updateCheckin(d) {
  var map = loadCheckinsMap(d.tripId);
  if (!map[d.id]) return { success: false, error: 'Not found' };
  map[d.id] = {
    id:        d.id,
    tripId:    d.tripId,
    timestamp: d.timestamp,
    name:      d.name,
    type:      d.type,
    lat:       d.lat       || null,
    lng:       d.lng       || null,
    gpsSource: d.gpsSource || map[d.id].gpsSource || 'none',
    createdAt: map[d.id].createdAt  // preserve original creation time
  };
  saveCheckinsMap(d.tripId, map);
  return { success: true };
}

// O(1) delete by id
function deleteCheckin(checkinId, tripId) {
  var map = loadCheckinsMap(tripId);
  delete map[checkinId];
  saveCheckinsMap(tripId, map);
  return { success: true };
}

// Called by deleteTrip — removes checkin data for this trip
function deleteCheckinFile(tripId) {
  props.deleteProperty('checkins_' + tripId);
}

// ---- EXPENSES ----
// Stored as: props['exp_{tripId}'] = JSON array of expense objects

function getExpenses(tripId) {
  return load('exp_' + tripId, []);
}

function addExpense(d) {
  var expenses = getExpenses(d.tripId);
  var id = uuid();
  expenses.push({
    id:         id,
    tripId:     d.tripId,
    date:       d.date,
    expense:    d.expense,
    type:       d.type,
    amount:     d.amount,
    currency:   d.currency,
    amountILS:  d.amountILS,
    rate:       d.rate,
    rateDate:   d.rateDate,
    rateSource: d.rateSource,
    info2:      d.info2  || '',
    info3:      d.info3  || '',
    createdAt:  nowISO()
  });
  save('exp_' + d.tripId, expenses);
  return { success: true, id: id };
}

function updateExpense(d) {
  var expenses = getExpenses(d.tripId);
  var found = false;
  for (var i = 0; i < expenses.length; i++) {
    if (expenses[i].id === d.id) {
      expenses[i] = {
        id:         d.id,
        tripId:     d.tripId,
        date:       d.date,
        expense:    d.expense,
        type:       d.type,
        amount:     d.amount,
        currency:   d.currency,
        amountILS:  d.amountILS,
        rate:       d.rate,
        rateDate:   d.rateDate,
        rateSource: d.rateSource,
        info2:      d.info2  || '',
        info3:      d.info3  || '',
        createdAt:  expenses[i].createdAt
      };
      found = true;
      break;
    }
  }
  if (found) {
    save('exp_' + d.tripId, expenses);
    return { success: true };
  }
  return { success: false, error: 'Not found' };
}

function deleteExpense(expenseId, tripId) {
  // tripId passed from client for efficiency; also scan all if missing
  if (tripId) {
    var expenses = getExpenses(tripId).filter(function(e) { return e.id !== expenseId; });
    save('exp_' + tripId, expenses);
    return { success: true };
  }
  // Fallback: scan all trip expense properties
  var allKeys = props.getKeys();
  for (var i = 0; i < allKeys.length; i++) {
    var k = allKeys[i];
    if (k.indexOf('exp_') === 0) {
      var list = load(k, []);
      var match = list.some(function(e) { return e.id === expenseId; });
      if (match) {
        save(k, list.filter(function(e) { return e.id !== expenseId; }));
        return { success: true };
      }
    }
  }
  return { success: true };
}

// ---- EXCHANGE RATES (frankfurter.app — free, no API key needed) ----

function getDefaultRates(tripCurrency) {
  var result = {};
  var currencies = [];
  if (tripCurrency && tripCurrency !== 'ILS') currencies.push(tripCurrency);
  if (currencies.indexOf('EUR') === -1) currencies.push('EUR');
  if (currencies.indexOf('USD') === -1) currencies.push('USD');
  currencies.forEach(function(cur) {
    var r = getExchangeRate(cur, 'ILS', '');
    if (r) result[cur] = r;
  });
  result['ILS'] = { rate: 1, source: 'same', date: Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd') };
  return result;
}

function getExchangeRate(from, to, date) {
  if (from === to) return { rate: 1, source: 'same', date: date };
  try {
    var dateStr = date || Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
    var url = 'https://api.frankfurter.app/' + dateStr +
              '?from=' + encodeURIComponent(from) +
              '&to='   + encodeURIComponent(to);
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var parsed = JSON.parse(resp.getContentText());
      if (parsed.rates && parsed.rates[to]) {
        var rate = parsed.rates[to];
        saveRateCache(from, to, rate, parsed.date);
        return { rate: rate, source: 'live', date: parsed.date };
      }
    }
  } catch(e) { Logger.log('Rate error: ' + e); }

  var cached = loadRateCache(from, to);
  if (cached) return { rate: cached.rate, source: 'cached', date: cached.date };
  return null;
}

function getRatesILStoUSDEUR() {
  var result = { USD: null, EUR: null };
  try {
    var url = 'https://api.frankfurter.app/latest?from=ILS&to=USD,EUR';
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      result.USD = (data.rates && data.rates.USD) ? data.rates.USD : null;
      result.EUR = (data.rates && data.rates.EUR) ? data.rates.EUR : null;
      if (result.USD) saveRateCache('ILS', 'USD', result.USD, data.date);
      if (result.EUR) saveRateCache('ILS', 'EUR', result.EUR, data.date);
    }
  } catch(e) { Logger.log('Multi-rate error: ' + e); }

  if (!result.USD) { var c = loadRateCache('ILS','USD'); if (c) result.USD = c.rate; }
  if (!result.EUR) { var c2 = loadRateCache('ILS','EUR'); if (c2) result.EUR = c2.rate; }
  return result;
}

// ---- RATE CACHE ----
// Stored inside the 'ratecache' property as a JSON object

function saveRateCache(from, to, rate, date) {
  var cache = load('ratecache', {});
  cache[from + '_' + to] = { rate: rate, date: date };
  save('ratecache', cache);
}

function loadRateCache(from, to) {
  var cache = load('ratecache', {});
  return cache[from + '_' + to] || null;
}

// ---- EXPENSE TYPES ----
// Stored inside 'settings' property

function getSettings() {
  return load('settings', {});
}

function getExpenseTypes() {
  var defaults = [
    'Flight','Lodging','Car Rental','Insurance','Petrol',
    'Toll Roads','Parking','Public Transport','Meals',
    'Souvenirs','Attractions','Other'
  ];
  var settings = getSettings();
  var custom = settings.customTypes || [];
  return defaults.concat(custom);
}

function addExpenseType(name) {
  var trimmed = (name || '').trim();
  if (!trimmed) return getExpenseTypes();
  var settings = getSettings();
  var custom = settings.customTypes || [];
  if (custom.indexOf(trimmed) === -1) {
    custom.push(trimmed);
    settings.customTypes = custom;
    save('settings', settings);
  }
  return getExpenseTypes();
}

function deleteExpenseType(name) {
  var trimmed = (name || '').trim();
  var settings = getSettings();
  var custom = settings.customTypes || [];
  settings.customTypes = custom.filter(function(t) { return t !== trimmed; });
  save('settings', settings);
  return getExpenseTypes();
}

// ---- REPORT ----

function getReport(tripId) {
  var trips = getTrips();
  var trip = null;
  for (var i = 0; i < trips.length; i++) {
    if (trips[i].id === tripId) { trip = trips[i]; break; }
  }
  if (!trip) return null;

  var expenses = getExpenses(tripId);

  var days = 0;
  if (trip.startDate && trip.endDate) {
    var ms = new Date(trip.endDate) - new Date(trip.startDate);
    days = Math.round(ms / 86400000) + 1;
  }

  var byType = {};
  var totalILS = 0;
  expenses.forEach(function(e) {
    var ils = parseFloat(e.amountILS) || 0;
    if (!byType[e.type]) byType[e.type] = { total: 0, count: 0 };
    byType[e.type].total += ils;
    byType[e.type].count++;
    totalILS += ils;
  });

  var rates = getRatesILStoUSDEUR();

  var categories = Object.keys(byType).sort().map(function(type) {
    var t = Math.round(byType[type].total * 100) / 100;
    return {
      type:     type,
      count:    byType[type].count,
      totalILS: t,
      totalUSD: rates.USD ? Math.round(t * rates.USD * 100) / 100 : null,
      totalEUR: rates.EUR ? Math.round(t * rates.EUR * 100) / 100 : null
    };
  });

  return {
    trip:         trip,
    days:         days,
    expenseCount: expenses.length,
    categories:   categories,
    totalILS:     Math.round(totalILS * 100) / 100,
    totalUSD:     rates.USD ? Math.round(totalILS * rates.USD * 100) / 100 : null,
    totalEUR:     rates.EUR ? Math.round(totalILS * rates.EUR * 100) / 100 : null,
    ratesDate:    Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd')
  };
}

// ---- COUNTRY → CURRENCY ----

function getCountryCurrency(country) {
  var map = {
    'france':'EUR','germany':'EUR','italy':'EUR','spain':'EUR','portugal':'EUR',
    'netherlands':'EUR','belgium':'EUR','austria':'EUR','greece':'EUR','finland':'EUR',
    'ireland':'EUR','luxembourg':'EUR','malta':'EUR','slovakia':'EUR','slovenia':'EUR',
    'estonia':'EUR','latvia':'EUR','lithuania':'EUR','croatia':'EUR','cyprus':'EUR',
    'united states':'USD','usa':'USD','us':'USD',
    'united kingdom':'GBP','uk':'GBP','england':'GBP','scotland':'GBP','wales':'GBP',
    'israel':'ILS',
    'japan':'JPY','thailand':'THB','switzerland':'CHF','norway':'NOK','sweden':'SEK',
    'denmark':'DKK','poland':'PLN','czech republic':'CZK','czechia':'CZK',
    'hungary':'HUF','romania':'RON','bulgaria':'BGN','australia':'AUD',
    'canada':'CAD','new zealand':'NZD','singapore':'SGD','hong kong':'HKD',
    'china':'CNY','india':'INR','south korea':'KRW','mexico':'MXN',
    'brazil':'BRL','turkey':'TRY','south africa':'ZAR','indonesia':'IDR',
    'malaysia':'MYR','philippines':'PHP','iceland':'ISK',
    'uae':'AED','qatar':'QAR','saudi arabia':'SAR','kuwait':'KWD',
    'bahrain':'BHD','oman':'OMR','jordan':'JOD','egypt':'EGP'
  };
  return map[(country || '').toLowerCase().trim()] || 'EUR';
}
