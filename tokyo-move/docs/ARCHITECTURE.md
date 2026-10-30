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
token is stored. Passwords use Node's scrypt. Mutations require JSON bodies and a same-origin `Origin` header.
Every query is scoped by `household_id`; `private` records are visible only to their creator.

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
4. Apply reviewed-model corrections once per (correction, record), each with a receipt in `import_changes`.
5. Validate counts and references (every dependency, workstream and evidence reference must resolve).

## 7. Dates and deadlines

- Civil dates are strings; arithmetic is integer day math, so a date never shifts across Tokyo/Honolulu/New York.
- Units: calendar days, business days (weekends excluded; holiday calendars must be supplied, otherwise the result is
  labeled approximate), calendar months (end-of-month clamped).
- Each traveler has independent anchors (arrival, departure, residence, health/pension eligibility). Household T/D are
  coordination helpers only and never drive a traveler's legal deadline.
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
