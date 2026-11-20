# OpenScreen
Open-source, fully client-side systematic-review tool (import, dedup, screening, export). No backend.

## Status
v0.3: working UI - import (RIS/BibTeX/CSV/TSV), deduplication with review queue, merge/undo, manual screening with keyword highlighting, table, CSV export, PRISMA counts. Data persists in IndexedDB.

## v0.4: new UI + AI assist
- Redesigned interface: light/dark theme, animated tabs, stat tiles with count-up, drag-and-drop import, swipe-style decisions, undo (Z), toasts, skeleton loaders. Respects `prefers-reduced-motion`.
- AI assist via [OpenRouter](https://openrouter.ai) free models (bring your own free key, set it under "Set up AI"):
  screening suggestions (single or batch pre-screen), keyword suggestions from your review question, and an AI second opinion on possible duplicates.
  The model list is fetched live (free models only) with automatic fallback to other free models. AI never decides: suggestions need your click.
- Privacy: key is kept in this browser's localStorage only; the title/abstract of the record being assessed is sent to OpenRouter and the model provider.

## v0.5: teams
- **Team tab**: reviewer profile, work plan, blinding, share & sync, agreement (Cohen's kappa) and conflict resolution.
- **Work plan**: split records into ranges per reviewer (batches handed out in turn, equal blocks, or double screening) or edit ranges by hand. Numbers (#) are frozen when the plan is created. In Screen choose "My assignment" or a "Custom range" with a "Next batch" button.
- **Blinding**: other reviewers' decisions stay hidden until you finish your assigned records.
- **Share**: the lead exports a project file once (record IDs differ between browsers, so everyone must start from it). Reviewers then swap decision files, or use a shared folder.
- **Shared-folder sync** (Chrome / Edge / Opera on desktop): pick a folder in Dropbox, Drive, OneDrive, Syncthing or a network share. Files: `project.json`, `config.json` (plan, blinding, criteria; newest wins), and one `reviewer-<id>.json` per person, written only by that person.

## v0.6: Google Sheet sync (Android-friendly)
- Team > Live: Google Sheet works on any device. The lead deploys `apps-script/Code.gs` once; reviewers connect with a URL + token.
- Every decision becomes a tidy row in the lead's sheet (`Decisions`, plus a wide `Summary` with Final/Status) - download as CSV any time. See `apps-script/README.md`.

## v0.7: screening UX + logic
- Mobile: swipe right = include, left = exclude; sticky decision bar; scrollable reason chips; haptic tick.
- Queue: filter Undecided / Maybe / All; order In order / Most relevant (keyword score, title hits count double); Go to #; session ETA.
- Cleaner data: reasons stored only for exclusions; AI rationale goes to the note (prefixed `AI:`), not the reason column; undo works across filters.

## Roadmap
Workers, nbib/EndNote/JSON, RIS/XLSX export, P2P/hosted realtime sync.

## (older notes)
Increment 1: core library (types, normalizer, RIS parser, staged dedup engine) + tests.
Next: remaining parsers, workers + IndexedDB, merge/undo, UI, screening, export, AI, collaboration.

## Develop
    npm install
    npm test

## Dedup stages
1 normalize -> 2 exact (DOI / PMID / title+year) -> 3 blocking (first 3 title tokens, year +/-1)
-> 4 weighted fuzzy score (missing fields neutral, DOI conflict x0.5) -> 5 tiers (>=0.95 auto, 0.80-0.95 possible).
Errata/retractions never merge with originals; preprint-vs-published is capped at "possible".

## Run / deploy
    npm install && npm run dev      # local
    npm run build                   # outputs dist/
Vercel: framework Vite, build `npm run build`, output `dist`. GitHub Pages: publish `dist/` (base is `./`).
Repo root must contain package.json and index.html.
