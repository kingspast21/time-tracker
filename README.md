# TimeTracker

A small desktop app for people who bill by the week. You log the hours you worked, and it creates two PDFs ready to send:

- **Invoice**: dated lines with hours × rate, a subtotal and a total, plus your payment details.
- **Weekly Timesheet**: a Monday–Sunday grid with time in, time out, break, overtime and daily totals.

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
2. **Clients**: add who you invoice: the name, the "Invoice for" lines, the hourly rate, and the line description, for example `Consulting`.

## Every week

1. Open the app. On Mondays and Tuesdays it starts on last week.
2. Type each day's time in and time out, or click **Fill Mon–Fri** to use your usual hours. Breaks are subtracted automatically, and everything saves as you type.
3. Check the invoice number (it counts up on its own) and the submitted date, then click **Create invoice + time sheet**.
4. You get `Your Name - Invoice MM_DD - MM_DD.pdf` and `Your Name - Time Sheet MM_DD - MM_DD.pdf`.

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
```

| Path | What it does |
|---|---|
| `electron/main.js` | Window, SQLite database (sql.js / WASM, no native build), IPC |
| `electron/pdf.js` | Invoice and timesheet layouts (PDFKit) |
| `electron/fonts/` | Bundled Roboto for the invoice. The timesheet uses Arial and falls back to Helvetica when Arial isn't installed |
| `src/` | React UI |

Roboto is licensed under the [SIL Open Font License 1.1](electron/fonts/OFL.txt). The app itself is MIT-licensed.
