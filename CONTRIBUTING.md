# Contributing to Unified Outliner

This repository is the single source of truth for the plugin's code, tests, and implementation-adjacent technical specs (e.g. `docs/mixed-structure-spec.md`). A separate, private repository (`unified-outliner-internal`) holds planning and progress-tracking documents only — see [`docs/repository-roles.md`](docs/repository-roles.md) for why the split exists and what belongs where.

## Development setup

1. Install Node.js 20 or later.
2. Run `npm ci` in the repository root.
3. Run `npm run dev` while developing, or `npm run build` to generate the production bundle.

## Required checks

Before opening a pull request or preparing a release candidate, run:

```bash
npm test
npm run build
```

For changes that affect Obsidian UI behavior, also perform the relevant manual acceptance checks in an Obsidian desktop vault.

## Scope and safety

- Keep Markdown as the source of truth.
- Treat structural edits as potentially destructive. Preserve unsupported or ambiguous structures rather than rewriting them.
- Do not introduce network access, telemetry, or external services without documenting the behavior and obtaining an explicit design decision.
- Keep Obsidian API-dependent code thin and move deterministic structural logic into testable pure modules where practical.

## Reporting changes

Describe the user-visible effect, affected Markdown structures, test coverage, manual verification, known limitations, and any migration or compatibility impact.
