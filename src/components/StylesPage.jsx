import React, { useState, useEffect, useRef, useMemo } from 'react';

const COLOR_GROUPS = [
  { title: 'Invoice', keys: [['accent', 'Accent bar & date'], ['heading', 'Section labels'], ['text', 'Text'], ['muted', 'Secondary text'], ['total', 'Total amount'], ['rule', 'Divider lines'], ['stripe', 'Row stripe']] },
  { title: 'Timesheet', keys: [['tsTitle', 'Title bar'], ['tsHeader', 'Header & totals'], ['tsDay', 'Day & total columns'], ['tsBorder', 'Grid lines']] },
];
const FONT_SLOTS = [['invoice', 'Invoice'], ['note', 'Footer notes'], ['timesheet', 'Timesheet']];
const TOKENS = ['{name}', '{type}', '{range}', '{number}', '{client}', '{start}', '{end}'];
const CURRENCIES = ['$', '₱', '€', '£', '¥', '₹', 'A$', 'C$', 'USD ', 'PHP '];

// the look = fonts + colours + stripes; it's what presets set and what "custom" means
const LOOK_KEYS = ['fonts', 'colors', 'stripes'];
const sameLook = (a, b) => LOOK_KEYS.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^%3A|\/([A-Za-z])%3A/, (m, d) => (d ? `/${d}:` : m));

function Swatch({ value, onChange, label }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (v) => { const x = v.trim().replace(/^([0-9a-f]{6})$/i, '#$1'); if (/^#[0-9a-f]{6}$/i.test(x)) onChange(x.toUpperCase()); else setText(value); };
  const typing = (v) => { setText(v); const x = v.trim().replace(/^([0-9a-f]{6})$/i, '#$1'); if (/^#[0-9a-f]{6}$/i.test(x)) onChange(x.toUpperCase()); };
  return (
    <label className="swatch">
      <input type="color" value={value} onChange={e => onChange(e.target.value.toUpperCase())} aria-label={label} />
      <span className="swatch-label">{label}</span>
      <input className="hex" value={text} spellCheck={false} maxLength={7} aria-label={`${label} hex`}
        onChange={e => typing(e.target.value)} onBlur={e => commit(e.target.value)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
    </label>
  );
}

export default function StylesPage({ showToast }) {
  const [meta, setMeta] = useState(null);     // presets, fonts, options
  const [saved, setSaved] = useState(null);   // last saved style
  const [style, setStyle] = useState(null);   // working copy
  const [doc, setDoc] = useState('invoice');
  const [cycle, setCycle] = useState('weekly');
  const [preview, setPreview] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [names, setNames] = useState(null);
  const seq = useRef(0);

  useEffect(() => {
    window.api.getStyle().then(m => { setMeta(m); setSaved(m.style); setStyle(m.style); });
  }, []);

  // live preview, debounced; ignore responses that arrive out of order
  useEffect(() => {
    if (!style) return;
    const id = ++seq.current;
    setRendering(true);
    const h = setTimeout(async () => {
      try {
        const [p, n] = await Promise.all([window.api.previewStyle({ style, cycle }), window.api.fileExample(style)]);
        if (id === seq.current) { setPreview(p); setNames(n); }
      } catch (e) {
        if (id === seq.current) showToast('Preview failed: ' + e.message, 'err');
      } finally {
        if (id === seq.current) setRendering(false);
      }
    }, 350);
    return () => clearTimeout(h);
  }, [style, cycle]);

  const dirty = useMemo(() => style && saved && JSON.stringify(style) !== JSON.stringify(saved), [style, saved]);
  if (!meta || !style) return null;

  const activePreset = meta.presets.find(p => sameLook(style, p));

  const update = (patch) => setStyle(s => {
    const next = { ...s, ...patch };
    const match = meta.presets.find(p => sameLook(next, p));
    return { ...next, preset: match ? match.id : 'custom' };
  });
  const setColor = (k, v) => update({ colors: { ...style.colors, [k]: v } });
  const setFont = (k, v) => update({ fonts: { ...style.fonts, [k]: v } });
  const applyPreset = (p) => update({ fonts: { ...p.fonts }, colors: { ...p.colors }, stripes: p.stripes });

  const save = async () => {
    const clean = await window.api.saveStyle(style);
    setSaved(clean); setStyle(clean);
    showToast('Style saved. New PDFs will use it.');
  };
  const pickLogo = async () => {
    const r = await window.api.pickLogo();
    if (!r) return;
    if (r.error) return showToast(r.error, 'err');
    update({ logo: r.path });
  };
  const insertToken = (tok) => update({ fileName: (style.fileName + ' ' + tok).replace(/\s+/g, ' ').trim() });

  const pdf = preview ? (doc === 'invoice' ? preview.invoice : preview.timesheet) : null;

  return (
    <div className="styles-page">
      <header className="page-head">
        <div>
          <h1>Output style</h1>
          <p className="muted">How your invoice and timesheet PDFs look. The preview uses sample hours.</p>
        </div>
        <div className="head-controls">
          <button className="btn btn-outline" disabled={!dirty} onClick={() => setStyle(saved)}>Discard changes</button>
          <button className="btn btn-primary" disabled={!dirty} onClick={save}>{dirty ? 'Save style' : 'Saved'}</button>
        </div>
      </header>

      <div className="styles-grid">
        <div className="styles-controls">
          <section className="card">
            <h3>Preset</h3>
            <div className="presets">
              {meta.presets.map(p => (
                <button key={p.id} className={`preset ${activePreset?.id === p.id ? 'on' : ''}`} onClick={() => applyPreset(p)}>
                  <span className="preset-chips">
                    {['accent', 'tsHeader', 'tsDay', 'total'].map(k => <i key={k} style={{ background: p.colors[k] }} />)}
                  </span>
                  <span className="preset-name">{p.label}</span>
                </button>
              ))}
            </div>
            <p className="hint">
              {activePreset ? <>Using <b>{activePreset.label}</b>. </> : <>Custom look. </>}
              Presets change fonts and colours only. Your page, date and file settings stay as they are.
            </p>
          </section>

          <section className="card">
            <h3>Colours</h3>
            {COLOR_GROUPS.map(g => (
              <div key={g.title} className="color-group">
                <div className="group-title">{g.title}</div>
                <div className="swatches">
                  {g.keys.map(([k, label]) => <Swatch key={k} label={label} value={style.colors[k]} onChange={v => setColor(k, v)} />)}
                </div>
              </div>
            ))}
            <label className="check">
              <input type="checkbox" checked={style.stripes} onChange={e => update({ stripes: e.target.checked })} />
              Striped invoice rows
            </label>
          </section>

          <section className="card">
            <h3>Fonts</h3>
            <div className="form-row three">
              {FONT_SLOTS.map(([k, label]) => (
                <div className="form-group" key={k}>
                  <label>{label}</label>
                  <select value={style.fonts[k]} onChange={e => setFont(k, e.target.value)}>
                    {meta.fonts.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <p className="hint">Only fonts installed on this computer are listed. Characters a font can't draw, like ₱ in Roboto, are filled in from Arial automatically.</p>
          </section>

          <section className="card">
            <h3>Branding</h3>
            <div className="form-group">
              <label>Logo (PNG or JPEG, top right of the invoice)</label>
              <div className="logo-row">
                {style.logo ? <img className="logo-thumb" src={fileUrl(style.logo)} alt="Logo" /> : <div className="logo-thumb empty">No logo</div>}
                <button className="btn btn-sm btn-outline" onClick={pickLogo}>{style.logo ? 'Replace…' : 'Choose image…'}</button>
                {style.logo && <button className="btn btn-sm btn-ghost" onClick={() => update({ logo: '' })}>Remove</button>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Invoice title</label>
                <input value={style.invoiceTitle} maxLength={40} onChange={e => update({ invoiceTitle: e.target.value })} placeholder="Invoice" />
              </div>
              <div className="form-group">
                <label>Closing line</label>
                <input value={style.thankYou} maxLength={120} onChange={e => update({ thankYou: e.target.value })} placeholder="Leave empty to hide" />
              </div>
            </div>
          </section>

          <section className="card">
            <h3>Format</h3>
            <div className="form-row three">
              <div className="form-group">
                <label>Page size</label>
                <select value={style.pageSize} onChange={e => update({ pageSize: e.target.value })}>
                  {meta.pageSizes.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Date format</label>
                <select value={style.dateFormat} onChange={e => update({ dateFormat: e.target.value })}>
                  {meta.dateFormats.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Currency symbol</label>
                <input list="currencies" value={style.currency} maxLength={5} onChange={e => update({ currency: e.target.value })} />
                <datalist id="currencies">{CURRENCIES.map(c => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div className="form-group">
              <label>File name</label>
              <input value={style.fileName} maxLength={120} spellCheck={false} onChange={e => update({ fileName: e.target.value })} />
              <div className="tokens">
                {TOKENS.map(tok => <button key={tok} type="button" className="token" onClick={() => insertToken(tok)}>{tok}</button>)}
              </div>
              {names && <p className="hint">e.g. <code>{names.invoice}</code> and <code>{names.timesheet}</code></p>}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => update({
              pageSize: meta.defaults.pageSize, dateFormat: meta.defaults.dateFormat, currency: meta.defaults.currency, fileName: meta.defaults.fileName,
            })}>Reset format to defaults</button>
          </section>
        </div>

        <aside className="preview-pane">
          <div className="preview-bar">
            <div className="seg small" role="tablist">
              {[['invoice', 'Invoice'], ['timesheet', 'Timesheet']].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={doc === id} className={doc === id ? 'on' : ''} onClick={() => setDoc(id)}>{label}</button>
              ))}
            </div>
            <select className="compact" value={cycle} onChange={e => setCycle(e.target.value)} aria-label="Preview period">
              <option value="weekly">Weekly sample</option>
              <option value="monthly">Monthly sample</option>
            </select>
            <span className={`status ${rendering ? 'busy' : ''}`}>{rendering ? 'Updating…' : dirty ? 'Unsaved' : 'Saved'}</span>
          </div>
          <div className="preview-frame">
            {pdf ? <iframe key={pdf} title="PDF preview" src={fileUrl(pdf) + '#toolbar=0&navpanes=0&view=FitH'} /> : <div className="preview-empty">Rendering preview…</div>}
          </div>
          {preview?.sample && <p className="hint">Add a client to see your own details in the preview.</p>}
        </aside>
      </div>
    </div>
  );
}
