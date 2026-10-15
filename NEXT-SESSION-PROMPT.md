# Prompt for the next session

Copy everything between the lines into a fresh session.

---

You're picking up an in-progress feature branch for DocWriter (a local-first novel-writing app) at /home/rj/docwriter. Nothing is committed yet — confirm with me whether to commit the existing work before starting anything new.

START HERE
- Read /home/rj/docwriter/HANDOFF.md first. It is the running decision log (sections §18–§23) and records every design choice, deviation, and verification result. Do not reverse any of it without asking.
- Then read the working tree: git status (there is a large uncommitted change set plus untracked files).

WHAT THE APP IS
- Server: Express + Node's built-in node:sqlite (server/index.mjs, server/db.mjs, server/detect.mjs, plus pure-logic modules server/planning.mjs and server/entitymerge.mjs).
- Client: Vite + React + TypeScript in src/ (single-page shell in src/App.tsx, views in src/views/, styles in src/styles.css).
- Dev: `node scripts/dev.mjs` boots the API (port 5178, `node --watch server/index.mjs`) and Vite (port 5173). API is live right now unless it was stopped.

HOW TO WORK WITH ME
- We discuss before building. I often say "just the convo" first, then approve with "go for it" / "go for phase N".
- Keep changes surgical and consistent with surrounding code. Never do broad string replacements across JSX.
- Bind visual choices to the app's existing design tokens (colors AND fonts) — do not hardcode palette/font values. Bundled fonts only (Inter UI, Literata reading); stay offline.
- Every feature: run the existing checks and add tests for it, then summarize assumptions. Persist in the existing DB. Every "chapter" field is a dropdown fed from existing chapters (never free text). Chapter links go by id/number so renumbering/deleting never breaks them. Deletion is soft (Trash). Destructive actions need a confirm.
- After finishing a feature, append a new numbered section to HANDOFF.md.

CHECKS (all currently green)
- `npm test` → node --test server/*.test.mjs (33/33).
- `npx tsc --noEmit` → expect exactly 37 pre-existing errors, all in src/assets/fonts/fonts.css.ts; anything else is a real regression.
- `npm run build`.
- Integration/UI harnesses live in /tmp/opencode (not part of npm test): api-phase2.mjs, api-renumber.mjs, api-merge.mjs, ui-planning.mjs, ui-merge.mjs. They boot a throwaway server on a DOCWRITER_DB temp DB; run them SEQUENTIALLY (api-phase2 and ui-planning both use port 5199, so parallel runs cross-contaminate). The UI ones need `npm run build` first because they serve dist/.

ALREADY DONE (uncommitted, all verified)
- §18 Design port: dw-* drawer/bible/modal/search reskin, colors+fonts bound to app tokens.
- §19–21 Planning page (one nav item, two tabs): "Chekhov's Guns" and "Questions" — schema, pure logic, API routes, Review alerts + nav badge, full views. Guns link to chapters renumber-safely.
- §22 Chekhov's Guns semantics: Used is revisitable (POST /api/guns/:id/reopen), Fired is permanent (no unfire).
- §23 Entity merge: from an entity's Aliases field you can absorb a duplicate card. A survives, B's name/aliases become aliases of A, B's mentions/items/candidate links move to A, B's fields fill A's blanks, and B's card goes to Trash. No unmerge.

WHAT'S NEXT
- Character sheet + automatic scan is a large feature I have deliberately put on hold. Do not start it until I green-light it.
- I also want to add a few more features before shipping all of it. Ask me what I want next rather than guessing.

KEY DECISIONS NOT TO BREAK
- Entity pictures are base64 stored in entities.fields (Option A); Bible search is jump-to only.
- Death/possession are restricted by entity type. Delete is soft (Trash).
- Notifications piggyback the existing alerts table + nav badge (nullable gun_id, a gun_ready kind).
- chapters.number is free text and can be blank; effectiveNumber falls back to 1-based sort_order.
