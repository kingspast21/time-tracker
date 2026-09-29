import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getWeekRange, shiftWeek, weekDays, weekLabel, hoursBetween, money, ymd, parse } from '../dates';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const blank = { time_in: '', time_out: '', break_hours: '', overtime_hours: '', description: '' };

// Default the week to last week on Mon/Tue (when you're usually invoicing the week just finished)
function initialWeek() {
  const now = new Date();
  const w = getWeekRange(now);
  return now.getDay() === 1 || now.getDay() === 2 ? shiftWeek(w, -1) : w;
}

export default function WeekPage({ showToast, settings, goSettings }) {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [week, setWeek] = useState(initialWeek);
  const [rows, setRows] = useState({});          // date -> row
  const [info, setInfo] = useState(null);        // invoice number / submitted / comments
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const saveTimers = useRef({});

  const client = clients.find(c => c.id === clientId);
  const days = useMemo(() => weekDays(week), [week]);

  useEffect(() => {
    window.api.getClients().then(cs => {
      setClients(cs);
      if (cs.length && !cs.some(c => c.id === clientId)) setClientId(cs[0].id);
    });
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setResult(null);
    window.api.getWeek({ clientId, weekStart: week.start, weekEnd: week.end }).then(list => {
      const m = {};
      for (const e of list) m[e.date] = {
        time_in: e.time_in || '', time_out: e.time_out || '',
        break_hours: e.break_hours ? String(e.break_hours) : '',
        overtime_hours: e.overtime_hours ? String(e.overtime_hours) : '',
        description: e.description || '', hours: e.hours,
      };
      setRows(m);
    });
    window.api.invoiceInfo({ clientId, weekStart: week.start }).then(setInfo);
  }, [clientId, week]);

  const rowHours = (r) => r ? (r.time_in && r.time_out ? hoursBetween(r.time_in, r.time_out, r.break_hours) : Number(r.hours) || 0) : 0;

  const persist = (date, r) => {
    clearTimeout(saveTimers.current[date]);
    saveTimers.current[date] = setTimeout(() => {
      window.api.saveDay({ client_id: clientId, date, ...r });
    }, 350);
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
    days.slice(0, 5).forEach(d => {
      const k = ymd(d);
      if (next[k]?.time_in || next[k]?.time_out) return;
      next[k] = { ...blank, ...(next[k] || {}), time_in: tin, time_out: tout };
      window.api.saveDay({ client_id: clientId, date: k, ...next[k] });
    });
    setRows(next);
    showToast(`Filled empty weekdays with ${tin}–${tout}`);
  };

  const totalHours = days.reduce((s, d) => s + rowHours(rows[ymd(d)]), 0);
  const totalBreak = days.reduce((s, d) => s + (Number(rows[ymd(d)]?.break_hours) || 0), 0);
  const rate = client?.hourly_rate || 0;
  const daysWorked = days.filter(d => rowHours(rows[ymd(d)]) > 0).length;

  const generate = async () => {
    // flush pending saves first
    for (const k of Object.keys(saveTimers.current)) clearTimeout(saveTimers.current[k]);
    await Promise.all(Object.entries(rows).map(([date, r]) => window.api.saveDay({ client_id: clientId, date, ...r })));
    setBusy(true);
    try {
      const r = await window.api.generate({
        clientId, weekStart: week.start, weekEnd: week.end,
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

  const fileName = (p) => p.split(/[\\/]/).pop();

  return (
    <div className="week-page">
      <header className="page-head">
        <div>
          <h1>Week of {weekLabel(week)}</h1>
          <p className="muted">
            {daysWorked} day{daysWorked === 1 ? '' : 's'} · {totalHours.toFixed(2)} h · {money(totalHours * rate)}
            {info?.existing && <span className="pill">Invoice #{info.number} already sent</span>}
          </p>
        </div>
        <div className="head-controls">
          {clients.length > 1 && (
            <select value={clientId || ''} onChange={e => setClientId(Number(e.target.value))}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="week-nav">
            <button className="btn btn-outline" onClick={() => setWeek(w => shiftWeek(w, -1))} aria-label="Previous week">‹</button>
            <button className="btn btn-outline" onClick={() => setWeek(getWeekRange())}>This week</button>
            <button className="btn btn-outline" onClick={() => setWeek(w => shiftWeek(w, 1))} aria-label="Next week">›</button>
          </div>
        </div>
      </header>

      <div className="grid-2">
        <section className="card">
          <div className="card-header">
            <h3>Time sheet</h3>
            <button className="btn btn-sm btn-outline" onClick={fillWeekdays}>
              Fill Mon–Fri {settings?.default_time_in || '08:00'}–{settings?.default_time_out || '16:00'}
            </button>
          </div>
          <table className="ts">
            <thead>
              <tr>
                <th>Day</th><th>Time in</th><th>Time out</th><th>Break (h)</th><th>Overtime (h)</th><th className="num">Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => {
                const k = ymd(d);
                const r = rows[k] || blank;
                const h = rowHours(rows[k]);
                const weekend = i >= 5;
                return (
                  <tr key={k} className={weekend ? 'weekend' : ''}>
                    <td className="day"><b>{DAY[i]}</b> <span className="muted">{d.getDate()}</span></td>
                    <td><input type="time" value={r.time_in} onChange={e => update(k, 'time_in', e.target.value)} /></td>
                    <td><input type="time" value={r.time_out} onChange={e => update(k, 'time_out', e.target.value)} /></td>
                    <td><input type="number" min="0" step="0.25" value={r.break_hours} placeholder="0" onChange={e => update(k, 'break_hours', e.target.value)} /></td>
                    <td><input type="number" min="0" step="0.25" value={r.overtime_hours} placeholder="0" onChange={e => update(k, 'overtime_hours', e.target.value)} /></td>
                    <td className="num">{h ? h.toFixed(2) : <span className="muted">—</span>}</td>
                    <td>{rows[k] && <button className="btn-icon" title="Clear day" onClick={() => clearDay(k)}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td>{totalBreak ? totalBreak.toFixed(2) : ''}</td>
                <td></td>
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
