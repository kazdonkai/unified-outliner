# Two-repository split (recorded 2026-08-12)

Unified Outliner's development spans two GitHub repositories. The local folder names and GitHub repository names are swapped relative to each other, which makes the split easy to misread.

| Local folder | GitHub repository | Role |
| --- | --- | --- |
| `~/Obsidian/unified-outliner-public` (this repository) | `kazdonkai/unified-outliner` (plain name) | The actual plugin source, tests, build configuration, and implementation-adjacent technical specs (e.g. `docs/mixed-structure-spec.md`). All code development happens here. |
| `~/Obsidian/unified-outliner` | `kazdonkai/unified-outliner-internal` | Planning documents, progress tracking (`TODO.md`), internal acceptance-test records, and internal-only reference material. No buildable source code — see that repository's own `docs/repository-roles.md` for the full rationale. |

## Why the split exists

Some internal reference material — notably WZ Editor reference PDFs used during early design — has unconfirmed redistribution rights and must never appear in this public repository, in the Community Plugin review, or in a distribution ZIP (see the internal repository's `docs/wz-reference-publication-assessment.md`). Since removing a file from a working tree does not remove it from Git history, a separate, clean-history repository was established here instead of trying to scrub history from the original.

`docs/phase5-implementation-plan.md` (approved 2026-08-07, stored in the internal repository) formally designated this repository as the implementation target from Phase 5 onward. As of 2026-08-12, the internal repository's own copy of the source code — frozen at the Phase 4F baseline — was removed entirely, since keeping a stale snapshot there (even with a note) kept signaling "this is where you build and test" regardless of what any README said.

## Practical implication

A single logical change that touches both a technical decision here (e.g. a spec update) and a tracking entry there (e.g. a `TODO.md` line) requires two separate commits, one per repository — they cannot be combined into one.
