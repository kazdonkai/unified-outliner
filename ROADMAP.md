# Unified Outliner Roadmap

Unified Outliner focuses on safe structural editing inside a single Markdown note. The roadmap prioritizes operations that help people rearrange, inspect, and refine meaningful blocks rather than duplicating Obsidian core features.

## Current Release

Unified Outliner provides structural move and level commands (including whole-section moves and minimal-safe-block moves that reach into paragraphs, callouts, blockquotes, fenced code blocks, and tables), delete/insert commands, Outline Tree View navigation with a configurable left/right sidebar, inline rename, and mobile tap/long-press support, a Partial Edit Pane for section and list subtrees with breadcrumb navigation, a Subtree Navigator, and pop-out window support, mixed-structure boundaries, and file-scoped fold-state persistence with conflict resolution.

Body paragraphs can be optionally shown in the Outline Tree and edited there directly — renamed in place, moved (adjacent swap, to top/bottom, or before/after a chosen sibling), inserted, deleted, and opened in the Partial Edit Pane — for top-level and section-direct paragraphs. A standalone callout or blockquote can likewise be moved from the tree and opened in the Partial Edit Pane. An image list item immediately followed by its OCR transcript or a quoted caption is recognized and grouped into a collapsible "extended block" (**List + Callout** / **List + Quote**), which can be moved or deleted as one unit, and whose list member and trailing callout/blockquote member are now edited together and saved in a single Apply whenever the block's structure allows a clean split; fenced code blocks (including Mermaid) and tables are recognized internally as safe atomic units for Move block but remain unavailable as their own Outline Tree nodes.

The Partial Edit Pane now hides the Markdown list marker, task-list checkbox, and ordered-list number/delimiter for an eligible leaf list item — unordered, task-list, or ordered, single-line or spanning multiple lines with blank lines in its own continuation — and edits only the item's own text, restoring the original syntax exactly on Apply; a block that can't be safely reduced to a single list item falls back to raw Markdown. Opening a parent list item shows its direct children as a live, read-only preview that supports navigating into a child or grandchild, inline-editing, adding, deleting, and reordering a direct child, and indenting/outdenting a direct child or grandchild one level at a time — all combinable with the parent's own text edit in a single Apply except indent/outdent, which is mutually exclusive with the other child operations. The pane resynchronizes automatically, including switching between a leaf item's editor and a parent item's editor, when the note changes elsewhere (another pane, the Outline Tree, or an Undo/Redo) while it has no unsaved changes. Settings are organized into a category-grouped "General" tab and an "Extended blocks" tab, with heading-prefix and list-marker display options. Mobile/tablet interaction was refined with a dedicated native HTML5 drag handle on iPad, separate from the long-press context menu gesture (UXP-01), and a fix for the long-press context menu stacking when a second row was long-pressed before dismissing the first (UXP-02).

## Next Focus

- **Editable fenced code blocks and tables**: Extend support to fenced code blocks and tables so they gain their own Outline Tree nodes and Partial Edit Pane editing, following the same per-kind safe write-back approach already established for paragraphs, callouts, and blockquotes.
- **Free movement to an arbitrary depth or parent**: Explore letting a list item or child move to any chosen ancestor or depth, beyond today's one-level indent/outdent.
- **Full subtree-level child operations**: Extend the Partial Edit Pane's child add/delete/reorder/indent-outdent support beyond one level, toward operating on a whole child subtree at once.
- **Drag-and-drop inside the Partial Edit Pane**: Explore adding direct drag-and-drop reordering of children inside the pane's preview, alongside the existing button-based controls.
- **Safe rejection of unresolved boundaries**: Keep protecting the source note by refusing edits whenever a block's boundary or nested structure cannot be confidently resolved.
- **Continued validation of hoist-like editing**: Keep strengthening safety and regression coverage for opening a selected section, list subtree, paragraph, standalone callout/blockquote, or parent/child structure as a focused editing context.

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
