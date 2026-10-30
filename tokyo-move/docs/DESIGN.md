# Kadode design direction

A private home for a move, not enterprise PM software with a Tokyo wallpaper. Think of a calm, well-lit *genkan*
(entryway): paper, ink, indigo, a little persimmon. Quiet confidence; nothing shouts unless it is genuinely urgent.

## Principles

1. **Answer six questions fast, on a phone:** what matters now · who owns it · what is blocked · what decision is
   needed · what is next · is each traveler ready.
2. **Few decisions at once.** Never show more than three decisions awaiting a person on Home.
3. **Plain language.** No internal IDs (W45, DOC12), sync jargon or field names in normal screens. IDs appear only in
   a collapsible "Source & history" panel on record detail and on the Data screen.
4. **Honest states.** Unknown is shown as unknown ("Amount not known yet", "Awaiting date"). No completion
   percentages for immigration or readiness. Optional work looks optional (muted, labeled "Optional").
5. **Progressive disclosure.** Lists show title, owner, status, next date. Detail holds the rest.
6. **Calm urgency.** Legal deadlines and blockers get clear, restrained emphasis — never gamified, no confetti,
   streaks or scores.

## Identity

- Name: **Kadode** with **門出** set small in Noto Serif JP ("setting out on a new start").
- A one-line seasonal note on Home using the 24 solar terms (二十四節気), e.g. "霜降 Sōkō · Frost descends".
  Approximate dates; decorative only, never data.
- No stock imagery, no cherry-blossom clichés, no torii icons.

## Tokens (light; provide a matching dark theme via `prefers-color-scheme`)

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F6F3EC` | page background |
| `--surface` | `#FFFFFF` | cards |
| `--surface-2` | `#FBF8F2` | inset areas |
| `--ink` | `#1E1C19` | primary text |
| `--ink-2` | `#4A463F` | secondary text |
| `--ink-3` | `#655F55` | tertiary text (must still meet 4.5:1 on paper) |
| `--line` | `#E2DCCF` | borders |
| `--ai` (indigo) | `#2B4A6F` | primary actions, links, focus |
| `--ai-soft` | `#E7EDF4` | selected backgrounds |
| `--matcha` | `#47632F` | done / ready |
| `--kaki` (persimmon) | `#A9471F` | blocked, legal deadlines near |
| `--kin` (amber) | `#7A5300` on `#FBF0D9` | due soon / attention |

Verify every text/background pair meets WCAG 2.2 AA (4.5:1 body, 3:1 large text and UI component boundaries).
Never rely on color alone: pair with an icon shape and text.

Type: headings **Source Serif 4** (600), UI/body **Inter Variable**; Japanese glyphs **Noto Serif JP** (self-hosted
via @fontsource; no external requests). Scale 13/15/17/20/24/30/38 px; body 16–17px; line-height 1.5; max 68ch.
Spacing: 4px base (4, 8, 12, 16, 24, 32, 48). Radius 12–14px cards, 999px chips. Borders over shadows.

## Layout

- Mobile first. `< 768px`: bottom tab bar — **Home · Plan · Decide · Money · More**; ≥ 1024px: left rail.
- Content max-width ~1100px; single column on phones; generous 16–24px gutters; no horizontal scroll at 320px.
- Touch targets ≥ 44×44px. Sticky bottom bar respects `env(safe-area-inset-bottom)`.

## People

Each person has a monogram badge (initial in a circle for adults; a simple paw glyph for the dog) **plus the name in
text**. Ownership chips read "<name>", "Together", "Unassigned", "Proposed: <name>" (proposed owners are
visibly provisional until accepted).

## States (every screen must handle)

Loading (skeletons, not spinners), empty (one helpful sentence + next step), saved ("Saved · 2:14 PM HST"),
unsaved ("Unsaved changes" + Save/Discard), conflict ("<name> changed this while you were editing" — show both, choose),
error (what failed, what still works, Retry), offline/stale ("Showing data loaded 2:10 PM HST — can't reach the
app right now"), and pending task capture ("Waiting to be added to your task list").

## Accessibility (WCAG 2.2 AA)

Semantic landmarks and headings; real buttons/links; labels on every input; visible 3px focus ring (`--ai`,
2px offset); skip link; focus moves to the page heading on navigation and returns sensibly after dialogs;
`aria-live="polite"` for save/sync status; dialogs trap focus and close on Escape; no keyboard traps; target size ≥24px
minimum (44px preferred); `prefers-reduced-motion` disables transitions; timeline has a list/table alternative.

## Print

Arrival pack prints cleanly on A4/Letter: no nav, black on white, links shown as text, sensitive fields excluded by
default with an explicit opt-in per section.

## Implementation notes (web)

Source lives in `src/web/`. Plain CSS in `styles/` (`tokens.css` → `base.css` → `layout.css` → `components.css` →
`screens.css`); one stylesheet per layer, no framework.

**Tokens added to the table above.** `--line-strong` `#8A8375` (input and control borders, 3:1 on paper and cards),
`--stone-soft` (neutral chip fill), and soft fills `--matcha-soft`, `--kaki-soft`, `--kin-soft` for tone chips and banners.
`--line` is decorative only (dividers). Dark values are in the same file under `prefers-color-scheme`.
`tests/web/contrast.test.tsx` reads `tokens.css` and checks every foreground/background pair the CSS uses in both themes
(4.5:1 text, 3:1 boundaries/focus). Add a pair there when you add a token pairing.

**Shell.** Phone: header (wordmark, account button), content, fixed bottom tab bar (Home · Plan · Decide · Money · More)
with `env(safe-area-inset-bottom)`. ≥1024px: left rail (same `<nav>`, plus the "More" destinations listed under a rule).
Record detail opens as a right-hand panel on ≥1024px when reached from a list (the opener passes `backgroundLocation`
in router state) and as a full page on phones or a direct link. Focus moves to the page `<h1>` on route change
(not on first load); the panel heading takes focus when it opens and focus returns to the opening link on close.

**Components** (`components/`): `Card`, `Section`, `PageTitle`, `Chip`, `OwnerChip`, `PersonBadge` (initial or paw),
`StatusBadge`, `DeadlineBadge`, `VerificationNote`, `DateText`, `ItemCard`, `EmptyState`, `Skeleton`, `SaveIndicator`
(persistent polite live region), `ErrorBanner`, `StaleBanner`, `ConflictBanner`, `Dialog` (portal, focus trap, Escape,
makes `#root` inert, bottom sheet on phones), `Disclosure` (native `<details>`), `SegmentedControl`, `FilterChips`,
`Field` (label/hint/error wiring), `DataGate` (skeleton → content → error with Retry). Every icon is decorative; meaning is
always carried by adjacent text.

**Data and saving.** `state/snapshot.tsx` holds `/api/snapshot` with `status` (loading | ready | stale | error), `loadedAt`
and `refresh()`; it refreshes on focus/visibility and every 90 s, and keeps showing the last data (dated banner) if a
refresh fails. Writes go through `actions.*` and `useWrite()`, which send the `baseVersion` the person started editing
from, track Saving / Saved / Unsaved / Conflict / Error, and on a 409 show both versions so the person chooses. Engines
(`collectDeadlines`, `householdReadiness`, `dependencyChain`, `downstreamOf`) are wrapped in `attempt()`: a thrown error
renders an inline error for that section only.

**Honesty rules in the UI.** Review checkpoints that share a date collapse into one expandable "Proposed review
checkpoint · N items · not yet scheduled" row and never appear as deadlines. Any rule not `verified_official` shows a
plain verification note beside its date. `related` links are labelled "Related (nothing waits on these)". Imported text is
passed through `plain()`/`plainRefs()` before display so internal codes such as "(W02)" read as plain words; the original
is untouched in Source & history. Old commitment dates never appear in "Now" and never imply non-completion.

**Why `src/web/net/` and not `src/web/api/`.** Vite's `/api` dev proxy would swallow requests for any source file under a
top-level `api/` folder (`/api/client.ts`), so the client lives in `src/web/net/client.ts`.

### Phase 2 additions (web)

**Home on a phone.** A compact "Who's ready" strip (one tappable row per traveler) sits directly under the greeting and
opens `/ready/:personId` (holding things up, what unlocks it, still to do, done, after arrival). On wide screens the
right-hand cards stay, trimmed to two blockers plus "See everything for <name>". Filter chips scroll sideways inside their
own box on phones. Blocked shows three then "See all N"; Coming up shows four weeks / eight rows, then "Show the next 8 weeks".

**Dates, honestly.**
- A legal date on a weekend (or a listed public holiday) keeps its weekday and adds "Falls on a weekend — aim for <prior business day>".
- State `historical` (an old date in a read-only task-list copy, or a commitment flagged `historical`) is neutral grey text
  "Old date — not evidence either way". It never appears in Now or Blocked; it is listed once under "Old dates to check".
- A milestone shows only its own deadline or review date. Linked task dates appear as "In your task list: <date> (copy as of <date>)";
  a commitment that links to a milestone shows as "Recorded date" on that milestone and nowhere else. Done tasks never appear.
- "Needs a decision" order: dated needed-by within 30 days, then `settings.first_review.decision_keys` in order, then the rest.
- Instants are shown as the calendar day in the display zone (`dayIn`), never by slicing the UTC date.

**Screens.** Money (scenario switch, exchange-rate panel, cash picture for 90 days or three years, one card per section with
"known so far · N not known yet", edit one amount in one currency), Documents (four separate lifecycle facts, https link only,
originals never stored), Contacts & evidence & plan review findings (relationship needs a basis beyond "potential resource";
evidence shows verification from `direct_check` / `review_check_*`), Arrival & living in Tokyo (per traveler windows and dates,
continuing obligations with no date, renewals register, property, return planning), Future work (calm, optional, interest
selector), Data & imports (runs, receipts grouped by correction, task-list connection, export, backup/restore with RESTORE),
Settings (display zone, household default, appearance, scenarios). Every record type has a plain detail view (`TypedDetail`).

**Creative.** `/review` guided couple review (5 steps, optional gentle timer, saves a plain-text summary that names and links
every record it mentions and never marks work done); `/what-if` compares moving the pet's arrival using `previewAnchorChange`
and `computeBudget` without saving anything; `/arrival-pack` prints one page per traveler (A4 or Letter, black on white, links as
text, contacts by role only, health and money sections off unless ticked).

**Theme.** `data-theme="light|dark"` on `<html>` forces a theme; absent means follow the device. The forced-dark block is checked
against the system dark block in `tests/web/contrast.test.tsx`.

**Settings keys read defensively (not in the shared type yet).** `settings.first_review.decision_keys: string[]`;
`settings.staging_analysis` (text, lists or labelled groups; `pet_specific` shown separately); `data.direct_check { on, url, result, quote, note }`
and any `data.review_check_*` on rules and evidence.
