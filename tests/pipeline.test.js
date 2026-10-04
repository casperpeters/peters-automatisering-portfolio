const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pipeline.js');
const S = require('../sample-data.js');

test('parseCSV handles quotes, escaped quotes, CRLF, BOM and delimiters', () => {
  const rows = P.parseCSV('﻿a;b;c\r\n"x;1";"he said ""hi""";z\r\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x;1', 'he said "hi"', 'z']]);
  assert.deepEqual(P.parseCSV('a,b\n1,2\n\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parseDate understands EU numeric, ISO and month-name formats and rejects impossible dates', () => {
  assert.equal(P.parseDate('2026-03-05'), '2026-03-05');
  assert.equal(P.parseDate('05/03/2026'), '2026-03-05');
  assert.equal(P.parseDate('5-3-2026'), '2026-03-05');
  assert.equal(P.parseDate('12 Mar 2026'), '2026-03-12');
  assert.equal(P.parseDate('March 12, 2026'), '2026-03-12');
  assert.equal(P.parseDate('2026/04/02'), '2026-04-02');
  assert.equal(P.parseDate('31/02/2026'), null);
  assert.equal(P.parseDate('tomorrow'), null);
  assert.equal(P.parseDate(''), null);
});

test('parsePrice returns cents for common currency formats', () => {
  assert.equal(P.parsePrice('€18,50'), 1850);
  assert.equal(P.parsePrice('1.234,50'), 123450);
  assert.equal(P.parsePrice('1,234.50'), 123450);
  assert.equal(P.parsePrice('3.80 EUR'), 380);
  assert.equal(P.parsePrice('340'), 34000);
  assert.equal(P.parsePrice('abc'), null);
  assert.equal(P.parsePrice(''), null);
});

test('parseQty accepts whole numbers only', () => {
  assert.equal(P.parseQty(' 4 '), 4);
  assert.equal(P.parseQty('3.0'), 3);
  assert.equal(P.parseQty('2.5'), null);
  assert.equal(P.parseQty('two'), null);
  assert.equal(P.parseQty('-2'), -2);
});

test('parseCountry maps spelling variants and ignores accents and case', () => {
  assert.equal(P.parseCountry('nederland'), 'Netherlands');
  assert.equal(P.parseCountry(' The Netherlands '), 'Netherlands');
  assert.equal(P.parseCountry('Belgié'), 'Belgium');
  assert.equal(P.parseCountry('DE'), 'Germany');
  assert.equal(P.parseCountry('Atlantis'), null);
});

test('sample export: counts add up and nothing is lost silently', () => {
  const result = P.run(S.buildSampleCSV());
  const { stats } = result;
  assert.equal(stats.rowsIn, 55);
  assert.equal(stats.rowsClean + stats.rowsQuarantined + stats.duplicatesRemoved, stats.rowsIn);
  assert.equal(stats.rowsClean, 46);
  assert.equal(stats.rowsQuarantined, 7);
  assert.equal(stats.duplicatesRemoved, 2);
  assert.equal(stats.warnings, 1);
  assert.equal(result.clean.length, 46);
});

test('sample export: every blocked row is quarantined for the right reason', () => {
  const { quarantine } = P.run(S.buildSampleCSV());
  const reasons = Object.fromEntries(quarantine.map(q => [q.row, q.reasons.join('; ')]));
  assert.match(reasons[10], /Missing customer/);
  assert.match(reasons[19], /positive/);
  assert.match(reasons[24], /Invalid or unreadable date/);
  assert.match(reasons[27], /positive/);
  assert.match(reasons[32], /Invalid or unreadable date/);
  assert.match(reasons[38], /Missing order ID/);
  assert.match(reasons[56], /Same order ID as row 30/);
});

test('sample export: cleaned data is consistent', () => {
  const { clean } = P.run(S.buildSampleCSV());
  const countries = new Set(clean.map(r => r.country));
  assert.deepEqual([...countries].sort(), ['Belgium', 'France', 'Germany', 'Netherlands']);
  assert.ok(clean.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.order_date)));
  assert.ok(clean.every(r => r.qty > 0 && Number(r.unit_price) > 0));
  assert.equal(new Set(clean.map(r => r.order_id)).size, clean.length);
  assert.equal(new Set(clean.map(r => r.customer.toLowerCase())).size, new Set(clean.map(r => r.customer)).size);
  assert.equal(clean.filter(r => r.review).length, 1);
});

test('report totals equal the sum of the cleaned lines and use integer cents', () => {
  const { clean, report } = P.run(S.buildSampleCSV());
  const cents = clean.reduce((sum, r) => sum + r.qty * r._cents, 0);
  assert.equal(report.revenueCents, cents);
  assert.equal(report.byMonth.reduce((s, m) => s + m.cents, 0), cents);
  assert.equal(report.byProduct.reduce((s, m) => s + m.cents, 0), cents);
  assert.equal(report.byCountry.reduce((s, m) => s + m.cents, 0), cents);
  assert.equal(report.orders, clean.length);
  assert.equal(report.avgOrderCents, Math.round(cents / clean.length));
});

test('missing columns are reported instead of crashing', () => {
  const result = P.run('order_id,order_date\nA1,2026-01-01\n');
  assert.equal(result.error.type, 'missing-columns');
  assert.ok(result.error.missing.includes('customer'));
  assert.equal(P.run('').error.type, 'missing-columns');
  assert.equal(P.run(P.COLUMNS.join(',') + '\n').error.type, 'empty');
});

test('header aliases and semicolon delimiters work for real-world exports', () => {
  const csv = 'Order ID;Date;Client;Land;Item;Quantity;Price\nX-1;2026-01-02;Acme;NL;Widget;2;5,00\n';
  const result = P.run(csv);
  assert.equal(result.stats.rowsClean, 1);
  assert.equal(result.clean[0].line_total, '10.00');
  assert.equal(result.clean[0].country, 'Netherlands');
});

test('CSV export escapes quotes and blocks spreadsheet formula injection', () => {
  const out = P.toCSV(['a', 'b'], [{ a: '=HYPERLINK("x")', b: 'say "hi", ok' }], ['a', 'b']);
  assert.equal(out, "a,b\n\"'=HYPERLINK(\"\"x\"\")\",\"say \"\"hi\"\", ok\"\n");
  const numeric = P.toCSV(['n'], [{ n: '-5' }], []);
  assert.equal(numeric, 'n\n-5\n');
});
