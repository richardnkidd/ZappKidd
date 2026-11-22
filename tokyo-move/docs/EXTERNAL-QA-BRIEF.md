# External QA brief (for an independent AI reviewer)

You are an independent QA reviewer for **Kadode**, a private two-person planning app for a household's staged move to
Tokyo. Review two things and return findings and suggestions: **(1) the project plan** and **(2) the app**. Be
skeptical and specific. Do not simply approve the existing plan or earlier reviews.

## Ground rules (follow exactly)

- **Read-only.** Do not edit, move or delete any file in this folder, except files you create inside `qa-findings/`.
  Do not change code, tests, `private/` or the database by hand.
- **No git changes.** Never run `git commit`, `push`, `checkout`, `reset`, `stash`, `clean` or anything else that
  changes the repository. `git log`, `git diff` and `git status` are fine.
- **Browser: this computer only.** Use the in-app browser only at `http://127.0.0.1:<port>` for the copy you start.
  Do not visit or sign in to any other site, email, government or work account.
- **Web research:** public official sources only (government, airline, manufacturer pages). **Never put household
  details (names, dates, medicines, employers, places) into a search query or any external service.**
- **No contact, no actions.** Do not email, message, book, buy, file or submit anything for anyone.
- **Honesty.** Unknown stays unknown. Never invent dates, amounts, eligibility or outcomes. Label each claim as
  verified (official source + date), inference, or opinion.
- **Sensitive data.** `private/` holds the real plan. Do not copy it anywhere else, and quote only what a finding needs.

## Setup

From this folder (`tokyo-move`), in the terminal:

```bash
PORT=8790 npm run preview -- --no-open
```

Open `http://127.0.0.1:8790` and pick a person to sign in. If `private/` is missing (demo-only review), use
`PORT=8790 npm run preview -- --demo --no-open` instead; the household is then fictional. Stop with Ctrl-C.

You may also run `npm run typecheck` and `npm test` (and `npm run test:e2e`, about 8 minutes) and report failures.
Clicking around the app changes only this copy's database, which is fine.

## What to read first

- `README.md`, then `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/OPERATING.md`, `docs/PRODUCTION-PATH.md`,
  `docs/TEST-REPORT.md`.
- If present: `private/reports/` (the newest scoping worklist, the scope decision, the handoff, the expert findings and
  dispositions) and `private/reviews/*-findings.md` (earlier reviews). **Do not repeat a finding that is already in
  the dispositions report unless you disagree with its disposition, and say why.**
- In the app: Home, Ready (each traveler), Plan (By area, List, Board, Timeline), Decide (Up next, Later, Questions),
  Money, Documents, Contacts & evidence, Arrival & living, What if the pet arrives later?, Couple review, Printable
  arrival pack, Data & imports, Settings.

## Part 1: the project plan

Judge the plan as it stands in the app and the private reports, including the household's latest answers. Look for:

- **Missing work** a household making this kind of move would need (people, the dog, health, money, home, belongings,
  documents, travel, arrival, the years abroad, the return).
- **Sequence and dates:** dependencies that are wrong, missing or circular; critical dates that look wrong or are
  calculated from the wrong date; things that should start now but are not flagged; summer/seasonal constraints.
- **Owners and load:** one accountable owner per item; is the load realistic for the adult who leaves last?
- **Risks** without a mitigation or trigger; single points of failure.
- **Scope:** anything that is not about the move (it should not be in the plan), and anything over-built for two people.
- **Questions** that should be asked and are not, or are asked of the wrong person.
- **Consistency** between the plan's text, its dates, the decisions already made and the household's answers.

## Part 2: the app

At a phone width (390 px) and a desktop width (1280 px):

- **Functional bugs:** broken flows, wrong numbers or dates, data not saving, conflicts, undo, filters, the Timeline
  (Gantt) chart, the couple review, printing the arrival pack, export.
- **Usability:** confusing wording, too much text, unclear next steps, hard-to-find features.
- **Accessibility (WCAG 2.2 AA):** keyboard use, focus, labels, contrast, screen-reader names, text at 200%.
- **Correctness and honesty:** unknown shown as unknown; tentative dates labelled; nothing presented as decided that is not.
- **Security observations** for a local app that will later be reachable only over a private network.
- **Suggestions for improvement** that would make it calmer, faster or more useful for two people.

## Output (write both files into `qa-findings/`)

1. `qa-findings/external-qa-findings.json`:

```json
{
  "reviewer": "external-qa",
  "model": "<the model you are>",
  "reviewed_on": "YYYY-MM-DD",
  "inputs_read": ["file paths and screens you used"],
  "limits": ["what you could not access, run or verify"],
  "findings": [
    {
      "id": "QA-001",
      "area": "plan | app",
      "severity": "critical | high | medium | low",
      "kind": "defect | gap | risk | improvement",
      "title": "short plain-language claim",
      "evidence": "file + line, or screen + exact steps to reproduce, or official URL + date read",
      "basis": "verified | inference | opinion",
      "impact": "what goes wrong for the household if this is not addressed",
      "recommendation": "the specific change",
      "owner": "Claude | one adult (by first name) | both adults | professional adviser | veterinarian",
      "due_or_trigger": "YYYY-MM-DD or a trigger such as 'before the first adult books travel'",
      "duplicates_existing": null
    }
  ]
}
```

   Set `duplicates_existing` to an earlier finding id when you are disagreeing with its disposition.

2. `qa-findings/external-qa-findings.md`: at most three pages. Start with the 10 findings that matter most, then list
   the rest by severity, then the improvement suggestions. Plain language; no jargon.

When you finish, stop the app (Ctrl-C) and say where the two files are.
