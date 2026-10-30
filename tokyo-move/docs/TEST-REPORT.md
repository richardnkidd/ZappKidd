# Kadode test report

Every number below was produced by running the command shown, on 2026-10-30, against the working tree at the time
(fictional demo data only, except the clearly marked real-data run, which reports counts and nothing else).

## 1. Result at a glance

| Suite | Command | Pass | Fail | Skip | Time |
|---|---|---:|---:|---:|---|
| Typecheck | `npm run typecheck` | clean (0 errors) | | | 16 s |
| Unit + API + web (no real data) | `npm test` | **543** | 0 | 13 | 21 s |
| Same, **with the real source package** | `TOKYO_SOURCE_DIR=<private package> npm test` | **556** | 0 | 0 | 21 s |
| Browser, all three viewports (run 1) | `npm run test:e2e` | 205 | 4 | 10 | 6 min 52 s |
| Browser, all three viewports (run 2) | `npm run test:e2e` | 205 | 4 | 10 | 6 min 8 s |

- The 13 skipped Vitest tests are the real-data tests in `tests/unit/real-import.test.ts`; they skip themselves when
  `TOKYO_SOURCE_DIR` is not set, so a public clone never needs household data. With the variable set all 13 run and pass.
- The browser suite is 219 test runs: 81 distinct tests across the three viewport projects (the API-only data-safety
  spec runs once). Two complete runs back to back gave the **same** result (205 / 4 / 10) with the same four failures, and
  the two specs that once showed a timing race (`resilience`, `conflict`) were then repeated five times each (120 runs, all
  passed). Retries are off (`retries: 0`), so a flaky test shows up as a failure instead of being hidden.
- The **4 browser failures are real findings in the app, not test problems** (see section 5). They are kept as failing
  tests on purpose so the fix has a test waiting for it.

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

### Vitest: `npm test` (556 tests in 33 files)

| Area | Files (tests) | Covers |
|---|---|---|
| **Unit: engines** | `dates` (23), `deadlines` (39), `readiness` (23), `budget` (22), `holidays` (10), `historical-dates` (4) | Civil-date arithmetic that never shifts across zones; calendar/business-day/month rules; deadline computation per traveler; anchor-change preview; per-traveler readiness and blockers; money model, FX, scenarios with unknown-stays-unknown; holiday calendar |
| **Unit: import** | `apply` (12), `corrections` (11), `import-text` (10), `xlsx` (7), `demo-bundle` (6), `real-import` (13, real data only) | Idempotent import, receipts, local edits kept; corrections applied once with receipts; plain-text cleanup; the XLSX reader; demo bundle integrity; real package counts and invariants |
| **API** (`fastify.inject`, temp databases) | `auth` (28), `security` (28), `screens` (27), `tasks` (19), `records` (18), `export-backup` (13), `status` (11), `decisions` (9), `xlsx-limits` (9), `cli` (7), `anchors` (6), `audit` (5), `misc` (4), `reviews` (3), `static` (2) | Sign-in, sessions, rate limiting, dev-identity rules per mode; host/origin/CSRF/headers/path guards; every screen's endpoints; task adapter flows incl. failures; optimistic concurrency and 409; status rules; per-person approvals; export/backup/restore incl. users rules; CLI scripts; audit and undo; static serving |
| **Web** (jsdom, Testing Library) | `contrast` (84), `logic` (42), `phase2` (22), `components` (17), `client` (16), `demo` (6) | WCAG contrast of every token pairing in both themes; Home/Plan selection logic; screen logic for Money/Documents/Arrival/etc.; shared components; API client error handling; the demo renders |

### Playwright: `npm run test:e2e` (13 specs, run against the built app in a real browser)

Three throw-away servers are started per run on ports 8920 (main), 8921 (read-only task list), 8922 (own database for
restore) and 8923 (task list that fails once), each with a fresh temporary database seeded with the fictional household.
Specs are written against roles, labels and visible text, check server state through the API where it matters, and
restore anything global they change.

| Spec | What it proves |
|---|---|
| `auth` | Sign in with a development identity; demo banner says fictional data; sign out ends the server session; a second person sees shared records but never the first person's private note (screen, snapshot, and direct fetch) |
| `home` | The six questions are answered; ≤3 decisions; every blocked item says why (and the reason is stored); per-traveler readiness for two adults and the dog; no "%" and no internal IDs on Home; the owner filters (Mine / other adult / Together / Unassigned / Waiting) list only matching items and say so when empty; filter remembered |
| `plan` | The four views list the same items (matches the server); view kept in the address; optional work hideable; filters and clear; a record opens as a panel (wide) or page (phone); **Blocked needs a reason, Done needs evidence, unsafe links refused**, and the server enforces the same; proposing an action defaults to **today + 14 days in the household zone**, "leave blank" stays blank, explicit dates kept; synced vs **"Waiting to be added to your task list"** (read-only list) vs **error + "Try again"** (failing task list) |
| `conflict` | Two browser contexts edit the same field: the second person sees both versions, and can keep the other's or re-apply their own; nothing is overwritten silently; history keeps both; same for the status dialog |
| `decide` | A joint decision stays "awaiting" until both adults approve the **same** option; disagreement is called out; household-approved only then; defer/reject need a reason; Home never shows more than three |
| `timezone` | Switching display zone (Tokyo / Honolulu / New York) never changes a date-only deadline's text on Home, Plan, record, Decide; times of day do follow the zone; the computer's own zone (UTC+14, UTC−11) makes no difference |
| `keyboard` | Skip link is first and works; Tab reaches the main navigation and primary actions with a visible focus ring; dialogs trap focus, make the app inert, close on Escape and return focus; the side panel returns focus to its link |
| `a11y` | On every route (24 fixed routes + one record of each type): no sideways scroll (320 px in `small-phone`), every input labelled, every button and link named, one h1, one main landmark, page title, no duplicate ids, no console errors or failed requests; dialogs named, labelled and on screen; sign-in screens (both kinds); best-practice checks for heading order, 24 px touch targets, and 200 % text |
| `plain-language` | No internal codes (W06, DOC12), raw status words, snake_case, raw timestamps or `undefined`/`NaN` in the visible text of any normal screen |
| `navigation` | The five destinations work and say where you are (`aria-current`); tab bar at the bottom on phones, rail on the left on wide screens; the tab bar never hides the end of a page; More reaches every screen; Back/Forward; deep links through sign-in; 404 pages; the readiness page |
| `resilience` | Offline: last data stays readable with a dated notice, recovers by itself; a failed save (network drop, then server error) keeps what was typed and succeeds on retry; session ending returns to sign-in; server unreachable on first load explains and retries |
| `later-screens` | Money (unknown stays unknown, partial totals labelled, scenarios, setting the exchange rate converts yen and clearing it restores "not known"); Documents (no upload, safe https link only); Contacts & evidence (candidate-only wording, relationship needs a stated basis); Arrival (per-person updates never touch the other person); Future work (undated, off Home); Data (counts match the server, real JSON/CSV downloads); Settings (per-device zone and theme, scenario validation and save); Couple review (five steps, nothing marked done, plan unchanged by saving); What-if (a comparison only: adults' deadlines unchanged, nothing written until asked); Arrival pack (sensitive sections off by default, print hides the app chrome) |
| `data-safety` (API plus one Data-screen flow; desktop only) | JSON export is a real file and carries the whole plan with no credentials; exports only contain what that person may see; CSV defuses formulas; **backup → change → restore returns the earlier state** and the restore is itself reversible; restore ends every session; a backup that would change who can sign in is refused unless `RESTORE-INCLUDING-USERS`; the Data screen's backup/restore flow; signed-out, wrong-Origin and non-JSON requests refused; other host names get 421; security headers and cookie flags |

## 4. Real-data tests

`tests/unit/real-import.test.ts` parses the private source package, imports it into a temporary database, and checks
counts and rules against it (every expected list present, every reference resolving, corrections and anchors behaving).
Run locally with:

```bash
TOKYO_SOURCE_DIR="/path/to/private/source-package" npm test
```

Observed on 2026-10-30 with the package at `private/source-package`: **13 real-data tests, 13 passed, 0 failed, 0
skipped**; the whole suite was 556 passed / 0 failed / 0 skipped in 21 s. Without the variable the same 13 are reported
as skipped. These tests and this report contain counts only: no real names, dates, amounts or text.

## 5. Findings the tests exposed (open app issues)

| Test | Where | What happens | Expected |
|---|---|---|---|
| `a11y › every route (best practice)` — **all three projects** | A **note** record page (`/r/note:…`, the first note a person writes) | Headings jump from the page's `h1` straight to an `h3` ("Source & history") | No skipped level (`h2` or a section heading in between). Earlier runs also caught the same pattern on Money, Documents, Contacts, Data and the decision/question/risk record pages; those were fixed during the build. |
| `a11y › text can be enlarged to 200 %` — **desktop** | Home, "Coming up": the collapsed "Proposed review checkpoint · N items · not yet scheduled" row | With the root font at 200 % the row is 1419 px wide in a 1280 px window, so the page scrolls sideways | The row wraps; no sideways scroll at larger text sizes |

Everything else the browser tests looked at passed, including defects the tests found earlier in the build that were
then fixed (an "Update status" button on the Arrival screen that was covered by its item's click area, so tapping it opened
the item instead; a readiness page that Home linked to but did not exist yet; heading levels on Money, Documents,
Contacts, Data and the decision, question and risk pages).

## 6. How to run, repeat and debug

```bash
npm run typecheck && npm test                                # fast, no browser
npm run test:e2e                                             # builds dist/web, starts 4 servers, runs everything
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
- **Skips are visible, not silent.** Ten browser runs skip by design (desktop-only global-state tests ×2 projects each,
  the wide-screen panel test on phones, the phone-only bottom-bar test on desktop, the 200 % test at 320 px, and the
  one-per-run injected-failure test in two projects); 13 Vitest tests skip without `TOKYO_SOURCE_DIR`.
