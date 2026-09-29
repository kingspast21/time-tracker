import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  periodFor, shiftPeriod, initialPeriod, weekChunks, periodLabel, periodNoun, cycleLabel, shortDate,
  hoursBetween, money, ymd,
} from '../periods';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const blank = { time_in: '', time_out: '', break_hours: '', overtime_hours: '', description: '' };
const rowHours = (r) => r ? (r.time_in && r.time_out ? hoursBetween(r.time_in, r.time_out, r.break_hours) : Number(r.hours) || 0) : 0;

export default function PeriodPage({ showToast, settings, goSettings }) {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [period, setPeriod] = useState(null);
  const [rows, setRows] = useState({});   // date -> row
  const [info, setInfo] = useState(null); // invoice number / submitted / comments / overlaps
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const saveTimers = useRef({});

  const client = clients.find(c => c.id === clientId);
  const cycle = client?.billing_cycle || 'weekly';
  const noun = periodNoun(cycle);
  const chunks = useMemo(() => (period ? weekChunks(period) : []), [period]);
  const days = useMemo(() => chunks.flatMap(c => c.days), [chunks]);

  useEffect(() => {
    window.api.getClients().then(cs => {
      setClients(cs);
      if (cs.length) setClientId(id => (cs.some(c => c.id === id) ? id : cs[0].id));
    });
  }, []);

  // switching client (or its cycle) resets to that client's current invoicing period
  useEffect(() => { if (client) setPeriod(initialPeriod(client)); }, [clientId, client?.billing_cycle, client?.cycle_anchor]);

  useEffect(() => {
    if (!clientId || !period) return;
    setResult(null);
    window.api.getRange({ clientId, start: period.start, end: period.end }).then(list => {
      const m = {};
      for (const e of list) m[e.date] = {
        time_in: e.time_in || '', time_out: e.time_out || '',
        break_hours: e.break_hours ? String(e.break_hours) : '',
        overtime_hours: e.overtime_hours ? String(e.overtime_hours) : '',
        description: e.description || '', hours: e.hours,
      };
      setRows(m);
    });
    window.api.invoiceInfo({ clientId, start: period.start, end: period.end }).then(setInfo);
  }, [clientId, period?.start, period?.end]);

  const persist = (date, r) => {
    clearTimeout(saveTimers.current[date]);
    saveTimers.current[date] = setTimeout(() => window.api.saveDay({ client_id: clientId, date, ...r }), 350);
  };

  const update = (date, field, value) => {
    setRows(prev => {
      const r = { ...blank, ...(prev[date] || {}), [field]: value };
      persist(date, r);
      return { ...prev, [date]: r };
    });
  };

  const clearDay = (date) => {
    setRows(prev => { const n = { ...prev }; delete n[date]; return n; });
    clearTimeout(saveTimers.current[date]);
    window.api.saveDay({ client_id: clientId, date });
  };

  const fillWeekdays = () => {
    const tin = settings?.default_time_in || '08:00';
    const tout = settings?.default_time_out || '16:00';
    const next = { ...rows };
    let n = 0;
    for (const d of days) {
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const k = ymd(d);
      if (next[k]?.time_in || next[k]?.time_out) continue;
      next[k] = { ...blank, ...(next[k] || {}), time_in: tin, time_out: tout };
      window.api.saveDay({ client_id: clientId, date: k, ...next[k] });
      n++;
    }
    setRows(next);
    showToast(n ? `Filled ${n} empty weekday${n === 1 ? '' : 's'} with ${tin}–${tout}` : 'Every weekday already has times');
  };

  const sum = (list, f) => list.reduce((s, d) => s + f(rows[ymd(d)]), 0);
  const totalHours = sum(days, rowHours);
  const totalBreak = sum(days, r => Number(r?.break_hours) || 0);
  const totalOT = sum(days, r => Number(r?.overtime_hours) || 0);
  const rate = client?.hourly_rate || 0;
  const daysWorked = days.filter(d => rowHours(rows[ymd(d)]) > 0).length;
  const multi = chunks.length > 1;

  const generate = async () => {
    for (const k of Object.keys(saveTimers.current)) clearTimeout(saveTimers.current[k]);
    await Promise.all(Object.entries(rows).map(([date, r]) => window.api.saveDay({ client_id: clientId, date, ...r })));
    setBusy(true);
    try {
      const r = await window.api.generate({
        clientId, start: period.start, end: period.end,
        number: Number(info.number), submittedOn: info.submitted_on, comments: info.comments,
      });
      if (r.error) { showToast(r.error, 'err'); return; }
      setResult(r);
      setInfo(i => ({ ...i, existing: true }));
      showToast('Invoice and time sheet created');
    } catch (e) {
      showToast('Could not create the PDFs: ' + e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  if (!clients.length) return (
    <div className="empty">
      <h2>Welcome to TimeTracker</h2>
      <p>Two quick steps before your first invoice:</p>
      <ol className="steps">
        <li>Add your name and payment details in <a onClick={goSettings}>Settings</a>.</li>
        <li>Add the person or company you invoice under <b>Clients</b>.</li>
      </ol>
    </div>
  );
  if (!period) return null;

  const fileName = (p) => p.split(/[\\/]/).pop();
  const title = cycle === 'weekly' ? `Week of ${periodLabel(period)}` : periodLabel(period);
  const current = periodFor(client);

  return (
    <div className="week-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{cycleLabel(cycle)} invoice{client && clients.length > 1 ? ` · ${client.name}` : ''}</div>
          <h1>{title}</h1>
          <p className="muted">
            {daysWorked} day{daysWorked === 1 ? '' : 's'} · {totalHours.toFixed(2)} h · {money(totalHours * rate)}
            {info?.existing && <span className="pill">Invoice #{info.number} already sent</span>}
          </p>
        </div>
        <div className="head-controls">
          {clients.length > 1 && (
            <select value={clientId || ''} onChange={e => setClientId(Number(e.target.value))} aria-label="Client">
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="week-nav">
            <button className="btn btn-outline" onClick={() => setPeriod(p => shiftPeriod(client, p, -1))} aria-label={`Previous ${noun}`}>‹</button>
            <button className="btn btn-outline" disabled={period.start === current.start} onClick={() => setPeriod(current)}>
              This {noun}
            </button>
            <button className="btn btn-outline" onClick={() => setPeriod(p => shiftPeriod(client, p, 1))} aria-label={`Next ${noun}`}>›</button>
          </div>
        </div>
      </header>

      {info?.overlaps?.length > 0 && (
        <div className="notice">
          Some of these dates are already on{' '}
          {info.overlaps.map((o, i) => (
            <span key={o.id}>{i ? ', ' : ''}invoice #{o.number} ({shortDate(o.week_start)} – {shortDate(o.period_end)})</span>
          ))}. Check you're not billing those days twice.
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h3>Time sheet</h3>
            <button className="btn btn-sm btn-outline" onClick={fillWeekdays}>
              Fill weekdays {settings?.default_time_in || '08:00'}–{settings?.default_time_out || '16:00'}
            </button>
          </div>
          <table className="ts">
            <thead>
              <tr>
                <th>Day</th><th>Time in</th><th>Time out</th><th>Break (h)</th><th>Overtime (h)</th><th className="num">Total</th><th></th>
              </tr>
            </thead>
            {chunks.map((c, ci) => {
              const wkHours = sum(c.days, rowHours);
              return (
                <tbody key={c.key} className={multi ? 'wk' : ''}>
                  {multi && (
                    <tr className="wk-head">
                      <td colSpan={5}>Week {ci + 1} <span className="muted">· {shortDate(ymd(c.days[0])).replace(/, \d{4}$/, '')} – {shortDate(ymd(c.days[c.days.length - 1])).replace(/, \d{4}$/, '')}</span></td>
                      <td className="num">{wkHours ? wkHours.toFixed(2) : ''}</td>
                      <td></td>
                    </tr>
                  )}
                  {c.days.map(d => {
                    const k = ymd(d);
                    const r = rows[k] || blank;
                    const h = rowHours(rows[k]);
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <tr key={k} className={weekend ? 'weekend' : ''}>
                        <td className="day"><b>{DOW[d.getDay()]}</b> <span className="muted">{d.getDate()}</span></td>
                        <td><input type="time" aria-label={`${k} time in`} value={r.time_in} onChange={e => update(k, 'time_in', e.target.value)} /></td>
                        <td><input type="time" aria-label={`${k} time out`} value={r.time_out} onChange={e => update(k, 'time_out', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.25" aria-label={`${k} break`} value={r.break_hours} placeholder="0" onChange={e => update(k, 'break_hours', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.25" aria-label={`${k} overtime`} value={r.overtime_hours} placeholder="0" onChange={e => update(k, 'overtime_hours', e.target.value)} /></td>
                        <td className="num">{h ? h.toFixed(2) : <span className="muted">—</span>}</td>
                        <td>{rows[k] && <button className="btn-icon" title="Clear day" onClick={() => clearDay(k)}>✕</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
            <tfoot>
              <tr>
                <td colSpan={3}>{multi ? `${cycleLabel(cycle)} total` : 'Total'}</td>
                <td>{totalBreak ? totalBreak.toFixed(2) : ''}</td>
                <td>{totalOT ? totalOT.toFixed(2) : ''}</td>
                <td className="num">{totalHours.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <p className="hint">Total = time out − time in − break. Saved automatically.</p>
        </section>

        <aside className="card invoice-card">
          <h3>Invoice</h3>
          {client && (
            <dl className="kv">
              <dt>Bill to</dt><dd>{(client.bill_to || client.name).split('\n').map((l, i) => <div key={i}>{l}</div>)}</dd>
              <dt>Rate</dt><dd>{money(rate)}/h · {client.default_description || '—'}</dd>
              <dt>Period</dt><dd>{shortDate(period.start)} – {shortDate(period.end)}</dd>
            </dl>
          )}
          {info && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Invoice #</label>
                  <input type="number" min="1" value={info.number} onChange={e => setInfo({ ...info, number: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Submitted on</label>
                  <input type="date" value={info.submitted_on} onChange={e => setInfo({ ...info, submitted_on: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Time sheet comments (optional)</label>
                <textarea value={info.comments || ''} onChange={e => setInfo({ ...info, comments: e.target.value })} placeholder="e.g. Public holiday on Monday" />
              </div>
            </>
          )}
          <div className="total-line">
            <span>{totalHours.toFixed(2)} h × {money(rate)}</span>
            <strong>{money(totalHours * rate)}</strong>
          </div>
          {!settings?.your_name && <p className="warn">Add your name in <a onClick={goSettings}>Settings</a> first.</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !totalHours || !info} onClick={generate}>
            {busy ? 'Creating…' : info?.existing ? 'Re-create invoice + time sheet' : 'Create invoice + time sheet'}
          </button>

          {result && (
            <div className="files">
              {[['Invoice', result.invoicePath], ['Time sheet', result.timesheetPath]].map(([label, p]) => (
                <div className="file" key={p}>
                  <div>
                    <div className="file-label">{label}</div>
                    <div className="file-name" title={p}>{fileName(p)}</div>
                  </div>
                  <button className="btn btn-sm btn-outline" onClick={() => window.api.openPath(p)}>Open</button>
                </div>
              ))}
              <button className="btn btn-sm btn-ghost" onClick={() => window.api.reveal(result.invoicePath)}>Show in folder</button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
