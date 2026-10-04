/*
 * Synthetic sample for the live demo: an order export from a fictional coffee roaster.
 * The data is generated deterministically and then deliberately "messed up" in the ways
 * real exports tend to be, so the pipeline has something honest to fix.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderSample = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PRODUCTS = [
    ['Espresso Beans 1kg', 1850],
    ['House Blend 500g', 990],
    ['Cold Brew Bottle 330ml', 380],
    ['Pour-Over Kit', 3400],
    ['Oat Milk 1L', 220]
  ];

  const CUSTOMERS = [
    ['Café De Hoek', 'NL'], ['Bakkerij Mol', 'NL'], ['Studio Nine', 'NL'], ['Harbour Deli', 'BE'],
    ['Kantine Zuid', 'NL'], ['Noord Koffie', 'DE'], ['Lunchroom Lux', 'BE'], ['Brasserie Vos', 'FR'],
    ['Hotel Linde', 'DE'], ['Yoga Loft', 'NL'], ['Bike & Brew', 'NL'], ['Atelier Rood', 'FR'],
    ['Co-work Collective', 'NL'], ['Markthal Kiosk', 'DE']
  ];

  const COUNTRY_NAMES = { NL: 'Netherlands', BE: 'Belgium', DE: 'Germany', FR: 'France' };

  function lcg(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function isoDate(base, offsetDays) {
    const d = new Date(Date.UTC(base[0], base[1] - 1, base[2] + offsetDays));
    return d.toISOString().slice(0, 10);
  }

  function baseRows() {
    const rand = lcg(20260301);
    const rows = [];
    for (let i = 0; i < 52; i++) {
      const [product, cents] = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
      const [customer, country] = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)];
      const maxQty = product === 'Pour-Over Kit' ? 3 : 12;
      rows.push({
        order_id: `BR-${1001 + i}`,
        order_date: isoDate([2026, 1, 5], i * 3 + Math.floor(rand() * 3)),
        customer,
        country: COUNTRY_NAMES[country],
        product,
        qty: String(1 + Math.floor(rand() * maxQty)),
        unit_price: (cents / 100).toFixed(2)
      });
    }
    return rows;
  }

  function dirtyRows() {
    const rows = baseRows();
    // A patch value may be a function of the row's current value, so the "messy" version of a
    // price still equals the real price and only the *format* is wrong.
    const set = (i, patch) => {
      for (const [field, value] of Object.entries(patch)) {
        rows[i][field] = typeof value === 'function' ? value(rows[i][field]) : value;
      }
    };

    // Dates in other formats (day-first, month names, slashes) and two that cannot be read.
    set(2, { order_date: '05/03/2026' });
    set(9, { order_date: '12 Mar 2026' });
    set(15, { order_date: '2026/04/02' });
    set(22, { order_date: '31/02/2026' });
    set(30, { order_date: 'tomorrow' });

    // Countries written every which way.
    set(3, { country: 'nederland' });
    set(7, { country: 'The Netherlands' });
    set(11, { country: 'Deutschland' });
    set(18, { country: 'Belgie' });
    set(26, { country: 'france' });

    // Prices with currency symbols, decimal commas and trailing text (same value, different format).
    set(5, { unit_price: p => '€' + p.replace('.', ',') });
    set(12, { unit_price: p => p.replace('.', ',') });
    set(19, { unit_price: p => p + ' EUR' });
    // A typo: one price entered ten times too high.
    set(27, { unit_price: p => (Number(p) * 10).toFixed(2) });

    // Quantities with stray spaces, decimals, zero and negative values.
    set(6, { qty: ' 4 ' });
    set(33, { qty: '3.0' });
    set(17, { qty: '0' });
    set(25, { qty: '-2' });

    // Customers and products with inconsistent spelling.
    set(14, { customer: '  Café De Hoek ' });
    set(21, { customer: 'CAFÉ DE HOEK' });
    set(4, { product: 'espresso beans 1kg' });
    set(10, { product: ' House Blend  500g ' });
    set(8, { customer: '' });
    set(36, { order_id: '' });

    // Duplicated lines: two harmless copies, one conflicting re-entry of an existing order.
    const exactCopy = Object.assign({}, rows[1]);
    const paddedCopy = Object.assign({}, rows[20], { customer: ' ' + rows[20].customer + ' ' });
    const conflicting = Object.assign({}, rows[28], { qty: '9' });
    rows.push(exactCopy, paddedCopy, conflicting);
    return rows;
  }

  function csvField(value) {
    return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  }

  function buildSampleCSV() {
    const columns = ['order_id', 'order_date', 'customer', 'country', 'product', 'qty', 'unit_price'];
    const lines = [columns.join(',')];
    for (const row of dirtyRows()) lines.push(columns.map(c => csvField(row[c])).join(','));
    return lines.join('\n') + '\n';
  }

  return { buildSampleCSV };
});
