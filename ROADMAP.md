# Unified Outliner Roadmap

Unified Outliner focuses on safe structural editing inside a single Markdown note. The roadmap prioritizes operations that help people rearrange, inspect, and refine meaningful blocks rather than duplicating Obsidian core features.

## Current Release

Unified Outliner provides structural move and level commands (including whole-section moves and minimal-safe-block moves that reach into paragraphs, callouts, blockquotes, fenced code blocks, and tables), delete/insert commands, Outline Tree View navigation with a configurable left/right sidebar, inline rename, and mobile tap/long-press support, a Partial Edit Pane for section and list subtrees with breadcrumb navigation, a Subtree Navigator, and pop-out window support, mixed-structure boundaries, and file-scoped fold-state persistence with conflict resolution.

Body paragraphs can now be optionally shown in the Outline Tree and edited there directly — renamed in place, moved (adjacent swap, to top/bottom, or before/after a chosen sibling), inserted, deleted, and opened in the Partial Edit Pane — for top-level and section-direct paragraphs. A standalone callout or blockquote can likewise be moved from the tree and opened in the Partial Edit Pane. An image list item immediately followed by its OCR transcript or a quoted caption is recognized and grouped into a collapsible "extended block", which can be moved or deleted as one unit; fenced code blocks (including Mermaid) and tables remain read-only in the tree. Settings are organized into a category-grouped "General" tab and an "Extended blocks" tab, with heading-prefix and list-marker display options. Mobile/tablet interaction was refined with a dedicated native HTML5 drag handle on iPad, separate from the long-press context menu gesture (UXP-01), and a fix for the long-press context menu stacking when a second row was long-pressed before dismissing the first (UXP-02).

## Next Focus

- **Editable fenced code blocks and tables**: Extend the currently read-only projection of fenced code blocks and tables to support move, insert, and delete from the Outline Tree, following the same per-kind safe write-back approach already established for paragraphs, callouts, and blockquotes.
- **Grouped extended-block editing**: Explore editing an extended block's list item and its callout/blockquote together as one unit, instead of requiring each to be edited individually in the body editor.
- **Safe rejection of unresolved boundaries**: Keep protecting the source note by refusing edits whenever a block's boundary or nested structure cannot be confidently resolved.
- **Continued validation of hoist-like editing**: Keep strengthening safety and regression coverage for opening a selected section, list subtree, paragraph, or standalone callout/blockquote as a focused editing context.

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
