# Changelog

This project follows [Semantic Versioning](https://semver.org/). The entries below begin with the first Git baseline created after Phase 4F.

## [Unreleased]

### Changed

- Added the release compatibility map in `versions.json`.
- Added repository metadata to `package.json`.
- Split the README into separate English and Japanese documents, with English as the default entry point.
- Corrected the documented Phase 4F status, test count, fold-state reference, and development deployment instructions.

## [0.1.0] - 2026-08-05

### Added

- Unified editing of heading sections and list subtrees through commands and the Outline Tree View.
- Drag and drop for section and list subtrees.
- Partial Edit Pane for section and list subtrees with conflict detection before apply.
- Bidirectional synchronization between the Outline Tree fold state and CodeMirror fold state.
- Per-file fold-state persistence and the Phase 4F conflict policy for multiple Outline Tree leaves.
- Regression coverage for Phase 4F authoritative fold-state handling and its separation from Partial Edit Pane conflicts.

### Notes

- This is an internal development baseline. It has not been published as a GitHub Release or submitted to the Obsidian Community Plugins directory.
- Callout, Mermaid, and table blocks are not supported as structural editing targets at this version.
