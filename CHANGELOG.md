# Changelog

This project follows [Semantic Versioning](https://semver.org/). The entries below begin with the first Git baseline created after Phase 4F.

## [Unreleased]

## [0.1.1] - 2026-08-06

### Changed

- Updated manifest and package metadata to meet Community Plugins submission requirements.
- Added English and Japanese user guides, screenshots, and short video walkthroughs.
- Added `versions.json` and repository metadata for release compatibility and traceability.

## [0.1.0] - 2026-08-05

### Added

- Unified editing of heading sections and list subtrees through commands and the Outline Tree View.
- Drag and drop for section and list subtrees.
- Partial Edit Pane for section and list subtrees with conflict detection before apply.
- Bidirectional synchronization between the Outline Tree fold state and CodeMirror fold state.
- Per-file fold-state persistence and the Phase 4F conflict policy for multiple Outline Tree leaves.
- Regression coverage for Phase 4F authoritative fold-state handling and its separation from Partial Edit Pane conflicts.

### Notes

- This is the initial public release of Unified Outliner.
- Callout, Mermaid, and table blocks are not supported as structural editing targets at this version.
