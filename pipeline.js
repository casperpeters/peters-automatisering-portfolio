/*
 * Order-export pipeline used by the live demo.
 *
 * Pure functions only (no DOM), so the same code runs in the browser and in
 * `node --test`. Money is handled in integer cents to avoid floating-point drift.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderPipeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLUMNS = ['order_id', 'order_date', 'customer', 'country', 'product', 'qty', 'unit_price'];

  const HEADER_ALIASES = {
    order_id: ['order_id', 'orderid', 'order', 'order_no', 'order_number', 'id'],
    order_date: ['order_date', 'orderdate', 'date'],
    customer: ['customer', 'client', 'customer_name'],
    country: ['country', 'land'],
    product: ['product', 'item', 'product_name'],
    qty: ['qty', 'quantity', 'amount', 'aantal'],
    unit_price: ['unit_price', 'unitprice', 'price', 'prijs']
  };

  const COUNTRY_VARIANTS = {
    Netherlands: ['nl', 'nld', 'nederland', 'netherlands', 'the netherlands', 'holland'],
    Germany: ['de', 'deu', 'deutschland', 'duitsland', 'germany'],
    Belgium: ['be', 'bel', 'belgie', 'belgique', 'belgium'],
    France: ['fr', 'fra', 'frankrijk', 'france'],
    'United Kingdom': ['uk', 'gb', 'gbr', 'united kingdom', 'great britain', 'england'],
    Spain: ['es', 'esp', 'spanje', 'spain', 'espana'],
    Italy: ['it', 'ita', 'italie', 'italy', 'italia']
  };

  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  /* ---------- CSV ---------- */

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    let best = ',';
    let bestCount = -1;
    for (const d of [',', ';', '\t']) {
      let inQuotes = false;
      let count = 0;
      for (const ch of firstLine) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === d && !inQuotes) count++;
      }
      if (count > bestCount) { best = d; bestCount = count; }
    }
    return best;
  }

  function parseCSV(text) {
    const src = String(text).replace(/^﻿/, '');
    const delimiter = detectDelimiter(src);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => String(cell).trim() !== ''));
  }

  function normaliseHeader(h) {
    return String(h).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /** Turns parsed CSV rows into records keyed by our canonical column names. */
  function toRecords(table) {
    if (!table.length) return { records: [], missing: COLUMNS.slice(), headers: [] };
    const headers = table[0].map(normaliseHeader);
    const index = {};
    for (const col of COLUMNS) {
      const at = headers.findIndex(h => HEADER_ALIASES[col].includes(h));
      if (at !== -1) index[col] = at;
    }
    const missing = COLUMNS.filter(col => !(col in index));
    const records = table.slice(1).map((cells, i) => {
      const raw = {};
      for (const col of COLUMNS) raw[col] = col in index ? String(cells[index[col]] ?? '') : '';
      return { row: i + 2, raw }; // row 1 is the header, so data starts on line 2
    });
    return { records, missing, headers };
  }

  /* ---------- Field parsers ---------- */

  function collapse(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function foldKey(s) {
    return collapse(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function makeDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** Accepts ISO, day-first numeric (EU) and "12 Mar 2026" / "Mar 12, 2026". */
  function parseDate(input) {
    const s = collapse(input);
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return makeDate(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) return makeDate(+m[3], +m[2], +m[1]);
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s))) {
      const mon = MONTHS[m[2].toLowerCase()];
      return mon === undefined ? null : makeDate(+m[3], mon + 1, +m[1]);
    }
    if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
      const mon = MONTHS[m[1].toLowerCase()];
      return mon === undefined ? null : makeDate(+m[3], mon + 1, +m[2]);
    }
    return null;
  }

  /** Returns cents, or null. Handles "€18,50", "1.234,50", "3.80 EUR", "340". */
  function parsePrice(input) {
    let t = String(input).replace(/[^0-9.,-]/g, '');
    if (!/\d/.test(t)) return null;
    const lastComma = t.lastIndexOf(',');
    const lastDot = t.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (lastComma > -1) {
      const decimals = t.length - lastComma - 1;
      t = decimals <= 2 ? t.replace(',', '.') : t.replace(/,/g, '');
    }
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }

  function parseQty(input) {
    const t = collapse(input);
    if (/^-?\d+$/.test(t)) return Number(t);
    if (/^-?\d+\.0+$/.test(t)) return Math.round(Number(t));
    return null;
  }

  const COUNTRY_LOOKUP = (() => {
    const map = new Map();
    for (const [canonical, variants] of Object.entries(COUNTRY_VARIANTS)) {
      for (const v of variants) map.set(foldKey(v), canonical);
    }
    return map;
  })();

  function parseCountry(input) {
    return COUNTRY_LOOKUP.get(foldKey(input)) || null;
  }

  /** Picks one spelling per case-insensitive key: the most common variant wins. */
  function canonicaliser(values) {
    const counts = new Map(); // key -> Map(variant -> count)
    for (const v of values) {
      const variant = collapse(v);
      if (!variant) continue;
      const key = foldKey(variant);
      if (!counts.has(key)) counts.set(key, new Map());
      const variants = counts.get(key);
      variants.set(variant, (variants.get(variant) || 0) + 1);
    }
    const best = new Map();
    for (const [key, variants] of counts) {
      let pick = null;
      let pickCount = -1;
      for (const [variant, count] of variants) {
        if (count > pickCount) { pick = variant; pickCount = count; }
      }
      best.set(key, pick);
    }
    return v => {
      const variant = collapse(v);
      return best.get(foldKey(variant)) || variant;
    };
  }

  function median(numbers) {
    const sorted = numbers.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* ---------- Main pipeline ---------- */

  function processOrders(records) {
    const issues = [];
    const addIssue = (row, field, severity, message, before, after) =>
      issues.push({ row, field, severity, message, before: before ?? '', after: after ?? '' });

    const canonCustomer = canonicaliser(records.map(r => r.raw.customer));
    const canonProduct = canonicaliser(records.map(r => r.raw.product));

    const candidates = [];
    const quarantine = [];
    const seenIds = new Map(); // order_id -> { row, signature }
    let duplicatesRemoved = 0;
    const fixedRows = new Set();

    for (const { row, raw } of records) {
      const blocked = [];
      const fixed = [];
      const rec = { row };

      // order_id
      const id = collapse(raw.order_id).toUpperCase();
      if (!id) blocked.push(['order_id', 'Missing order ID', raw.order_id]);
      rec.order_id = id;
      if (id && id !== raw.order_id) fixed.push(['order_id', 'Whitespace/casing standardised', raw.order_id, id]);

      // date
      const date = parseDate(raw.order_date);
      if (!date) blocked.push(['order_date', `Invalid or unreadable date "${collapse(raw.order_date)}"`, raw.order_date]);
      else if (date !== raw.order_date) fixed.push(['order_date', 'Date converted to ISO format (YYYY-MM-DD)', raw.order_date, date]);
      rec.order_date = date;

      // customer
      const customer = canonCustomer(raw.customer);
      if (!customer) blocked.push(['customer', 'Missing customer', raw.customer]);
      else if (customer !== raw.customer) fixed.push(['customer', 'Spelling/whitespace standardised', raw.customer, customer]);
      rec.customer = customer;

      // country
      const country = parseCountry(raw.country);
      if (!country) blocked.push(['country', `Unknown country "${collapse(raw.country)}"`, raw.country]);
      else if (country !== raw.country) fixed.push(['country', 'Country name normalised', raw.country, country]);
      rec.country = country;

      // product
      const product = canonProduct(raw.product);
      if (!product) blocked.push(['product', 'Missing product', raw.product]);
      else if (product !== raw.product) fixed.push(['product', 'Spelling/whitespace standardised', raw.product, product]);
      rec.product = product;

      // qty
      const qty = parseQty(raw.qty);
      if (qty === null) blocked.push(['qty', `Quantity is not a whole number: "${collapse(raw.qty)}"`, raw.qty]);
      else if (qty <= 0) blocked.push(['qty', `Quantity must be positive (found ${qty})`, raw.qty]);
      else if (String(qty) !== raw.qty) fixed.push(['qty', 'Quantity cleaned', raw.qty, String(qty)]);
      rec.qty = qty;

      // price
      const cents = parsePrice(raw.unit_price);
      if (cents === null) blocked.push(['unit_price', `Unreadable price "${collapse(raw.unit_price)}"`, raw.unit_price]);
      else if (cents <= 0) blocked.push(['unit_price', 'Price must be positive', raw.unit_price]);
      else {
        const pretty = (cents / 100).toFixed(2);
        if (pretty !== raw.unit_price) fixed.push(['unit_price', 'Price parsed (currency/decimal format)', raw.unit_price, pretty]);
      }
      rec.unit_price_cents = cents;

      // duplicates (only meaningful once the row itself is readable)
      if (!blocked.length) {
        const signature = [rec.order_date, rec.customer, rec.country, rec.product, rec.qty, rec.unit_price_cents].join('|');
        const first = seenIds.get(rec.order_id);
        if (first) {
          if (first.signature === signature) {
            duplicatesRemoved++;
            addIssue(row, 'order_id', 'fixed', `Exact duplicate of row ${first.row} removed`, raw.order_id, '(removed)');
            fixedRows.add(row);
            continue;
          }
          blocked.push(['order_id', `Same order ID as row ${first.row} but different values`, raw.order_id]);
        } else {
          seenIds.set(rec.order_id, { row, signature });
        }
      }

      if (blocked.length) {
        for (const [field, message, before] of blocked) addIssue(row, field, 'blocked', message, before, '');
        quarantine.push({ row, raw, reasons: blocked.map(b => b[1]) });
        continue;
      }
      for (const [field, message, before, after] of fixed) addIssue(row, field, 'fixed', message, before, after);
      if (fixed.length) fixedRows.add(row);
      candidates.push(rec);
    }

    // Price sanity check per product, using the median of the cleaned rows.
    const byProduct = new Map();
    for (const rec of candidates) {
      if (!byProduct.has(rec.product)) byProduct.set(rec.product, []);
      byProduct.get(rec.product).push(rec.unit_price_cents);
    }
    let warnings = 0;
    for (const rec of candidates) {
      const prices = byProduct.get(rec.product);
      if (prices.length < 4) continue;
      const med = median(prices);
      if (rec.unit_price_cents > med * 5 || rec.unit_price_cents < med * 0.2) {
        warnings++;
        addIssue(rec.row, 'unit_price', 'warning',
          `Price looks unusual for this product (typical ${(med / 100).toFixed(2)}) — kept, please review`,
          (rec.unit_price_cents / 100).toFixed(2), '');
        rec.review = true;
      }
    }

    issues.sort((a, b) => a.row - b.row);
    const clean = candidates.map(r => ({
      order_id: r.order_id,
      order_date: r.order_date,
      customer: r.customer,
      country: r.country,
      product: r.product,
      qty: r.qty,
      unit_price: (r.unit_price_cents / 100).toFixed(2),
      line_total: ((r.qty * r.unit_price_cents) / 100).toFixed(2),
      review: r.review ? 'check price' : '',
      _cents: r.unit_price_cents,
      _row: r.row
    }));

    return {
      issues,
      clean,
      quarantine,
      stats: {
        rowsIn: records.length,
        rowsClean: clean.length,
        rowsQuarantined: quarantine.length,
        duplicatesRemoved,
        rowsAutoFixed: fixedRows.size,
        warnings
      },
      report: buildReport(clean)
    };
  }

  function buildReport(clean) {
    const sum = (map, key, cents, orders = 1) => {
      const entry = map.get(key) || { key, cents: 0, orders: 0 };
      entry.cents += cents;
      entry.orders += orders;
      map.set(key, entry);
    };
    const month = new Map();
    const product = new Map();
    const country = new Map();
    const customer = new Map();
    let totalCents = 0;
    for (const r of clean) {
      const lineCents = r.qty * r._cents;
      totalCents += lineCents;
      sum(month, r.order_date.slice(0, 7), lineCents);
      sum(product, r.product, lineCents);
      sum(country, r.country, lineCents);
      sum(customer, r.customer, lineCents);
    }
    const byRevenue = m => [...m.values()].sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key));
    return {
      orders: clean.length,
      revenueCents: totalCents,
      avgOrderCents: clean.length ? Math.round(totalCents / clean.length) : 0,
      byMonth: [...month.values()].sort((a, b) => a.key.localeCompare(b.key)),
      byProduct: byRevenue(product),
      byCountry: byRevenue(country),
      topCustomers: byRevenue(customer).slice(0, 5)
    };
  }

  /** Runs the whole thing from raw CSV text. */
  function run(csvText) {
    const table = parseCSV(csvText);
    const { records, missing } = toRecords(table);
    if (missing.length) return { error: { type: 'missing-columns', missing } };
    if (!records.length) return { error: { type: 'empty' } };
    return processOrders(records);
  }

  /* ---------- Export helpers ---------- */

  function csvCell(value, guard) {
    let s = value === null || value === undefined ? '' : String(value);
    // Stop spreadsheet apps from executing text that starts with a formula character.
    if (guard && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(columns, rows, textColumns) {
    const guarded = new Set(textColumns || []);
    const lines = [columns.join(',')];
    for (const row of rows) lines.push(columns.map(c => csvCell(row[c], guarded.has(c))).join(','));
    return lines.join('\n') + '\n';
  }

  return {
    COLUMNS, parseCSV, toRecords, parseDate, parsePrice, parseQty, parseCountry,
    processOrders, buildReport, run, toCSV
  };
});
