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
