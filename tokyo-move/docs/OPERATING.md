# Operating Kadode

Day-to-day use of the **local preview**. Everything here is copy-pasteable from the project folder. For install and
quick start see [../README.md](../README.md); for how it is built see [ARCHITECTURE.md](ARCHITECTURE.md).

Contents: [modes](#1-modes) · [logins](#2-identities-and-passwords) · [files](#3-where-things-live) ·
[import](#4-import-and-re-import) · [corrections](#5-the-corrections-overlay) · [task list](#6-the-task-list-three-states) ·
[backup drill](#7-backup-and-restore-drill) · [CSV for Sheets](#8-exporting-to-csv-for-a-spreadsheet) ·
[troubleshooting](#9-troubleshooting) · [not done](#10-what-is-not-done)

## 1. Modes

`KADODE_MODE` decides which data you are looking at and how people sign in. The banner at the top of every screen says
which one you are in.

| Mode | Data | Sign-in | Banner | Use it for |
|---|---|---|---|---|
| `local-demo` (default) | The **fictional** household, loaded automatically on first start | "Pick a person" (development identities) | "Demo — fictional data" | Trying the app, screenshots, the browser tests |
| `local` | Your **real plan**, imported into `private/data/kadode.db` | Passwords; or "pick a person" only with `KADODE_DEV_IDENTITIES=1` | "Local preview — this computer only" | Using the real plan on your own computer |
| `staging` | A copy of real data on a private host | Passwords only | "Staging — test copy" | Not set up |
| `production` | Live household data | Passwords only, HTTPS required | none | Not set up |

Two safety rules are enforced by the server, not by habit:

- **`KADODE_MODE` must be written down whenever `KADODE_DB` is set.** Forgetting it can never turn a real database into
  the passwordless demo. (`KADODE_MODE=local KADODE_DB=/path/to/kadode.db npm start`.)
- The demo database (`kadode-demo.db`) and the real one (`kadode.db`) are different files, so the demo can never
  overwrite your plan. `npm run seed:demo -- --reset` refuses any file whose name does not contain "demo".

The command-line tools (`backup`, `export`, `restore`, `user:password`, `db:migrate`) pick the database from the same
setting. **For your real plan put `KADODE_MODE=local` in front of them**, otherwise they look for the demo database and
tell you there is none ("No database at …private/data/kadode-demo.db"). They never create an empty database for you.

## 2. Identities and passwords

- **Development identities** ("pick Avery or Jun") are rows in the database marked as development identities. They are
  not authentication. They work in `local-demo`, and in `local` only when you start with `KADODE_DEV_IDENTITIES=1`.
  They are refused in `staging`/`production`, and the server will not start there while any are enabled.
- **Passwords** are set from the terminal (typed twice, not echoed; at least the minimum length the tool tells you):

  ```bash
  # create a login for a person, or change an existing login's password
  KADODE_MODE=local npm run user:password -- --username <name> --create --person <person id>
  KADODE_MODE=local npm run user:password -- --username <name>

  # scripted use (piped, one line)
  printf '%s\n' "$PASSWORD" | KADODE_MODE=local npm run user:password -- --username <name>

  # switch every development identity off (required before staging/production; harmless in local)
  KADODE_MODE=local npm run user:password -- --disable-dev-identities
  ```

  Changing a password ends that person's existing sessions. Sign-in attempts are rate limited per username and address
  ("Too many sign-in attempts. Try again in about N minutes").
- **Sessions** are random tokens in an `HttpOnly` cookie; only a hash is stored. "Switch person" / "Sign out" in the
  account dialog ends the session on the server too.
- **Private notes** ("Only me") are visible only to their author, in the app and in exports. A **backup file** holds
  everything (every private note, and the password hashes), and an export made by one adult contains that adult's
  private notes: store both accordingly.

## 3. Where things live

Everything private is under `private/` (gitignored, created with owner-only permissions).

| Path | What |
|---|---|
| `private/source-package/` | The source package you import from (workbook and sidecar files). Read-only to Kadode. |
| `private/corrections/` | Optional reviewed-model corrections for your real data ([section 5](#5-the-corrections-overlay)) |
| `private/data/kadode.db` | The real database (SQLite, with `-wal` and `-shm` side files while running) |
| `private/data/kadode-demo.db` | The demo database |
| `private/data/backups/` | Backups (`kadode-<UTC time>.db`, and `…-pre-restore.db` copies) |
| `private/data/task-fixture-store.json` | The demo's fake task list (demo mode only) |
| `private/exports/<time>/` | `npm run export` output (JSON and CSV) |
| `private/reports/` | Reconciliation reports from `npm run import -- --report` |

Override the data folder with `KADODE_DATA_DIR` and the database file with `KADODE_DB` (plus `KADODE_MODE`).

## 4. Import and re-import

```bash
npm run import -- --source "/path/to/the Revision 2 package"
# optional:
#   --report private/reports/reconciliation.md   write a plain reconciliation report (must be inside a private/ folder)
#   --corrections private/corrections            where to look for corrections (default: next to the source folder)
#   --force                                      re-compare every record even if the files did not change
```

What it does, in order:

1. Fingerprints every source file (SHA-256). **The same set of files is "no changes"** and writes nothing but the run
   record, so running it twice is safe.
2. Parses the workbook and sidecar files into records, keeping the raw cell values and where they came from.
3. Applies the corrections ([section 5](#5-the-corrections-overlay)).
4. Checks the plan is whole: all 71 roadmap items present, expected counts per list, every reference resolves. A missing
   item stops the import with a non-zero exit code; count mismatches and dangling references are listed as warnings.
5. Saves by stable id (`milestone:W45`). For a **new version of the source**, fields nobody edited in the app take the new
   source value; **fields someone edited in the app are kept** and recorded as "kept local".

The terminal prints the counts and the outcome (`completed`, `no_changes` or `failed`), for example
`created 160, updated 0, kept local 0, corrections 0, unchanged 0`, and **never prints record text**.

**Receipts.** Every change is written down: what changed, the before and after, and why. Each receipt is one of
`created`, `source_updated`, `local_kept`, `correction_applied`, `correction_not_applicable`. Read them in the app at
**More → Data & imports** (each import has a "Receipts" section), or as JSON at `GET /api/import/runs` and
`GET /api/import/runs/<id>/changes` while signed in. Review the first real receipt together before relying on the plan.

Before a re-import it is worth taking a backup ([section 7](#7-backup-and-restore-drill)): an import is idempotent and
keeps your edits, but a backup is a cheap undo for everything else.

## 5. The corrections overlay

A **correction** is a small, reviewed, id-based edit applied to the parsed plan *before* it is saved: fixing a typo in a
label, adding a missing link, splitting a shared item per traveler. It never edits the raw source values (those stay
visible under "Source & history" on each item), and every correction leaves a receipt with its rationale.

- **Generic corrections** that apply to any household are built in and are already part of every import.
- **Your own** go in `private/corrections/*.json` (loaded in file-name order, after the built-ins; a correction with the
  same `id` as a built-in replaces it). Shape:

  ```json
  {
    "corrections": [
      {
        "id": "my-fix-1",
        "title": "Plain words for the housing item",
        "rationale": "Why this is right, in one sentence.",
        "source": "where it came from (optional)",
        "ops": [
          { "op": "set", "record": "milestone:W19", "path": "next_action", "value": "Shortlist three areas." },
          { "op": "replace_text", "record": "milestone:W19", "path": "next_action", "find": "teh", "replace": "the" }
        ]
      }
    ]
  }
  ```

  Operations: `set`, `add`, `remove`, `replace_text`, `strip_clause`, `create` (a new record), `setting`, and
  `exclude` (`{ "op": "exclude", "record": "milestone:W19", "reason": "Outside the move." }`, or
  `"record": "task_link:<task id>"`) for an item that is not part of the move. Excluded items are not imported, links
  to them are removed, and the import report lists them. Put scope exclusions in a file that sorts last
  (e.g. `99-scope.json`).
- Each (correction, record) pair is applied **once** (tracked, so re-imports do not repeat receipts), while the edit
  itself is re-applied to the freshly parsed plan every time so the stored result always agrees with source + corrections.
  An operation that no longer fits (the record or text is gone) is logged as `correction_not_applicable`, not forced.
- To drop a correction, remove it from the file and import again: the plan then follows the source plus the remaining
  corrections for every field nobody edited in the app.
- The correction files are part of what is fingerprinted, so adding, changing or removing one counts as a new import.

### Changes made by assistants (one way in)

People change the plan in the app; the app records each edited field so an import never overwrites it. **Assistants
and scripts change the plan only by adding a correction file**, never by writing to the database directly and never by
editing tracked repository files:

- A direct database write is not marked as an in-app edit, so the next import (the launcher runs one whenever the
  private files or the importer change) puts the source-plus-corrections value back. The change is silently lost.
- Write one file per change set into `private/corrections/`, named so it sorts after the files it builds on, for example
  `97s-pet-records-2026-11-01.json`, with a `title`, a `rationale` and a `source` on each correction, and `set` /
  `add` / `create` / `exclude` operations as above. Then stop and start Kadode so the import applies it with receipts.
- New facts go where the app already shows them (for example a question's `data.known` or `data.answer`, a record's
  `data.next_action`); a new record uses an existing type.
- Hand the file on with the rest of `private/` so every copy of the plan stays the same.

## 6. The task list: three states

Actions live in your existing task list, not in Kadode. Kadode shows a **dated copy** and a **sync state**, and it never
edits the task list's files. The adapter is chosen by mode (override with `KADODE_TASK_ADAPTER`):

| Adapter | Used in | What it does | What you see |
|---|---|---|---|
| `fixture` | demo | An isolated fake task list (`task-fixture-store.json`) that really creates, reads back, edits and completes, so every flow can be tried. | "Up to date" after a proposal; "Couldn't reach your task list" plus **Try again** when it fails |
| `snapshot` | `local` and above | A **read-only, dated copy** of the tasks that already exist (from the roadmap-queue crosswalk). Every write is refused. | Existing tasks as "Read-only copy"; a new proposal stays **"Waiting to be added to your task list"** |
| `script` | nothing yet | Placeholder for a sanctioned task-list script. Disabled unless configured *and* approved (`KADODE_TASK_LIVE_WRITES=approved`). Do not enable it. | — |

**Pending task capture** is the honest default for real data: a proposed action (title, owner, due date) is saved in
Kadode and waits. Nothing is created in your task list, and nothing pretends it was. A new action defaults to a due date
14 calendar days after today in the household's time zone unless you pick a date or choose "Leave blank"; existing dates
are never recalculated.

The sync states you can meet: **Up to date**, **Read-only copy**, **Waiting to be added to your task list**, **Change
waiting to reach your task list**, **Couldn't reach your task list** (with "Try again"), **Changed in two places**.
Refresh the copy from **Data & imports → Your task list**.

To see the failure states in the demo: `KADODE_TASK_FIXTURE_FAIL=create npm start` makes the first create fail once
(`update`, `complete` and `readback` work the same way).

## 7. Backup and restore drill

A backup is a verified, self-contained SQLite copy of the whole plan: records, history, import receipts, settings **and
the logins (password hashes)**. Treat it like the database itself: keep copies in a **restricted** place (for example a
private, non-shared folder), never in the repo, never in an email.

**Back up** (any of these):

```bash
KADODE_MODE=local npm run backup              # writes private/data/backups/kadode-<time>.db, checks it, prints the name
KADODE_MODE=local npm run backup -- --list    # lists backups
# or in the app: More -> Data & imports -> Backups -> "Back up now"
```

**Restore** (the drill; do it once on a copy before you ever need it):

```bash
# 1. stop the server (Ctrl-C) when using the command line
# 2. restore; a copy of the CURRENT state is saved first as ...-pre-restore.db
KADODE_MODE=local npm run restore -- kadode-20261030T014526Z.db --confirm RESTORE
# 3. start again and sign in
```

In the app: **Data & imports → Backups → Restore…** on the backup, type `RESTORE`, confirm.

What to know:

- **A restore signs everyone out.** Every session ends, including yours; both adults sign in again afterwards.
- **Plain `RESTORE` keeps today's logins.** If the backup would bring back a login that no longer exists, switch a
  development identity back on, or leave a current login without a person, the restore is **refused** (HTTP 409,
  reason `users_differ`) and nothing changes. If that is what you want, confirm with the longer word
  **`RESTORE-INCLUDING-USERS`** (`--confirm RESTORE-INCLUDING-USERS`), which replaces the logins and passwords with the
  backup's. Development identities are switched off again afterwards unless the mode allows them.
- **A restore is undoable.** The `…-pre-restore.db` it writes is itself a backup; restore it to go back.
- The restore itself is recorded in the history (who, from which backup).
- Names must be plain backup file names from the backups folder; the command line also accepts a path.
- The in-app restore is refused if the database holds more than one household (use the command line).

**Drill checklist** (about five minutes, using the demo or a throw-away copy):

1. Note one value you can recognise (an item's "Next action").
2. Back up. Change that value. Add a note.
3. Restore from the backup. Sign in again.
4. Confirm the value is back and the note is gone.
5. Restore from the `…-pre-restore.db`. Confirm the change and the note are back. Then restore the first backup again.

The browser tests run exactly this drill against a throw-away server (`tests/e2e/data-safety.spec.ts`).

## 8. Exporting to CSV for a spreadsheet

The way out of Kadode is always open: nothing is locked in.

```bash
KADODE_MODE=local npm run export                         # -> private/exports/<time>/
KADODE_MODE=local npm run export -- --out private/exports/for-sheets
KADODE_MODE=local npm run export -- --person <person id> # also include that person's private notes
```

This writes `kadode-export.json` (everything, with history and receipts) and one CSV per list (`milestone.csv`,
`decision.csv`, `document.csv`, `cost.csv`, …; empty lists are skipped). Without `--person` only records shared with the
household are exported. In the app, **Data & imports → Export** downloads the JSON or one CSV at a time (these contain
what *you* can see, including your private notes).

**In Google Sheets:** File → Import → Upload → choose a CSV → "Replace current sheet" (or "Insert new sheet") →
separator "Comma" → untick "Convert text to numbers, dates and formulas" if you want the cells left exactly as written.
Nested values are flattened into columns (`data.next_action`, …); lists are joined with ` | `.

Formula safety: any cell that starts with `=`, `+`, `-` or `@` is written with a leading apostrophe (`'=…`) so a
spreadsheet shows it as text instead of running it. Exports and CSVs contain real household data: keep them under
`private/`.

## 9. Troubleshooting

| What you see | Why, and what to do |
|---|---|
| Blank page, or "Cannot GET /" | The web app is not built. Run `npm run build`, then `npm start`. (`npm run dev` serves it on port 5173 instead.) |
| `EADDRINUSE` / "address already in use" | Another copy is running. Stop it, or use another port: `PORT=8790 npm start`. |
| "KADODE_MODE must be set explicitly when KADODE_DB is set" | Add `KADODE_MODE=local` (or `local-demo` for a demo file). By design. |
| "No database at …kadode-demo.db" from `backup`/`export`/… | You are looking at the demo database. For the real plan add `KADODE_MODE=local`. |
| "The database … holds no household" | Wrong file, or nothing imported yet. Check `KADODE_MODE`/`KADODE_DB`, then `npm run import`. |
| Phone shows "This address is not served here" (HTTP 421) | The server only answers to addresses it knows. Start it with `KADODE_ALLOWED_ORIGINS=http://<your Mac's address>:8787` (see the README). |
| "Requests must come from this site" (HTTP 403) when saving | The page was opened from an address the server was not told about, or a tool posted without a matching `Origin`. Open the app at the address the server prints. |
| "Refusing KADODE_LAN=1 with KADODE_DEV_IDENTITIES=1 in local mode" | Deliberate: that would let anyone on the network sign in without a password. Set passwords (section 2) and drop the flag. |
| "Refusing to start in production/staging mode…" | Those modes need `KADODE_COOKIE_SECURE=true` over HTTPS and no development identities (`npm run user:password -- --disable-dev-identities`). See PRODUCTION-PATH. |
| "Too many sign-in attempts" | Wait the time it says; the limit is per username and address. |
| Restore refused with `users_differ` | The backup would change who can sign in. Read the message; use `RESTORE-INCLUDING-USERS` only if you mean it. |
| After a restore you are asked to sign in | Expected: a restore ends every session. |
| "Showing data loaded 2:10 PM … can't reach Kadode right now" | The server stopped or the network dropped. Your last data stays readable; start the server and tap "Try again". Nothing typed is lost until you leave the page. |
| "<Name> changed this while you were editing" | Two people edited the same field. Nothing was overwritten: choose "Keep <name>'s version" or "Use mine instead". |
| A date looks one day off | Dates are calendar dates and never move with the time-zone setting; only times of day do. Check the item's "Calendar date in" line. Deadlines that fall on a weekend say so. |
| `npm ci` fails building `better-sqlite3` on a Mac | `xcode-select --install`, then `npm ci` again. Use Node 22. |
| Browser tests cannot find a browser | `npx playwright install chromium` (once). |
| A test run says a port (8920–8923) is in use | A previous run did not shut down. Stop it (or `E2E_REUSE_SERVER=1` to reuse servers you started on those ports). |

Useful checks: `curl http://127.0.0.1:8787/api/health` (is it up, and in which mode), `npm run db:migrate` (database
schema version), `LOG_LEVEL=debug npm start` (more logging; request bodies and cookies are never logged).

## 10. What is NOT done

Be clear about these when deciding what to rely on:

- **Not deployed.** It runs on one computer at `127.0.0.1`. There is no hosting, no HTTPS, no sharing with a second device
  beyond the trusted-network trick in the README. See [PRODUCTION-PATH.md](PRODUCTION-PATH.md) for the recommended private
  setup and the approvals each step needs.
- **No live task-list writes.** Real-data mode holds a read-only dated copy; new actions stay "Waiting to be added".
  Nothing creates, edits or completes a task in your actual task list.
- **No notifications.** No email, push, calendar entries or reminders are sent. Kadode contacts, books, pays, files and
  shares nothing.
- **No document storage.** Documents are status, dates and a restricted link only; originals (passports, medical,
  financial) stay where they are kept. Nothing can be uploaded.
- **No automatic backups.** Backups are taken by you (`npm run backup` or the Data screen). A scheduled backup is a
  separate approval because it is an automation.
- **Development identities are not real sign-in.** Use passwords for anything beyond one trusted computer.
- **No account recovery or multi-household admin.** A forgotten password is reset from the terminal
  (`npm run user:password`); one database holds one household for the in-app restore.
- **Rules are only as certain as their source.** Immigration, quarantine, customs and tax rules appear as dated rules
  with a verification label; anything not verified is labelled, and legal dates need confirming with the official
  source or an adviser. Kadode is a planning aid, not advice.
