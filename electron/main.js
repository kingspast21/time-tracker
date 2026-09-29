const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { generatePeriod, fileNames } = require('./pdf');
const S = require('./styles');

let db;
let dbPath;

// Optional: keep data somewhere else (e.g. a throwaway profile for testing)
if (process.env.TIMETRACKER_DATA_DIR) app.setPath('userData', process.env.TIMETRACKER_DATA_DIR);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const CYCLES = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const PERIOD_NOUN = { weekly: 'week', biweekly: 'period', semimonthly: 'period', monthly: 'month' };

const DEFAULT_SETTINGS = {
  your_name: '',
  payment_method: '',
  payment_email: '',
  default_time_in: '08:00',
  default_time_out: '16:00',
  output_dir: '',
};

// ── database ──

function saveDb() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
const queryOne = (sql, params) => queryAll(sql, params)[0];

function columns(table) {
  return queryAll(`PRAGMA table_info(${table})`).map(c => c.name);
}
function addColumn(table, name, def) {
  if (!columns(table).includes(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}

function hoursBetween(tin, tout, brk) {
  if (!tin || !tout) return 0;
  const [h1, m1] = tin.split(':').map(Number);
  const [h2, m2] = tout.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60; // overnight shift
  return Math.max(0, Math.round((mins / 60 - (brk || 0)) * 100) / 100);
}

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

async function initDatabase() {
  const SQL = await initSqlJs();
  dbPath = path.join(app.getPath('userData'), 'timetracker.db');
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

  db.run('PRAGMA foreign_keys = ON');
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    hourly_rate REAL NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    hours REAL NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    number INTEGER NOT NULL,
    submitted_on TEXT,
    comments TEXT DEFAULT '',
    UNIQUE (client_id, week_start),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`);

  // migrations for databases created by earlier versions
  addColumn('clients', 'bill_to', "TEXT DEFAULT ''");
  addColumn('clients', 'default_description', "TEXT DEFAULT ''");
  addColumn('clients', 'billing_cycle', "TEXT DEFAULT 'weekly'");
  addColumn('clients', 'cycle_anchor', "TEXT DEFAULT ''");
  addColumn('time_entries', 'time_in', "TEXT DEFAULT ''");
  addColumn('time_entries', 'time_out', "TEXT DEFAULT ''");
  addColumn('time_entries', 'break_hours', 'REAL DEFAULT 0');
  addColumn('time_entries', 'overtime_hours', 'REAL DEFAULT 0');
  // invoices.week_start is the period start; period_end + cycle added for multi-week periods
  addColumn('invoices', 'period_end', "TEXT DEFAULT ''");
  addColumn('invoices', 'cycle', "TEXT DEFAULT 'weekly'");
  // backfill: older rows were always Mon-Sun weeks
  db.run(`UPDATE invoices SET period_end = date(week_start, '+6 days') WHERE period_end IS NULL OR period_end = ''`);
  db.run(`UPDATE clients SET billing_cycle = 'weekly' WHERE billing_cycle IS NULL OR billing_cycle = ''`);

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
  if (!getSettings().output_dir) setSetting('output_dir', path.join(app.getPath('documents'), 'Invoices'));
  saveDb();
}

function getSettings() {
  const out = {};
  for (const r of queryAll('SELECT key, value FROM settings')) out[r.key] = r.value;
  delete out.output_style; // handled by getStyle()
  return out;
}
function setSetting(k, v) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v ?? '']);
}
function getStyle() {
  const row = queryOne("SELECT value FROM settings WHERE key = 'output_style'");
  let raw = null;
  try { raw = row ? JSON.parse(row.value) : null; } catch { raw = null; }
  return S.normalizeStyle(raw || {});
}

// Invoices whose date range overlaps [start, end] for this client
const overlapping = (clientId, start, end, exceptStart) =>
  queryAll(`SELECT * FROM invoices WHERE client_id = ? AND week_start <= ? AND period_end >= ? AND week_start <> ? ORDER BY week_start`,
    [clientId, end, start, exceptStart || '']);

// ── IPC: settings ──

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, s) => {
  for (const [k, v] of Object.entries(s)) if (k !== 'output_style') setSetting(k, String(v ?? ''));
  saveDb();
  return getSettings();
});
ipcMain.handle('settings:pickFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ── IPC: clients ──

ipcMain.handle('db:getClients', () => queryAll('SELECT * FROM clients ORDER BY name'));

ipcMain.handle('db:saveClient', (_e, c) => {
  const cycle = CYCLES.includes(c.billing_cycle) ? c.billing_cycle : 'weekly';
  let anchor = '';
  if (cycle === 'biweekly') {
    // anchor is always a Monday so fortnights line up with weeks
    const base = c.cycle_anchor ? new Date(...c.cycle_anchor.split('-').map((n, i) => i === 1 ? n - 1 : +n)) : new Date();
    anchor = ymd(mondayOf(base));
  }
  const vals = [c.name, Number(c.hourly_rate) || 0, c.bill_to || '', c.default_description || '', cycle, anchor];
  if (c.id) db.run('UPDATE clients SET name = ?, hourly_rate = ?, bill_to = ?, default_description = ?, billing_cycle = ?, cycle_anchor = ? WHERE id = ?', [...vals, c.id]);
  else db.run('INSERT INTO clients (name, hourly_rate, bill_to, default_description, billing_cycle, cycle_anchor) VALUES (?, ?, ?, ?, ?, ?)', vals);
  saveDb();
  return queryOne('SELECT * FROM clients WHERE name = ?', [c.name]);
});

ipcMain.handle('db:deleteClient', (_e, id) => {
  db.run('DELETE FROM clients WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ── IPC: time entries (one row per client per day) ──

ipcMain.handle('db:getRange', (_e, { clientId, start, end }) =>
  queryAll('SELECT * FROM time_entries WHERE client_id = ? AND date >= ? AND date <= ? ORDER BY date', [clientId, start, end]));

ipcMain.handle('db:saveDay', (_e, d) => {
  const brk = Number(d.break_hours) || 0;
  const ot = Number(d.overtime_hours) || 0;
  const hours = d.time_in && d.time_out ? hoursBetween(d.time_in, d.time_out, brk) : (Number(d.hours) || 0);
  db.run('DELETE FROM time_entries WHERE client_id = ? AND date = ?', [d.client_id, d.date]);
  if (hours > 0 || d.time_in || d.time_out) {
    db.run('INSERT INTO time_entries (client_id, date, time_in, time_out, break_hours, overtime_hours, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [d.client_id, d.date, d.time_in || '', d.time_out || '', brk, ot, hours, d.description || '']);
  }
  saveDb();
  return queryOne('SELECT * FROM time_entries WHERE client_id = ? AND date = ?', [d.client_id, d.date]) || null;
});

// ── IPC: invoices ──

ipcMain.handle('invoice:info', (_e, { clientId, start, end }) => {
  const existing = queryOne('SELECT * FROM invoices WHERE client_id = ? AND week_start = ? AND period_end = ?', [clientId, start, end]);
  const overlaps = overlapping(clientId, start, end, existing ? start : '');
  if (existing) return { ...existing, existing: true, overlaps };
  const max = queryOne('SELECT MAX(number) AS m FROM invoices').m || 0;
  return { number: max + 1, submitted_on: ymd(new Date()), comments: '', existing: false, overlaps };
});

ipcMain.handle('invoice:history', () =>
  queryAll(`SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.number DESC, i.week_start DESC LIMIT 20`));

ipcMain.handle('invoice:generate', async (_e, { clientId, start, end, number, submittedOn, comments }) => {
  const settings = getSettings();
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) return { error: 'Pick a client first.' };
  const cycle = client.billing_cycle || 'weekly';
  const entries = queryAll('SELECT * FROM time_entries WHERE client_id = ? AND date >= ? AND date <= ? AND hours > 0 ORDER BY date', [clientId, start, end]);
  if (!entries.length) return { error: `No hours logged for this ${PERIOD_NOUN[cycle]}.` };
  if (!settings.your_name) return { error: 'Add your name in Settings first.' };

  const outDir = settings.output_dir || path.join(app.getPath('documents'), 'Invoices');
  let result;
  try {
    result = await generatePeriod({ settings, client, entries, periodStart: start, periodEnd: end, cycle, invoiceNumber: number, submittedOn, comments, outDir, style: getStyle() });
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') return { error: 'A PDF with this name is open in another program. Close it and try again.' };
    throw err;
  }

  // one invoice per (client, period start); re-creating updates it in place
  db.run(`INSERT INTO invoices (client_id, week_start, period_end, cycle, number, submitted_on, comments) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(client_id, week_start) DO UPDATE SET period_end = excluded.period_end, cycle = excluded.cycle,
            number = excluded.number, submitted_on = excluded.submitted_on, comments = excluded.comments`,
    [clientId, start, end, cycle, number, submittedOn, comments || '']);
  saveDb();
  return result;
});

ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));

// ── IPC: output style ──

const pad2 = (n) => String(n).padStart(2, '0');
const previewDir = () => path.join(app.getPath('temp'), 'timetracker-preview');

ipcMain.handle('style:get', () => ({
  style: getStyle(),
  defaults: S.DEFAULT_STYLE,
  presets: S.publicPresets(),
  fonts: S.availableFonts(),
  pageSizes: Object.entries(S.PAGE_SIZES).map(([id, p]) => ({ id, label: p.label })),
  dateFormats: S.DATE_FORMATS,
}));

ipcMain.handle('style:save', (_e, style) => {
  const clean = S.normalizeStyle(style);
  setSetting('output_style', JSON.stringify(clean));
  saveDb();
  return clean;
});

// Copy the chosen logo into the app's data folder so it keeps working if the original moves
ipcMain.handle('style:pickLogo', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const buf = fs.readFileSync(src);
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) return { error: 'That file is not a PNG or JPEG image.' };
  if (buf.length > 5 * 1024 * 1024) return { error: 'Please pick an image under 5 MB.' };
  const dir = path.join(app.getPath('userData'), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('logo')) fs.rmSync(path.join(dir, f), { force: true });
  const dest = path.join(dir, `logo-${Date.now()}.${isPng ? 'png' : 'jpg'}`);
  fs.writeFileSync(dest, buf);
  return { path: dest };
});

// Sample file names for the file-name field
ipcMain.handle('style:fileExample', (_e, style) => {
  const s = getSettings();
  const clean = S.normalizeStyle(style);
  return fileNames(clean, { name: s.your_name || 'Your Name', client: 'Acme Ltd', number: 12, start: '2026-09-14', end: '2026-09-20', range: '09_14 - 09_18' });
});

// Render sample documents with a style that hasn't been saved yet
let previewSeq = 0;
ipcMain.handle('style:preview', async (_e, { style, cycle = 'weekly' }) => {
  const s = getSettings();
  const clients = queryAll('SELECT * FROM clients ORDER BY name');
  const client = clients[0] || { name: 'Acme Ltd', bill_to: 'Acme Ltd\nAccounts Payable', hourly_rate: 25, default_description: 'Consulting' };
  const settings = { ...s, your_name: s.your_name || 'Your Name', payment_method: s.payment_method || 'PayPal:', payment_email: s.payment_email || 'you@example.com' };

  // the most recent Monday-based week (or month) with sample weekday hours
  const now = new Date();
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 7);
  const ymdL = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  let start = mon, end = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  if (cycle === 'monthly') { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); }
  const entries = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    entries.push({ date: ymdL(d), time_in: s.default_time_in || '08:00', time_out: s.default_time_out || '16:00', break_hours: 0, overtime_hours: 0, hours: 8, description: '' });
  }

  const dir = previewDir();
  fs.rmSync(dir, { recursive: true, force: true });
  const outDir = path.join(dir, String(++previewSeq)); // unique folder so the viewer never shows a cached file
  const r = await generatePeriod({
    settings, client, entries, periodStart: ymdL(start), periodEnd: ymdL(end), cycle,
    invoiceNumber: 12, submittedOn: ymdL(now), comments: '', outDir, style,
  });
  return { invoice: r.invoicePath, timesheet: r.timesheetPath, sample: !clients.length };
});

// ── app lifecycle ──

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'TimeTracker',
    autoHideMenuBar: true,
    backgroundColor: '#0f0f1a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  if (process.argv.includes('--dev')) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
  } catch (err) {
    dialog.showErrorBox('TimeTracker failed to start', String((err && err.stack) || err));
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => {
  try { fs.rmSync(previewDir(), { recursive: true, force: true }); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
