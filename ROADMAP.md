# Unified Outliner Roadmap

Unified Outliner focuses on safe structural editing inside a single Markdown note. The roadmap prioritizes operations that help people rearrange, inspect, and refine meaningful blocks rather than duplicating Obsidian core features.

## Current Release (1.0)

Unified Outliner 1.0 completes the plugin's core scope: safe structural editing inside a single Markdown note.

- **Structural commands**: move and level commands, including whole-section moves and minimal-safe-block moves that reach into paragraphs, callouts, blockquotes, fenced code blocks, and tables; node-only heading actions; delete and insert commands.
- **Outline Tree View**: a configurable left/right sidebar, inline rename, and mobile tap/long-press with a dedicated drag handle on touch devices (UXP-01/UXP-02). Sections, list items, paragraphs, and standalone callouts, blockquotes, fenced code blocks, and tables can be dragged and dropped — paragraphs and standalone blocks also across sections, with blank-line separation added automatically. Paragraphs, fenced code blocks, tables, and mirrors can optionally be shown as their own rows, and a new code block or table can be inserted below a section or list item. Fold state is persisted per file with conflict resolution and can optionally be synchronized to the editor.
- **Extended blocks**: an image list item followed by its OCR transcript or quoted caption is grouped as **List + Callout** / **List + Quote**, and moved, deleted, and edited as one unit.
- **Partial Edit Pane**: breadcrumb navigation, a Subtree Navigator, and pop-out windows; structured, marker-free editing for leaf list items; direct-child operations (add, delete, reorder, inline edit, indent/outdent, one level at a time) for a parent item; structured editors for standalone callouts/blockquotes and extended blocks; fenced code blocks with the fence lines hidden and a separate language selector; tables in Raw and Table modes with structural validation; automatic resynchronization while clean and conflict protection on Apply.
- **Block copy**: **Copy block**, **Duplicate below**, and **Paste block** (after, above, or as a child) for sections, list subtrees, standalone callouts/blockquotes/fenced code blocks/tables, and paragraphs, from the tree or the Command Palette, within the same note. A copy only ever inserts lines; it never rewrites an existing line.
- **Same-note mirrors**: Obsidian embeds of a heading or block in the same note (`![[#Heading]]`, `![[#^block-id]]`) are shown as read-only mirror rows (flagged when not found or circular); created from the tree or the Command Palette with an automatically assigned `^uo-` block id and circular references refused; moved within their section; deleted without ever changing the referenced block; and counted in the Partial Edit Pane ("Mirrors referencing this block: N") with click-to-jump. The embed syntax itself is the only record — no database is kept.
- **Settings**: a **General** tab grouped into Outline Tree contents, Outline Tree appearance, Move operations, and Editing & interaction, and an **Extended blocks** tab; English and Japanese UI.

## Next Focus

- **Mirror follow-ups**: editing the referenced block from a mirror row and keeping its display in sync, choosing where a new mirror goes (a paste-like "create the mirror here" flow), drag and drop of mirror rows, mirrors of blocks in other notes, and a clearer visual distinction between a mirror and a copy.
- **Cross-section Move up/down**: let the **Move up/down** commands for paragraphs, standalone blocks, and mirrors cross section boundaries, as drag and drop already does.
- **Declarative settings API**: implement `PluginSettingTab.getSettingDefinitions()` (Obsidian 1.13.0+) in `src/settings.ts`, mirroring the current `display()` items, while keeping `display()` for Obsidian 1.12.x and earlier (flagged as a warning by the Obsidian Community review of 0.7.3; not yet implemented).
- **Richer table and code-block editing**: beyond today's Raw/Table modes and raw fenced-code body — for example, rendered inline Markdown in Table Mode cells and optional column-width formatting.
- **Free movement to an arbitrary depth or parent**: Explore letting a list item or child move to any chosen ancestor or depth, beyond today's one-level indent/outdent.
- **Full subtree-level child operations**: Extend the Partial Edit Pane's child add/delete/reorder/indent-outdent support beyond one level, toward operating on a whole child subtree at once.
- **Drag-and-drop inside the Partial Edit Pane**: Explore adding direct drag-and-drop reordering of children inside the pane's preview, alongside the existing button-based controls.
- **Safe rejection of unresolved boundaries**: Keep protecting the source note by refusing edits whenever a block's boundary or nested structure cannot be confidently resolved.
- **Continued validation of hoist-like editing**: Keep strengthening safety and regression coverage for opening a selected section, list subtree, paragraph, standalone callout/blockquote, fenced code block, table, or parent/child structure as a focused editing context.

## Later Directions

- Node-level link and embed previews.
- A node-level inventory of links and attachments.
- Canvas integration at the section or list-subtree level.
- Local subtree metadata such as status or tags.
- Cross-note block classification and search (Phase 6: a BlockIndex unifying YAML inheritance and inline properties).
- Structural diagrams and dialog-based editing (Phase 7).

## Design Principles

### Safety boundary for callout / blockquote line continuation

Unified Outliner limits the editable range of a callout or blockquote to only the contiguous lines where the Markdown itself carries an explicit quote prefix (`>`).

In Obsidian's rendering, ordinary prefix-less text that immediately follows a callout header or a quote line with no blank line in between can visually appear to continue inside the callout/blockquote. Unified Outliner does not infer, complete, or re-serialize that visual continuation as part of the callout/blockquote's syntax.

Accordingly, a prefix-less continuation line is handled as follows:

- Not included in the callout/blockquote's editable range.
- Not loaded into the Partial Edit Pane.
- Never given an automatic `> ` prefix on Apply.
- Not projected as a callout/blockquote member in the Tree.
- Not included in a CompositeBlock's member range.
- Treated as an ordinary paragraph, or whatever other block kind the existing parser determines.

When the target range cannot be safely and uniquely resolved because it would include a prefix-less continuation line, Partial Edit is refused and the note body is left unchanged.

## Deliberate Non-goals

Unified Outliner does not aim to replace general full-text search, task management, Dataview-style aggregation, or AI rewriting. It remains focused on reliable structural editing of Markdown notes.
