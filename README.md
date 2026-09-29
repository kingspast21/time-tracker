# TimeTracker

A small desktop app for people who bill by the hour. You log the hours you worked, and at the end of each billing period it creates two PDFs ready to send:

- **Invoice**: dated lines with hours × rate, a subtotal and a total, plus your payment details.
- **Timesheet**: a Monday–Sunday grid per week with time in, time out, break, overtime and daily totals.

Each client has its own billing cycle:

| Cycle | Period |
|---|---|
| Weekly | Monday to Sunday |
| Bi-weekly | 14 days, counted from a start Monday you choose |
| Semi-monthly | 1st–15th, then 16th to the end of the month |
| Monthly | 1st to the end of the month |

Everything stays on your computer. There are no accounts, no servers, and nothing is sent anywhere.

## Getting started

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/kingspast21/time-tracker.git
cd time-tracker
npm install
npm run app
```

On Windows you can also double-click `start.bat`. The first time, it installs dependencies, then it builds and launches the app.

## First run

The app starts empty.

1. **Settings**: enter your name, payment label and account (for example `PayPal:` and `you@example.com`), your usual hours, and where to save the PDFs. The default is `Documents/Invoices`.
2. **Clients**: add who you invoice: the name, the "Invoice for" lines, the hourly rate, the line description (for example `Consulting`), and how often you invoice them. For bi-weekly, also pick the first day of a pay period.

## Each billing period

1. Open the app. It starts on the period you're most likely invoicing: during the first two days of a new period, that's the one that just ended.
2. Type each day's time in and time out, or click **Fill weekdays** to use your usual hours. Breaks are subtracted automatically, and everything saves as you type. Longer periods are grouped by week.
3. Check the invoice number (it counts up on its own) and the submitted date, then click **Create invoice + time sheet**.
4. You get `Your Name - Invoice MM_DD - MM_DD.pdf` and `Your Name - Time Sheet MM_DD - MM_DD.pdf`. Monthly files are named by month, for example `Your Name - Invoice 2026_09.pdf`.

If you change a client's cycle, and some days in the new period are already on an earlier invoice, the app warns you so you don't bill them twice.

## Output style

**Output style** controls how both PDFs look, with a live preview beside the settings:

- **Presets**: Classic (the original orange/peach look), Slate, Minimal and Forest. A preset sets fonts and colours only.
- **Colours**: every colour on both documents, with a colour picker or a hex code.
- **Fonts**: separate choices for the invoice, the footer notes and the timesheet. Only fonts installed on the computer are listed, and the PDF built-ins (Helvetica, Times, Courier) always work. Characters a font can't draw, such as ₱ in Roboto, are filled in from a system font.
- **Branding**: a logo (PNG or JPEG) at the top right of the invoice, the invoice title, and the closing line.
- **Format**: page size (Tabloid, Letter or A4), date format, currency symbol, and a file-name template using `{name}`, `{type}`, `{range}`, `{number}`, `{client}`, `{start}` and `{end}`.

Changes apply to PDFs you create after saving. The logo is copied into the app's data folder, so moving the original file doesn't break it.

## Where your data lives

| | Location |
|---|---|
| Database | `%APPDATA%\time-tracker\timetracker.db` (Windows), `~/Library/Application Support/time-tracker` (macOS), `~/.config/time-tracker` (Linux) |
| PDFs | The folder chosen in Settings |

To start over, delete `timetracker.db`. To keep data in a different folder, for example a test profile, set `TIMETRACKER_DATA_DIR` before launching.

## Development

```bash
npm run electron:dev   # Vite dev server + Electron with DevTools
npm run build          # build the UI into dist/
npm start              # run Electron against dist/
npm test               # billing-period math + output-style validation
```

| Path | What it does |
|---|---|
| `electron/main.js` | Window, SQLite database (sql.js / WASM, no native build), IPC |
| `electron/pdf.js` | Invoice and timesheet layouts (PDFKit), drawn in a 792-pt design space and scaled to the page size |
| `electron/styles.js` | Output-style presets, fonts, page sizes and input validation |
| `electron/fonts/` | Bundled Roboto for the invoice. The timesheet uses Arial and falls back to Helvetica when Arial isn't installed |
| `src/periods.js` | Billing-period math (weekly, bi-weekly, semi-monthly, monthly) |
| `src/` | React UI |

Roboto is licensed under the [SIL Open Font License 1.1](electron/fonts/OFL.txt). The app itself is MIT-licensed.
