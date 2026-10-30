# Kadode test report

Every number below was produced by running the command shown, on 2026-10-30, against the working tree at the time
(fictional demo data only, except the clearly marked real-data run, which reports counts and nothing else).

## 1. Result at a glance

| Suite | Command | Pass | Fail | Skip | Time |
|---|---|---:|---:|---:|---|
| Typecheck | `npm run typecheck` | clean (0 errors) | | | 17 s |
| Unit + API + web (no real data) | `npm test` | **573** | 0 | 13 | 22 s |
| Same, **with the real source package** | `TOKYO_SOURCE_DIR=<private package> npm test` | **586** | 0 | 0 | 23 s |
| Browser, all three viewports (run 1) | `npm run test:e2e` | 227 | 4 | 18 | 7 min 12 s |
| Browser, all three viewports (run 2) | `npm run test:e2e` | 227 | 4 | 18 | 7 min 17 s |
| Browser, after the two fixes in §5 (final run) | `npm run test:e2e` | **231** | **0** | 18 | 6 min 42 s |

- The 13 skipped Vitest tests are the real-data tests in `tests/unit/real-import.test.ts`; they skip themselves when
  `TOKYO_SOURCE_DIR` is not set, so a public clone never needs household data. With the variable set all 13 run and pass.
- The browser suite is 249 test runs: 91 distinct tests across the three viewport projects (the API-only data-safety
  spec runs once). Two complete runs back to back gave the **same** result (227 / 4 / 18) with the same four failures.
  Retries are off (`retries: 0`), so a flaky test shows up as a failure instead of being hidden; the specs that once
  showed a timing race (`resilience`, `conflict`) were also repeated five times each (120 runs, all passed).
- Runs 1 and 2 exposed **4 real app failures** (section 5): three were one bug (shown in all three viewports) and one a
  layout overflow at large text. Both were then fixed (section 5) and the **final full run passed 231 / 0 / 18**. The
  unit count rose to 573 with two engine tests that guard the first fix.
- 18 browser runs skip by design (section 7).

## 2. Environment

| | |
|---|---|
| Machine | Linux 6.18 (Firecracker VM), Ubuntu 24.04.5, 4 vCPU Intel Xeon 2.8 GHz, 15 GB RAM |
| Node / npm | v22.22.0 / 10.9.4 |
| Browser | Chromium 153.0.8010.12 (the Playwright 1.63.0 build, preinstalled; headless) |
| Test tools | Vitest 4.1.12 (jsdom 26.1.0 for component tests), `@playwright/test` 1.63.0, TypeScript 5.9.3 |
| Browser projects | `phone` 390×844 (touch, mobile), `small-phone` 320×640 (touch, mobile), `desktop` 1280×800 |
| Browser settings | `en-US`, light scheme, reduced motion on, 2 workers (`E2E_WORKERS`), no retries |

Dates in the demo are fixed in the fixtures; "today" is the real clock (2026-10-29 in the household's Honolulu zone when
this was run), and the tests compute their expectations from the clock rather than hard-coding today.

## 3. What each suite covers

### Vitest: `npm test` (584 tests in 34 files)

| Area | Files (tests) | Covers |
|---|---|---|
| **Unit: engines** | `deadlines` (39), `dates` (23), `readiness` (23), `budget` (22), `holidays` (10), `historical-dates` (4) | Civil-date arithmetic that never shifts across zones; calendar/business-day/month rules; deadline computation per traveler; anchor-change preview; per-traveler readiness and blockers; money model, FX, scenarios with unknown-stays-unknown; holiday calendar |
| **Unit: import** | `apply` (12), `corrections` (11), `import-text` (10), `xlsx` (7), `demo-bundle` (6), `real-import` (13, real data only) | Idempotent import, receipts, local edits kept; corrections applied once with receipts; plain-text cleanup; the XLSX reader; demo bundle integrity; real package counts and invariants |
| **API** (`fastify.inject`, temp databases) | `screens` (31), `auth` (28), `security` (28), `tasks` (19), `records` (18), `export-backup` (13), `status` (11), `decisions` (9), `xlsx-limits` (9), `cli` (7), `anchors` (6), `audit` (5), `misc` (4), `reviews` (3), `static` (2) | Sign-in, sessions, rate limiting, dev-identity rules per mode; host/origin/CSRF/headers/path guards; every screen's endpoints; task adapter flows incl. failures; optimistic concurrency and 409; status rules; per-person approvals; export/backup/restore incl. users rules; CLI scripts; audit and undo; static serving |
| **Web** (jsdom, Testing Library) | `contrast` (84), `logic` (42), `phase2` (28), `components` (18), `round3` (17), `client` (16), `demo` (6) | WCAG contrast of every token pairing in both themes; Home/Plan selection logic; screen logic for Money/Documents/Arrival/etc.; shared components; API client error handling; the demo renders |

### Playwright: `npm run test:e2e` (14 specs, run against the built app in a real browser)

Four throw-away servers are started per run on ports 8920 (main), 8921 (read-only task list), 8922 (own database for
restore) and 8923 (task list that fails once), each with a fresh temporary database seeded with the fictional household.
Specs are written against roles, labels and visible text, check server state through the API where it matters, and
restore anything global they change.

| Spec | What it proves |
|---|---|
| `auth` | Sign in with a development identity; demo banner says fictional data; sign out ends the server session; a second person sees shared records but never the first person's private note (screen, snapshot, and direct fetch) |
| `home` | The six questions are answered ("This week", decisions, blocked, coming up, who is ready, recent changes); ≤3 decisions; blocked work says why (wide screens list it, phones say "Blocked: N" and each item states its reason on its own page); per-traveler readiness for two adults and the dog; no "%" and no internal IDs on Home; the owner filters (Needs me / Only mine / other adult / Together / Unassigned / Waiting) list only matching items and say so when empty; the first visit starts from "Needs me" on phones and everything on wide screens; filter remembered |
| `plan` | The four views (By area, List, Board, Timeline) list the same items (matches the server); view kept in the address; optional work hideable; filters and clear; a record opens as a panel (wide) or page (phone); **Blocked needs a reason, Done needs evidence, unsafe links refused**, and the server enforces the same; proposing an action defaults to **today + 14 days in the household zone**, "leave blank" stays blank, explicit dates kept; synced vs **"Waiting to be added"** (read-only list) vs **error + "Try again"** (failing task list); **a pending proposal is labelled "Waiting to be added" everywhere it is listed (Home, the item), never "in your task list" and never overdue, and stays out of plan work and the plan views** |
| `conflict` | Two browser contexts edit the same field: the second person sees both versions (side by side, or stacked on narrow screens), and can keep the other's, re-apply their own, or **"Combine them"** into the editor to tidy by hand; nothing is overwritten silently; history keeps both; same for the status dialog |
| `decide` | A joint decision stays "awaiting" until both adults approve the **same** option (Approve is offered only after "Review options and decide"); disagreement is called out; household-approved only then, and it moves to the Decided tab with a "Decided together" notice; defer/reject need a reason and land on Decided; Home never shows more than three, and Decide shows three "Up next" with the rest under "Later" |
| `timezone` | Switching display zone (Tokyo / Honolulu / New York) never changes a date-only deadline's text on Home, Plan, record, Decide; times of day do follow the zone; the computer's own zone (UTC+14, UTC−11) makes no difference |
| `keyboard` | Skip link is first and works; Tab reaches the main navigation and primary actions with a visible focus ring; dialogs trap focus, make the app inert, close on Escape and return focus; the side panel returns focus to its link |
| `a11y` | On every route (24 fixed routes + one record of each type): no sideways scroll (320 px in `small-phone`), every input labelled, every button and link named, one h1, one main landmark, page title, no duplicate ids, no console errors or failed requests; dialogs named, labelled and on screen; sign-in screens (both kinds); best-practice checks for heading order, 24 px touch targets, and 200 % text |
| `plain-language` | No internal codes (W06, DOC12), raw status words, snake_case, raw timestamps or `undefined`/`NaN` in the visible text of any normal screen |
| `navigation` | The five destinations work and say where you are (`aria-current`); tab bar at the bottom on phones, rail on the left on wide screens; the tab bar never hides the end of a page; More reaches every screen; Back/Forward; deep links through sign-in; 404 pages; the readiness page |
| `resilience` | Offline: last data stays readable with a dated notice, recovers by itself; a failed save (network drop, then server error) keeps what was typed and succeeds on retry; **the unsaved-changes guard**: a link or the Back button while typing asks "You have changes that aren’t saved" (Keep editing / Escape stays with the words intact; Discard and leave goes and saves nothing), the browser warns before closing the tab, and nothing is asked when there is nothing to lose; session ending returns to sign-in; server unreachable on first load explains and retries |
| `readiness` | **Conditional steps:** answering "Does this apply to Avery?" Yes / No / Not sure moves the step in and out of Avery's lists, changes the "N steps are left / still needs a yes or no" sentence (also on Home), is saved, and leaves Jun's own answer alone; long lists show three rows and "Show all"; folded date and step sections open to their rows. **The pet's dates:** the exam window reads "Not before … (window opens)"; when it opens on a weekend the advice names the first business day *inside* it (a later day), never "aim for" an earlier one; a weekday opening has no advice; dates in the next 90 days start open. **What if with no dates:** the field says what is needed, offers an example that is never saved, and shows "(optional)" only when the pet already has an arrival date |
| `later-screens` | Money (unknown stays unknown, partial totals labelled, scenarios, setting the exchange rate converts yen and clearing it restores "No exchange rate yet"); Documents (compact rows with "Details", no upload, filters whose counts match, safe https link only); Contacts & evidence (candidate-only wording, relationship needs a stated basis); Arrival (per-person updates never touch the other person); Future work (undated, off Home); Data (counts match the server, real JSON/CSV downloads); Settings (per-device zone and theme, scenario validation and save); Couple review (five steps with a done/current/not-started step list, nothing marked done, plan unchanged by saving, "Last review" kept); What-if (a comparison only: adults' deadlines unchanged, nothing written until asked); Arrival pack (sensitive sections off by default and only offered when something is sensitive, print hides the app chrome) |
| `data-safety` (API plus one Data-screen flow; desktop only) | JSON export is a real file and carries the whole plan with no credentials; exports only contain what that person may see; CSV defuses formulas; **backup → change → restore returns the earlier state** and the restore is itself reversible; restore ends every session; a backup that would change who can sign in is refused unless `RESTORE-INCLUDING-USERS`; the Data screen's backup/restore flow; signed-out, wrong-Origin and non-JSON requests refused; other host names get 421; security headers and cookie flags |

## 4. Real-data tests

`tests/unit/real-import.test.ts` parses the private source package, imports it into a temporary database, and checks
counts and rules against it (every expected list present, every reference resolving, corrections and anchors behaving).
Run locally with:

```bash
TOKYO_SOURCE_DIR="/path/to/private/source-package" npm test
```

Observed on 2026-10-30 with the package at `private/source-package`: **13 real-data tests, 13 passed, 0 failed, 0
skipped**; the whole suite was 584 passed / 0 failed / 0 skipped in 23 s. Without the variable the same 13 are reported
as skipped. These tests and this report contain counts only: no real names, dates, amounts or text.

## 5. Findings the tests exposed — now fixed

| Test | Where | What happened | Fix (verified by the final run) |
|---|---|---|---|
| `plan › a pending proposal never turns up in "Coming up"…` — all three projects | Home → "Coming up" (read-only task list) | A proposal still "Waiting to be added" was listed as a dated, committed item, and a past date read "past its date". | The deadline engine no longer turns a proposal (no id in the task list yet) into a date at all (`src/shared/deadlines.ts`), guarded by two unit tests in `tests/unit/historical-dates.test.ts`. |
| `a11y › text can be enlarged to 200 %` — desktop | `/plan?view=list` | The page scrolled sideways by 15 px. Cause: a screen-reader-only label inside a sortable column header was positioned relative to the page, escaping the table's own scroll box. | `.table-wrap` is now the positioning context and is held to the page width (`src/web/styles/components.css`). |

Everything else the browser tests looked at passed. Earlier findings that the build has since fixed, and that these tests
now guard: an "Update status" button on the Arrival screen that was covered by its item's click area; a readiness page that
Home linked to but did not exist yet; skipped heading levels on Money, Documents, Contacts, Data, the note, decision,
question and risk pages; the Home "Coming up" row that overflowed at 200 % text.

## 6. How to run, repeat and debug

```bash
npm run typecheck && npm test                                # fast, no browser
npm run test:e2e                                             # builds dist/web, starts 4 servers, runs everything (about 7 minutes)
npx playwright test --project=phone tests/e2e/plan.spec.ts   # one project, one file
E2E_SKIP_BUILD=1 npx playwright test tests/e2e/home.spec.ts  # reuse the existing dist/web
E2E_WORKERS=1 npx playwright test                            # slower, strictly one test at a time
npx playwright show-report                                   # HTML report; failures keep a screenshot and a trace
```

Servers for a run are created by `tests/e2e/support/start-server.mjs` (fresh temporary database each time, deleted on
exit; `KADODE_MODE=local-demo` always). `E2E_REUSE_SERVER=1` attaches to servers you started on the same ports.
Machine-readable results are written to `test-results/results.json`.

## 7. Limits: what is NOT tested

Be careful not to read "green" as more than it is.

- **One browser engine.** Chromium only. Safari/iOS WebKit and Firefox are not run; the phone projects are Chromium with a
  phone viewport and touch input, **not a real phone** (no iOS keyboard, safe-area insets, address-bar resizing, pinch
  zoom, or real touch latency).
- **No assistive-technology testing.** The accessibility checks are small DOM checks (names, labels, headings, focus,
  landmarks, sizes) and a contrast unit test. There is no axe-core run and **no screen-reader pass** (VoiceOver, NVDA,
  TalkBack); live-region announcements, reading order and the quality of the wording to a listener are unverified.
  Colour contrast is verified from the design tokens, not by sampling rendered pixels in context.
- **No visual regression.** Nothing compares screenshots; a layout can look wrong and still pass if it has the right
  roles, text and no overflow. Print is checked by emulating print media and a few computed styles, not by printing to
  paper or PDF on A4/Letter.
- **Real data only through the importer.** The browser suite never loads the real plan (it must not: the repo is public).
  The real-data Vitest tests check counts and rules, not how the real plan *looks or reads* in the screens; a human has to
  review that on the Mac (and the import receipts, with both adults).
- **Modes and deployment.** Only `local-demo` is exercised end to end. `local` with passwords, `staging` and `production`
  rules are covered by API/unit tests (startup refusals, secure cookies, dev-identity refusal), not by a browser against a
  real HTTPS deployment. There is no deployment, so no TLS, proxy, Tailscale or host hardening tests.
- **Task list.** Only the fixture and read-only snapshot adapters are tested. The `script` adapter (the real task list) is
  deliberately disabled, so live create/readback/complete against the real system is **not** tested and not done.
- **Concurrency is two people, a handful of requests.** Conflict handling is tested with two browser contexts and API
  races, not with load, long sessions, many tabs, or a database of production size (a few hundred records).
- **Time.** "Today" is the real clock; no test freezes the clock across midnight, a daylight-saving change in New York, or
  a year boundary in the browser (the engines' date maths has unit tests for these). The 90-second background refresh and
  the once-a-minute "new day" check are not waited for.
- **Security.** Checks are targeted (host/origin/CSRF/headers/cookies/path/size/rate limits/private notes/formula
  neutralisation/no raw HTML), not a penetration test or dependency audit run. Browser-side XSS was checked by rendering
  hostile text in API tests and by the "no raw HTML" rule, not by a fuzzer.
- **Operations not scripted.** Importing a *newer* version of the source package over edited data is covered by unit tests,
  not by the browser; backup restore across a schema change is covered by API tests; the CLI restore is covered by
  the `cli` API test, while the browser tests use the HTTP restore.
- **Locale and fonts.** English (US) only; the Japanese glyphs and self-hosted fonts are checked only in that nothing
  requests an external host (the strict CSP would block it and the suite fails on console errors).
- **Skips are visible, not silent.** Eighteen browser runs skip by design: tests that change household-wide state run in
  one project only (the exchange rate and the money scenarios, desktop; the conditional-step answers, phone; the pet-date
  and what-if-without-dates tests, desktop: 2 + 2 + 2 + 6 runs), the wide-screen panel test on phones (2), the phone-only
  bottom-bar test on desktop (1), the 200 % test at 320 px (1), and the once-per-run injected-failure test in two
  projects (2). 13 Vitest tests skip without `TOKYO_SOURCE_DIR`.
- **Shared dates are changed on a throw-away server.** The pet-date tests move the pet's departure and arrival dates on
  the read-only task-list server and restore them; they check the wording the screens give for the dates the engine
  computes, not the engine's arithmetic (that is covered by the Vitest suites).
