// Local-time date helpers (avoid toISOString, which shifts to UTC)
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export function getWeekRange(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: ymd(monday), end: ymd(sunday), monday };
}

export function shiftWeek(week, dir) {
  const d = new Date(week.monday);
  d.setDate(d.getDate() + dir * 7);
  return getWeekRange(d);
}

export function weekDays(week) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week.monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function weekLabel(week) {
  const a = week.monday;
  const b = new Date(a); b.setDate(a.getDate() + 6);
  const left = `${MON[a.getMonth()]} ${a.getDate()}`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MON[b.getMonth()]} ${b.getDate()}`;
  return `${left} – ${right}, ${b.getFullYear()}`;
}

export function hoursBetween(tin, tout, brk) {
  if (!tin || !tout) return 0;
  const [h1, m1] = tin.split(':').map(Number);
  const [h2, m2] = tout.split(':').map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return Math.max(0, Math.round((mins / 60 - (Number(brk) || 0)) * 100) / 100);
}

export const money = (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
