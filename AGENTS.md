# StudyAL — Agent Instructions

## Product goal

StudyAL is an AI study platform being finished for product release.

Main study modes:

- Free Mode: functional; polish reliability, persistence, UX and tools.
- Adaptive Mode: nearly complete; preserve its pedagogical contracts and harden product reliability.
- Manual Mode: still to be built.
- Shared product systems include materials, selected pages, sessions, users, XP, leaderboard, calendar, agenda, notes and future features.

Do not assume Adaptive is the entire application.

## Before exploring code

Use the repository knowledge graph when available.

For codebase questions:

1. Run a narrow `graphify query`.
2. Use `graphify path` or `graphify explain` when useful.
3. Identify the smallest relevant set of files/symbols.
4. Read source only after narrowing the scope.

Do not scan the whole repository with broad grep/glob/read operations when Graphify can locate the relevant code.

Graphify is navigation assistance, not source-of-truth. Verify important behavior in actual source before modifying it.

## Canonical source identity

Study flows must respect the canonical SourceSelectionSnapshot.

It represents:

- selected materials;
- selected pages per material;
- sourceSelectionFingerprint.

Never silently replace an explicit page selection with the full material.

Never leak unselected pages into generation.

Free and Adaptive may share source-selection infrastructure but must not share progress/session identity accidentally.

Support 1–5 selected materials.

## Persistence and restore

Existing valid work must be restored before generation is considered.

Canonical principle:

RESTORE FIRST → GENERATE ONLY WHEN ABSENCE IS PROVEN.

A network error, timeout, 5xx, malformed response or failed restore does NOT prove absence.

Do not regenerate valid:

- plans;
- journeys;
- sessions;
- teaching;
- evaluations;
- user progress.

Refresh, navigation, Continue Studying and cross-device restore must preserve durable work whenever it exists.

## Adaptive invariants

Do not weaken pedagogical/mastery contracts to make tests pass.

Maintain:

- false mastery = 0;
- coverage and mastery as separate concepts;
- program completion only when the canonical engine confirms it;
- grounded generation from authorized source content;
- recoverable failures must not become false READY/mastery.

Do not introduce parallel frontend pedagogical engines.

## Free Mode

All Free tools must consume only their authorized source selection.

Session/cache identity must remain scoped to the correct session and source fingerprint.

Do not allow one Free selection to restore results belonging to another selection.

Do not allow Free and Adaptive sessions to collide.

## Product engineering rules

Prefer shared infrastructure over mode-specific duplication when the underlying contract is genuinely shared.

Do not hardcode behavior for individual subjects, PDFs, fixtures or examples.

Do not add architecture unless the existing architecture cannot correctly express the requirement.

Fix root causes rather than hiding errors.

Preserve existing valid work in the working tree.

## Git safety

Do not run:

- git reset
- git clean
- git checkout
- git restore
- git stash
- force push

Do not commit, push, deploy or change environment/secrets unless explicitly requested.

Do not delete unrelated work.

Generated reports/artifacts must not enter commits unless explicitly requested.

## Code quality

Do not hide type errors with `as any`.

Read the complete relevant function/module context before editing.

After modifying code, update the Graphify graph when appropriate.

Use focused tests during implementation and broader validation before declaring product work complete.

Do not claim PASS for tests that were not actually executed successfully.

## Final validation

Choose validation proportional to the change.

For substantial runtime changes, normally include:

- npx tsc --noEmit
- npm run pretest
- npm test
- relevant focused contracts
- relevant Playwright/E2E
- npm run build
- git diff --check

Do not run expensive unrelated historical suites automatically when they do not exercise the changed system.

## Current priority

Finish StudyAL as a reliable product.

Priority order:

1. data/source correctness;
2. persistence and restore;
3. no unnecessary regeneration;
4. study-mode functionality;
5. UX reliability;
6. visual/product polish;
7. new features.

When investigating a bug, trace the real user path end-to-end rather than fixing only the visible component.

@RTK.md
