import React, { useState, useEffect } from 'react';
import { CYCLES, cycleLabel, money, mondayOf, ymd } from '../periods';

const empty = { name: '', hourly_rate: '', bill_to: '', default_description: '', billing_cycle: 'weekly', cycle_anchor: '' };

export default function ClientsPage({ showToast }) {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState(null);

  const load = () => window.api.getClients().then(setClients);
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim() || form.hourly_rate === '') return showToast('Name and rate are required', 'err');
    try {
      await window.api.saveClient({ ...form, name: form.name.trim(), hourly_rate: parseFloat(form.hourly_rate) });
      showToast(form.id ? 'Client updated' : 'Client added');
      setForm(null);
      load();
    } catch (e) {
      showToast(/UNIQUE/.test(e.message) ? 'A client with that name already exists' : e.message, 'err');
    }
  };

  const remove = async (c) => {
    if (!confirm(`Delete ${c.name} and all of their logged hours?`)) return;
    await window.api.deleteClient(c.id);
    showToast('Client deleted');
    load();
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setCycle = (id) => setForm(f => ({
    ...f, billing_cycle: id,
    cycle_anchor: id === 'biweekly' && !f.cycle_anchor ? ymd(mondayOf(new Date())) : f.cycle_anchor,
  }));

  return (
    <div>
      <header className="page-head">
        <h1>Clients</h1>
        <button className="btn btn-primary" onClick={() => setForm({ ...empty })}>Add client</button>
      </header>

      <div className="card">
        {clients.length === 0 ? <p className="muted center">No clients yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Invoice for</th><th>Rate</th><th>Invoiced</th><th>Description</th><th style={{ width: 140 }}></th></tr></thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td className="muted">{(c.bill_to || c.name).split('\n').join(', ')}</td>
                  <td>{money(c.hourly_rate)}/h</td>
                  <td>{cycleLabel(c.billing_cycle)}</td>
                  <td className="muted">{c.default_description}</td>
                  <td className="actions">
                    <button className="btn btn-sm btn-outline" onClick={() => setForm({ ...empty, ...c, hourly_rate: String(c.hourly_rate) })}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{form.id ? 'Edit client' : 'New client'}</h3>
            <div className="form-group">
              <label>Client name</label>
              <input autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Acme Ltd" />
            </div>
            <div className="form-group">
              <label>"Invoice for" block (one line per name)</label>
              <textarea rows={3} value={form.bill_to} onChange={set('bill_to')} placeholder={'Jane Doe\nAcme Ltd'} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Hourly rate ($)</label>
                <input type="number" step="0.01" min="0" value={form.hourly_rate} onChange={set('hourly_rate')} />
              </div>
              <div className="form-group">
                <label>Line description</label>
                <input value={form.default_description} onChange={set('default_description')} placeholder="e.g. Consulting" />
              </div>
            </div>

            <div className="form-group">
              <label>How often you invoice</label>
              <div className="seg" role="radiogroup" aria-label="Billing cycle">
                {CYCLES.map(c => (
                  <button key={c.id} type="button" role="radio" aria-checked={form.billing_cycle === c.id}
                    className={form.billing_cycle === c.id ? 'on' : ''} onClick={() => setCycle(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="hint">{CYCLES.find(c => c.id === form.billing_cycle)?.hint}</p>
            </div>
            {form.billing_cycle === 'biweekly' && (
              <div className="form-group">
                <label>First day of a pay period</label>
                <input type="date" value={form.cycle_anchor || ''} onChange={set('cycle_anchor')} />
                <p className="hint">Pick any Monday a fortnight started on. Other dates snap to that week's Monday.</p>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
