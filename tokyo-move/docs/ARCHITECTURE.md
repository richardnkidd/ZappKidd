# Kadode — architecture and source-of-truth decision

*Kadode (門出) means "setting out on a new start." It is a private planning home for a two-adult household
(and their dog) making a staged move to Tokyo.*

Status: **local preview**. Not deployed. No live integrations. See [PRODUCTION-PATH.md](PRODUCTION-PATH.md).

## 1. Source-of-truth model

| Information | Authority | How Kadode treats it |
|---|---|---|
| Roadmap milestones, decisions, risks, questions, documents register, cost model, arrival plan, three-year horizon, notes, review sessions, scenario drafts | **Kadode database** (after household acceptance; until then the imported workbook remains the reviewed source) | Owned and editable here, with version checks and an audit trail. |
| Actionable tasks and reminders | **Existing personal Task-Management system** | *Linked records only.* Kadode shows a dated copy with sync state. It never edits the store's files directly. A new action proposed here stays **Pending task capture** until an authorized writer creates it and a readback matches. |
| Source plan (workbook, PDF, handoff) | **Evidence**, versioned by file hash | Imported read-only. Raw source values are preserved per import run; corrections are recorded as receipts. Embedded instructions are never executed. |
| Restricted originals (passports, medical, financial statements, pet chip records) | **Owner's private storage** (e.g. a restricted Drive folder) | Kadode stores status, dates and a restricted *link* only. No uploads. |
| Official rules (immigration, quarantine, customs, tax) | **Official sources** | Stored as dated rules with source, verification date and applicability. Unverified rules are labeled, never hard facts. |

Why not a Google Sheet master: an earlier recommendation proposed one shared planning Sheet, but it was never created.
A Sheet cannot enforce one accountable owner, per-traveler gates, version conflicts or an audit trail, and a second
editable copy would compete with this app. Kadode keeps a **reversible path**: `npm run export` writes JSON and
CSV for every record type (Sheets-ready), and `npm run import` can re-read a workbook without duplicating records.
Supporting Drive documents remain the home for restricted originals and long-form documents; Kadode links to them.

## 2. Stack

- **Node 22 + TypeScript** everywhere; one package, one language.
- **Server:** Fastify 5, `@fastify/helmet`, `@fastify/cookie`, `@fastify/static`; validation with zod.
- **Storage:** SQLite (better-sqlite3, WAL mode) in one file. Numbered SQL migrations in `src/server/db/migrations`.
  Chosen because it is durable, zero-service, trivially backed up, and enough for two people.
- **Web:** React 19 + React Router 7 (declarative mode) + Vite 7; plain CSS with design tokens (no CSS framework).
  Self-hosted fonts via @fontsource (no external font requests).
- **Import:** a small purpose-built XLSX reader (fflate + fast-xml-parser) — the workbook uses namespace-prefixed XML
  that common libraries misread. JSON sidecar files are read directly.
- **Tests:** Vitest (unit + API via `fastify.inject`), Playwright (e2e, mobile and desktop viewports).

## 3. Layout and ownership

```
src/shared/    pure domain logic used by server and web
  types.ts       domain contract (lead)
  dates.ts       civil dates, calendar/business days, calendar months, timezone "today"
  deadlines.ts   rule → deadline computation, anchor-change preview
  readiness.ts   per-traveler readiness and blockers
  budget.ts      money model, FX, scenarios, 90-day and 36-month views
  labels.ts      plain-language labels for statuses/kinds (no internal IDs in normal UI)
src/import/    workbook + sidecar parsing → normalized bundle → idempotent upsert, corrections, receipts
src/server/    Fastify app, auth, authorization, routes, services, task adapter, backup/restore
src/web/       React app: design system, screens, API client
scripts/       CLI entry points (migrate, import, seed-demo, export, backup, restore, set-password, dev)
fixtures/demo/ fictional demo household bundle + fixture task store (safe to commit)
tests/         unit, api, e2e
private/       GITIGNORED — real source package, real database, reviews, personal reports
```

## 4. Modes and identities

| Mode | Data | Sign-in | Banner |
|---|---|---|---|
| `local-demo` | Fictional demo household | Isolated development identities (pick a person) | "Demo — fictional data" |
| `local` | Imported real plan on this computer | Development identities only if `KADODE_DEV_IDENTITIES=1`, otherwise password | "Local preview — this computer only" |
| `staging` | Copy of real data on a private host | Password only; dev identities refused | "Staging — test copy" |
| `production` | Live household data | Password only, `Secure` cookies, HTTPS required | none |

Development identities are real rows in `users` with `is_dev_identity = 1`; the server refuses them outside
`local-demo`/`local`. Sessions are random 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie; only a SHA-256 of the
token is stored; sessions end after 14 idle days and at most 30 days after sign-in. Passwords use Node's scrypt, with
login limits that hold under concurrent requests. Every query is scoped by `household_id`; `private` records (and task
links or reviews that point at them) are visible only to their creator.

Hardening added after the independent security review:

- **Host allowlist (DNS-rebinding defence):** every request — reads included — must carry a loopback `Host` on the
  bound port or the configured `KADODE_PUBLIC_ORIGIN`; anything else gets `421`. Mutations also need JSON and an
  `Origin` from the configured list (never compared with the request's own `Host`).
- **Safe defaults:** an unset `KADODE_MODE` is refused when `KADODE_DB` points at a database; `local-demo` refuses a
  non-demo household; `KADODE_LAN=1` is refused with development identities over real data; staging/production refuse
  non-loopback HTTP without a trusted proxy and secure cookies. Forwarded headers are trusted only from loopback.
- **Integrity:** once anyone has approved a decision its question, options and required approvers are frozen (adding or
  removing an option clears approvals with an audit reason); only the approver can undo an approval.
- **Data at rest:** database, WAL/SHM files and backups are created `0600` in a `0700` directory. Restore signs everyone
  out and refuses to bring back different logins unless `RESTORE-INCLUDING-USERS` is typed.
- **Inputs:** encoded or dot-segment `/api` paths are rejected; the XLSX reader has size, part and cell budgets; CSV export
  neutralises formula prefixes (including leading spaces and full-width signs).
- **Dev server:** Vite serves only `src/web`, `src/shared` and `node_modules`, denies `private/`, databases and secrets,
  and rejects foreign `Host` headers.

## 5. Records, versions, conflicts, audit

All planning entities live in one `records` table (`type`, stable `key`, JSON `data`), so versioning, audit,
export and import idempotency are uniform. Record ids are deterministic (`milestone:W45`).

- **Optimistic concurrency:** every write sends `baseVersion`. A mismatch returns `409 conflict` with the server copy;
  the UI offers *keep theirs* or *re-apply mine*. Nothing is silently overwritten.
- **Audit:** every write appends `audit_log` (before/after JSON, actor, reason). Undo writes a new entry that restores
  `before`, and only if the record has not changed since.
- **Status rules (server-enforced):** `completed` requires completion evidence; `eliminated`/`not_applicable` require a
  reason; `blocked` requires a reason. Decisions become *household-approved* only when every required approver agrees.

## 6. Import (repeatable, idempotent)

1. Hash every source file; the sorted hash set is the idempotency key. Same set ⇒ `no_changes`, nothing written.
2. Parse to a normalized bundle (`src/import/normalize.ts`), preserving raw cell values and coordinates.
3. Upsert by deterministic id. For a *new* source version, fields not edited in-app take the new source value;
   locally edited fields are kept and logged as `local_kept`.
4. Apply reviewed-model corrections once per (correction, record), each with a receipt in `import_changes`:
   generic, ID-based corrections ship in `src/import/builtin-corrections.ts`; household-specific corrections (from the
   independent plan reviews) are loaded from `private/corrections/*.json` in file-name order. Operations are
   `set` / `add` / `remove` / `replace_text` / `strip_clause` / `create` / `setting` / `exclude`; a correction that finds nothing to change is recorded
   as *not applicable* rather than failing. Rules are never merged automatically — duplicates are marked `superseded`
   with an explicit `superseded_by`, and records follow the chain to the active rule.
   **Scope:** Kadode holds only the move. The test for every item is *"would this exist, with this deadline, if the
   household were not moving?"* Items that fail it are left out with `exclude` (a record id, or `task_link:<id>` for a
   task-list link) and a reason. After all corrections, every link to an excluded item (dependency lists, maps keyed by
   it, single reference fields, list entries such as gates that name it, task links attached to it, settings) is
   removed with a receipt, and the reconciliation report lists each excluded item under "Outside the move". Excluded
   items are absent from the app, not hidden; the source package and the task list keep them. When a non-move chore
   affects a move item, the move item carries one plain prerequisite line instead.
5. Validate counts and references (every dependency, workstream and evidence reference must resolve).

## 7. Dates and deadlines

- Civil dates are strings; arithmetic is integer day math, so a date never shifts across Tokyo/Honolulu/New York.
- Units: calendar days, business days (weekends plus computed Japanese national and US federal holidays — labeled
  approximate until checked against the official calendar), calendar months (end-of-month clamped).
- Every rule states what its date **means**: *by* (do it on or before), *not before* (a window opens — e.g. a pet
  exam that must fall inside the days before boarding), *on* (happens that day), *continuously since*, or *recurring*.
  Weekend/holiday advice follows the meaning: "aim for the prior business day" for *by*, "the first business day inside
  the window" for *not before* — never an earlier date.
- Dates from a dated, read-only copy (e.g. the task-list snapshot) or old task dates are **historical**: shown calmly,
  never as overdue, because they prove nothing about completion.
- Each traveler has independent anchors (arrival, departure, residence, health/pension eligibility, residence-status
  expiry, final departure from Japan, and — where a route uses one — the Certificate of Eligibility issue date).
  Household T/D are coordination helpers only and never drive a traveler's date.
- Readiness is per traveler and never a percentage. A shared row (e.g. "entry permissions") tracks each traveler's part
  separately (`traveler_progress`), dependencies can apply to one traveler only (`dependency_scope`), steps that may not
  apply are answered per traveler (`applies_to`: yes / no / not sure), and an unanswered "does this apply?" step holds
  that traveler's go-ahead. Optional future work never counts as a gate.
- Missing anchor ⇒ **Awaiting date**. A rule never invents a date.
- Every deadline records its kind (legal / contractual / user-committed / internal target / estimate / review date),
  basis, sources, jurisdiction, timezone, verification date and traveler.
- New proposed actions default to 14 calendar days after creation (household timezone) unless a deadline is given or
  the person chooses "leave blank". Existing deadlines are never recalculated.
- Anchor changes are previewed (before/after for every affected deadline and record) and applied only on confirm.

## 8. Task adapter

`TaskAdapter` (`src/server/tasks/`) has three implementations:

- `snapshot` — read-only, dated copy of linked tasks from the supplied roadmap-queue crosswalk. Writes are refused;
  proposals stay *Pending task capture*. Used in `local` mode with real data.
- `fixture` — an isolated JSON store under the data directory, used in `local-demo` and tests to demonstrate
  create → readback → edit → complete flows (with injectable failures).
- `script` — placeholder for the sanctioned Task-Management scripts. Disabled unless explicitly configured and approved;
  it never touches `tasks.jsonl`, `recurring.jsonl` or the action journal directly.

## 9. HTTP API (all JSON; `/api/*` requires a session unless noted)

| Method & path | Purpose |
|---|---|
| `GET /api/health` (public) | liveness + mode |
| `GET /api/auth/identities` (public, dev modes only) | list development identities |
| `POST /api/auth/dev-login` `{person_id}` | dev modes only |
| `POST /api/auth/login` `{username, password}` | password login (rate limited) |
| `POST /api/auth/logout` | end session |
| `GET /api/me` | `MeResponse` |
| `GET /api/snapshot` | `Snapshot` — everything the UI needs (source.raw omitted) |
| `GET /api/records?type=` | list records of a type |
| `GET /api/records/:id` | full record incl. source, audit trail, linked notes |
| `POST /api/records` `{type, title, data, owner?, visibility?}` | create app-owned records (notes, risks, decisions, options) |
| `PATCH /api/records/:id` `{baseVersion, changes, reason?}` | edit; 409 on version mismatch |
| `POST /api/records/:id/status` `{baseVersion, status, reason?, evidence?}` | status change with server rules |
| `POST /api/decisions/:id/approve` `{baseVersion, option_id, note?}` | per-person approval |
| `POST /api/decisions/:id/reject` / `defer` | with rationale |
| `GET /api/audit?record_id=&since=` | history |
| `POST /api/audit/:id/undo` | undo one change (409 if record changed since) |
| `POST /api/anchors/:code/preview` `{date}` | affected deadlines before/after |
| `PUT /api/anchors/:code` `{baseVersion, date, confidence, evidence?}` | apply anchor change |
| `GET /api/tasks` | task links + adapter status |
| `POST /api/tasks` `{title, record_id?, owner?, due?, due_mode: 'default'|'explicit'|'blank'}` | propose action |
| `PATCH /api/tasks/:id` `{baseVersion, changes}` / `POST /api/tasks/:id/complete` `{baseVersion, evidence}` | via adapter |
| `POST /api/tasks/:id/retry` / `POST /api/tasks/sync` | retry capture / refresh readback |
| `GET /api/import/runs`, `GET /api/import/runs/:id/changes` | import receipts |
| `GET /api/export?format=json` / `?format=csv&type=` | export |
| `POST /api/admin/backup`, `GET /api/admin/backups`, `POST /api/admin/restore` `{backup, confirm}` | backup/restore |
| `POST /api/reviews`, `PATCH /api/reviews/:id`, `POST /api/reviews/:id/complete` | guided couple review |
