// Billing-period math. All dates are local (no toISOString, which shifts to UTC).
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY_MS = 86400000;
const diffDays = (a, b) => Math.round((dayOnly(a) - dayOnly(b)) / DAY_MS);

export const CYCLES = [
  { id: 'weekly', label: 'Weekly', hint: 'Monday to Sunday' },
  { id: 'biweekly', label: 'Bi-weekly', hint: 'Every 14 days from a start date' },
  { id: 'semimonthly', label: 'Semi-monthly', hint: '1st to 15th, then 16th to end of month' },
  { id: 'monthly', label: 'Monthly', hint: '1st to end of month' },
];
export const cycleLabel = (id) => (CYCLES.find(c => c.id === id) || CYCLES[0]).label;
export const periodNoun = (id) => ({ weekly: 'week', biweekly: 'fortnight', semimonthly: 'half-month', monthly: 'month' }[id] || 'week');

export function mondayOf(date) {
  const d = dayOnly(date);
  return addDays(d, -((d.getDay() + 6) % 7));
}

function make(cycle, start, end) {
  return { cycle, start: ymd(start), end: ymd(end), startDate: start, endDate: end };
}

// The period that contains `date` for the client's billing cycle.
export function periodFor(client, date = new Date()) {
  const cycle = client?.billing_cycle || 'weekly';
  const d = dayOnly(date);
  if (cycle === 'monthly') {
    return make(cycle, new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  if (cycle === 'semimonthly') {
    return d.getDate() <= 15
      ? make(cycle, new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth(), 15))
      : make(cycle, new Date(d.getFullYear(), d.getMonth(), 16), new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  if (cycle === 'biweekly') {
    const anchor = client?.cycle_anchor ? parse(client.cycle_anchor) : mondayOf(d);
    const k = Math.floor(diffDays(d, anchor) / 14);
    const start = addDays(anchor, k * 14);
    return make(cycle, start, addDays(start, 13));
  }
  const mon = mondayOf(d);
  return make('weekly', mon, addDays(mon, 6));
}

export const shiftPeriod = (client, p, dir) =>
  periodFor(client, dir < 0 ? addDays(p.startDate, -1) : addDays(p.endDate, 1));

// Open on the period just finished if the current one started in the last 2 days (invoicing time).
export function initialPeriod(client, today = new Date()) {
  const cur = periodFor(client, today);
  return diffDays(today, cur.startDate) < 2 ? shiftPeriod(client, cur, -1) : cur;
}

export function periodDays(p) {
  const out = [];
  for (let d = p.startDate; d <= p.endDate; d = addDays(d, 1)) out.push(d);
  return out;
}

// Split the period into Monday-based week chunks (for display and the timesheet).
export function weekChunks(p) {
  const chunks = [];
  for (const d of periodDays(p)) {
    const key = ymd(mondayOf(d));
    let c = chunks[chunks.length - 1];
    if (!c || c.key !== key) { c = { key, monday: mondayOf(d), days: [] }; chunks.push(c); }
    c.days.push(d);
  }
  return chunks;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function periodLabel(p) {
  const a = p.startDate, b = p.endDate;
  if (p.cycle === 'monthly') return `${MONTH[a.getMonth()]} ${a.getFullYear()}`;
  const left = `${MON[a.getMonth()]} ${a.getDate()}`;
  if (a.getFullYear() !== b.getFullYear()) return `${left}, ${a.getFullYear()} – ${MON[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MON[b.getMonth()]} ${b.getDate()}`;
  return `${left} – ${right}, ${b.getFullYear()}`;
}
export const shortDate = (s) => { const d = parse(s); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };

export function hoursBetween(tin, tout, brk) {
  if (!tin || !tout) return 0;
  const [h1, m1] = tin.split(':').map(Number);
  const [h2, m2] = tout.split(':').map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return Math.max(0, Math.round((mins / 60 - (Number(brk) || 0)) * 100) / 100);
}

export const money = (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
