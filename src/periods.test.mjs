// Period math self-test: node --experimental-default-type=module or run via vite-node. Run: node src/periods.test.mjs
import assert from 'node:assert/strict';
import { periodFor, shiftPeriod, initialPeriod, periodDays, weekChunks, periodLabel } from './periods.js';

const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const span = (p) => `${p.start}..${p.end}`;

// weekly
assert.equal(span(periodFor({ billing_cycle: 'weekly' }, D('2026-09-29'))), '2026-09-28..2026-10-04');
assert.equal(span(periodFor({}, D('2026-10-04'))), '2026-09-28..2026-10-04'); // Sunday stays in its week
assert.equal(span(shiftPeriod({}, periodFor({}, D('2026-09-29')), -1)), '2026-09-21..2026-09-27');

// monthly incl. leap year + year rollover
const M = { billing_cycle: 'monthly' };
assert.equal(span(periodFor(M, D('2028-02-10'))), '2028-02-01..2028-02-29');
assert.equal(span(shiftPeriod(M, periodFor(M, D('2026-12-05')), 1)), '2027-01-01..2027-01-31');
assert.equal(span(shiftPeriod(M, periodFor(M, D('2026-03-31')), -1)), '2026-02-01..2026-02-28');

// semi-monthly
const S = { billing_cycle: 'semimonthly' };
assert.equal(span(periodFor(S, D('2026-09-15'))), '2026-09-01..2026-09-15');
assert.equal(span(periodFor(S, D('2026-09-16'))), '2026-09-16..2026-09-30');
assert.equal(span(shiftPeriod(S, periodFor(S, D('2026-09-20')), 1)), '2026-10-01..2026-10-15');
assert.equal(span(shiftPeriod(S, periodFor(S, D('2026-10-03')), -1)), '2026-09-16..2026-09-30');

// bi-weekly, anchored; dates before the anchor still land on the grid
const B = { billing_cycle: 'biweekly', cycle_anchor: '2026-09-14' };
assert.equal(span(periodFor(B, D('2026-09-27'))), '2026-09-14..2026-09-27');
assert.equal(span(periodFor(B, D('2026-09-28'))), '2026-09-28..2026-10-11');
assert.equal(span(periodFor(B, D('2026-09-13'))), '2026-08-31..2026-09-13');
assert.equal(span(shiftPeriod(B, periodFor(B, D('2026-09-20')), 1)), '2026-09-28..2026-10-11');
// DST-safe: 14-day steps across a DST boundary (US Nov) keep day alignment
assert.equal(span(periodFor(B, D('2026-11-09'))), '2026-11-09..2026-11-22');

// initialPeriod: first 2 days of a period show the one just finished
assert.equal(span(initialPeriod(M, D('2026-10-01'))), '2026-09-01..2026-09-30');
assert.equal(span(initialPeriod(M, D('2026-10-03'))), '2026-10-01..2026-10-31');
assert.equal(span(initialPeriod({}, D('2026-09-29'))), '2026-09-21..2026-09-27'); // Tuesday -> last week

// days & chunks
const sep = periodFor(M, D('2026-09-10'));
assert.equal(periodDays(sep).length, 30);
const ch = weekChunks(sep);
assert.equal(ch.length, 5); // Sep 1 2026 is Tuesday: Aug31-wk .. Sep28-wk
assert.deepEqual(ch.map(c => c.days.length), [6, 7, 7, 7, 3]);
assert.equal(weekChunks(periodFor({}, D('2026-09-29'))).length, 1);

assert.equal(periodLabel(sep), 'September 2026');
assert.equal(periodLabel(periodFor(B, D('2026-09-28'))), 'Sep 28 – Oct 11, 2026');
assert.equal(periodLabel(periodFor({}, D('2026-12-30'))), 'Dec 28, 2026 – Jan 3, 2027');
console.log('periods: all tests passed');
