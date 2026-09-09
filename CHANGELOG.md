# Changelog

This project follows [Semantic Versioning](https://semver.org/). The entries below begin with the first Git baseline created after Phase 4F.

## [Unreleased]

## [0.6.1] - 2026-09-09

### Fixed

- Standalone callout Partial Edit Pane: closing the pane, editing the note body, and reopening the same callout could show stale, pre-edit content instead of the current body. The pane's loaded state (target, snapshot, draft, and displayed form) is now fully reset on close and whenever the pane falls back to its empty state, so reopening always reloads from the current note body.
- Fixed cases where a Partial Edit target could not be resolved (e.g. the block was deleted or no longer matches a supported structure) but the previously loaded editing form remained visible instead of the pane clearing itself.

### Changed

- Standalone callout and blockquote Partial Edit Panes now support adding, deleting, joining, and pasting body lines, instead of only editing the content of existing lines in place.
- Blank lines inside callout and blockquote bodies are safely preserved as quote continuation lines (a bare `>`) rather than becoming bare blank lines that would break the block.
- An emptied callout body can now be saved as a header-only callout (type/fold marker/title preserved, no body).
- Emptying a blockquote's body is rejected with a clear notice instead of being silently allowed, since that would amount to an implicit deletion of the whole block.
- Callout and blockquote edits are structurally re-validated against the current parser immediately before Apply, so an edit that would break the callout/blockquote structure is rejected and the note is left unchanged.

## [0.6.0] - 2026-09-09

### Changed

- Outline Tree: CompositeBlock ("extended block") rows now show a three-tier visual treatment — a left-edge accent border and subtle background tuned by row role (parent header, intermediate member row, terminating member row) — instead of one uniform accent, so the grouping reads clearly rather than as a single flat band.
- Outline Tree: tightened vertical spacing on ordinary list rows (`padding-top`/`padding-bottom: 1px`, `min-height: 28px` matching the drag handle's own tap-target height), so they sit visually closer to CompositeBlock member rows, which have no drag handle of their own.
- Outline Tree: equalized the text start position between paragraph rows (no drag handle) and list rows (drag handle) at the same nesting level — paragraph rows gained left padding and the drag handle narrowed slightly — so top-level and section-direct paragraph rows now start at very nearly the same horizontal position as list rows.
- Outline Tree: adjusted the nested-list indent step (first-level start position and per-level step width) via Obsidian's own `--nav-item-children-padding-start` / `--nav-item-children-margin-start` custom properties, scoped to this plugin's own tree panel only — File Explorer and the core Outline panel are unaffected.
- Partial Edit Pane: consolidated six per-row `margin-bottom` declarations into a single `gap` on the pane's flex container, and hid the sibling-navigation row whenever the loaded node has no sibling in either direction (previously it always rendered two permanently-disabled buttons and a row's worth of empty space).
- Partial Edit Pane: the callout/blockquote editing header now shows the Outline Tree's own callout symbol ("▣") instead of raw Markdown punctuation (`> [!`), the closing `]` is no longer shown, and the fold-marker dropdown's option labels are more compact ("Fixed" / "+ Expand" / "- Collapse"), giving the title field more room to expand.
- Settings: renamed and reworded "Show move result toast" to "Show notification after moving", replacing the jargon terms "toast" and the command names "Move block" / "Move section" with plain, outcome-focused wording.
- Settings: the "List + Callout" and "List + Quote" extended-block descriptions now each include a concrete illustrative use case (an image/PDF embed with its OCR notes; a citation with its quoted text) instead of a purely structural description.

### Fixed

- Partial Edit Pane: an Obsidian-internal mechanism (`toggleVisibility(false)` sets `visibility: hidden`, not `display: none`) was leaving hidden optional rows (sync status, breadcrumb, sibling nav, Subtree Navigator, quote header) occupying their full layout height even while invisible, producing a large empty gap above the edit textarea. Hidden rows are now fully collapsed out of the layout.

## [0.5.1] - 2026-08-25

### Fixed

- Corrected the "Show body paragraphs in Outline Tree View" setting description (English and Japanese), which had never been updated after 0.5.0 added paragraph editing: it still claimed the Tree only lets you view and jump to paragraphs, and that editing, inserting, deleting, or moving a paragraph from the Tree was not possible. Top-level and section-direct paragraphs have in fact supported all of these (rename in place, insert before/after, delete, move, and Partial Edit) since 0.5.0; the description now says so. No functional change.

## [0.5.0] - 2026-08-25

### Added

- Body paragraphs can be shown in the Outline Tree as their own nodes ("Show body paragraphs in Outline Tree View", off by default) and, once shown, edited directly: renamed in place, moved (adjacent swap via "Move block up/down", or via the tree's own "Move up/down" / "Move to top/bottom" / "Move before/after sibling…"), inserted ("Insert paragraph before/after"), deleted ("Delete paragraph", with confirmation), and opened in the Partial Edit Pane ("Edit paragraph…", or the new "Edit paragraph at cursor" command) — scoped to top-level and section-direct paragraphs.
- A standalone callout or blockquote (one not grouped into an extended block, see below) can now be moved from the Outline Tree ("Move up/down") and opened in the Partial Edit Pane, including as a popout.
- New built-in "Extended blocks" rules — "Image + OCR" and "Image + Quote" — recognize an image list item immediately followed by its OCR transcript or a quoted caption and group the two into one collapsible unit in the Outline Tree. The group can be moved ("Move extended block up/down", from the Command Palette or the tree) and deleted ("Delete extended block") as a single unit; each rule can be turned off independently in Settings → Extended blocks without changing the underlying Markdown.
- New setting "Outline Tree default sidebar" (right by default, or left) controls which sidebar a brand-new Outline Tree View opens into. Opening a Partial Edit Pane now places itself sensibly relative to wherever the tree actually is: it splits the same sidebar when the tree is on the right, or opens in the other sidebar cleanly when the tree is on the left — enabling a three-pane layout (tree, note, edit pane).
- New setting "List marker in Outline Tree" shows the Markdown list marker (`-`, `*`, `+`, `1.`, and so on) before each list item; off by default.
- New bilingual example note, `examples/Example outline note.md`, demonstrating every currently supported Outline Tree block type; linked from both READMEs.

### Changed

- The General settings tab is now organized into labeled groups (display language and sidebar position first, then Outline Tree contents, appearance, move operations, and editing/interaction, each separated by a heading divider) instead of one flat list.
- The user-facing "Composite Block" wording is now "Extended Block" everywhere in the UI, including a Japanese settings heading that had been left showing the English word "CompositeBlock".

### Fixed

- A standalone callout or blockquote nested under a list item now appears as that list item's own child in the Outline Tree, instead of always being placed directly under the enclosing section.
- Committing or rolling back a rename or a pending paragraph insert is now blocked if the active note changes to a different file while the rename is still pending, preventing an accidental write to the wrong note.
- Opening a Partial Edit Pane while the Outline Tree View is open in the right sidebar now reliably splits that sidebar so both remain visible, instead of the Partial Edit Pane sometimes covering the tree.

## [0.4.1] - 2026-08-14

### Fixed

- Corrected the GitHub Release tag to exactly match `manifest.json`'s version string (`0.4.1`), which had previously been pushed as `v0.4.1`. Obsidian's Community Plugins listing requires an exact match to resolve a release, so the mismatched tag prevented the plugin from being installable via in-app search. No functional or user-facing changes in this release.

## [0.4.0] - 2026-08-13

### Added

- New setting: "Heading prefix in Outline Tree" (General tab) — shows an optional badge before a section's heading text in the Outline Tree, indicating its heading level. Choices: don't show (default), "H1"–"H6", or "#"–"######" (the literal ATX marker count). Purely cosmetic; never changes the heading text itself.
- Read-only CompositeBlock projection in the Outline Tree (Phase 5D-0.3).
- Plugin settings reorganized into "General" and "Composite blocks" tabs.
- (UXP-01) Dragging a row on iPad now uses a dedicated drag handle with native HTML5 drag-and-drop, isolated from the long-press context menu gesture. Desktop drag behavior (grabbing the row itself) is unchanged. Verified against all 12 real-device acceptance criteria on iPad; see `docs/uxp-01-ipad-drag-context-menu.md`.

### Fixed

- Ordered list markers ("1.", "1)", a mid-list restart like "3.") were silently stripped from the Outline Tree's display text by the same logic that strips unordered bullets, so numbered lists appeared unnumbered in the Tree even though the document body itself was correctly ordered. Ordered markers now display correctly at every nesting depth; bullets remain marker-free as before.
- (UXP-02) Long-pressing a second row in the Outline Tree before dismissing the first row's context menu on mobile left both menus open and stacked, since the mobile DOM-rendered menu (unlike desktop's native OS menu) has no built-in "only one open at a time" behavior. The view now tracks its single open menu and hides it before showing a new one. Confirmed fixed on iPad and desktop; see `docs/uxp-02-long-press-menu-duplicate.md`.

## [0.3.5] - 2026-08-11

### Fixed

- Fixed the Partial Edit Pane's "Next" sibling button never showing its target-label preview, unlike "Previous" (reported: the two looked inconsistent). Obsidian's `setIcon()` replaces all of its target element's existing children with the icon — harmless for "Previous", whose icon is set before its target/label spans exist, but the "Next" button set its icon last, silently wiping out the target-label span that had just been created. Fixed by giving the icon its own dedicated wrapper span. No other behavior change.

## [0.3.4] - 2026-08-11

### Fixed

- Adopted `obsidianmd/eslint-plugin` (the official local check for Obsidian's automated Community review) and resolved everything it flagged in the plugin's shipped source: the Outline Tree View's inline-rename textarea auto-resize now sets its height through `setCssProps` instead of directly on `element.style` (a discouraged pattern per the developer guidelines), two internal `resolveMoveTarget.ts` helpers dropped a redundant type assertion each, and the "auto" UI-language detection in `main.ts` now reads Obsidian's own public `getLanguage()` accessor (available since 1.8.7, this plugin's own minimum version) instead of an undocumented `localStorage` key. Behavior is unchanged in all three cases. Added `npm run lint` for ongoing local checks against these guidelines.

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
