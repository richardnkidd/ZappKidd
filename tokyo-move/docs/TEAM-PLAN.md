# Kadode — implementation plan, ownership and handoffs

Lead: Opus product/architecture lead (integration, final acceptance). Others are working in this codebase at the same
time: **preserve other agents' edits, stay inside your owned paths, and coordinate interface changes through the lead**
(add optional fields rather than renaming). Run `npm run typecheck` and your tests before handing off.

## Hard rules for every agent

1. The git repository is **public**. Never put real household data in committed paths. Real data is only under
   `private/` (gitignored). Committed fixtures use the fictional demo household in `fixtures/demo/`.
   Tests needing the real workbook read `TOKYO_SOURCE_DIR` and `describe.skip` when it is absent.
2. Do not contact anyone, book, pay, file, share, schedule, or write production tasks. Never touch
   `tasks.jsonl`, `recurring.jsonl` or `task_store_action_journal.jsonl`.
3. Unknown stays unknown (`null`), never 0 or a guessed date. Date-only values are `'YYYY-MM-DD'` strings.
4. Do not `git commit` or `git push` — the lead commits.
5. No new runtime dependencies without asking the lead (the dependency set has been security-audited: 0 known
   vulnerabilities). `npm install` uses `.npmrc` legacy-peer-deps.
6. Never render imported or user text as HTML (no `dangerouslySetInnerHTML`). Never log record bodies or secrets.

## Ownership

| Area | Owner | Paths |
|---|---|---|
| Domain contract | Lead | `src/shared/types.ts`, `src/shared/engine-contracts.ts`, `docs/ARCHITECTURE.md`, `src/server/db/migrations/001_init.sql` |
| Engines + import | Sonnet "engines" | `src/shared/{dates,deadlines,readiness,budget}.ts`, `src/import/**`, `scripts/import.ts`, `fixtures/demo/**`, `tests/unit/**` |
| Backend | Sonnet "server" | `src/server/**` (incl. `db/db.ts`, new migrations `002_*.sql`+), `scripts/{migrate,seed-demo,export,backup,restore,set-password}.ts`, `scripts/dev.mjs`, `tests/api/**` |
| Frontend | Sonnet "web" | `src/web/**`, `src/shared/labels.ts`, `tests/web/**`, `docs/DESIGN.md` (extend) |
| QA + docs | Sonnet "qa" (later) | `tests/e2e/**`, `playwright.config.ts`, `README.md`, `docs/TEST-REPORT.md`, `docs/OPERATING.md` |
| Reviews | Opus reviewers | `private/reviews/**` only |

## Interfaces between agents

- **Bundle:** parsers produce `ImportBundle` (types.ts). `src/import/apply.ts` exports
  `applyBundle(db, bundle, { actor, now }) → { run: ImportRun; changes: number; status }` and is the only writer
  of imported records. Corrections live in `src/import/corrections.ts` (generic, ID-based) and optionally
  `private/corrections/*.json` (real-data specific).
- **Demo data:** `fixtures/demo/bundle.ts` exports `buildDemoBundle(): ImportBundle` (fictional household, same ID
  scheme W01…, enough records to exercise every screen) and `fixtures/demo/task-store.json` (fixture task store seed).
- **Engines:** signatures are fixed in `src/shared/{dates,deadlines,readiness,budget}.ts`; result types in
  `engine-contracts.ts`. Web and server call them; nobody re-implements date or money math elsewhere.
- **Server:** `buildApp({ db, mode, dataDir, now? }) → FastifyInstance` in `src/server/app.ts` (tests use
  `app.inject`). `ensureDevIdentities(db, householdId)` in `src/server/auth/users.ts`.
- **Web:** consumes `/api/snapshot` and the endpoints in ARCHITECTURE.md §9 through `src/web/api/client.ts`.

## Delivery sequence

1. Lead: contract, schema, skeleton (done). Opus PM/relocation/immigration reviews run in parallel.
2. Parallel build: engines (dates → demo bundle + apply → deadlines/readiness/budget → real parser),
   server (auth, records, conflicts, audit, tasks adapter, export/backup/restore), web (design system → shell → Home →
   Plan → record detail → Decide → Money → Documents/Contacts → Arrival/Living → Future work → Data).
3. Lead integrates reviewed-model corrections from Opus findings; creative enhancements: guided couple review,
   "What if the dog arrives later?", printable arrival pack.
4. QA: e2e (mobile + desktop + keyboard), real-data import tests, test report. Opus UX/accessibility, security and
   functional reviews against the running app; PM + Japan specialists re-review; fix material defects.
5. Lead: docs, handoff, commit generic code.

## Handoff format (reply to the lead)

```
DONE: what works (with commands run and pass/fail counts)
FILES: paths created/changed
INTERFACES: anything others must know (new exports, fields, endpoints)
OPEN: known gaps, deferred items, risks
```
