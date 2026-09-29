const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { generateWeekly } = require('./pdf');

let db;
let dbPath;

// Optional: keep data somewhere else (e.g. a throwaway profile for testing)
if (process.env.TIMETRACKER_DATA_DIR) app.setPath('userData', process.env.TIMETRACKER_DATA_DIR);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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
  addColumn('time_entries', 'time_in', "TEXT DEFAULT ''");
  addColumn('time_entries', 'time_out', "TEXT DEFAULT ''");
  addColumn('time_entries', 'break_hours', 'REAL DEFAULT 0');
  addColumn('time_entries', 'overtime_hours', 'REAL DEFAULT 0');

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
  if (!getSettings().output_dir) setSetting('output_dir', path.join(app.getPath('documents'), 'Invoices'));
  saveDb();
}

function getSettings() {
  const out = {};
  for (const r of queryAll('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}
function setSetting(k, v) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, v ?? '']);
}

// ── IPC: settings ──

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, s) => {
  for (const [k, v] of Object.entries(s)) setSetting(k, String(v ?? ''));
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
  const vals = [c.name, Number(c.hourly_rate) || 0, c.bill_to || '', c.default_description || ''];
  if (c.id) db.run('UPDATE clients SET name = ?, hourly_rate = ?, bill_to = ?, default_description = ? WHERE id = ?', [...vals, c.id]);
  else db.run('INSERT INTO clients (name, hourly_rate, bill_to, default_description) VALUES (?, ?, ?, ?)', vals);
  saveDb();
  return queryOne('SELECT * FROM clients WHERE name = ?', [c.name]);
});

ipcMain.handle('db:deleteClient', (_e, id) => {
  db.run('DELETE FROM clients WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ── IPC: time entries (one row per client per day) ──

ipcMain.handle('db:getWeek', (_e, { clientId, weekStart, weekEnd }) =>
  queryAll('SELECT * FROM time_entries WHERE client_id = ? AND date >= ? AND date <= ? ORDER BY date', [clientId, weekStart, weekEnd]));

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

ipcMain.handle('invoice:info', (_e, { clientId, weekStart }) => {
  const existing = queryOne('SELECT * FROM invoices WHERE client_id = ? AND week_start = ?', [clientId, weekStart]);
  if (existing) return { ...existing, existing: true };
  const max = queryOne('SELECT MAX(number) AS m FROM invoices').m || 0;
  return { number: max + 1, submitted_on: ymd(new Date()), comments: '', existing: false };
});

ipcMain.handle('invoice:history', () =>
  queryAll(`SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.week_start DESC LIMIT 20`));

ipcMain.handle('invoice:generate', async (_e, { clientId, weekStart, weekEnd, number, submittedOn, comments }) => {
  const settings = getSettings();
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
  const entries = queryAll('SELECT * FROM time_entries WHERE client_id = ? AND date >= ? AND date <= ? AND hours > 0 ORDER BY date', [clientId, weekStart, weekEnd]);
  if (!client) return { error: 'Pick a client first.' };
  if (!entries.length) return { error: 'No hours logged for this week.' };
  if (!settings.your_name) return { error: 'Add your name in Settings first.' };

  const outDir = settings.output_dir || path.join(app.getPath('documents'), 'Invoices');
  let result;
  try {
    result = await generateWeekly({ settings, client, entries, weekStart, invoiceNumber: number, submittedOn, comments, outDir });
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') return { error: 'A PDF with this name is open in another program. Close it and try again.' };
    throw err;
  }

  db.run(`INSERT INTO invoices (client_id, week_start, number, submitted_on, comments) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(client_id, week_start) DO UPDATE SET number = excluded.number, submitted_on = excluded.submitted_on, comments = excluded.comments`,
    [clientId, weekStart, number, submittedOn, comments || '']);
  saveDb();
  return result;
});

ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));

// ── app lifecycle ──

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
