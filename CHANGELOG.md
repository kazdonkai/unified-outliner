# Changelog

This project follows [Semantic Versioning](https://semver.org/). The entries below begin with the first Git baseline created after Phase 4F.

## [Unreleased]

## [0.7.0] - 2026-09-22

### Added

- Partial Edit Pane: opening a CompositeBlock (`list + callout` or `list + blockquote`) now shows a structured editor when the list member and trailing callout/blockquote member can be cleanly separated, instead of only a single raw-Markdown textarea. The list member gets its own single-line input, and the trailing callout/blockquote member reuses the exact same prefix-free structured editor (title, type, fold marker, and body edited separately, with no `>` prefix shown) already used for a standalone callout/blockquote. Apply, Cancel, dirty tracking, and conflict detection remain unified across the whole CompositeBlock — there is still exactly one save operation, never a partial save of just the list row or just the callout/blockquote row. Any structure the split/projection can't handle (an unsupported trailing member, a nested callout/blockquote, a gap between members) falls back to the previous raw whole-block textarea, unchanged.
- Partial Edit Pane: within a CompositeBlock's structured editor, the list member's input now hides its Markdown list marker (`-`/`*`/`+`) too, showing only the item's text — mirroring the marker-free treatment the trailing callout/blockquote member already had. This only applies when the list member is a single, unsplit line recognized by the existing grouping rules; a list item spanning multiple lines or containing a nested list, a task-list checkbox (`- [ ]`), or an ordered marker (`1.`) still shows its full raw line, unaffected. On Apply, the original marker, the whitespace after it, and the item's indentation are always restored exactly. Editing the list body so it no longer forms a valid CompositeBlock with the following callout/blockquote is not an error — the edit still saves, and the existing notice explaining that the blocks are now shown separately still appears; Apply is only ever refused for a genuine problem, such as the list body being edited into more than one line. A standalone list item (not part of a CompositeBlock) is completely unaffected by this change.
- Partial Edit Pane: a standalone (not part of a CompositeBlock) single-line unordered list item — top-level, directly under a heading, or nested as a leaf under a parent item — can now be edited without needing to type its Markdown list marker (`-`/`*`/`+`); the editor shows just the item's text. This only applies to a single-line leaf item with no nested child list and no continuation paragraph; an ordered item (`1.`), a task-list item (`- [ ]`), a multi-line item, an item with a child list, or an item with a continuation paragraph still shows its full raw line, unaffected. On Apply, the original marker, the whitespace after it, and the item's indentation are always restored exactly, and editing the body into more than one line is rejected with a notice, leaving the draft in place. This reuses the same marker/body model already introduced for a CompositeBlock's list member, and connects to the existing list Partial Edit save, Cancel, and conflict-detection path unchanged.
- Partial Edit Pane: a standalone single-line task-list item (`- [ ] ...` / `- [x] ...`) can now also be edited without typing its Markdown list marker or `[ ]`/`[x]` checkbox syntax — the editor shows just the item's own text, with a small checkbox control next to it for the completion state. The checkbox and the text can be changed independently or together, and both are restored to their original Markdown on Apply along with the original marker, checkbox brackets, and indentation. This only applies to a single-line leaf task item (same scope as the non-task marker-free editing above: no nested child list, no continuation paragraph); an ordered item, a multi-line item, a CompositeBlock task-list member, or a checkbox status other than unchecked/checked still shows its full raw line, unaffected.
- Partial Edit Pane: a standalone single-line ORDERED list item (`1.`/`12.`/`1)`/`12)`, at any indentation) can now also be edited without typing its Markdown number marker — the editor shows just the item's own text, with a small text field next to it for the item's number. The number and the text can be changed independently or together, and both are restored to their original Markdown on Apply along with the original delimiter (`.`/`)`, never itself editable this phase) and indentation. The number field validates strictly (a positive whole number only — an empty value, zero, a negative number, a decimal, exponential notation, or a value with surrounding whitespace are all rejected, with both the number and text drafts preserved) rather than relying on browser input behavior alone. Duplicate, non-sequential, or reverse-order numbers among sibling items are never a reason Apply is rejected — this pane never renumbers sibling items automatically. This only applies to a single-line leaf ordered item (same scope as the other marker-free editing above: no nested child list, no continuation paragraph); a task-list item, a multi-line item, or a CompositeBlock ordered-list member still shows its full raw line, unaffected.
- Partial Edit Pane: the marker-free editing above (unordered, task-list, and ordered) now ALSO works for a standalone MULTI-LINE leaf list item — one with one or more continuation lines, but still no nested child list of its own. The item's marker/checkbox/number is hidden exactly as for the single-line case, and the same checkbox/number controls are reused unchanged; the shared body field simply becomes multi-line, supporting adding, removing, splitting, merging, and pasting continuation lines. Continuation-line indentation is normalized to the item's own canonical column on Apply, while any indentation beyond that is preserved as body content; a continuation line indented more SHALLOWLY than that canonical column falls back to raw editing, as does a continuation containing a nested child list, or a callout/blockquote/fenced-code-block/table/thematic-break. A freshly edited candidate is re-verified to still resolve to exactly one safe leaf list item — never a manufactured nested list or one of those other block kinds — immediately before Apply; a candidate that fails this check is rejected with a notice and every draft field (checkbox, number, and the full multi-line body) is left exactly as edited. As with the single-line ordered case, sibling numbering is never auto-renumbered, and the marker type, checkbox status range, and ordered delimiter remain unsupported for editing this phase.
- Partial Edit Pane: the multi-line leaf list item editing above now also safely handles blank lines (paragraph breaks) inside the continuation body, for unordered, task-list, and ordered items that still have no nested child list and no callout/blockquote/fenced-code-block/table content in their continuation. Blank lines can be added, removed, or left in place anywhere in the middle of the body, and the original marker/checkbox/number and indentation are still restored exactly on Apply. A continuation immediately followed (after a blank line) by a callout, blockquote, fenced code block, table, or a deeper-indented nested list item still falls back to raw editing, unchanged; a blank line followed by a sibling list item or a heading is simply outside the edited item's own range and is left untouched either way.
- Partial Edit Pane: opening a list item that owns one or more nested child list items now shows a structured editor for the item's own text (marker/checkbox/number hidden, and continuation/blank lines editable, exactly like the leaf-item editing above), with its child items shown directly below as a read-only preview reflecting their existing indentation. The child preview is never editable from this pane — adding, deleting, reordering, or indenting a child item still goes through the existing Outline Tree/Subtree Navigator, unchanged. Applying an edit to the item's own text only ever rewrites that item's own lines; a child subtree that changes externally (for example from a Tree drag-and-drop, or from editing a child in its own Partial Edit session) while this pane is open never blocks Apply, as long as the item's own text hasn't also changed. An edit is still safely re-verified immediately before Apply, both on its own and once reattached to the child subtree, so an edit that would break the parent/child relationship (for example typing what looks like a new nested list item, or a callout/blockquote/fenced-code-block/table, into the continuation) is rejected with a notice and every draft field is left exactly as edited. A parent item whose own text can't be safely told apart from its children falls back to raw editing for the whole item, unchanged.
- Partial Edit Pane: the read-only child-subtree preview below a parent list item's own-text editor (added above) can now also be used to navigate into a child item. Clicking (or tapping) a previewed child or grandchild row — or focusing it and pressing Enter/Space — opens that item as the pane's new target, going through the exact same Apply/Discard/Cancel safeguard every other way of switching targets in this pane already uses: if the parent's own-text has no unsaved changes the switch happens immediately, and if it does, a dialog offers to apply the parent's changes first, discard them, or stay put, with the child only ever opened once that choice actually succeeds. The preview rows themselves remain fully read-only — clicking one never toggles its checkbox, edits its number or text, or lets it be dragged — this is a navigation shortcut only, never a second way to edit a child's content. Each click re-checks the target against the note's current content immediately beforehand, so a child that was deleted, moved, or edited elsewhere since the preview was last shown is never opened by mistake; the pane simply shows a notice and stays exactly where it was, with any unsaved parent edit left untouched.
- Partial Edit Pane: a direct child of a parent list item — as long as it's a leaf (no nested grandchildren) and could itself be safely edited by the existing marker-free/checkbox-free/number-free editors — can now be edited right inside the read-only child preview, without opening it as a separate pane. Hovering (or tabbing to) an eligible child's row now shows a small pencil icon; activating it opens a compact inline editor for just that one child directly below the preview, with the same marker-free body field and (for a task or ordered child) the same checkbox/number control the parent's own editor already has. This is a completely separate action from clicking the row itself, which still only navigates, unchanged. While a child is open this way, Apply saves the parent's own text and the child's text together, in one save — whichever of the two (or both) actually changed — so there is never a moment where only one of them is written to the note. Switching to a different eligible child, or closing the inline editor, while there are unsaved changes goes through the same Apply/Discard/Cancel dialog every other target switch in this pane already uses. A child that has grandchildren of its own, or whose content can't be safely marker-free edited (for example a continuation line containing a callout or code block), never shows the pencil icon — opening it for editing still requires navigating to it as its own pane, unchanged.
- Partial Edit Pane: a parent list item's read-only child preview now also lets you add a new direct child and delete an existing one, without leaving the pane. A small "+" button in the preview's own header appends one new, empty, plain (non-task, unordered) child item right after the parent's current last direct child, matching its indentation; a trash icon on each eligible child's row marks that one child for deletion, always behind a confirmation dialog regardless of whether its body is empty. Both are purely additive/subtractive drafts — nothing is written to the note until Apply, which saves them together with the parent's own text and/or an open inline child edit (from the feature above) in the exact same single save operation, so there is never a partial write of just some of them. This is only available for a parent that already has at least one direct child when the pane opens; adding the very first child to an item that currently has none is not supported yet. A child that isn't itself eligible for the inline editing above (one with grandchildren of its own, or unsafe to marker-free edit) likewise can't be marked for deletion — its row simply has no trash icon.

- Partial Edit Pane: a parent list item's read-only child preview now also lets you reorder its direct child items, without leaving the pane. Eligible children (the same leaf items the inline edit and delete features above already support) show small up/down buttons; each press swaps that child with its adjacent eligible sibling, and the reordered result is visible in the preview immediately, before Apply. A child with grandchildren of its own, or currently marked for deletion, is never crossed by a move, even as a side effect of moving another child past it. The buttons only appear at all when there's no blank line between any of the parent's direct children; when one exists, reordering isn't offered for that parent, and every other child-preview feature is unaffected. Reordering never renumbers an ordered list item's own number text, and is saved together with the parent's own text, an open inline child edit, an add, and/or a delete in the exact same single Apply as the features above — never a separate save.

- Partial Edit Pane: a parent list item's read-only child preview now also lets you indent a direct child leaf into its immediately preceding sibling (as that sibling's new last child), and outdent a child nested exactly one level deep back out to a direct child of the same parent, positioned right after its former parent -- without leaving the pane. Eligible rows (a 2nd-or-later direct child for indent; any one-level-deep leaf for outdent) show a small indent/outdent icon; activating one decides the transformation immediately, and the preview shows the resulting hierarchy right away, before Apply -- the note's Markdown is never touched until Apply is pressed. Only one indent or outdent can be pending at a time, and while one is pending every other child-preview action (navigation, inline edit, delete, reorder, add, and a second indent/outdent) is disabled for that parent; Cancel fully discards it, and switching targets while one is pending goes through the same Apply/Discard/Cancel dialog every other unsaved change in this pane already uses. Indenting into a sibling that already has children of its own adds the moved item as that sibling's new last child, after its existing children, which are left untouched; outdenting a leaf that has siblings of its own moves only that leaf -- its siblings stay exactly where they were, under the original parent. A checkbox's checked state and an ordered item's own number text are always preserved across either move, and neither move ever renumbers a sibling. This is saved together with the parent's own text in the exact same single Apply as the other child-preview features above, but is otherwise independent of them -- an indent/outdent never combines with an add, delete, or reorder in the same Apply. Moving anything more than one level, into an arbitrary parent, as part of a multi-node or subtree-carrying move, or via drag-and-drop remains unsupported.

- Partial Edit Pane: a leaf list item with no children of its own -- previously excluded from the "add a direct child" feature above -- can now gain its very first child too, right from its own (non-parent) editor, without leaving the pane. A new "add a child" button appears below the shared body field whenever the item is being edited as a standalone unordered, task, ordered, or multi-line leaf (never once it's already a real parent, which keeps its own separate add button in the child preview instead); activating it opens the same compact new-child editor the existing add feature already uses, alongside -- never instead of -- the leaf's own in-progress edit, and is disabled with a tooltip while a first child is already pending, preventing a second one. The new child is always plain, unordered, and non-task, indented one step past the leaf itself, exactly like every other newly added child. Applying saves the leaf's own text and the new child together in one save; the item then automatically reloads as a real parent, with the existing child preview, add, delete, reorder, and indent/outdent controls immediately available for it. Canceling the pending first child, or the pane as a whole, discards it completely and leaves the leaf exactly as it was, with nothing written to the note; switching to a different item while a first child is pending goes through the same Apply/Discard/Cancel dialog every other unsaved change in this pane already uses. A task item's checked state and an ordered item's own number are always preserved across the addition, and it never affects a following sibling, a heading, or any other block.

### Changed

- Partial Edit Pane: the shared unsaved-changes confirmation dialog (shown whenever you switch targets — Outline Tree, breadcrumb, Subtree Navigator, popout, hoist, child preview navigation, or the child inline add/edit/delete features above — while there's an unapplied edit) now shows two buttons, "Apply"/"Cancel", instead of three ("Apply"/"Discard"/"Cancel"), to match the pane's own top-level Apply/Cancel bar. This is a wording/presentation change only: internally the dialog still resolves to one of the same three outcomes it always did (apply, discard-and-proceed, or stay and keep editing) — the "Cancel" button now performs the discard-and-proceed action (previously labeled "Discard"), and "stay and keep editing" is reached by closing the dialog (✕, Escape, or clicking outside), exactly as it already was before this change. No target-switch safety behavior changes.
- Outline Tree: a CompositeBlock member (a callout/blockquote that is part of a `list + callout`/`list + blockquote` group) can no longer be opened as its own, independent Partial Edit session from its right-click menu — only the CompositeBlock's own parent-row menu opens an editor for it now, as part of the whole group. Move up/down for a composite member are unaffected.
- Partial Edit Pane: the pencil (edit), trash (delete), and up/down (reorder) icons on a parent's read-only child preview row now render at full opacity at rest, instead of the same dimmed 50% used for their hover/focus/disabled states — they had been hard to see against the pane's own muted background (reported on a real device). A reorder button that is genuinely disabled (first/last position) is unaffected and stays visibly dimmed.
- Partial Edit Pane: the pencil, trash, and up/down icons on a parent's read-only child preview row were a fixed, small size regardless of the plugin's own "Font Size" setting (Style Settings), making them hard to tap accurately on an 11-inch iPad (reported on a real device). Their icon size and padding are now expressed relative to that same font size, so the whole tap target — already a bit larger than before at the default size — grows right along with it when a larger font size is chosen, exactly like the row's own text already does.

### Fixed

- Partial Edit Pane: on an 11-inch iPad, opening a parent list item whose own-text is a task-list or ordered line (the structured editor added above) could show what looked like a completely blank pane, with no own-text field and no child-subtree preview visible, while the same item opened correctly on desktop and on a 13-inch iPad. The pane's own hidden checkbox/number-input rows (`composite-list-row`, `task-checkbox-row`, `ordered-number-row`) were still reserving their own padding and height even while hidden, pushing the own-text field and child preview below the visible area on a shorter screen; they are now fully removed from layout while hidden, matching the same fix already applied to this pane's other rows.
- Partial Edit Pane: in a parent's read-only child preview, the pencil/trash/up-down row-action icons (added above) could drift progressively further left, and the last row's icons could detach entirely into a separate row below the whole preview, on some screens (confirmed on a real iPad). Each preview row hosts up to three `float: right` icon groups but had no containment of its own, so a group even slightly taller than the row's own text line bled down into the next row; with several rows doing this in sequence, the drift compounded. Each row now establishes its own containing box (`overflow: hidden`) so its icon groups are always fully enclosed within that row alone, never bleeding into a neighboring row.
- Partial Edit Pane: after an Apply, undoing the change directly in the note's own editor (or any other external edit landing while the pane sat clean) refreshed the read-only child preview's own text, but left a previously-applied reorder, a pending deletion, or a pending new-child draft still showing in the preview, pointing at child items that no longer matched the reloaded note. The pane's general auto-reload path was rebuilding the parent's own-text projection fresh but not the add/delete/reorder session built alongside it; that session is now rebuilt fresh on every auto-reload too, matching how every other Apply/reload path in the pane already treats it.
- Partial Edit Pane: even after the float-containment fix above, a parent's read-only child preview could still show the pencil/trash icons on one line and the up/down reorder buttons alone on a separate line below, for a long enough child line or a narrow enough pane (reported on a real device). The three controls had each been floated independently, so each could independently wrap onto its own line once they and the row's own text no longer fit side by side. They are now grouped into a single flex item that is never allowed to shrink or split, so all three always render together on one line, in the same order, regardless of the child line's length or the pane's width; the row's own text now clips instead, rather than pushing a control onto another line.
- Partial Edit Pane: a leaf item's first-child addition (Mode B), once Applied, could be left stranded if the addition was then undone or redone directly in the note's own editor (an external Undo/Redo, not this pane's own Cancel) — the Subtree Navigator kept pointing at a child that no longer existed, and the "add a child" button did not return, leaving the pane in a state that was neither a correct leaf view nor a correct parent view. This happened because the pane's background auto-reload path (used only for changes landing from outside the pane) never recomputed the breadcrumb/sibling-nav/Subtree-Navigator data, and its projection-rebuild logic only re-checked whichever of the five leaf/parent projections had already been active, so a leaf-to-parent transition it hadn't seen before wasn't picked up. The auto-reload path now always recomputes the full navigation state and always re-resolves all five projections from the current note content, regardless of what was showing beforehand, matching what every other reload path in the pane already does.
- Partial Edit Pane: two of this pane's own Apply flows could leave the same kind of stale state described above, reachable without any external edit at all. Deleting a parent's only remaining direct child and Applying could leave the child preview, breadcrumb, and Subtree Navigator still referencing the now-gone child instead of switching back to the item's own leaf view; indenting or outdenting a direct child and Applying always changed the item's set of direct children but never refreshed the Subtree Navigator to reflect it. Both Apply flows now go through the same full-reconciliation step as the auto-reload fix above, so the pane's projection and navigation state are always rebuilt from the note as it stands immediately after each Apply.

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
