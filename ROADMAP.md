# Unified Outliner Roadmap

Unified Outliner focuses on safe structural editing inside a single Markdown note. The roadmap prioritizes operations that help people rearrange, inspect, and refine meaningful blocks rather than duplicating Obsidian core features.

## Current Release

Version 0.4.0 provides structural move and level commands (including whole-section moves and minimal-safe-block moves that reach into paragraphs, callouts, blockquotes, fenced code blocks, and tables), delete/insert commands, Outline Tree View navigation, inline rename, and mobile tap/long-press support, a Partial Edit Pane for section and list subtrees with breadcrumb navigation, a Subtree Navigator, and pop-out window support, mixed-structure boundaries, and file-scoped fold-state persistence with conflict resolution.

It also establishes a seven-kind block-boundary model covering blockquotes, callouts, fenced code blocks (including Mermaid), and tables, and projects these as read-only CompositeBlock nodes in the Outline Tree (Phase 5D-0.3). Settings are now organized into "General" and "Composite blocks" tabs, with an optional heading-level badge setting. Mobile/tablet interaction was refined with a dedicated native HTML5 drag handle on iPad, separate from the long-press context menu gesture (UXP-01), and a fix for the long-press context menu stacking when a second row was long-pressed before dismissing the first (UXP-02).

## Next Focus: Phase 5C-1 / Phase 5D

- **Editable CompositeBlocks**: Extend the currently read-only projection of blockquotes, callouts, fenced code blocks, and tables to support move, insert, and delete from the Outline Tree, following per-kind safe write-back rules (blank lines, `>` prefixes, code fences, list markers) defined in Phase 5C-1.
- **Safe rejection of unresolved boundaries**: Keep protecting the source note by refusing edits whenever a block's boundary or nested structure cannot be confidently resolved.
- **Continued validation of hoist-like editing**: Keep strengthening safety and regression coverage for opening a selected section or list subtree as a focused editing context.

## Later Directions

- Node-level link and embed previews.
- A node-level inventory of links and attachments.
- Canvas integration at the section or list-subtree level.
- Local subtree metadata such as status or tags.
- Cross-note block classification and search (Phase 6: a BlockIndex unifying YAML inheritance and inline properties).
- Structural diagrams and dialog-based editing (Phase 7).

## Deliberate Non-goals

Unified Outliner does not aim to replace general full-text search, task management, Dataview-style aggregation, or AI rewriting. It remains focused on reliable structural editing of Markdown notes.
