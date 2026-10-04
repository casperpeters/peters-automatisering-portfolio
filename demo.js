/*
 * Live demo UI: runs OrderPipeline on a synthetic export (or on a CSV the visitor picks).
 * Everything happens in the browser. All text is inserted with textContent, never innerHTML,
 * so a hostile CSV cannot inject markup.
 */
(() => {
  const root = document.querySelector('#demo-app');
  if (!root || !window.OrderPipeline || !window.OrderSample) return;

  const P = window.OrderPipeline;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_INPUT_ROWS = 200;
  const MAX_OUTPUT_ROWS = 300;
  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
  const integer = new Intl.NumberFormat('en-GB');
  const SEVERITY_RANK = { fixed: 1, warning: 2, blocked: 3 };
  const SEVERITY_LABEL = { fixed: 'auto-fixed', warning: 'check', blocked: 'quarantined' };

  const $ = sel => root.querySelector(sel);
  const runButton = $('#demo-run');
  const resetButton = $('#demo-reset');
  const fileInput = $('#demo-file');
  const sampleButton = $('#demo-sample');
  const statusEl = $('#demo-status');
  const inputMeta = $('#input-meta');
  const steps = [...root.querySelectorAll('.pipeline li')];
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = {
    report: $('#panel-report'), issues: $('#panel-issues'),
    clean: $('#panel-clean'), quarantine: $('#panel-quarantine')
  };
  const exportButtons = {
    clean: $('#export-clean'), quarantine: $('#export-quarantine'), report: $('#export-report')
  };

  let source = { name: 'orders_export.csv', text: window.OrderSample.buildSampleCSV(), isSample: true };
  let current = null; // { result, records }
  let running = false;

  /* ---------- small DOM helpers ---------- */

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const wait = ms => (reduced ? Promise.resolve() : new Promise(r => setTimeout(r, ms)));

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
    statusEl.setAttribute('role', isError ? 'alert' : 'status');
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function table(caption, columns, rows, opts = {}) {
    const t = el('table');
    t.append(el('caption', { class: 'sr-only', text: caption }));
    const head = el('tr');
    for (const col of columns) head.append(el('th', { scope: 'col', text: col.label }));
    t.append(el('thead', {}, head));
    const body = el('tbody');
    rows.forEach((row, i) => {
      const tr = el('tr', { class: opts.rowClass ? opts.rowClass(row, i) : '' });
      for (const col of columns) {
        const cell = el('td', { class: [col.class || '', opts.cellClass ? opts.cellClass(row, col, i) : ''].join(' ').trim() });
        const value = col.get ? col.get(row) : row[col.key];
        if (value && value.nodeType) cell.append(value); else cell.textContent = value ?? '';
        tr.append(cell);
      }
      body.append(tr);
    });
    t.append(body);
    return t;
  }

  function note(text) { return el('p', { class: 'panel-note', text }); }

  /* ---------- downloads ---------- */

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function reportHTML(result, sourceName) {
    const { report, stats } = result;
    const rows = list => list.map(r =>
      `<tr><td>${escapeHTML(r.key)}</td><td class="n">${r.orders}</td><td class="n">${escapeHTML(money.format(r.cents / 100))}</td></tr>`).join('');
    const block = (title, list) =>
      `<h2>${escapeHTML(title)}</h2><table><thead><tr><th>${escapeHTML(title.replace('Revenue by ', ''))}</th><th class="n">Orders</th><th class="n">Revenue</th></tr></thead><tbody>${rows(list)}</tbody></table>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Order report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#14181b}
h1{font-size:26px;margin-bottom:4px}h2{margin-top:32px;font-size:16px;text-transform:uppercase;letter-spacing:.06em}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.kpi{border:1px solid #cfd8dc;padding:12px}
.kpi b{display:block;font-size:22px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e3e9ec}
.n{text-align:right}small{color:#58656c}</style></head><body>
<h1>Order report</h1><small>Generated from ${escapeHTML(sourceName)} · cleaned data only</small>
<div class="kpis">
<div class="kpi"><small>Orders</small><b>${integer.format(report.orders)}</b></div>
<div class="kpi"><small>Revenue</small><b>${escapeHTML(money.format(report.revenueCents / 100))}</b></div>
<div class="kpi"><small>Average order</small><b>${escapeHTML(money.format(report.avgOrderCents / 100))}</b></div>
<div class="kpi"><small>Rows auto-fixed</small><b>${integer.format(stats.rowsAutoFixed)}</b></div>
<div class="kpi"><small>Duplicates removed</small><b>${integer.format(stats.duplicatesRemoved)}</b></div>
<div class="kpi"><small>Quarantined for review</small><b>${integer.format(stats.rowsQuarantined)}</b></div></div>
${block('Revenue by month', report.byMonth)}${block('Revenue by product', report.byProduct)}${block('Revenue by country', report.byCountry)}${block('Revenue by customer (top 5)', report.topCustomers)}
<p><small>${integer.format(stats.rowsQuarantined)} rows were not counted because they need a human decision. See the quarantine file.</small></p>
</body></html>`;
  }

  /* ---------- input table ---------- */

  function buildRecords(text) {
    const parsed = P.toRecords(P.parseCSV(text));
    return parsed;
  }

  function renderInput(parsed, flags = null, removedRows = null, blockedRows = null) {
    const shown = parsed.records.slice(0, MAX_INPUT_ROWS);
    const columns = [{ key: 'row', label: '#', class: 'num' }].concat(
      P.COLUMNS.map(c => ({ key: c, label: c, get: r => r.raw[c] })));
    const t = table(`Input data from ${source.name}`, columns, shown, {
      rowClass: r => (removedRows && removedRows.has(r.row) ? 'row-removed' : blockedRows && blockedRows.has(r.row) ? 'row-blocked' : ''),
      cellClass: (r, col) => {
        if (!flags || col.key === 'row') return '';
        const sev = flags.get(`${r.row}:${col.key}`);
        return sev ? `cell-${sev}` : '';
      }
    });
    $('#input-table').replaceWith(t);
    t.id = 'input-table';
    inputMeta.textContent = `${source.name} · ${integer.format(parsed.records.length)} rows` +
      (parsed.records.length > MAX_INPUT_ROWS ? ` (first ${MAX_INPUT_ROWS} shown)` : '');
    return t;
  }

  /* ---------- output panels ---------- */

  function barChart(title, items, { horizontal, valueFmt }) {
    const max = Math.max(1, ...items.map(i => i.cents));
    const w = 520;
    const rowH = 30;
    const height = horizontal ? items.length * rowH + 8 : 190;
    const g = svg('svg', {
      viewBox: `0 0 ${w} ${height}`, role: 'img', class: 'chart',
      'aria-label': `${title}: ${items.map(i => `${i.key} ${valueFmt(i.cents)}`).join(', ')}`
    });
    if (horizontal) {
      const labelW = 150;
      items.forEach((item, i) => {
        const y = 4 + i * rowH;
        const bar = Math.max(2, ((w - labelW - 80) * item.cents) / max);
        g.append(svg('text', { x: labelW - 10, y: y + 17, class: 'chart-label', 'text-anchor': 'end' }, item.key.length > 22 ? item.key.slice(0, 21) + '…' : item.key));
        g.append(svg('rect', { x: labelW, y: y + 4, width: bar, height: 16, rx: 2, class: 'chart-bar' }));
        g.append(svg('text', { x: labelW + bar + 8, y: y + 17, class: 'chart-value' }, valueFmt(item.cents)));
      });
    } else {
      const gap = 10;
      const bw = Math.max(12, (w - 20 - gap * (items.length - 1)) / items.length);
      items.forEach((item, i) => {
        const h = Math.max(2, (110 * item.cents) / max);
        const x = 10 + i * (bw + gap);
        g.append(svg('rect', { x, y: 140 - h, width: bw, height: h, rx: 2, class: 'chart-bar' }));
        g.append(svg('text', { x: x + bw / 2, y: 132 - h, class: 'chart-value', 'text-anchor': 'middle' }, valueFmt(item.cents)));
        g.append(svg('text', { x: x + bw / 2, y: 160, class: 'chart-label', 'text-anchor': 'middle' }, item.key));
      });
    }
    return el('figure', { class: 'chart-card' }, el('figcaption', { class: 'mono', text: title }), g);
  }

  function kpi(label, value, tone) {
    return el('div', { class: `kpi ${tone || ''}`.trim() }, el('span', { class: 'mono', text: label }), el('b', { text: value }));
  }

  function renderReport(result) {
    const { report, stats } = result;
    const panel = panels.report;
    clear(panel);
    panel.append(
      el('div', { class: 'kpis' },
        kpi('Orders counted', integer.format(report.orders)),
        kpi('Revenue', money.format(report.revenueCents / 100)),
        kpi('Average order', money.format(report.avgOrderCents / 100)),
        kpi('Rows auto-fixed', integer.format(stats.rowsAutoFixed), 'tone-fixed'),
        kpi('Duplicates removed', integer.format(stats.duplicatesRemoved), 'tone-fixed'),
        kpi('Quarantined', integer.format(stats.rowsQuarantined), stats.rowsQuarantined ? 'tone-blocked' : '')
      ),
      el('div', { class: 'charts' },
        barChart('Revenue by month', report.byMonth.map(m => ({ key: m.key, cents: m.cents })), { horizontal: false, valueFmt: c => `€${Math.round(c / 100)}` }),
        barChart('Revenue by product', report.byProduct, { horizontal: true, valueFmt: c => money.format(c / 100) })
      ),
      el('div', { class: 'mini-tables' },
        miniTable('Revenue by country', report.byCountry),
        miniTable('Top customers', report.topCustomers)
      ),
      note(`Figures use cleaned rows only. ${stats.rowsQuarantined} row${stats.rowsQuarantined === 1 ? '' : 's'} need a human decision and ${stats.warnings} price${stats.warnings === 1 ? '' : 's'} should be double-checked — the automation shows them instead of guessing.`)
    );
  }

  function miniTable(title, list) {
    return el('div', { class: 'mini-table' }, el('h4', { class: 'mono', text: title }),
      table(title, [
        { label: 'Name', key: 'key' },
        { label: 'Orders', key: 'orders', class: 'num' },
        { label: 'Revenue', get: r => money.format(r.cents / 100), class: 'num' }
      ], list));
  }

  let issueFilter = 'all';
  function renderIssues(result) {
    const panel = panels.issues;
    clear(panel);
    const counts = { all: result.issues.length, fixed: 0, warning: 0, blocked: 0 };
    result.issues.forEach(i => counts[i.severity]++);
    const filters = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter issues' });
    for (const key of ['all', 'fixed', 'warning', 'blocked']) {
      const label = key === 'all' ? 'All' : SEVERITY_LABEL[key][0].toUpperCase() + SEVERITY_LABEL[key].slice(1);
      const btn = el('button', { type: 'button', class: 'chip mono', 'aria-pressed': String(issueFilter === key), text: `${label} · ${counts[key]}` });
      btn.addEventListener('click', () => { issueFilter = key; renderIssues(result); });
      filters.append(btn);
    }
    const visible = result.issues.filter(i => issueFilter === 'all' || i.severity === issueFilter);
    panel.append(filters);
    if (!visible.length) { panel.append(note('Nothing here.')); return; }
    panel.append(el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Issues table, scrollable' },
      table('Issues found', [
        { label: 'Row', key: 'row', class: 'num' },
        { label: 'Field', key: 'field' },
        { label: 'Result', get: i => el('span', { class: `badge ${i.severity}`, text: SEVERITY_LABEL[i.severity] }) },
        { label: 'What happened', key: 'message' },
        { label: 'Before → after', get: i => (i.after ? `${i.before || '∅'} → ${i.after}` : i.before || '∅'), class: 'mono-cell' }
      ], visible.slice(0, MAX_OUTPUT_ROWS))));
    if (visible.length > MAX_OUTPUT_ROWS) panel.append(note(`Showing the first ${MAX_OUTPUT_ROWS} of ${integer.format(visible.length)} issues.`));
  }

  function renderClean(result) {
    const panel = panels.clean;
    clear(panel);
    const cols = ['order_id', 'order_date', 'customer', 'country', 'product', 'qty', 'unit_price', 'line_total', 'review']
      .map(c => ({ label: c, key: c, class: ['qty', 'unit_price', 'line_total'].includes(c) ? 'num' : '' }));
    panel.append(el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Clean data table, scrollable' },
      table('Cleaned orders', cols, result.clean.slice(0, MAX_OUTPUT_ROWS), { rowClass: r => (r.review ? 'row-warning' : '') })));
    if (result.clean.length > MAX_OUTPUT_ROWS) panel.append(note(`Showing the first ${MAX_OUTPUT_ROWS} of ${integer.format(result.clean.length)} rows. The download contains all of them.`));
  }

  function renderQuarantine(result) {
    const panel = panels.quarantine;
    clear(panel);
    if (!result.quarantine.length) { panel.append(note('No rows needed a human decision.')); return; }
    panel.append(note('These rows are not guessed at. They are set aside, with the reason, for a person to decide.'));
    panel.append(el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Quarantine table, scrollable' },
      table('Quarantined rows', [
        { label: 'Row', key: 'row', class: 'num' },
        { label: 'Original values', get: q => P.COLUMNS.map(c => q.raw[c] || '∅').join(' · '), class: 'mono-cell' },
        { label: 'Why', get: q => q.reasons.join('; ') }
      ], result.quarantine.slice(0, MAX_OUTPUT_ROWS))));
  }

  function showTab(name) {
    tabs.forEach(tab => {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== name; });
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      showTab(next.dataset.tab);
    });
  });

  /* ---------- pipeline run ---------- */

  function setStep(index, state, detail) {
    const li = steps[index];
    li.dataset.state = state;
    if (detail !== undefined) li.querySelector('.step-detail').textContent = detail;
  }

  function resetSteps() {
    steps.forEach((_, i) => setStep(i, 'idle', i === 0 ? '' : ''));
    steps.forEach(li => { li.querySelector('.step-detail').textContent = ''; });
  }

  function clearOutput() {
    Object.values(panels).forEach(clear);
    panels.report.append(note('Press “Run the automation” to see the checked report, the issues found and the clean data.'));
    panels.issues.append(note('Every fix, warning and set-aside row is listed here after the run, with the before and after values.'));
    panels.clean.append(note('The cleaned table appears here after the run, ready to download.'));
    panels.quarantine.append(note('Rows that need a human decision appear here after the run, each with the reason.'));
    Object.values(exportButtons).forEach(b => { b.disabled = true; });
    tabs.forEach(tab => {
      const badge = tab.querySelector('.count');
      if (badge) badge.textContent = '';
    });
    showTab('report');
  }

  async function runDemo() {
    if (running) return;
    running = true;
    runButton.disabled = true;
    try {
      const parsed = buildRecords(source.text);
      const result = P.processOrders(parsed.records);
      current = { result, parsed };
      resetSteps();
      clearOutput();
      const s = result.stats;

      setStatus('Loading the file…');
      setStep(0, 'active');
      await wait(350);
      setStep(0, 'done', `${integer.format(s.rowsIn)} rows`);

      setStep(1, 'active');
      setStatus('Validating every field…');
      const flags = new Map();
      const removed = new Set();
      const blocked = new Set(result.quarantine.map(q => q.row));
      for (const issue of result.issues) {
        const key = `${issue.row}:${issue.field}`;
        const prev = flags.get(key);
        if (!prev || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[prev]) flags.set(key, issue.severity);
        if (issue.severity === 'fixed' && issue.after === '(removed)') removed.add(issue.row);
      }
      renderInput(parsed, flags, removed, blocked);
      await wait(550);
      setStep(1, 'done', `${integer.format(result.issues.length)} findings`);

      setStep(2, 'active');
      setStatus('Cleaning what can be fixed safely, setting the rest aside…');
      await wait(450);
      renderIssues(result);
      renderClean(result);
      renderQuarantine(result);
      setStep(2, 'done', `${integer.format(s.rowsAutoFixed)} fixed · ${integer.format(s.rowsQuarantined)} set aside`);

      setStep(3, 'active');
      setStatus('Aggregating…');
      await wait(350);
      setStep(3, 'done', `${integer.format(result.report.byMonth.length)} months · ${integer.format(result.report.byProduct.length)} products`);

      setStep(4, 'active');
      renderReport(result);
      await wait(300);
      setStep(4, 'done', 'ready');

      tabs[1].querySelector('.count').textContent = ` ${result.issues.length}`;
      tabs[3].querySelector('.count').textContent = ` ${result.quarantine.length}`;
      Object.values(exportButtons).forEach(b => { b.disabled = false; });
      setStatus(`Done: ${integer.format(s.rowsClean)} clean rows, ${integer.format(s.duplicatesRemoved)} duplicates removed, ${integer.format(s.rowsQuarantined)} rows set aside for review.`);
    } catch (error) {
      console.error(error);
      setStatus('Something went wrong while processing this file. Check that it is a CSV with the expected columns.', true);
    } finally {
      running = false;
      runButton.disabled = false;
    }
  }

  function loadSource(next) {
    source = next;
    current = null;
    const parsed = buildRecords(source.text);
    resetSteps();
    clearOutput();
    renderInput(parsed);
    steps[0].querySelector('.step-detail').textContent = '';
    setStatus(`Loaded ${integer.format(parsed.records.length)} rows from ${source.name}. Press “Run the automation”.`);
  }

  /* ---------- wiring ---------- */

  runButton.addEventListener('click', runDemo);
  resetButton.addEventListener('click', () => {
    loadSource({ name: 'orders_export.csv', text: window.OrderSample.buildSampleCSV(), isSample: true });
    fileInput.value = '';
  });
  sampleButton.addEventListener('click', () => download('orders_export_sample.csv', window.OrderSample.buildSampleCSV(), 'text/csv'));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus('That file is larger than 5 MB. This browser demo is limited to small files; a real project has no such limit.', true);
      fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      const probe = P.toRecords(P.parseCSV(text));
      if (probe.missing.length) {
        setStatus(`This CSV is missing the column${probe.missing.length > 1 ? 's' : ''}: ${probe.missing.join(', ')}. Expected: ${P.COLUMNS.join(', ')}. Download the sample CSV to see the format.`, true);
        fileInput.value = '';
        return;
      }
      if (!probe.records.length) { setStatus('That CSV has a header but no rows.', true); fileInput.value = ''; return; }
      loadSource({ name: file.name, text, isSample: false });
    } catch (error) {
      console.error(error);
      setStatus('Could not read that file.', true);
    }
  });

  exportButtons.clean.addEventListener('click', () => {
    if (!current) return;
    const cols = ['order_id', 'order_date', 'customer', 'country', 'product', 'qty', 'unit_price', 'line_total', 'review'];
    download('orders_clean.csv', P.toCSV(cols, current.result.clean, ['order_id', 'customer', 'country', 'product', 'review']), 'text/csv');
  });
  exportButtons.quarantine.addEventListener('click', () => {
    if (!current) return;
    const rows = current.result.quarantine.map(q => Object.assign({ row: q.row, reasons: q.reasons.join('; ') }, q.raw));
    download('orders_quarantine.csv', P.toCSV(['row'].concat(P.COLUMNS, ['reasons']), rows, P.COLUMNS.concat(['reasons'])), 'text/csv');
  });
  exportButtons.report.addEventListener('click', () => {
    if (!current) return;
    download('orders_report.html', reportHTML(current.result, source.name), 'text/html');
  });

  root.dataset.ready = 'true';
  loadSource(source);
})();
