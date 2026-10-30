# Kadode 門出

*Kadode means "setting out on a new start."* It is a private planning home for a two-adult household (and their dog)
making a **staged move to Tokyo**: one place that answers, on a phone, *what matters now, who owns it, what is blocked,
what needs a decision, what is next, and whether each traveler is ready.*

Status: **local preview.** Nothing is deployed, shared, synchronized or connected to a live task list. It runs on one
computer, at `127.0.0.1`, over a SQLite file. See [docs/PRODUCTION-PATH.md](docs/PRODUCTION-PATH.md) for what it would
take to use it from two phones.

- Plan, Decide, Money, Documents, Contacts & evidence, Arrival, Future work, Data, Settings
- A calm couple review, a "what if the pet arrives later?" comparison, and a printable arrival pack
- One accountable owner per item, per-traveler readiness, version checks that never overwrite anyone silently,
  a change history, JSON and CSV export, backup and restore
- Unknown stays unknown: a missing date, amount or rate is shown as "not known yet", never as zero or a guess

## Privacy model (read this first)

**This git repository is public.** It must never contain real household data.

| Where | What lives there |
|---|---|
| Committed code, `fixtures/demo/`, `tests/` | Only the **fictional demo household** (Avery, Jun and their dog Mochi). Every name, date and amount is invented. |
| `private/` (**gitignored**) | The real source package, the real database (`private/data/`), exports, backups, reviews and reports. |
| `*.db`, `.env*`, `dist/`, `test-results/` | Gitignored. |

Rules of the house:

- Real data is only ever imported **from a folder you point at**, into `private/data/`. Nothing in the repo reads it by default.
- The browser tests and the default `npm test` run use the fictional demo only. The real-data tests read
  `TOKYO_SOURCE_DIR` and are **skipped** when it is not set.
- `npm run export` and `npm run backup` write under `private/`. An export contains your private notes: keep it there.
- The demo shows a banner ("Demo — fictional data"); real-data previews show "Local preview — this computer only".
- Development identities ("pick a person") are **not real sign-in**. They exist only for the demo and for a local preview
  on one computer, and the server refuses them in staging and production.

## Quick start (the demo)

You need **Node 22** and a terminal. On a Mac:

```bash
# one-time: Node 22 (pick one)
brew install node@22          # then follow brew's note to put it on your PATH
# or: nvm install 22 && nvm use 22

node --version                # v22.x

git clone <this repo> && cd tokyo-move     # or just cd into the folder you already have
npm ci                        # installs exactly what package-lock.json says
npm run build                 # builds the web app into dist/web
npm start                     # starts the API and serves the app
```

Open **http://127.0.0.1:8787**, choose **Avery** or **Jun**, and look around. The first start creates a fresh demo
database at `private/data/kadode-demo.db` and fills it with the fictional household. Stop with `Ctrl-C`.

If `npm ci` complains about a native build for `better-sqlite3`, run `xcode-select --install` once and try again.

For development with live reload (API on 8787, web on 5173):

```bash
npm run dev                   # open http://localhost:5173
```

Start the demo over from scratch: `npm run seed:demo -- --reset` (only ever resets files whose name contains "demo").

## Using your real plan, on your own computer

This is a **local preview**: the real plan on one computer, nobody else can reach it.

```bash
# 1. Import the Revision 2 source package (a folder holding the workbook and its sidecar files).
npm run import -- --source "/path/to/the Revision 2 package"
#    Prints counts, status and receipts (never record text). Safe to run again: the same files change nothing.
#    Writes private/data/kadode.db.

# 2. Run it. KADODE_MODE=local means "the real database"; the flag lets you pick a person without a password.
KADODE_MODE=local KADODE_DEV_IDENTITIES=1 npm run dev
#    open http://localhost:5173
```

Commands that work on the real database (`backup`, `export`, `restore`, `user:password`, `db:migrate`) must be told
which database with `KADODE_MODE=local`, for example `KADODE_MODE=local npm run backup`. Without it they look for the
demo database and say so. Details, receipts, corrections and the backup drill are in
[docs/OPERATING.md](docs/OPERATING.md).

### Prefer a password to "pick a person"?

```bash
KADODE_MODE=local npm run user:password -- --username <name> --create --person <person id>
KADODE_MODE=local npm run start       # no KADODE_DEV_IDENTITIES: the sign-in screen asks for the password
```

## Opening it on your phone (same Wi-Fi) — read the warning

> **Warning.** `KADODE_LAN=1` makes the app listen on your whole network. Anyone on that network can reach the sign-in
> screen. Use it only on a network you trust (your home Wi-Fi, not a café or an office). With the **demo** that is
> harmless (fictional data). With the **real plan** the server **refuses** `KADODE_LAN=1` together with
> `KADODE_DEV_IDENTITIES=1`, because that would let anyone on the network sign in as either adult without a password:
> use password sign-in for real data (previous section).

The server also only answers to addresses it was told about, so give it the address your phone will type. Find your
Mac's address (System Settings → Wi-Fi → Details, something like `192.168.1.23`), then:

```bash
npm run build
KADODE_LAN=1 KADODE_ALLOWED_ORIGINS=http://192.168.1.23:8787 npm start
# on the phone, open  http://192.168.1.23:8787
```

(`npm start` serves the built app itself; `npm run dev` on a phone also needs `http://192.168.1.23:5173` added.)
Without `KADODE_ALLOWED_ORIGINS` the phone gets "This address is not served here". The connection is plain HTTP, so
this is for trying the layout, not for anything you would not say on your own Wi-Fi.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (`tsx watch`, port 8787) and Vite web dev server (port 5173) together; `Ctrl-C` stops both |
| `npm run build` | Builds the web app into `dist/web` (the API serves it) |
| `npm start` | Starts the API on `127.0.0.1:8787` and serves `dist/web` |
| `npm run dev:server` / `npm run dev:web` | Just the API (watching) / just Vite |
| `npm run typecheck` | `tsc --noEmit` over `src`, `scripts` and `tests` |
| `npm test` | Vitest: unit, API and web-component tests (500+ tests, about 30 seconds) |
| `npm run test:e2e` | Playwright browser tests in three viewports against throw-away demo servers (builds first; about 8 minutes) |
| `npm run seed:demo` | Creates the fictional demo database (`-- --reset` recreates it) |
| `npm run import -- --source <dir>` | Reads a source package into the database, idempotently, with receipts (`--report`, `--corrections`, `--force`) |
| `npm run db:migrate` | Applies database migrations (opening the app does this too) |
| `npm run export` | Writes `kadode-export.json` and one CSV per list under `private/exports/<time>/` (`-- --out <dir>`) |
| `npm run backup` | Writes a verified SQLite copy to `<data dir>/backups/` (`-- --list` lists them) |
| `npm run restore -- <backup> --confirm RESTORE` | Restores a backup (stop the server first; signs everyone out) |
| `npm run user:password -- --username <name>` | Sets a password (`--create --person <id>` makes the login; `--disable-dev-identities`) |

### Settings (environment variables)

| Variable | Meaning |
|---|---|
| `KADODE_MODE` | `local-demo` (default; fictional data), `local` (your real plan on this computer), `staging`, `production`. **Required whenever `KADODE_DB` is set**, so a real database can never open as the passwordless demo. |
| `PORT`, `HOST` | Default `8787` and `127.0.0.1` (loopback only) |
| `KADODE_LAN=1` | Listen on the whole network (see the warning above) |
| `KADODE_ALLOWED_ORIGINS` | Extra browser addresses the server accepts, comma separated (a phone, or the Vite dev origin) |
| `KADODE_DB`, `KADODE_DATA_DIR` | Database file and data folder (default `private/data/`; the demo uses `kadode-demo.db`) |
| `KADODE_DEV_IDENTITIES=1` | Allow "pick a person" in `local` mode (never in staging or production) |
| `KADODE_COOKIE_SECURE`, `KADODE_PUBLIC_ORIGIN`, `KADODE_TRUST_PROXY` | For a later private deployment behind HTTPS (see PRODUCTION-PATH) |
| `KADODE_TASK_ADAPTER` | `fixture` (demo default), `snapshot` (real-data default, read-only), `script` (disabled until approved) |
| `KADODE_TASK_FIXTURE_FAIL` | Demo only: make the fixture task store fail `create`, `update`, `complete` or `readback` once, to see the error states |
| `TOKYO_SOURCE_DIR` | Source package for the real-data tests (and the default for `npm run import`) |
| `LOG_LEVEL` | `info` (default), `warn`, … (request bodies and cookies are never logged) |

## Tests

```bash
npm run typecheck
npm test                       # unit + API + web: no browser, no real data
npm run test:e2e               # browser tests: first run only, install the browser:  npx playwright install chromium
```

- **Real-data tests** (skipped unless you opt in; they check counts and rules against your own package):
  `TOKYO_SOURCE_DIR="/path/to/package" npm test`
- **Browser tests** start three throw-away servers on ports 8920, 8921 and 8922 with temporary databases, so they never
  touch `private/`. Run one project or file: `npx playwright test --project=phone tests/e2e/plan.spec.ts`.
  If something fails, `npx playwright show-report` opens the report with screenshots and traces.
- What the suites cover, and what they do **not**, is written down in [docs/TEST-REPORT.md](docs/TEST-REPORT.md).

## Folder map

```
src/shared/     pure domain logic used by server and web: dates, deadlines, readiness, budget, labels, types
src/import/     workbook + sidecar parsing, corrections, idempotent import with receipts
src/server/     Fastify API: auth, authorization, records, decisions, tasks adapter, export, backup/restore
src/web/        React app: design system, screens, API client
scripts/        command-line tools (import, seed:demo, export, backup, restore, user:password, dev)
fixtures/demo/  the fictional demo household (safe to commit)
tests/          unit/ api/ web/ (Vitest) and e2e/ (Playwright)
docs/           architecture, design, operating guide, production path, test report
private/        GITIGNORED: real source package, real database, exports, backups, reviews
dist/           GITIGNORED: the built web app
```

## More documentation

- [docs/OPERATING.md](docs/OPERATING.md) — day-to-day use: modes, logins, import and receipts, corrections, the task list, backup drill, CSV for Sheets, troubleshooting, what is not done
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — source of truth, stack, records and versions, dates, the task adapter, the API
- [docs/DESIGN.md](docs/DESIGN.md) — design direction, tokens, accessibility rules
- [docs/PRODUCTION-PATH.md](docs/PRODUCTION-PATH.md) — what it takes to use Kadode from two phones, and what needs your approval first
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md) — exact test commands, counts, environment, coverage and limits
- [docs/TEAM-PLAN.md](docs/TEAM-PLAN.md) — how the build was organised and its hard rules

Kadode never contacts anyone, books, pays, files or shares anything on your behalf.
