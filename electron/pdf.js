// Invoice + Timesheet PDF generation for any billing period, drawn with a user output style (styles.js).
// Layout is authored in a fixed 792-pt-wide design space and scaled to the chosen page size, so the
// Classic style on Tabloid reproduces the original Google Docs/Sheets documents exactly.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { ROLES, PAGE_SIZES, resolveFamily, glyphFallback, normalizeStyle } = require('./styles');

const DESIGN_W = 792;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── date helpers (local time) ──
const pad = (n) => String(n).padStart(2, '0');
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const hrs = (n) => (Math.round(n * 100) / 100).toString();
const fixed2 = (n) => n.toFixed(2);

function formatDate(d, f) {
  const D = d.getDate(), M = d.getMonth(), Y = d.getFullYear();
  switch (f) {
    case 'DD/MM/YYYY': return `${pad(D)}/${pad(M + 1)}/${Y}`;
    case 'YYYY-MM-DD': return ymd(d);
    case 'D MMM YYYY': return `${D} ${MON3[M]} ${Y}`;
    case 'MMM D, YYYY': return `${MON3[M]} ${D}, ${Y}`;
    default: return `${pad(M + 1)}/${pad(D)}/${Y}`;
  }
}

// "September 14-18, 2026" / "August 31 to September 4, 2026" / "December 29, 2025 to January 2, 2026"
function rangeLabel(a, b) {
  if (a.getFullYear() !== b.getFullYear())
    return `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} to ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth())
    return `${MONTHS[a.getMonth()]} ${a.getDate()} to ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  if (a.getDate() === b.getDate()) return `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()}-${b.getDate()}, ${b.getFullYear()}`;
}
// "September 14 - September 18, 2026"
function invoiceRangeLabel(a, b) {
  if (a.getFullYear() !== b.getFullYear())
    return `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} - ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} - ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
}

// What the documents call the period
const PERIOD_TEXT = {
  weekly: { invoice: 'Week Ending:', ts: 'Weekly Timesheet', start: 'Week Starting:' },
  biweekly: { invoice: 'Period:', ts: 'Bi-weekly Timesheet', start: 'Period:' },
  semimonthly: { invoice: 'Period:', ts: 'Semi-monthly Timesheet', start: 'Period:' },
  monthly: { invoice: 'Period:', ts: 'Monthly Timesheet', start: 'Month:' },
};

// Weekly keeps the original behaviour (label the Mon-Fri span, stretched to weekend work).
function labelRange(cycle, periodStart, periodEnd, entries) {
  if (cycle !== 'weekly') return { first: periodStart, last: periodEnd };
  let last = addDays(periodStart, 4);
  for (const e of entries) { const d = parseDate(e.date); if (d > last) last = d; }
  return { first: periodStart, last };
}

// ── file names ──
const TYPE_NAMES = { invoice: 'Invoice', timesheet: 'Time Sheet' };
const cleanFileName = (s) => String(s)
  .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').trim().slice(0, 150);

function fileNames(style, ctx) {
  const fill = (type) => {
    const vals = { name: ctx.name, type: TYPE_NAMES[type], range: ctx.range, number: ctx.number, client: ctx.client, start: ctx.start, end: ctx.end };
    const s = style.fileName.replace(/\{(\w+)\}/g, (m, k) => (vals[k] === undefined ? m : String(vals[k] ?? '')));
    return (cleanFileName(s) || TYPE_NAMES[type]) + '.pdf';
  };
  const invoice = fill('invoice');
  let timesheet = fill('timesheet');
  if (timesheet.toLowerCase() === invoice.toLowerCase()) timesheet = timesheet.replace(/\.pdf$/, ' - Time Sheet.pdf');
  return { invoice, timesheet };
}

function rangeToken(cycle, start, range) {
  if (cycle === 'monthly') return `${start.getFullYear()}_${pad(start.getMonth() + 1)}`;
  const a = range.first, b = range.last;
  return `${pad(a.getMonth() + 1)}_${pad(a.getDate())} - ${pad(b.getMonth() + 1)}_${pad(b.getDate())}`;
}

// ── rendering context: fonts, glyph fallback, scaling ──
// WinAnsi covers Latin-1 plus these; PDF built-in fonts can't draw anything else.
const WINANSI_EXTRA = new Set([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178]);

function registerFamilies(doc, style) {
  const meta = {};
  const slots = { inv: style.fonts.invoice, note: style.fonts.note, ts: style.fonts.timesheet, fb: glyphFallback() };
  for (const [slot, fam] of Object.entries(slots)) {
    const r = resolveFamily(fam);
    for (const role of ROLES) {
      const name = `${slot}-${role}`;
      doc.registerFont(name, r.src[role]);
      doc.font(name);
      const f = doc._font;
      const embedded = f.font && typeof f.font.hasGlyphForCodePoint === 'function';
      meta[name] = {
        asc: f.ascender / 1000,
        // hand-tuned for the original documents' fonts; derived from metrics for everything else
        lift: r.lift ?? ((f.ascender - f.capHeight) / 1000 - 0.069),
        has: embedded ? (cp) => f.font.hasGlyphForCodePoint(cp) : (cp) => cp < 256 || WINANSI_EXTRA.has(cp),
      };
    }
  }
  return meta;
}

function createRenderer(doc, style, pageSize) {
  const k = pageSize[0] / DESIGN_W;
  const apply = () => { if (Math.abs(k - 1) > 1e-6) doc.scale(k); };
  apply();
  doc.on('pageAdded', apply);
  const meta = registerFamilies(doc, style);

  // split a string into runs, using the fallback font for characters the chosen font can't draw (e.g. ₱)
  const runs = (s, font) => {
    const fb = font.replace(/^[a-z]+-/, 'fb-');
    const out = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      const f = meta[font].has(cp) || !meta[fb].has(cp) ? font : fb;
      const last = out[out.length - 1];
      if (last && last.font === f) last.text += ch; else out.push({ font: f, text: ch });
    }
    return out;
  };
  const width = (s, font, size) =>
    runs(String(s), font).reduce((w, r) => w + doc.font(r.font).fontSize(size).widthOfString(r.text), 0);
  // y is the top of the text line in design units; runs share one baseline
  const t = (s, x, y, font, size, color) => {
    const m = meta[font];
    const baseline = y - m.lift * size + m.asc * size;
    for (const r of runs(String(s), font)) {
      doc.font(r.font).fontSize(size).fillColor(color).text(r.text, x, baseline - meta[r.font].asc * size, { lineBreak: false });
      x += doc.widthOfString(r.text);
    }
  };
  const tc = (s, x, w, y, font, size, color) => t(s, x + (w - width(s, font, size)) / 2, y, font, size, color);
  const tr = (s, right, y, font, size, color) => t(s, right - width(s, font, size), y, font, size, color);
  return { doc, H: pageSize[1] / k, t, tc, tr, width, addPage: () => doc.addPage({ size: pageSize, margin: 0 }) };
}

function writeDoc(doc, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
    doc.pipe(stream);
    doc.end();
  });
}

// Merge several entries on the same day into one row
function byDay(entries) {
  const m = new Map();
  for (const e of entries) {
    const cur = m.get(e.date);
    if (!cur) { m.set(e.date, { ...e }); continue; }
    cur.time_in = [cur.time_in, e.time_in].filter(Boolean).sort()[0] || '';
    cur.time_out = [cur.time_out, e.time_out].filter(Boolean).sort().pop() || '';
    cur.break_hours = (cur.break_hours || 0) + (e.break_hours || 0);
    cur.overtime_hours = (cur.overtime_hours || 0) + (e.overtime_hours || 0);
    cur.hours += e.hours;
  }
  return m;
}

// ── Invoice ──
function buildInvoice(R, S, { settings, client, entries, invoiceNumber, submittedOn, range, cycle }) {
  const { doc, t, tc, tr, width } = R;
  const C = S.colors;
  const PAGE_BOTTOM = R.H - 60;
  const col = { date: [164, 68], desc: [232, 166], hours: [398, 70], rate: [468, 82], total: [550, 78] };
  const money = (n) => S.currency + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (s) => formatDate(parseDate(s), S.dateFormat);

  let logoOk = !!S.logo;
  const LOGO = { x: 488, y: 88, w: 140, h: 60 };
  const titleMax = (logoOk ? LOGO.x - 12 : 628) - 167;
  let titleSize = 33.1;
  while (titleSize > 16 && width(S.invoiceTitle, 'inv-bold', titleSize) > titleMax) titleSize -= 1;

  const header = (continued) => {
    doc.rect(127, 53, 538, 7).fill(C.accent);
    t(S.invoiceTitle, 167, 104 + (33.1 - titleSize) * 0.6, 'inv-bold', titleSize, C.text);
    t(continued ? `${S.invoiceTitle} #${invoiceNumber} (continued)` : `Submitted on ${date(submittedOn)}`, 167, 143, 'inv-bold', 11.7, C.accent);
    if (logoOk && !continued) {
      try { doc.image(S.logo, LOGO.x, LOGO.y, { fit: [LOGO.w, LOGO.h], align: 'right', valign: 'center' }); }
      catch { logoOk = false; }
    }
  };
  const tableHead = (hy) => {
    tc('Date', ...col.date, hy, 'inv-bold', 11.7, C.text);
    tc('Description', ...col.desc, hy, 'inv-bold', 11.7, C.text);
    tc('Hours', ...col.hours, hy, 'inv-bold', 11.7, C.text);
    tc('Rate', ...col.rate, hy, 'inv-bold', 11.7, C.text);
    tc('Total', ...col.total, hy, 'inv-bold', 11.7, C.text);
  };
  const rule = (y, w = 0.75) => doc.save().moveTo(164, y).lineTo(628, y).lineWidth(w).strokeColor(C.rule).stroke().restore();

  header(false);
  t('Invoice for', 167, 176, 'inv-bold', 11.7, C.heading);
  t('Payable to', 333, 176, 'inv-bold', 11.7, C.heading);
  t('Invoice #', 473, 176, 'inv-bold', 11.7, C.heading);

  const billTo = String(client.bill_to || client.name).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  billTo.forEach((line, i) => t(line, 167, 194 + i * 23, 'inv-regular', 9.7, C.muted));
  t(settings.your_name, 333, 194, 'inv-regular', 9.7, C.text);
  let py = 211;
  if (settings.payment_method) { t(settings.payment_method, 333, py, 'inv-italic', 9.8, C.muted); py += 11; }
  if (settings.payment_email) t(settings.payment_email, 333, py, 'inv-italic', 9.8, C.muted);
  t(String(invoiceNumber), 473, 194, 'inv-regular', 9.7, C.muted);

  const shift = Math.max(0, 194 + (billTo.length - 1) * 23 + 30 - 268);
  rule(268 + shift);
  tableHead(294 + shift);

  const ROW = 19.5;
  const FOOTER_H = 150; // subtotal + total + period + closing line
  let y = 314 + shift;
  let stripe = 0, totalHours = 0, totalAmount = 0;
  const rate = client.hourly_rate;

  const rows = [...entries, null]; // trailing empty row, like the original
  for (const e of rows) {
    if (y + ROW > PAGE_BOTTOM) {
      R.addPage();
      header(true);
      rule(190);
      tableHead(210);
      y = 230; stripe = 0;
    }
    if (S.stripes) doc.rect(164, y, 464, ROW).fill(stripe++ % 2 === 0 ? C.stripe : '#FFFFFF');
    else if (e) rule(y + ROW, 0.5);
    if (e) {
      const amount = e.hours * rate;
      totalHours += e.hours; totalAmount += amount;
      const ty = y + 5;
      t(date(e.date), 171, ty, 'inv-regular', 9.8, C.text);
      t(e.description || client.default_description || '', 276, ty, 'inv-regular', 9.8, C.text);
      tc(hrs(e.hours), ...col.hours, ty, 'inv-regular', 9.8, C.muted);
      tc(money(rate), ...col.rate, ty, 'inv-regular', 9.8, C.muted);
      tc(money(amount), ...col.total, ty, 'inv-regular', 9.8, C.muted);
    }
    y += ROW;
  }

  if (y + 19 + FOOTER_H > PAGE_BOTTOM) {
    R.addPage();
    header(true);
    y = 190;
  }

  const ruleY = y + 19;
  rule(ruleY);
  const sy = ruleY + 8;
  t('Subtotal:', 296, sy, 'inv-regular', 9.8, C.text);
  tc(hrs(totalHours), ...col.hours, sy, 'inv-regular', 9.8, C.text);
  tc(money(totalAmount), ...col.total, sy, 'inv-bold', 9.8, C.text);

  const toty = sy + 43;
  const amtW = width(money(totalAmount), 'inv-bold', 19.5);
  tr(money(totalAmount), 624, toty, 'inv-bold', 19.5, C.total);
  tr('TOTAL:', 624 - amtW - 5, toty + 2, 'inv-bold', 13.6, C.text);

  const wy = toty + 28;
  const label = PERIOD_TEXT[cycle].invoice;
  t(label, 167, wy, 'note-regular', 9.8, C.text);
  t(invoiceRangeLabel(range.first, range.last), Math.max(234, 167 + width(label, 'note-regular', 9.8) + 6), wy, 'inv-regular', 9.8, C.muted);
  if (S.thankYou.trim()) t(S.thankYou.trim(), 167, wy + 42, 'note-boldItalic', 9.8, C.text);

  return { totalHours, totalAmount };
}

// ── Timesheet ──
function buildTimesheet(R, S, { settings, entries, range, cycle, periodStart, periodEnd, comments }) {
  const { doc, t, tc, width } = R;
  const C = S.colors;
  const PAGE_BOTTOM = R.H - 50;
  const box = (x, y, w, h, fill) => {
    if (fill) doc.rect(x, y, w, h).fill(fill);
    doc.rect(x, y, w, h).lineWidth(0.75).strokeColor(C.tsBorder).stroke();
  };
  const X = [72, 165, 249, 335, 427, 516, 591];
  const W = X.slice(1).map((x, i) => x - X[i]);
  const HEAD_H = 16, ROW = 15.85, NROWS = 7;
  const headers = ['Day of the week', 'Time In', 'Time Out', 'Break hours', 'Overtime Hours', 'Total Hours'];
  const text = PERIOD_TEXT[cycle];
  const multi = cycle !== 'weekly';
  const ink = C.text;

  // page header (identical to the original for weekly Classic)
  box(72, 68, 519, 24, C.tsTitle);
  tc(text.ts, 72, 519, 72, 'ts-bold', 17.5, ink);
  t(text.start, 75, 109, 'ts-bold', 9.8, ink);
  const periodText = cycle === 'monthly' ? `${MONTHS[periodStart.getMonth()]} ${periodStart.getFullYear()}` : rangeLabel(range.first, range.last);
  box(72, 121, Math.max(177, width(periodText, 'ts-regular', 10.7) + 10), 16);
  t(periodText, 75, 124, 'ts-regular', 10.7, ink);
  t('Name:', 75, 154, 'ts-bold', 10.7, ink);
  box(72, 167, Math.max(177, width(settings.your_name, 'ts-bold', 11.7) + 10), 31);
  t(settings.your_name, 75, 177, 'ts-bold', 11.7, ink);

  const days = byDay(entries);
  const inPeriod = (d) => d >= periodStart && d <= periodEnd;

  // one 7-row block per Monday-based week touching the period
  const blocks = [];
  for (let mon = mondayOf(periodStart); mon <= periodEnd; mon = addDays(mon, 7)) blocks.push(mon);

  let y = 230;
  const grand = { brk: 0, ot: 0, hrs: 0 };
  const LABEL_H = 13, GAP = 9;
  const blockH = (multi ? LABEL_H + GAP : 0) + HEAD_H + NROWS * ROW + ROW;
  const totalsRow = (label, tot, h, dy) => {
    box(X[0], y, X[3] - X[0], h, C.tsHeader);
    box(X[3], y, W[3], h, C.tsHeader);
    box(X[4], y, W[4], h, C.tsHeader);
    box(X[5], y, W[5], h, C.tsHeader);
    t(label, 75, y + dy, 'ts-bold', 10.7, ink);
    tc(fixed2(tot.brk), X[3], W[3], y + dy, 'ts-bold', 10.7, ink);
    if (tot.ot) tc(fixed2(tot.ot), X[4], W[4], y + dy, 'ts-bold', 10.7, ink);
    tc(fixed2(tot.hrs), X[5], W[5], y + dy, 'ts-bold', 10.7, ink);
    y += h;
  };

  blocks.forEach((mon, bi) => {
    if (y + blockH > PAGE_BOTTOM) { R.addPage(); y = 60; }
    if (multi) {
      const a = mon < periodStart ? periodStart : mon;
      const e = addDays(mon, 6) > periodEnd ? periodEnd : addDays(mon, 6);
      t(`Week ${bi + 1}: ${rangeLabel(a, e)}`, 75, y, 'ts-bold', 9.8, ink);
      y += LABEL_H;
    }
    for (let c = 0; c < 6; c++) {
      box(X[c], y, W[c], HEAD_H, C.tsHeader);
      tc(headers[c], X[c], W[c], y + 3, 'ts-bold', 10.7, ink);
    }
    y += HEAD_H;
    const tot = { brk: 0, ot: 0, hrs: 0 };
    for (let r = 0; r < NROWS; r++) {
      const d = addDays(mon, r);
      const outside = !inPeriod(d);
      const e = outside ? null : days.get(ymd(d));
      const weekend = r >= 5;
      for (let c = 0; c < 6; c++) box(X[c], y, W[c], ROW, c === 0 || c === 5 ? C.tsDay : null);
      const ty = y + 3;
      // weekly: original look (Mon-Fri day numbers, blank weekend rows). Longer periods label every in-period day.
      const dayText = multi ? `${DOW[d.getDay()]} ${d.getDate()}` : String(d.getDate());
      if (!outside && (multi || !weekend || e)) tc(dayText, X[0], W[0], ty, 'ts-regular', 10.7, ink);
      if (e) {
        if (e.time_in) tc(e.time_in, X[1], W[1], ty, 'ts-regular', 10.7, ink);
        if (e.time_out) tc(e.time_out, X[2], W[2], ty, 'ts-regular', 10.7, ink);
        if (e.break_hours) tc(fixed2(e.break_hours), X[3], W[3], ty, 'ts-regular', 10.7, ink);
        if (e.overtime_hours) tc(fixed2(e.overtime_hours), X[4], W[4], ty, 'ts-regular', 10.7, ink);
        tot.brk += e.break_hours || 0; tot.ot += e.overtime_hours || 0; tot.hrs += e.hours;
      }
      if (!outside) tc(fixed2(e ? e.hours : 0), X[5], W[5], ty, 'ts-regular', 10.7, ink);
      y += ROW;
    }
    totalsRow(multi ? 'Week total:' : 'Total:', tot, ROW, 3);
    grand.brk += tot.brk; grand.ot += tot.ot; grand.hrs += tot.hrs;
    if (multi) y += GAP;
  });

  if (multi) {
    if (y + ROW + 70 > PAGE_BOTTOM) { R.addPage(); y = 60; }
    totalsRow('Period total:', grand, ROW + 2, 4);
  }

  const lines = String(comments || '').split(/\r?\n/).filter(Boolean);
  const cH = Math.max(32, 8 + lines.length * 13);
  if (y + 17 + 12 + cH > PAGE_BOTTOM) { R.addPage(); y = 60; }
  const cy = y + 17;
  t('Comments:', 75, cy, 'ts-bold', 10.7, ink);
  box(72, cy + 12, 519, cH);
  lines.forEach((l, i) => t(l, 75, cy + 16 + i * 13, 'ts-regular', 10.7, ink));

  return { totHours: grand.hrs };
}

// ── public ──
async function generatePeriod({ settings, client, entries, periodStart, periodEnd, cycle = 'weekly', invoiceNumber, submittedOn, comments, outDir, style }) {
  const S = normalizeStyle(style);
  const pageSize = PAGE_SIZES[S.pageSize].size;
  const start = parseDate(periodStart);
  const end = parseDate(periodEnd);
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || String(a.time_in).localeCompare(String(b.time_in)));
  const range = labelRange(cycle, start, end, sorted);
  fs.mkdirSync(outDir, { recursive: true });

  const names = fileNames(S, {
    name: settings.your_name, client: client.name, number: invoiceNumber,
    start: periodStart, end: periodEnd, range: rangeToken(cycle, start, range),
  });
  const invoicePath = path.join(outDir, names.invoice);
  const timesheetPath = path.join(outDir, names.timesheet);

  const make = (title) => new PDFDocument({ size: pageSize, margin: 0, info: { Title: title, Author: settings.your_name } });

  const inv = make(`${S.invoiceTitle} #${invoiceNumber}`);
  const totals = buildInvoice(createRenderer(inv, S, pageSize), S, { settings, client, entries: sorted, invoiceNumber, submittedOn, range, cycle });
  await writeDoc(inv, invoicePath);

  const ts = make(PERIOD_TEXT[cycle].ts);
  buildTimesheet(createRenderer(ts, S, pageSize), S, { settings, entries: sorted, range, cycle, periodStart: start, periodEnd: end, comments });
  await writeDoc(ts, timesheetPath);

  return { invoicePath, timesheetPath, ...totals };
}

module.exports = { generatePeriod, fileNames, formatDate };
