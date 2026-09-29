// Output styles: presets, font families, and validation. Shared by main.js (IPC) and pdf.js (rendering).
const fs = require('fs');
const path = require('path');

const OWN = path.join(__dirname, 'fonts');
const WIN = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
const ROLES = ['regular', 'bold', 'italic', 'boldItalic'];

// `lift` is hand-tuned for the two fonts used by the original documents; other fonts derive it from metrics.
const FAMILIES = {
  roboto: { label: 'Roboto', dir: OWN, lift: 0.185, files: ['Roboto-Regular.ttf', 'Roboto-Bold.ttf', 'Roboto-Italic.ttf', 'Roboto-BoldItalic.ttf'] },
  arial: { label: 'Arial', dir: WIN, lift: 0.12, fallback: 'helvetica', files: ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'] },
  calibri: { label: 'Calibri', dir: WIN, fallback: 'helvetica', files: ['calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf'] },
  segoe: { label: 'Segoe UI', dir: WIN, fallback: 'helvetica', files: ['segoeui.ttf', 'segoeuib.ttf', 'segoeuii.ttf', 'segoeuiz.ttf'] },
  verdana: { label: 'Verdana', dir: WIN, fallback: 'helvetica', files: ['verdana.ttf', 'verdanab.ttf', 'verdanai.ttf', 'verdanaz.ttf'] },
  trebuchet: { label: 'Trebuchet MS', dir: WIN, fallback: 'helvetica', files: ['trebuc.ttf', 'trebucbd.ttf', 'trebucit.ttf', 'trebucbi.ttf'] },
  georgia: { label: 'Georgia', dir: WIN, fallback: 'times', files: ['georgia.ttf', 'georgiab.ttf', 'georgiai.ttf', 'georgiaz.ttf'] },
  timesnr: { label: 'Times New Roman', dir: WIN, fallback: 'times', files: ['times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf'] },
  // PDF built-ins: always available on every OS
  helvetica: { label: 'Helvetica (built-in)', std: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'] },
  times: { label: 'Times (built-in)', std: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'] },
  courier: { label: 'Courier (built-in)', std: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'] },
};

const installed = (id) => {
  const f = FAMILIES[id];
  return !!f && (!!f.std || f.files.every(file => fs.existsSync(path.join(f.dir, file))));
};

// Family id -> { src: {role: path|stdName}, lift? }, falling back when a system font is missing (e.g. not Windows)
function resolveFamily(id) {
  let fid = FAMILIES[id] ? id : 'helvetica';
  if (!installed(fid)) fid = FAMILIES[fid].fallback || 'helvetica';
  const f = FAMILIES[fid];
  const src = {};
  ROLES.forEach((r, i) => { src[r] = f.std ? f.std[i] : path.join(f.dir, f.files[i]); });
  return { id: fid, src, lift: f.lift };
}

const availableFonts = () => Object.entries(FAMILIES).filter(([id]) => installed(id)).map(([id, f]) => ({ id, label: f.label }));

// Glyph fallback for characters a chosen font lacks (e.g. ₱ in Roboto)
const glyphFallback = () => ['arial', 'segoe', 'calibri'].find(installed) || 'helvetica';

const PAGE_SIZES = {
  tabloid: { label: 'Tabloid (11 × 17 in)', size: [792, 1224] },
  letter: { label: 'Letter (8.5 × 11 in)', size: [612, 792] },
  a4: { label: 'A4', size: [595.28, 841.89] },
};

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'D MMM YYYY', 'MMM D, YYYY'];

// "Look" = fonts + colours. Presets only ever change the look; output options stay the user's.
const PRESETS = {
  classic: {
    label: 'Classic',
    fonts: { invoice: 'roboto', note: 'arial', timesheet: 'arial' },
    stripes: true,
    colors: {
      accent: '#FF9900', heading: '#434343', text: '#000000', muted: '#666666', rule: '#B7B7B7',
      stripe: '#F3F3F3', total: '#FF0000', tsTitle: '#FCE5CD', tsHeader: '#F9CB9C', tsDay: '#CFE2F3', tsBorder: '#000000',
    },
  },
  slate: {
    label: 'Slate',
    fonts: { invoice: 'roboto', note: 'roboto', timesheet: 'roboto' },
    stripes: true,
    colors: {
      accent: '#1F3A5F', heading: '#1F3A5F', text: '#1B1F24', muted: '#5B6573', rule: '#C9D1DB',
      stripe: '#F1F4F8', total: '#1F3A5F', tsTitle: '#DCE6F1', tsHeader: '#B8CCE4', tsDay: '#EEF3F8', tsBorder: '#5B6573',
    },
  },
  minimal: {
    label: 'Minimal',
    fonts: { invoice: 'arial', note: 'arial', timesheet: 'arial' },
    stripes: false,
    colors: {
      accent: '#111111', heading: '#111111', text: '#111111', muted: '#6B6B6B', rule: '#D0D0D0',
      stripe: '#F5F5F5', total: '#111111', tsTitle: '#FFFFFF', tsHeader: '#EDEDED', tsDay: '#FAFAFA', tsBorder: '#9A9A9A',
    },
  },
  forest: {
    label: 'Forest',
    fonts: { invoice: 'georgia', note: 'georgia', timesheet: 'georgia' },
    stripes: true,
    colors: {
      accent: '#2E7D32', heading: '#1B5E20', text: '#1A1A1A', muted: '#5F6B5F', rule: '#C5D6C5',
      stripe: '#F1F7F1', total: '#2E7D32', tsTitle: '#E3F0E3', tsHeader: '#C3DEC3', tsDay: '#EFF6EF', tsBorder: '#4F6B4F',
    },
  },
};

const OUTPUT_DEFAULTS = {
  pageSize: 'tabloid',
  dateFormat: 'MM/DD/YYYY',
  currency: '$',
  invoiceTitle: 'Invoice',
  thankYou: 'Thank you for your business.',
  logo: '',
  fileName: '{name} - {type} {range}',
};

const DEFAULT_STYLE = { preset: 'classic', ...clone(PRESETS.classic), ...OUTPUT_DEFAULTS };
delete DEFAULT_STYLE.label;

function clone(o) { return JSON.parse(JSON.stringify(o)); }
const HEX = /^#[0-9a-f]{6}$/i;
const str = (v, max, dflt) => (typeof v === 'string' ? v.slice(0, max) : dflt);

// Merge user input over defaults and reject anything malformed, so the renderer never sees bad values.
function normalizeStyle(input) {
  const s = input && typeof input === 'object' ? input : {};
  const base = PRESETS[s.preset] ? { ...clone(PRESETS[s.preset]) } : clone(PRESETS.classic);
  const out = { ...clone(DEFAULT_STYLE) };
  out.preset = PRESETS[s.preset] || s.preset === 'custom' ? s.preset : 'classic';
  out.fonts = {};
  for (const k of ['invoice', 'note', 'timesheet']) {
    const v = s.fonts && s.fonts[k];
    out.fonts[k] = FAMILIES[v] ? v : base.fonts[k];
  }
  out.colors = {};
  for (const k of Object.keys(DEFAULT_STYLE.colors)) {
    const v = s.colors && s.colors[k];
    out.colors[k] = HEX.test(v || '') ? v.toUpperCase() : base.colors[k];
  }
  out.stripes = typeof s.stripes === 'boolean' ? s.stripes : base.stripes;
  out.pageSize = PAGE_SIZES[s.pageSize] ? s.pageSize : OUTPUT_DEFAULTS.pageSize;
  out.dateFormat = DATE_FORMATS.includes(s.dateFormat) ? s.dateFormat : OUTPUT_DEFAULTS.dateFormat;
  out.currency = str(s.currency, 5, OUTPUT_DEFAULTS.currency);
  out.invoiceTitle = str(s.invoiceTitle, 40, OUTPUT_DEFAULTS.invoiceTitle).trim() || OUTPUT_DEFAULTS.invoiceTitle;
  out.thankYou = str(s.thankYou, 120, OUTPUT_DEFAULTS.thankYou);
  out.logo = typeof s.logo === 'string' && s.logo && fs.existsSync(s.logo) ? s.logo : '';
  let fn = str(s.fileName, 120, OUTPUT_DEFAULTS.fileName).trim() || OUTPUT_DEFAULTS.fileName;
  if (!fn.includes('{type}')) fn += ' - {type}'; // invoice and timesheet must not collide
  out.fileName = fn;
  return out;
}

function publicPresets() {
  return Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, fonts: p.fonts, colors: p.colors, stripes: p.stripes }));
}

module.exports = {
  ROLES, FAMILIES, PAGE_SIZES, DATE_FORMATS, PRESETS, DEFAULT_STYLE,
  resolveFamily, availableFonts, glyphFallback, normalizeStyle, publicPresets,
};
