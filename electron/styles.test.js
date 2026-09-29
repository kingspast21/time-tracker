// Output-style self-test. Run: node electron/styles.test.js
const assert = require('node:assert/strict');
const { normalizeStyle, DEFAULT_STYLE, PRESETS, resolveFamily, availableFonts } = require('./styles');
const { fileNames, formatDate } = require('./pdf');

// defaults == Classic, and the file-name template keeps the original naming
const d = normalizeStyle({});
assert.equal(d.preset, 'classic');
assert.deepEqual(d.colors, PRESETS.classic.colors);
assert.deepEqual(d.fonts, PRESETS.classic.fonts);
assert.equal(d.pageSize, 'tabloid');
assert.equal(d.fileName, '{name} - {type} {range}');
assert.deepEqual(normalizeStyle(null), d);
assert.deepEqual(normalizeStyle('garbage'), d);

// presets change the look but keep user output options
const s = normalizeStyle({ preset: 'slate', fonts: PRESETS.slate.fonts, colors: PRESETS.slate.colors, pageSize: 'a4', currency: '€' });
assert.equal(s.colors.accent, PRESETS.slate.colors.accent);
assert.equal(s.pageSize, 'a4');
assert.equal(s.currency, '€');

// malformed input is rejected field by field, never passed to the renderer
const bad = normalizeStyle({
  preset: 'nope', colors: { accent: 'red', text: '#12', total: '#abcdef', rule: '#GGGGGG' },
  fonts: { invoice: '../../etc/passwd', note: 'arial' }, pageSize: 'huge', dateFormat: '%s',
  currency: 'ABCDEFGHIJ', logo: 'C:/does/not/exist.png', invoiceTitle: '   ', stripes: 'yes', thankYou: 42,
});
assert.equal(bad.preset, 'classic');
assert.equal(bad.colors.accent, DEFAULT_STYLE.colors.accent);
assert.equal(bad.colors.text, DEFAULT_STYLE.colors.text);
assert.equal(bad.colors.rule, DEFAULT_STYLE.colors.rule);
assert.equal(bad.colors.total, '#ABCDEF');
assert.equal(bad.fonts.invoice, 'roboto');
assert.equal(bad.fonts.note, 'arial');
assert.equal(bad.pageSize, 'tabloid');
assert.equal(bad.dateFormat, 'MM/DD/YYYY');
assert.equal(bad.currency, 'ABCDE');
assert.equal(bad.logo, '');
assert.equal(bad.invoiceTitle, 'Invoice');
assert.equal(bad.stripes, true);
assert.equal(bad.thankYou, DEFAULT_STYLE.thankYou);

// file names: original naming, tokens, no path traversal, invoice/timesheet never collide
const ctx = { name: 'Jane Doe', client: 'Acme/Ltd', number: 12, start: '2026-09-14', end: '2026-09-20', range: '09_14 - 09_18' };
assert.deepEqual(fileNames(d, ctx), { invoice: 'Jane Doe - Invoice 09_14 - 09_18.pdf', timesheet: 'Jane Doe - Time Sheet 09_14 - 09_18.pdf' });
const tok = fileNames(normalizeStyle({ fileName: '{client} {type} #{number} {start}' }), ctx);
assert.equal(tok.invoice, 'AcmeLtd Invoice #12 2026-09-14.pdf');
for (const evil of ['..\\..\\{name}', '../../{name}', 'C:\\Windows\\{name}', '{name}\u0000x', '...{type}...']) {
  const n = fileNames(normalizeStyle({ fileName: evil }), ctx);
  for (const f of [n.invoice, n.timesheet]) {
    assert.ok(!/[\\/:*?"<>|\u0000]/.test(f), `unsafe chars in ${f}`);
    assert.ok(!f.startsWith('.'), `leading dot in ${f}`);
  }
}
const noType = fileNames(normalizeStyle({ fileName: 'Billing' }), ctx);
assert.notEqual(noType.invoice.toLowerCase(), noType.timesheet.toLowerCase());

// dates
const dt = new Date(2026, 8, 4);
assert.equal(formatDate(dt, 'MM/DD/YYYY'), '09/04/2026');
assert.equal(formatDate(dt, 'DD/MM/YYYY'), '04/09/2026');
assert.equal(formatDate(dt, 'YYYY-MM-DD'), '2026-09-04');
assert.equal(formatDate(dt, 'D MMM YYYY'), '4 Sep 2026');
assert.equal(formatDate(dt, 'MMM D, YYYY'), 'Sep 4, 2026');

// fonts: built-ins always resolve; an unknown family falls back instead of throwing
assert.equal(resolveFamily('courier').src.bold, 'Courier-Bold');
assert.equal(resolveFamily('does-not-exist').id, 'helvetica');
assert.ok(availableFonts().some(f => f.id === 'roboto'));

console.log('styles: all tests passed');
