# fineants — visual design direction (phase 1 UI)

Binding for Tasks 12–16. It overrides the plan's markup and styling suggestions; it never changes routes, data, queries, component names, props, or behaviour.

## Subject, audience, job

One person's money, pulled from their banks, read at home on a laptop and later mirrored on an ambient display. Audience: the owner, a developer. Primary job: an honest, fast read of "where do I stand" — balances, debt, spending — plus the ability to inspect the raw data underneath.

## Concept: the passbook

A bank passbook is a small book of ruled lines where every entry is printed and every balance is stamped. fineants borrows that: ruled ledgers instead of cards, one strong structural rule per section, large stamped figures for balances, and no decoration that is not information. The one memorable element is the balance hero: wide-set numerals that read like a stamp on paper. Everything else stays quiet.

## Tokens

Colour (light):
- `--paper` #F2F4F1 — page background (cool mist, not cream)
- `--paper-2` #E3E8E3 — rules, hover rows, input backgrounds
- `--ink` #16231F — text, rules, chart strokes
- `--ink-2` #556660 — secondary text
- `--cobalt` #1F4FD8 — interactive: links, focus ring, primary button, "now" markers
- `--bottle` #2C6E49 — inflow, positive balances
- `--oxblood` #9C3B2E — outflow, negative balances, failures
- `--ochre` #B8791A — pending, partial, warnings

Colour (dark, `prefers-color-scheme: dark`):
- `--paper` #0F1614, `--paper-2` #1B2521, `--ink` #E8EDE9, `--ink-2` #94A39B, `--cobalt` #8FA8FF, `--bottle` #6CC094, `--oxblood` #E58273, `--ochre` #E2AC4E

Type: one family, **Archivo** (Google Fonts, variable: `wdth` 62–125, `wght` 100–900), loaded via `next/font/google` with `display: "swap"` and fallback `system-ui, "Helvetica Neue", Arial, sans-serif`. Roles:
- Stamp (hero balances): `font-stretch: 112%`, weight 600, size `clamp(2.75rem, 6vw, 4.75rem)`, line-height 1, `font-variant-numeric: tabular-nums`, letter-spacing -0.01em
- Section title: weight 600, 1.125rem, normal width, sentence case
- Body: weight 400, 0.9375rem, line-height 1.55, max 72ch
- Ledger (tables): 0.875rem, `tabular-nums`, line-height 1.4
- Small: 0.8125rem, `--ink-2`
No all-caps labels. No monospace anywhere, including data. No eyebrow labels above headings. Numbers always tabular.

Layout:
- Content column max-width 72rem, everything left-aligned, 1.25rem side padding on mobile, 2.5rem on desktop.
- Header: wordmark "fineants" (weight 700, 1rem, normal width) at left; nav links inline to the right as plain text; current page marked by a 2px `--ink` underline offset 6px, not colour alone.
- The hero on Overview is the net position: one stamp figure per currency, stacked, each followed by a one-line sentence in body type describing the change since the previous snapshot in words ("Up $312.40 since Tuesday's sync", "No earlier snapshot to compare yet"). No gradient, no card, no icon.
- Sections: a 3px `--ink` rule across the full content width, then the section title on the left and the section's one meta line on the right (e.g. "20 most recent", "last 365 days"), then the content. This rule is the only structural device. No other borders except 1px `--paper-2` row rules inside ledgers.
- Ledgers replace cards everywhere: accounts, transactions, top payees, sync runs. Columns: text left, money right, dates right-aligned in a fixed-width column. Row hover: `--paper-2` background. Pending rows: amount in `--ochre` with the word "pending" in the date column, small type.
- Account detail: stamp figure hero with the account's own change sentence, then balance chart, then ledger.
- Forms (filters, settings): inputs with 1px `--ink-2` border, 2px radius, `--paper-2` background; buttons the same with weight 600; primary button filled `--cobalt` with `--paper` text. Keyboard focus: 2px `--cobalt` ring, 2px offset, everywhere.
- Radius: 2px on inputs and buttons only. No shadows. No gradients. No icons in phase 1.

Charts (Recharts): strokes in `--ink` for balance lines, bars in `--oxblood` (spent) and `--bottle` (received), no gradient fills, `--paper-2` horizontal grid only, axis text `--ink-2` 0.75rem, tooltip as a `--paper` plate with a 1px `--ink` border and tabular figures. Charts sit directly on the page under their section rule, no frame.

Motion: none on load. Hover/focus transitions ≤ 120 ms, colour only. Respect `prefers-reduced-motion` (there is little to reduce). The Sync now button shows its state by changing its own label: "Sync now" → "Syncing…" → "Synced" (then a plain sentence of results beside it).

Copy: sentence case, plain verbs, from the user's point of view. Empty states tell the user the next action ("Add your SimpleFin access URL to .env, then choose Sync now."). Errors say what happened and what to do; they do not apologise. No middle-dot meta strings; join meta with plain words or spaces. No arrows appended to links or buttons.

## Self-check against generic defaults

- Not cream + serif + terracotta: cool mist paper, single grotesque, cobalt/bottle/oxblood semantics.
- Not dark + single acid accent: light-first, dark mode is an inversion of the same tokens.
- Not broadsheet hairlines: one heavy 3px rule per section carries the structure; row rules are subordinate.
- Not the card kit: no cards, no shadows, no uniform radius.
- No eyebrows, no all-caps labels, no mono data labels, no middle dots, no arrows, no per-section fade-ins.
- Boldness spent once: the stamp figures.
