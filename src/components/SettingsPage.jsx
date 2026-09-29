import React, { useState, useEffect } from 'react';
import { cycleLabel, shortDate } from '../periods';

export default function SettingsPage({ showToast }) {
  const [s, setS] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    window.api.getSettings().then(setS);
    window.api.invoiceHistory().then(setHistory);
  }, []);

  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });

  const save = async () => {
    setS(await window.api.saveSettings(s));
    showToast('Settings saved');
  };

  const pick = async () => {
    const dir = await window.api.pickFolder();
    if (dir) setS({ ...s, output_dir: dir });
  };

  return (
    <div>
      <header className="page-head"><h1>Settings</h1></header>

      <div className="card narrow">
        <h3>You (shown on both PDFs)</h3>
        <div className="form-group">
          <label>Your name</label>
          <input value={s.your_name || ''} onChange={set('your_name')} placeholder="Jane Doe" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Payment method label</label>
            <input value={s.payment_method || ''} onChange={set('payment_method')} placeholder="e.g. PayPal:" />
          </div>
          <div className="form-group">
            <label>Payment email / account</label>
            <input value={s.payment_email || ''} onChange={set('payment_email')} placeholder="you@example.com" />
          </div>
        </div>

        <h3 className="mt">Usual hours</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Time in</label>
            <input type="time" value={s.default_time_in || ''} onChange={set('default_time_in')} />
          </div>
          <div className="form-group">
            <label>Time out</label>
            <input type="time" value={s.default_time_out || ''} onChange={set('default_time_out')} />
          </div>
        </div>

        <h3 className="mt">Save PDFs to</h3>
        <div className="folder">
          <code>{s.output_dir}</code>
          <button className="btn btn-sm btn-outline" onClick={pick}>Change…</button>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={save}>Save settings</button>
        </div>
      </div>

      {history.length > 0 && (
        <div className="card narrow">
          <h3>Recent invoices</h3>
          <table>
            <thead><tr><th>#</th><th>Period</th><th>Cycle</th><th>Client</th><th>Submitted</th></tr></thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id}><td>{h.number}</td><td>{shortDate(h.week_start)} – {shortDate(h.period_end || h.week_start)}</td><td className="muted">{cycleLabel(h.cycle)}</td><td>{h.client_name}</td><td>{h.submitted_on ? shortDate(h.submitted_on) : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
