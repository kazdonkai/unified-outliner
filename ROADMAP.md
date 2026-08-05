# Unified Outliner Roadmap

Unified Outliner focuses on safe structural editing inside a single Markdown note. The roadmap prioritizes operations that help people rearrange, inspect, and refine meaningful blocks rather than duplicating Obsidian core features.

## Current Release

Version 0.1.0 provides structural move and level commands, Outline Tree View navigation and editing, a Partial Edit Pane for section and list subtrees, mixed-structure boundaries, and file-scoped fold-state persistence with conflict resolution.

## Next Focus: Phase 5

- **Hoist-like editing**: Open a selected section or list subtree as a focused editing context.
- **Pop-out workflow**: Support Obsidian pop-out windows for a focused editing view, while keeping navigation state synchronized.
- **Breadcrumb navigation**: Show the ancestor path in the focused editing view and let users navigate back to an ancestor.
- **Expanded safe editing**: Evaluate additions, deletions, and reordering inside focused subtree editing without weakening conflict protection.
- **Special Markdown blocks**: Define explicit parsing and editing boundaries for callouts and Mermaid code blocks before allowing structural operations to modify them.

## Later Directions

- Node-level link and embed previews.
- A node-level inventory of links and attachments.
- Canvas integration at the section or list-subtree level.
- Local subtree metadata such as status or tags.
- Cross-note block classification and search.
- Structural diagrams and dialog-based editing.

## Deliberate Non-goals

Unified Outliner does not aim to replace general full-text search, task management, Dataview-style aggregation, or AI rewriting. It remains focused on reliable structural editing of Markdown notes.
