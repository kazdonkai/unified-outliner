# Changelog

This project follows [Semantic Versioning](https://semver.org/). The entries below begin with the first Git baseline created after Phase 4F.

## [Unreleased]

## [0.1.4] - 2026-08-07

### Added

- Added a setting to control whether Outline Tree fold and unfold actions also affect the active Markdown editor.

### Fixed

- Replaced a parser array-initialization pattern reported by static analysis without changing parsing behavior.

### Changed

- Replaced the build-only `builtin-modules` dependency with Node's built-in module list.
- Expressed the drag-and-drop color fallback with a CSS feature query while preserving the existing appearance.

## [0.1.3] - 2026-08-06

### Fixed

- Handled Outline Tree View and Partial Edit Pane activation failures without leaking unhandled promise rejections from UI callbacks.
- Used the owning window's animation frame scheduler for popout-compatible Outline Tree scrolling.

### Changed

- Declared direct CodeMirror development dependencies and updated the build-only `builtin-modules` dependency.
- Consolidated the internal CodeMirror view lookup used by Outline Tree scrolling and leaf resolution.
- Removed an unused Outline Tree import while preserving the contextual command path.
- Updated the English and Japanese installation guides for Community Plugins, BRAT beta installs, and direct GitHub Release downloads.

## [0.1.2] - 2026-08-06

### Fixed

- Preserved user-positioned Outline Tree View and Partial Edit Pane leaves when the plugin unloads, rather than detaching them and resetting their workspace location on the next load.

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
