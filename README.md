# Unified Outliner

English | [日本語](README.ja.md)

> **Development status:** Phase 4F is complete. This is an internal development build, not a GitHub release or an Obsidian Community Plugins distribution.
>
> **Data protection:** Back up any note before trying structural editing. Do not include confidential or personal information in bug reports.

Unified Outliner is an Obsidian plugin for moving heading sections and list subtrees up or down within a single note through one consistent user experience. It does not move content between notes. In addition to editor commands, it provides the right-sidebar **Outline Tree View** for inspecting and editing structure, and the **Partial Edit Pane** for editing one selected section or list subtree in isolation.

Implemented capabilities include: Outline Tree View browsing (Phase 2A); block commands in the tree (2B); fold-aware contextual commands (2C); section-subtree drag and drop (3A); section editing in the Partial Edit Pane (3B); list-item display (3C); list-subtree drag and drop (4A); full list-item-body tooltips (4B); list editing in the Partial Edit Pane (4C); documented mixed-structure boundaries (4D); per-file fold-state persistence and synchronization (4E); and fold-state conflict resolution (4F). The mixed-structure rules are specified in `docs/mixed-structure-spec.md`.

## Outline Tree View

The custom right-sidebar view displays the heading structure of the active Markdown note and synchronizes with the body editor.

- **Open it:** Run `Open outline tree view` from the Command Palette or click the `list-tree` ribbon icon. If the view already exists, the plugin reuses its leaf and reveals the right sidebar with `revealLeaf`; otherwise it creates a leaf with `workspace.getRightLeaf(false)`.
- **What it shows:** By default it shows only `SectionBlockNode` heading nodes. Enable **Show list items in Outline Tree View** to include list items.
- **Body to tree:** Moving the editor cursor highlights exactly one matching tree node. With list display off, a cursor on a list line highlights its containing section; with it on, the list item itself is highlighted.
- **Tree to body:** Clicking a node moves the editor cursor to the matching heading line, or to the list-item line when list display is enabled, and scrolls the editor to it.
- **Tree folding:** Each tree node can be expanded or collapsed. This state belongs to the Outline Tree View; it is not the editor's CodeMirror 6 fold state.
- **Frontmatter and code fences:** Heading-like lines in frontmatter and fenced code blocks are excluded by the parser, so they never appear in the tree.

### Block commands from the tree (Phase 2B)

Right-click a section node to run these block-oriented commands:

| Menu item | Behavior |
| --- | --- |
| Move subtree up | Swaps the section subtree with its previous same-level sibling section, using the same pure function as `move-block-up`. |
| Move subtree down | Swaps it with the following same-level sibling section, using `move-block-down`. |
| Indent subtree | Lowers by one level every heading in the section and its descendants, using `indent-block`. |
| Outdent subtree | Raises by one level every heading in the section and its descendants, using `outdent-block`. |

These commands always operate on a section subtree regardless of its expanded state. The view does not duplicate feasibility, destination, or edit logic: `tree/treeBlockCommand.ts` calls the pure functions in `move/moveBlock.ts` and `move/indentBlock.ts`, while the shared Obsidian-dependent layer `commands/applyLineEditOutcome.ts` applies the outcome to the editor.

The same constraints as the body commands apply. Indentation requires a preceding sibling section and must not push any heading past level 6; outdenting must not raise the target above level 1; moving requires a same-level sibling. Unavailable operations are signaled with a ban icon, a `— unavailable` title suffix, and `setWarning()` styling. A race between preflight and execution, such as a note changing after the menu opens, safely becomes a no-op; **Show no-op notices** optionally explains why. After a block operation, the tree rebuilds immediately, highlights the section in its new position, and moves the editor cursor to its heading.

### Fold-aware contextual commands (Phase 2C)

The same context menu also has contextual commands, separate from the explicit subtree commands above. Their target unit depends on the Outline Tree View's own local collapsed state:

| Menu item | Collapsed node | Expanded node |
| --- | --- | --- |
| Move up (contextual) | `move-block-up`: move the section subtree | `move-node-only-up`: swap heading text only |
| Move down (contextual) | `move-block-down` | `move-node-only-down` |
| Indent (contextual) | `indent-block`: cascade through descendants | `indent-node-only`: alter that line only |
| Outdent (contextual) | `outdent-block` | `outdent-node-only` |

A collapsed node means “treat as subtree”; an expanded node means “treat as node only.” This does not read or alter CodeMirror 6 fold state and does not change the semantics of editor commands. Explicit **Move/Indent/Outdent subtree** commands remain available and always use block behavior. Contextual-menu titles show the active `subtree` or `node-only` mode before execution.

The dispatch layers are deliberately narrow: `tree/treeBlockCommand.ts` runs block operations, `tree/treeNodeOnlyCommand.ts` calls `move/moveNodeOnly.ts` or `level/setNodeOnlyLevel.ts`, and `tree/treeContextualCommand.ts` chooses between them from `isCollapsed`. No-op messages are shared through `NOOP_MESSAGES` in `commands/applyLineEditOutcome.ts`. Every operation rebuilds the tree; node-only operations leave the cursor and highlight on the same physical line, whose label has changed.

### Section-subtree drag and drop (Phase 3A)

Dragging a section node reorganizes its entire section subtree. It supplements rather than replaces context-menu commands.

- The dragged unit is always the heading, body text, child sections, and contained lists. Node-only heading movement is not a drag operation.
- The hover row is split vertically into thirds: the top third is **before** with no level change; the middle third is **inside**, appended as the target's last child while preserving descendant level differences; the bottom third is **after**, following the target's full subtree with no level change.
- Before and after use top or bottom guide lines; inside uses a pale row highlight and leading accent bar based on `--uo-current-color`. The source node becomes translucent while dragging.
- Dropping on the source itself or a descendant is rejected before drop. Dropping on an ancestor is permitted, allowing a node to be promoted out of its parent. `move/relocateSection.ts` repeats the safety check and safely no-ops if necessary.
- The pure relocation logic is isolated in `move/relocateSection.ts`, which composes `insertBlockAt`, `collectSectionSubtree`, and `setHeadingLevel`. The view determines only `before`, `after`, or `inside` from pointer position.

Multiple selection and cross-note drag and drop are not supported. Section drag has no effect on CodeMirror 6 folding. List-subtree dragging is supported separately below.

### List-subtree drag and drop (Phase 4A)

When list display is enabled, list items can be moved through the same drag interaction. Drag state, indicators, and thirds detection are shared with section dragging; only validation and relocation dispatch differ by node kind.

- A list drag moves the item and every nested child list. `ListBlockNode.range` already represents that whole subtree.
- A list can be dropped on either a list node or a section node. A section cannot be dropped on a list; section dragging remains section-to-section only.
- On a list target, **before** and **after** insert a sibling on the target's indentation column; **inside** appends as the last child, using the existing child indentation or one newly nested level.
- On a section target, **before** inserts before the heading as a root list item; **inside** appends to the section's root list items. **After** deliberately has the same result as **inside**: Markdown has no text position that can express a non-heading sibling after a section's full subtree, because non-heading content after the target is absorbed by the deepest currently open heading.
- Indentation is recalculated for every placement with `growIndent` and `shrinkIndent`. Unlike heading levels, raw list indentation has meaning only relative to surrounding list items.
- Drops onto the item itself or its descendants are rejected; a drop onto an ancestor is allowed. Any source or list target with unsafe mixed tab-and-space indentation is rejected. A list-to-section drop cannot create a list cycle, so cycle checks are required only for list targets.
- Pure logic is in `move/relocateListSubtree.ts`, reusing `insertBlockAt`, `expandToListRegion`, `normalizeOrderedMarkers`, `growIndent`, and `shrinkIndent`. The view chooses `canDropOn`/`relocateSection` or `canDropListOn`/`relocateListSubtree` according to source kind.

Node-only list dragging, full support for complex list structures interrupted by paragraphs, cross-note drag and drop, and multi-selection are not supported.

### Appearance and Style Settings

Outline Tree View colors and font size use plugin-owned CSS custom properties such as `--uo-bg-color`, rather than depending on Obsidian theme variables. Therefore switching the Obsidian theme does not automatically change the view's appearance.

- Light and dark defaults are defined in `.theme-light` and `.theme-dark` in `styles.css`, and work without the [Style Settings](https://github.com/community-archive/obsidian-style-settings) plugin.
- With Style Settings installed, the `/* @settings ... */` block adds a **Unified Outliner** settings section. Light and dark modes can independently set Background Color, Text Color, Highlighted Node Color, Muted Text Color, and List Item Text Color; Font Size is shared.
- The properties are `--uo-bg-color`, `--uo-text-color`, `--uo-current-color`, `--uo-muted-text-color`, `--uo-list-text-color`, and `--uo-font-size`. Style Settings emits higher-specificity values through `body.theme-light.css-settings-manager` and `body.theme-dark.css-settings-manager`, so no extra override CSS is needed.
- `main.ts` calls `this.app.workspace.trigger("parse-style-settings")` in `onload()` to ask Style Settings to rescan. Standard Obsidian tree classes still provide spacing and fold arrows; only colors and font size are customized.

### Showing list items (Phase 3C)

**Show list items in Outline Tree View** is off by default. Enabling it adds list items to the tree and supports browsing, jumping, highlighting, folding, full-body tooltips, list drag and drop, and list-subtree editing.

`OutlineTreeNode` in `tree/buildOutlineTree.ts` is a discriminated union with `kind: "section" | "list"`. Without `includeLists: true`, behavior remains section-only. With it enabled, root list items become section children and nested items become list children. Because `ParsedDocument.childIds` is not necessarily document order, `buildOutlineTree` sorts children by line number before building the tree.

List items can be clicked to jump to their body lines. `resolveHighlightedNodeId(doc, cursorLine, { includeLists })` highlights the item itself when lists are included, otherwise it resolves to the containing section. Nested lists share the normal `collapsedIds` state and `.tree-item-children` indentation. They use `unified-outliner-list-text`, a lighter weight and slightly smaller size than headings, plus the dedicated readable `--uo-list-text-color` rather than the overly faint muted-text color.

#### Long labels and tooltips (Phases 3C.1, 4B, 4B.1, 4B.2)

Long list labels stay on one line and use `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`; the truncation point responds to sidebar width. Obsidian's `setTooltip()` API, rather than an HTML `title`, displays the complete body. This originally required `minAppVersion` 1.4.4.

The tooltip now includes the list item's own complete body: its marker line plus continuation lines, excluding child lists, fenced-code content, and frontmatter. `lineToOwningNodeId` makes this a direct ownership check, avoiding reimplementation of indentation parsing. Blank runs are omitted and continuation indentation is removed for display. The pure helpers `collectListItemBodyLines`, `formatListItemBodyLines`, and `extractListItemBodyText` reside in `edit/listBodyRange.ts`.

The tooltip uses `setTooltip` classes, available from Obsidian 1.8.7, to attach `unified-outliner-list-tooltip`; `.tooltip.unified-outliner-list-tooltip { text-align: left; }` limits left alignment to this tooltip. Continuation indentation uses an EM SPACE in `CONTINUATION_INDENT`, not a normal space or a CJK-specific ideographic space, so it survives CSS whitespace collapse and remains natural for both Latin and CJK notes.

### Partial Edit Pane (Phases 3B, 3B.1, 4C)

The Partial Edit Pane lets you edit exactly one section subtree or list subtree in an independent pane. The original note remains the source of truth: the pane temporarily extracts the target range and replaces only that range after an explicit **Apply**. It is not an editor that replaces the whole note.

- Open a section with **Open partial edit pane** from a tree node or **Open partial edit pane for current section** from the Command Palette. Open a list with **Edit list subtree in pane** from its tree item. An existing pane leaf is reused.
- It shows raw Markdown. A section includes its heading, body, child headings, and contained lists; a list includes its marker line and child lists. Structural lines are editable. The header identifies `Editing (Section)` or `Editing (List)` with the node label.
- **Apply** replaces only the target range. It does not autosave or provide live bidirectional synchronization. On success the editor cursor moves to the target's new start line, and normal `editor-change` processing rebuilds the tree, highlighting, tooltips, and drag behavior.
- **Cancel** restores text last loaded or applied. The header close button detaches the leaf; closing also discards unsaved edits.
- A pane restored as part of startup layout closes itself before rendering while `workspace.layoutReady === false`, avoiding an orphaned empty pane after restart.
- Apply always refuses, with a Notice, if the target id no longer resolves; for lists, if unsafe indentation is present; or if the original text differs from the current source range, indicating a conflict. There is no diff or merge UI.
- `edit/partialEdit.ts` offers generic `extractSubtreeText` and `applySubtreeEdit` for both node kinds; `extractSectionText` remains a compatible thin wrapper. `view/PartialEditView.ts` handles both kinds through `loadNode(nodeId)` and `applyEdit()`, varying only its header label. The active Markdown view comes from shared `view/activeMarkdownViewTracker.ts`.

The pane does not export or import a whole list subtree as another file, edit multiple selected list subtrees, or synchronize live with the body editor. Phase 4F completes fold-state conflict resolution between concurrent editing surfaces; see the dedicated specification in the references.

## Mixed-structure boundaries (Phase 4D)

`docs/mixed-structure-spec.md` defines the subtree boundaries used by move operations and the Partial Edit Pane for contiguous headings, paragraphs, and lists.

- Existing parser ranges already satisfy the intended rules for heading → paragraph → list, heading → list → paragraph, paragraph → list without a heading, and heading → paragraph. Phase 4D documented and tested behavior rather than changing parser, relocation, or pane logic.
- A section subtree runs from its heading through the line before the next heading of equal or shallower level, including intervening paragraphs and lists. A list subtree includes only its item and nested child lists, not adjacent independent paragraphs. A more-deeply indented paragraph continuing an item is treated as a continuation line.
- An unindented paragraph directly between two list items intentionally prevents those items from being connected as siblings. A `move-block-up/down` between them is a safe no-op rather than a potentially incorrect move.
- Unsafe mixed tab-and-space indentation remains rejected for moves and pane edits, without blocking safe items in the same section.
- `tests/mixedStructure.test.ts` contains 18 characterization tests for the four patterns, relocation, pane behavior, unsafe indentation, and the known limitation.

## Keyboard operation in Outline Tree View

With focus on the tree panel, you can operate it without a mouse. This has its own keyboard-selection state, `unified-outliner-selected`, separate from cursor-following highlighting, `unified-outliner-current`.

| Key | Behavior |
| --- | --- |
| Up / Down | Moves selection through visible nodes only; collapsed children are skipped and the ends do not wrap. With **Follow keyboard selection into body editor** enabled by default, a changed selection also moves the body cursor and scroll position without taking focus away from the tree. |
| Right | Expands a collapsed node without moving the body; if already expanded, selects the first child. It does nothing for a leaf. |
| Left | Collapses an expanded node without moving the body; otherwise selects the parent. It does nothing for a top-level node with no parent. |
| Enter | Jumps to the selected node in the body and always transfers editor focus. |

Turning **Follow keyboard selection into body editor** off restores the earlier behavior: arrow keys select only in the tree and Enter is the only body jump. Fold/unfold alone never moves the body cursor. `shouldFollowKeyboardSelectionIntoBody(followEnabled, previousId, nextId)` implements the decision in the pure `tree/outlineNavigation.ts` module.

The tree root, rather than each row, has `tabIndex = 0`; selection is represented with `aria-activedescendant`, which fits the redraw-on-navigation rendering model. It also exposes `role="tree"`, `role="treeitem"`, `aria-selected`, and `aria-expanded` for assistive technologies. Selected rows receive `--uo-selected-bg-color` only while the panel has focus, though the selection is retained. On receiving focus, `ensureSelection` chooses the visible node for the body cursor or the first tree node. Mouse clicking preserves tree focus so subsequent arrow-key navigation stays in the panel; Enter intentionally focuses the body editor.

## Fold-state persistence, synchronization, and conflict resolution (Phases 4E and 4F)

Outline Tree View collapse state persists independently for each file, survives restarts, follows supported structural edits, and is protected by Phase 4F conflict-resolution rules when concurrent views update it. It is not synchronized with CodeMirror 6 folding.

- The plugin stores `foldState: Record<filePath, string[]>` in `data.json`. `main.ts` owns the single `persistData()` writing path, used by both settings persistence and `FoldStateManager.flush()`, so neither overwrites the other's fields. Older data with no `foldState` key continues to load.
- Temporary `sec-N` and `li-N` ids cannot persist. `tree/foldIdentity.ts` creates content-based identities: section identities use the full ancestor-heading path; list identities use the nearest enclosing section's path plus document-order occurrence index for duplicate labels. This preserves a list identity through re-nesting within its section, but not relocation to a different section or heading-parent changes.
- Chevron clicks and Left/Right keyboard operations all use `setNodeCollapsed(nodeId, collapsed)`. It updates in-memory `collapsedIds` and the persistent identity. Each `refresh()` derives current ids again from stored identities, avoiding cross-file state leakage.
- `vault.on("rename")` moves saved state through `FoldStateManager.handleRename(oldPath, newPath)`. Writes are debounced for 500 ms, then explicitly flushed by `OutlineTreeView.onClose()` and `UnifiedOutlinerPlugin.onunload()`.
- The identity-map traversal was consolidated into one recursion, and `scrollSelectedIntoView` uses `requestAnimationFrame` after rendering to avoid a reported forced-reflow regression.
- `jumpToLine` supports `focusEditor`; clicks pass `false` to preserve tree keyboard focus, while Enter keeps the default `true`. `scrollLineToTop` uses CodeMirror's `EditorView.scrollIntoView(pos, { y: "start" })` through the editor's `.cm` view when available, falling back to Obsidian's editor scroll API.
- Phase 4F defines how concurrent views or Partial Edit Panes update the same note's fold state without corrupting the file-scoped persisted representation. The conflict rules, synchronization boundaries, and limitations are specified in `docs/fold-state-conflict-resolution-spec.md`.

Tests include `tests/foldIdentity.test.ts` (9), `tests/foldStateStore.test.ts` (15), `tests/foldStateAcceptance.test.ts` (11), and the full suite of **311 unit tests**.

## Commands

| Command ID | Name | Behavior |
| --- | --- | --- |
| `move-block-up` | Move block up (section / list subtree) | Moves the current heading section or list subtree before a same-level sibling. |
| `move-block-down` | Move block down (section / list subtree) | Moves it after a same-level sibling. |
| `move-node-only-up` | Move heading label up (current line only) | Swaps the current heading line's complete text with the preceding heading line; body, child headings, and lists stay put. |
| `move-node-only-down` | Move heading label down (current line only) | Swaps it with the following heading line only. |
| `indent-block` | Indent block (list subtree / heading subtree) | Makes a list subtree a child of its preceding sibling, or lowers every heading in a section subtree when a preceding sibling section exists. |
| `outdent-block` | Outdent block (list subtree / heading subtree) | Outdents the last child list item, or raises every heading in the target section subtree. |
| `indent-node-only` | Indent heading level (current line only) | Lowers only the current heading's `#` level. |
| `outdent-node-only` | Outdent heading level (current line only) | Raises only the current heading's `#` level. |
| `open-outline-tree-view` | Open outline tree view | Opens or reuses the right-sidebar Outline Tree View. |
| `open-partial-edit-pane` | Open partial edit pane for current section | Opens the current section in the Partial Edit Pane; it no-ops on a list item. |

No hotkeys are assigned by default. Assign them in Settings → Hotkeys; for example, `Alt+Up`/`Alt+Down` for block movement and keys equivalent to `Tab`/`Shift+Tab` for node-only heading-level changes.

### Node-only versus block commands

Editor commands intentionally separate two distinct meanings:

- **Node-only commands**—`indent-node-only`, `outdent-node-only`, `move-node-only-up`, and `move-node-only-down`—operate on the current heading line alone. Level changes alter only its `#` count within levels 1 through 6. Moves exchange the complete heading-line text, including its level, with the previous or next heading in document order regardless of their hierarchy. They never move body text, child headings, or lists. They are advanced operations for rearranging labels and can temporarily separate a label from the meaning of the body below it.
- **Block commands**—`indent-block`, `outdent-block`, `move-block-up`, and `move-block-down`—operate on the whole current section subtree. Heading-level changes cascade by the same delta through descendants, preserving relative hierarchy. Moves swap the whole subtree with a same-level sibling and preserve internal text, child structure, and lists. A list item is likewise moved as a subtree.

Neither editor command family changes behavior from folding. Fold-aware contextual semantics exist only in Outline Tree View. Existing block command ids are unchanged, preserving assigned hotkeys; the node-only ids were added independently.

## Resolution and movement rules

For block movement, the cursor resolves to these targets:

| Cursor location | Target |
| --- | --- |
| List line | That list item's subtree, including child items and continuation lines. |
| Heading line | The complete section, including descendant sections. |
| Body line | The containing complete section. |
| Fenced code block or frontmatter | No-op. |

Adjacent sibling blocks are exchanged by extraction and reinsertion, not by line swapping; blank lines between blocks keep their positions. A root list item with no sibling in the chosen direction may cross an adjacent heading into the neighboring section when **Allow list moves across sections** is enabled. Sections never cross their parent-section boundary. Multiple cursors, unsafe mixed indentation, and unavailable siblings produce no-ops. Affected contiguous ordered-list regions are normalized to `1.` after movement.

Node-only move resolves only headings. It no-ops on list lines, multiple cursors, frontmatter, fenced code, the first heading for upward movement, and the final heading for downward movement. The preceding/following heading is determined solely by document order, not level or parentage.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Allow list moves across sections | on | Allows a root list item to cross a section boundary. |
| Normalize ordered list markers to "1." | on | Normalizes ordered markers to `1.` after movement. |
| Show no-op notices | on | Shows a Notice explaining an unavailable operation. |
| Show list items in Outline Tree View | off | Includes list items in the tree and immediately redraws open Outline Tree Views when changed. |
| Follow keyboard selection into body editor | on | Follows changed arrow-key selection into the body; when off, only Enter jumps to the body. |

## Architecture

Only six layers depend on the Obsidian API: `main.ts` for command wiring; `view/OutlineTreeView.ts` for the sidebar; `view/PartialEditView.ts` for the editing pane; `view/activeMarkdownViewTracker.ts` for active-note resolution shared by both views; `commands/applyLineEditOutcome.ts` for applying edits; and `persistence/foldStateManager.ts` for debounced fold-state persistence, flushes, and renames. The remaining `model/`, `parser/`, `resolver/`, `move/`, `level/`, `tree/`, `edit/`, and `persistence/foldStateStore.ts` modules are pure functions and are unit-testable.

Key pure modules include `parser/parseDocument.ts`, `resolver/resolveCurrentBlock.ts`, block and node-only movement modules, `move/relocateSection.ts`, `move/relocateListSubtree.ts`, heading-level primitives, tree building and navigation, `tree/foldIdentity.ts`, partial-edit extraction/application, list-body tooltip extraction, and fold-state storage. The intentionally lightweight parser is not fully CommonMark compliant, but can be replaced by an AST-based implementation while preserving the `ParsedDocument` shape.

The design treats a heading as its whole section subtree; operations target blocks rather than lines; relative move targeting is separate from future destination targeting; and names favor `block`, `section`, and `subtree` over `line`.

## Development

```bash
npm install
npm test          # run the 311-unit-test Vitest suite
npm run build     # type-check and generate main.js with esbuild
npm run dev       # watch build
```

To deploy a development build, `deploy:dev` copies only `manifest.json`, `main.js`, and `styles.css` to `<vault>/.obsidian/plugins/unified-outliner/`. Keep the source repository outside the vault; the vault contains only generated plugin artifacts. Set `OBSIDIAN_VAULT` to the path of your own vault:

```bash
OBSIDIAN_VAULT="$HOME/path/to/your/vault" \
  npm run deploy:dev
```

Manual installation uses the same three files in the same plugin directory.

## Technical references

1. **Design influences**: WZ Editor and WZ Writing Editor are historical points of inspiration only. Unified Outliner is not affiliated with or endorsed by WZ Software, and no WZ materials are distributed with the plugin.
2. **[Mixed Structure Boundary Rules](docs/mixed-structure-spec.md)**: Defines section and list-subtree inclusion for four supported mixed-structure patterns, as well as the intentionally unsupported paragraph-between-list-items case.
3. **[Fold State Persistence & Synchronization](docs/fold-state-spec.md)**: Defines per-file `data.json` persistence, content-based node identities, unified toggle and keyboard paths, rename handling, and known identity limitations.
4. **[Fold State Conflict Resolution](docs/fold-state-conflict-resolution-spec.md)**: Defines the completed Phase 4F conflict-resolution behavior, synchronization boundaries, and limitations for concurrent fold-state updates.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned work. Current non-goals include body-editor CodeMirror 6 fold-state synchronization, cross-note structural moves, multi-selection, and live body-to-pane bidirectional editing.
