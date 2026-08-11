# Changelog

This project follows [Semantic Versioning](https://semver.org/). The entries below begin with the first Git baseline created after Phase 4F.

## [Unreleased]

## [0.3.3] - 2026-08-11

### Added

- Added a target-label preview to the Partial Edit Pane's sibling "Previous"/"Next" buttons, showing the destination sibling's own label (e.g. "‹ Previous  Markdown A") so it's clear where each button leads before it's clicked. A long label is truncated with CSS ellipsis; the button's own tooltip still shows the full label. No label is shown for a disabled direction (no sibling). Uses the existing sibling state and `requestLoadNode` transition path — no new navigation API or dirty guard.

## [0.3.2] - 2026-08-11

### Fixed

- Fixed the Partial Edit Pane's sibling "Next" button being pushed all the way to the pane's right edge (`justify-content: space-between`), far from "Previous" and awkward to reach. Both buttons now sit adjacent at the start of the row, matching the breadcrumb and Subtree Navigator rows above/below.

## [0.3.1] - 2026-08-11

### Added

- Added sibling previous/next navigation to the Partial Edit Pane header (docs/phase5b_sibling-navigation-spec.md), alongside the existing ancestor breadcrumb and Subtree Navigator. Two buttons let you move sideways to the loaded node's previous/next sibling — a section or list item sharing the same parent — without leaving the pane, including in a popped-out window. Each button disables itself when there is no sibling in that direction, and the destination's label is shown on hover. Navigation reuses the pane's existing guarded projection entry point, so unapplied edits are always confirmed (Apply / Discard / Cancel) before switching, exactly like breadcrumb and Subtree Navigator clicks already do.

## [0.3.0] - 2026-08-11

### Added

- Added a Japanese/English display language switch for this plugin's own UI (settings tab, command names, notices, modals, context menus, and the Outline Tree / Partial Edit Pane's own text). New `Language` setting at the top of the settings tab: `Auto` (follows Obsidian's own language setting), `Japanese`, or `English` — defaults to `Auto`. Editing behavior, command ids, hotkeys, and settings persistence are unaffected; only how this plugin's own text is displayed changes. Command names already shown in the Command Palette only update after reloading the plugin (or Obsidian) — a notice explains this each time the language setting changes.

## [0.2.3] - 2026-08-11

### Fixed

- Fixed the Outline Tree View's double-click-to-rename often failing to trigger. The double-click listener lived only on a row's text label, which is only as wide as its own text — double-clicking the empty space elsewhere in the row (common for short labels) missed it entirely. Double-click now starts a rename from anywhere on the row, except the fold/disclosure triangle, which keeps its own toggle-fold behavior.

## [0.2.2] - 2026-08-11

### Fixed

- Fixed the Outline Tree View's inline rename discarding an edit without any warning whenever focus left the input by any means other than pressing Enter — including simply clicking a different row to look at it. Moving focus out of the rename box now commits the edit (matching Finder/Explorer/VS Code tree-view conventions) unless the text was left completely unchanged, in which case it still cleanly cancels. Escape continues to always cancel explicitly.
- Fixed a related latent bug where committing an inline rename with the text left exactly as it started could insert a spurious blank line at the end of the note.

## [0.2.1] - 2026-08-11

### Fixed

- Fixed the Outline Tree View's long-press context menu on mobile (iPadOS/mobile Safari) sometimes failing to open, with a duplicated or corrupted pane appearing instead. Rows were marked `draggable="true"` even on mobile, where WebKit's native drag-lift gesture for touch-and-hold competed with the plugin's own long-press timer for the same gesture. Rows are now only marked draggable on desktop; mobile reordering was already available via the long-press menu's Move up/down and Indent/Outdent commands.

## [0.2.0] - 2026-08-11

### Added

- Added `Move section up` / `Move section down` commands that always move the whole enclosing heading section, regardless of where the cursor sits inside it.
- Redefined `Move block up` / `Move block down` to operate on the minimal safe unit at the cursor: a heading section, a list subtree, a plain paragraph, or — when the cursor is inside one — a whole callout, blockquote, fenced code block, or table. Ambiguous or unrecognized boundaries are rejected without editing the note.
- Added `Delete block (section / list subtree)`, `Insert sibling after current block`, and `Insert child list item` commands, wired into the Outline Tree View's context menu.
- Added inline rename for section headings and list items directly in the Outline Tree View: double-click a row (or press F2, or choose Rename from its context menu) to edit its text in place, with commit on Enter and cancel on Escape. Renaming is IME-safe, writes back through the plugin's normal safe edit path, and commits as a single Undo/Redo step. A newly inserted block is renamed automatically.
- Added mobile tap and long-press support in the Outline Tree View: a single tap selects a row, tapping an already-selected row starts inline rename, and a long-press opens the context menu.
- Added optional visual aids to the Outline Tree View: a subtle always-on background or left-edge stripe to distinguish section rows from list rows, a brief flash highlight on the row a `Move block` / `Move section` command just moved, and a short notice naming what was moved. All configurable under the new "Move & Outline Tree kind highlight" settings group (`Section background style in Outline Tree`, `List row highlight style in Outline Tree`, `Preview move target in Outline Tree`, `Show move result toast`).
- Added ancestor breadcrumb navigation and a Subtree Navigator to the Partial Edit Pane, for moving up to a parent or into a child block without leaving the pane.
- Added pop-out window support for the Partial Edit Pane, reachable from the Outline Tree View's node context menu.

### Changed

- User-facing text assembled by the plugin (notices, the move-result toast, and the Outline Tree View / Partial Edit Pane empty-state messages) now defaults to English, since the plugin is not limited to a specific language. This affects wording only, not behavior.
- The Partial Edit Pane now shows its Apply/Cancel controls only while there are unsaved changes, and its close button behaves consistently with that dirty state.

### Fixed

- Fixed the inline rename input in the Outline Tree View collapsing to a narrow width instead of filling the row.

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
