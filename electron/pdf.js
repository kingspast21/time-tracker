// Weekly document generation: Invoice + Weekly Timesheet.
// Layouts replicate the user's existing Google Docs/Sheets exports (11x17 pt page, 792x1224).
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const PAGE = [792, 1224];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// ── helpers ──
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const pad = (n) => String(n).padStart(2, '0');
const mmddyyyy = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hrs = (n) => (Math.round(n * 100) / 100).toString();          // 8, 7.5, 7.25
const fixed2 = (n) => n.toFixed(2);                                  // 8.00

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Monday..Friday, extended to Sat/Sun when there is weekend work
function workRange(weekStart, entries) {
  const mon = parseDate(weekStart);
  let last = addDays(mon, 4);
  for (const e of entries) { const d = parseDate(e.date); if (d > last) last = d; }
  return { first: mon, last };
}

// "September 14-18, 2026" / "August 31 to September 4, 2026" / "December 29, 2025 to January 2, 2026"
function timesheetRangeLabel(a, b) {
  if (a.getFullYear() !== b.getFullYear())
    return `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} to ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth())
    return `${MONTHS[a.getMonth()]} ${a.getDate()} to ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()}-${b.getDate()}, ${b.getFullYear()}`;
}

// "September 14 - September 18, 2026"
function invoiceRangeLabel(a, b) {
  if (a.getFullYear() !== b.getFullYear())
    return `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} - ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} - ${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
}

function fileRange(a, b) { return `${pad(a.getMonth() + 1)}_${pad(a.getDate())} - ${pad(b.getMonth() + 1)}_${pad(b.getDate())}`; }

function safeName(s) { return String(s || '').replace(/[<>:"/\\|?*]+/g, '').trim() || 'Invoice'; }

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

// Text helpers — y is the top of the text line; lineBreak disabled so nothing reflows.
// pdfkit's y includes the line-gap above the glyphs; nudge up so glyph tops land where the originals' do
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

// ── Invoice ──
function buildInvoice(doc, { settings, client, entries, invoiceNumber, submittedOn, range }) {
  const ORANGE = '#FF9900', LABEL = '#434343', GREY = '#666666', RULE = '#B7B7B7', STRIPE = '#F3F3F3';

  doc.rect(127, 53, 538, 7).fill(ORANGE);

  t(doc, 'Invoice', 167, 104, 'Roboto-Bold', 33.1);
  t(doc, `Submitted on ${mmddyyyy(parseDate(submittedOn))}`, 167, 143, 'Roboto-Bold', 11.7, ORANGE);

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

  // push the table down if the bill-to block is long
  const shift = Math.max(0, 194 + (billTo.length - 1) * 23 + 30 - 268);

  doc.save().moveTo(164, 268 + shift).lineTo(628, 268 + shift).lineWidth(0.75).strokeColor(RULE).stroke().restore();

  // columns: Date | Description | Hours | Rate | Total
  const C = { date: [164, 68], desc: [232, 166], hours: [398, 70], rate: [468, 82], total: [550, 78] };
  const hy = 294 + shift;
  tc(doc, 'Date', ...C.date, hy, 'Roboto-Bold', 11.7);
  tc(doc, 'Description', ...C.desc, hy, 'Roboto-Bold', 11.7);
  tc(doc, 'Hours', ...C.hours, hy, 'Roboto-Bold', 11.7);
  tc(doc, 'Rate', ...C.rate, hy, 'Roboto-Bold', 11.7);
  tc(doc, 'Total', ...C.total, hy, 'Roboto-Bold', 11.7);

  const ROW = 19.5;
  let y = 314 + shift;
  let totalHours = 0, totalAmount = 0;
  const rowsDrawn = entries.length + 1; // one empty striped row after the data, like the original
  for (let i = 0; i < rowsDrawn; i++) {
    const ry = y + i * ROW;
    doc.rect(164, ry, 464, ROW).fill(i % 2 === 0 ? STRIPE : '#FFFFFF');
    const e = entries[i];
    if (!e) continue;
    const rate = client.hourly_rate;
    const amount = e.hours * rate;
    totalHours += e.hours; totalAmount += amount;
    const ty = ry + 5;
    t(doc, mmddyyyy(parseDate(e.date)), 171, ty, 'Roboto', 9.8);
    t(doc, e.description || client.default_description || '', 276, ty, 'Roboto', 9.8);
    tc(doc, hrs(e.hours), ...C.hours, ty, 'Roboto', 9.8, GREY);
    tc(doc, money(rate), ...C.rate, ty, 'Roboto', 9.8, GREY);
    tc(doc, money(amount), ...C.total, ty, 'Roboto', 9.8, GREY);
  }

  const ruleY = y + rowsDrawn * ROW + 19;
  doc.save().moveTo(164, ruleY).lineTo(628, ruleY).lineWidth(0.75).strokeColor(RULE).stroke().restore();

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
  t(doc, 'Week Ending:', 167, wy, 'Arial', 9.8);
  t(doc, invoiceRangeLabel(range.first, range.last), 234, wy, 'Roboto', 9.8, GREY);

  t(doc, 'Thank you for your business.', 167, wy + 42, 'Arial-BoldItalic', 9.8);

  return { totalHours, totalAmount };
}

// ── Weekly Timesheet ──
function buildTimesheet(doc, { settings, entries, range, weekStart, comments }) {
  const PEACH = '#FCE5CD', ORANGE = '#F9CB9C', BLUE = '#CFE2F3', LW = 0.75;
  const box = (x, y, w, h, fill) => {
    if (fill) doc.rect(x, y, w, h).fill(fill);
    doc.rect(x, y, w, h).lineWidth(LW).strokeColor('#000000').stroke();
  };

  box(72, 68, 519, 24, PEACH);
  tc(doc, 'Weekly Timesheet', 72, 519, 72, 'Arial-Bold', 17.5);

  t(doc, 'Week Starting:', 75, 109, 'Arial-Bold', 9.8);
  box(72, 121, 177, 16);
  t(doc, timesheetRangeLabel(range.first, range.last), 75, 124, 'Arial', 10.7);

  t(doc, 'Name:', 75, 154, 'Arial-Bold', 10.7);
  box(72, 167, 177, 31);
  t(doc, settings.your_name, 75, 177, 'Arial-Bold', 11.7);

  // columns
  const X = [72, 165, 249, 335, 427, 516, 591];
  const W = X.slice(1).map((x, i) => x - X[i]);
  const HEAD_Y = 230, HEAD_H = 16, ROW = 15.85, NROWS = 7;
  const headers = ['Day of the week', 'Time In', 'Time Out', 'Break hours', 'Overtime Hours', 'Total Hours'];

  for (let c = 0; c < 6; c++) {
    box(X[c], HEAD_Y, W[c], HEAD_H, ORANGE);
    tc(doc, headers[c], X[c], W[c], HEAD_Y + 3, 'Arial-Bold', 10.7);
  }

  // one row per day Mon..Sun; merge multiple entries on the same day
  const mon = parseDate(weekStart);
  const byDay = new Map();
  for (const e of entries) {
    const cur = byDay.get(e.date);
    if (!cur) { byDay.set(e.date, { ...e }); continue; }
    cur.time_in = [cur.time_in, e.time_in].filter(Boolean).sort()[0] || '';
    cur.time_out = [cur.time_out, e.time_out].filter(Boolean).sort().pop() || '';
    cur.break_hours = (cur.break_hours || 0) + (e.break_hours || 0);
    cur.overtime_hours = (cur.overtime_hours || 0) + (e.overtime_hours || 0);
    cur.hours += e.hours;
  }

  let totBreak = 0, totOT = 0, totHours = 0;
  for (let r = 0; r < NROWS; r++) {
    const d = addDays(mon, r);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const e = byDay.get(key);
    const weekend = r >= 5;
    const y = HEAD_Y + HEAD_H + r * ROW;
    for (let c = 0; c < 6; c++) box(X[c], y, W[c], ROW, c === 0 || c === 5 ? BLUE : null);
    const ty = y + 3;
    if (!weekend || e) tc(doc, String(d.getDate()), X[0], W[0], ty, 'Arial', 10.7);
    if (e) {
      if (e.time_in) tc(doc, e.time_in, X[1], W[1], ty, 'Arial', 10.7);
      if (e.time_out) tc(doc, e.time_out, X[2], W[2], ty, 'Arial', 10.7);
      if (e.break_hours) tc(doc, fixed2(e.break_hours), X[3], W[3], ty, 'Arial', 10.7);
      if (e.overtime_hours) tc(doc, fixed2(e.overtime_hours), X[4], W[4], ty, 'Arial', 10.7);
      totBreak += e.break_hours || 0; totOT += e.overtime_hours || 0; totHours += e.hours;
    }
    tc(doc, fixed2(e ? e.hours : 0), X[5], W[5], ty, 'Arial', 10.7);
  }

  const ty0 = HEAD_Y + HEAD_H + NROWS * ROW;
  box(X[0], ty0, X[3] - X[0], ROW, ORANGE);
  box(X[3], ty0, W[3], ROW, ORANGE);
  box(X[4], ty0, W[4], ROW, ORANGE);
  box(X[5], ty0, W[5], ROW, ORANGE);
  t(doc, 'Total:', 75, ty0 + 3, 'Arial-Bold', 10.7);
  tc(doc, fixed2(totBreak), X[3], W[3], ty0 + 3, 'Arial-Bold', 10.7);
  if (totOT) tc(doc, fixed2(totOT), X[4], W[4], ty0 + 3, 'Arial-Bold', 10.7);
  tc(doc, fixed2(totHours), X[5], W[5], ty0 + 3, 'Arial-Bold', 10.7);

  const cy = ty0 + ROW + 17;
  t(doc, 'Comments:', 75, cy, 'Arial-Bold', 10.7);
  const lines = String(comments || '').split(/\r?\n/).filter(Boolean);
  const cH = Math.max(32, 8 + lines.length * 13);
  box(72, cy + 12, 519, cH);
  lines.forEach((l, i) => t(doc, l, 75, cy + 16 + i * 13, 'Arial', 10.7));

  return { totHours };
}

// ── public ──
async function generateWeekly({ settings, client, entries, weekStart, invoiceNumber, submittedOn, comments, outDir }) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || String(a.time_in).localeCompare(String(b.time_in)));
  const range = workRange(weekStart, sorted);
  fs.mkdirSync(outDir, { recursive: true });

  const base = safeName(settings.your_name);
  const fr = fileRange(range.first, range.last);
  const invoicePath = path.join(outDir, `${base} - Invoice ${fr}.pdf`);
  const timesheetPath = path.join(outDir, `${base} - Time Sheet ${fr}.pdf`);

  const meta = (title) => ({ size: PAGE, margin: 0, info: { Title: title, Author: settings.your_name } });

  const inv = new PDFDocument(meta(`Invoice #${invoiceNumber}`));
  registerFonts(inv);
  const totals = buildInvoice(inv, { settings, client, entries: sorted, invoiceNumber, submittedOn, range });
  await writeDoc(inv, invoicePath);

  const ts = new PDFDocument(meta('Weekly Timesheet'));
  registerFonts(ts);
  buildTimesheet(ts, { settings, entries: sorted, range, weekStart, comments });
  await writeDoc(ts, timesheetPath);

  return { invoicePath, timesheetPath, ...totals };
}

module.exports = { generateWeekly };
