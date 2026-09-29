// Invoice + Timesheet PDF generation for any billing period (weekly, bi-weekly, semi-monthly, monthly).
// A weekly period reproduces the original single-week layout exactly; longer periods add rows / week blocks.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const PAGE = [792, 1224];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── date helpers (local time) ──
const pad = (n) => String(n).padStart(2, '0');
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const mmddyyyy = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hrs = (n) => (Math.round(n * 100) / 100).toString();
const fixed2 = (n) => n.toFixed(2);

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
const fileRange = (a, b) => `${pad(a.getMonth() + 1)}_${pad(a.getDate())} - ${pad(b.getMonth() + 1)}_${pad(b.getDate())}`;
const safeName = (s) => String(s || '').replace(/[<>:"/\\|?*]+/g, '').trim() || 'Invoice';

// What the documents call the period
const PERIOD_TEXT = {
  weekly: { invoice: 'Week Ending:', ts: 'Weekly Timesheet', start: 'Week Starting:' },
  biweekly: { invoice: 'Period:', ts: 'Bi-weekly Timesheet', start: 'Period:' },
  semimonthly: { invoice: 'Period:', ts: 'Semi-monthly Timesheet', start: 'Period:' },
  monthly: { invoice: 'Period:', ts: 'Monthly Timesheet', start: 'Month:' },
};

// Weekly keeps the original behaviour (label the Mon-Fri span, stretched to weekend work).
// Other cycles label the full billing period.
function labelRange(cycle, periodStart, periodEnd, entries) {
  if (cycle !== 'weekly') return { first: periodStart, last: periodEnd };
  let last = addDays(periodStart, 4);
  for (const e of entries) { const d = parseDate(e.date); if (d > last) last = d; }
  return { first: periodStart, last };
}

function registerFonts(doc) {
  const own = path.join(__dirname, 'fonts');
  doc.registerFont('Roboto', path.join(own, 'Roboto-Regular.ttf'));
  doc.registerFont('Roboto-Bold', path.join(own, 'Roboto-Bold.ttf'));
  doc.registerFont('Roboto-Italic', path.join(own, 'Roboto-Italic.ttf'));
  const win = 'C:\\Windows\\Fonts';
  const pick = (file, fallback) => { const p = path.join(win, file); return fs.existsSync(p) ? p : fallback; };
  doc.registerFont('Arial', pick('arial.ttf', 'Helvetica'));
  doc.registerFont('Arial-Bold', pick('arialbd.ttf', 'Helvetica-Bold'));
  doc.registerFont('Arial-BoldItalic', pick('arialbi.ttf', 'Helvetica-BoldOblique'));
}

// Text helpers — y is the top of the glyphs; pdfkit's y includes line-gap, so lift to match the originals.
const LIFT = { Roboto: 0.185, Arial: 0.12 };
function t(doc, s, x, y, font, size, color = '#000000') {
  const lift = (font.startsWith('Roboto') ? LIFT.Roboto : LIFT.Arial) * size;
  doc.font(font).fontSize(size).fillColor(color).text(String(s), x, y - lift, { lineBreak: false });
}
function tc(doc, s, x, w, y, font, size, color = '#000000') {
  doc.font(font).fontSize(size);
  t(doc, s, x + (w - doc.widthOfString(String(s))) / 2, y, font, size, color);
}
function tr(doc, s, right, y, font, size, color = '#000000') {
  doc.font(font).fontSize(size);
  t(doc, s, right - doc.widthOfString(String(s)), y, font, size, color);
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
function buildInvoice(doc, { settings, client, entries, invoiceNumber, submittedOn, range, cycle }) {
  const ORANGE = '#FF9900', LABEL = '#434343', GREY = '#666666', RULE = '#B7B7B7', STRIPE = '#F3F3F3';
  const PAGE_BOTTOM = PAGE[1] - 60;
  const C = { date: [164, 68], desc: [232, 166], hours: [398, 70], rate: [468, 82], total: [550, 78] };

  const header = (continued) => {
    doc.rect(127, 53, 538, 7).fill(ORANGE);
    t(doc, 'Invoice', 167, 104, 'Roboto-Bold', 33.1);
    t(doc, continued ? `Invoice #${invoiceNumber} (continued)` : `Submitted on ${mmddyyyy(parseDate(submittedOn))}`, 167, 143, 'Roboto-Bold', 11.7, ORANGE);
  };
  const tableHead = (hy) => {
    tc(doc, 'Date', ...C.date, hy, 'Roboto-Bold', 11.7);
    tc(doc, 'Description', ...C.desc, hy, 'Roboto-Bold', 11.7);
    tc(doc, 'Hours', ...C.hours, hy, 'Roboto-Bold', 11.7);
    tc(doc, 'Rate', ...C.rate, hy, 'Roboto-Bold', 11.7);
    tc(doc, 'Total', ...C.total, hy, 'Roboto-Bold', 11.7);
  };
  const rule = (y) => doc.save().moveTo(164, y).lineTo(628, y).lineWidth(0.75).strokeColor(RULE).stroke().restore();

  header(false);
  t(doc, 'Invoice for', 167, 176, 'Roboto-Bold', 11.7, LABEL);
  t(doc, 'Payable to', 333, 176, 'Roboto-Bold', 11.7, LABEL);
  t(doc, 'Invoice #', 473, 176, 'Roboto-Bold', 11.7, LABEL);

  const billTo = String(client.bill_to || client.name).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  billTo.forEach((line, i) => t(doc, line, 167, 194 + i * 23, 'Roboto', 9.7, GREY));
  t(doc, settings.your_name, 333, 194, 'Roboto', 9.7);
  let py = 211;
  if (settings.payment_method) { t(doc, settings.payment_method, 333, py, 'Roboto-Italic', 9.8, GREY); py += 11; }
  if (settings.payment_email) t(doc, settings.payment_email, 333, py, 'Roboto-Italic', 9.8, GREY);
  t(doc, String(invoiceNumber), 473, 194, 'Roboto', 9.7, GREY);

  const shift = Math.max(0, 194 + (billTo.length - 1) * 23 + 30 - 268);
  rule(268 + shift);
  tableHead(294 + shift);

  const ROW = 19.5;
  const FOOTER_H = 150; // subtotal + total + period + thank-you
  let y = 314 + shift;
  let stripe = 0, totalHours = 0, totalAmount = 0;
  const rate = client.hourly_rate;

  const rows = [...entries, null]; // trailing empty striped row, like the original
  for (const e of rows) {
    if (y + ROW > PAGE_BOTTOM) {
      doc.addPage({ size: PAGE, margin: 0 });
      header(true);
      rule(190);
      tableHead(210);
      y = 230; stripe = 0;
    }
    doc.rect(164, y, 464, ROW).fill(stripe++ % 2 === 0 ? STRIPE : '#FFFFFF');
    if (e) {
      const amount = e.hours * rate;
      totalHours += e.hours; totalAmount += amount;
      const ty = y + 5;
      t(doc, mmddyyyy(parseDate(e.date)), 171, ty, 'Roboto', 9.8);
      t(doc, e.description || client.default_description || '', 276, ty, 'Roboto', 9.8);
      tc(doc, hrs(e.hours), ...C.hours, ty, 'Roboto', 9.8, GREY);
      tc(doc, money(rate), ...C.rate, ty, 'Roboto', 9.8, GREY);
      tc(doc, money(amount), ...C.total, ty, 'Roboto', 9.8, GREY);
    }
    y += ROW;
  }

  if (y + 19 + FOOTER_H > PAGE_BOTTOM) {
    doc.addPage({ size: PAGE, margin: 0 });
    header(true);
    y = 190;
  }

  const ruleY = y + 19;
  rule(ruleY);
  const sy = ruleY + 8;
  t(doc, 'Subtotal:', 296, sy, 'Roboto', 9.8);
  tc(doc, hrs(totalHours), ...C.hours, sy, 'Roboto', 9.8);
  tc(doc, money(totalAmount), ...C.total, sy, 'Roboto-Bold', 9.8);

  const toty = sy + 43;
  doc.font('Roboto-Bold').fontSize(19.5);
  const amtW = doc.widthOfString(money(totalAmount));
  tr(doc, money(totalAmount), 624, toty, 'Roboto-Bold', 19.5, '#FF0000');
  tr(doc, 'TOTAL:', 624 - amtW - 5, toty + 2, 'Roboto-Bold', 13.6);

  const wy = toty + 28;
  const label = PERIOD_TEXT[cycle].invoice;
  doc.font('Arial').fontSize(9.8);
  const labelW = doc.widthOfString(label);
  t(doc, label, 167, wy, 'Arial', 9.8);
  t(doc, invoiceRangeLabel(range.first, range.last), Math.max(234, 167 + labelW + 6), wy, 'Roboto', 9.8, GREY);
  t(doc, 'Thank you for your business.', 167, wy + 42, 'Arial-BoldItalic', 9.8);

  return { totalHours, totalAmount };
}

// ── Timesheet ──
function buildTimesheet(doc, { settings, entries, range, cycle, periodStart, periodEnd, comments }) {
  const PEACH = '#FCE5CD', ORANGE = '#F9CB9C', BLUE = '#CFE2F3', LW = 0.75;
  const PAGE_BOTTOM = PAGE[1] - 50;
  const box = (x, y, w, h, fill) => {
    if (fill) doc.rect(x, y, w, h).fill(fill);
    doc.rect(x, y, w, h).lineWidth(LW).strokeColor('#000000').stroke();
  };
  const X = [72, 165, 249, 335, 427, 516, 591];
  const W = X.slice(1).map((x, i) => x - X[i]);
  const HEAD_H = 16, ROW = 15.85, NROWS = 7;
  const headers = ['Day of the week', 'Time In', 'Time Out', 'Break hours', 'Overtime Hours', 'Total Hours'];
  const text = PERIOD_TEXT[cycle];
  const multi = cycle !== 'weekly';

  // ── page header (identical to the original for weekly)
  box(72, 68, 519, 24, PEACH);
  tc(doc, text.ts, 72, 519, 72, 'Arial-Bold', 17.5);
  t(doc, text.start, 75, 109, 'Arial-Bold', 9.8);
  const periodText = cycle === 'monthly' ? `${MONTHS[periodStart.getMonth()]} ${periodStart.getFullYear()}` : rangeLabel(range.first, range.last);
  doc.font('Arial').fontSize(10.7);
  box(72, 121, Math.max(177, doc.widthOfString(periodText) + 10), 16);
  t(doc, periodText, 75, 124, 'Arial', 10.7);
  t(doc, 'Name:', 75, 154, 'Arial-Bold', 10.7);
  box(72, 167, 177, 31);
  t(doc, settings.your_name, 75, 177, 'Arial-Bold', 11.7);

  const days = byDay(entries);
  const inPeriod = (d) => d >= periodStart && d <= periodEnd;

  // one 7-row block per Monday-based week touching the period
  const blocks = [];
  for (let mon = mondayOf(periodStart); mon <= periodEnd; mon = addDays(mon, 7)) blocks.push(mon);

  let y = 230;
  const grand = { brk: 0, ot: 0, hrs: 0 };
  const LABEL_H = 13, GAP = 9; // multi-week: caption above each block, gap after it
  const blockH = (multi ? LABEL_H + GAP : 0) + HEAD_H + NROWS * ROW + ROW;

  blocks.forEach((mon, bi) => {
    if (y + blockH > PAGE_BOTTOM) { doc.addPage({ size: PAGE, margin: 0 }); y = 60; }
    if (multi) {
      const a = mon < periodStart ? periodStart : mon;
      const e = addDays(mon, 6) > periodEnd ? periodEnd : addDays(mon, 6);
      t(doc, `Week ${bi + 1}: ${rangeLabel(a, e)}`, 75, y, 'Arial-Bold', 9.8);
      y += LABEL_H;
    }
    for (let c = 0; c < 6; c++) {
      box(X[c], y, W[c], HEAD_H, ORANGE);
      tc(doc, headers[c], X[c], W[c], y + 3, 'Arial-Bold', 10.7);
    }
    y += HEAD_H;
    const tot = { brk: 0, ot: 0, hrs: 0 };
    for (let r = 0; r < NROWS; r++) {
      const d = addDays(mon, r);
      const e = inPeriod(d) ? days.get(ymd(d)) : null;
      const weekend = r >= 5;
      const outside = !inPeriod(d);
      for (let c = 0; c < 6; c++) box(X[c], y, W[c], ROW, c === 0 || c === 5 ? BLUE : null);
      const ty = y + 3;
      // weekly: original look (Mon-Fri day numbers, blank weekend rows). Longer periods: label every in-period day.
      const dayText = multi ? `${DOW[d.getDay()]} ${d.getDate()}` : String(d.getDate());
      if (!outside && (multi || !weekend || e)) tc(doc, dayText, X[0], W[0], ty, 'Arial', 10.7);
      if (e) {
        if (e.time_in) tc(doc, e.time_in, X[1], W[1], ty, 'Arial', 10.7);
        if (e.time_out) tc(doc, e.time_out, X[2], W[2], ty, 'Arial', 10.7);
        if (e.break_hours) tc(doc, fixed2(e.break_hours), X[3], W[3], ty, 'Arial', 10.7);
        if (e.overtime_hours) tc(doc, fixed2(e.overtime_hours), X[4], W[4], ty, 'Arial', 10.7);
        tot.brk += e.break_hours || 0; tot.ot += e.overtime_hours || 0; tot.hrs += e.hours;
      }
      if (!outside) tc(doc, fixed2(e ? e.hours : 0), X[5], W[5], ty, 'Arial', 10.7);
      y += ROW;
    }
    box(X[0], y, X[3] - X[0], ROW, ORANGE);
    box(X[3], y, W[3], ROW, ORANGE);
    box(X[4], y, W[4], ROW, ORANGE);
    box(X[5], y, W[5], ROW, ORANGE);
    t(doc, multi ? 'Week total:' : 'Total:', 75, y + 3, 'Arial-Bold', 10.7);
    tc(doc, fixed2(tot.brk), X[3], W[3], y + 3, 'Arial-Bold', 10.7);
    if (tot.ot) tc(doc, fixed2(tot.ot), X[4], W[4], y + 3, 'Arial-Bold', 10.7);
    tc(doc, fixed2(tot.hrs), X[5], W[5], y + 3, 'Arial-Bold', 10.7);
    y += ROW;
    grand.brk += tot.brk; grand.ot += tot.ot; grand.hrs += tot.hrs;
    if (multi) y += GAP;
  });

  if (multi) {
    if (y + ROW + 70 > PAGE_BOTTOM) { doc.addPage({ size: PAGE, margin: 0 }); y = 60; }
    box(X[0], y, X[3] - X[0], ROW + 2, ORANGE);
    box(X[3], y, W[3], ROW + 2, ORANGE);
    box(X[4], y, W[4], ROW + 2, ORANGE);
    box(X[5], y, W[5], ROW + 2, ORANGE);
    t(doc, 'Period total:', 75, y + 4, 'Arial-Bold', 10.7);
    tc(doc, fixed2(grand.brk), X[3], W[3], y + 4, 'Arial-Bold', 10.7);
    if (grand.ot) tc(doc, fixed2(grand.ot), X[4], W[4], y + 4, 'Arial-Bold', 10.7);
    tc(doc, fixed2(grand.hrs), X[5], W[5], y + 4, 'Arial-Bold', 10.7);
    y += ROW + 2;
  }

  const lines = String(comments || '').split(/\r?\n/).filter(Boolean);
  const cH = Math.max(32, 8 + lines.length * 13);
  if (y + 17 + 12 + cH > PAGE_BOTTOM) { doc.addPage({ size: PAGE, margin: 0 }); y = 60; }
  const cy = y + 17;
  t(doc, 'Comments:', 75, cy, 'Arial-Bold', 10.7);
  box(72, cy + 12, 519, cH);
  lines.forEach((l, i) => t(doc, l, 75, cy + 16 + i * 13, 'Arial', 10.7));

  return { totHours: grand.hrs };
}

// ── public ──
async function generatePeriod({ settings, client, entries, periodStart, periodEnd, cycle = 'weekly', invoiceNumber, submittedOn, comments, outDir }) {
  const start = parseDate(periodStart);
  const end = parseDate(periodEnd);
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || String(a.time_in).localeCompare(String(b.time_in)));
  const range = labelRange(cycle, start, end, sorted);
  fs.mkdirSync(outDir, { recursive: true });

  const base = safeName(settings.your_name);
  const fr = cycle === 'monthly'
    ? `${start.getFullYear()}_${pad(start.getMonth() + 1)}`
    : fileRange(range.first, range.last);
  const invoicePath = path.join(outDir, `${base} - Invoice ${fr}.pdf`);
  const timesheetPath = path.join(outDir, `${base} - Time Sheet ${fr}.pdf`);

  const meta = (title) => ({ size: PAGE, margin: 0, info: { Title: title, Author: settings.your_name } });

  const inv = new PDFDocument(meta(`Invoice #${invoiceNumber}`));
  registerFonts(inv);
  const totals = buildInvoice(inv, { settings, client, entries: sorted, invoiceNumber, submittedOn, range, cycle });
  await writeDoc(inv, invoicePath);

  const ts = new PDFDocument(meta(PERIOD_TEXT[cycle].ts));
  registerFonts(ts);
  buildTimesheet(ts, { settings, entries: sorted, range, cycle, periodStart: start, periodEnd: end, comments });
  await writeDoc(ts, timesheetPath);

  return { invoicePath, timesheetPath, ...totals };
}

module.exports = { generatePeriod };
