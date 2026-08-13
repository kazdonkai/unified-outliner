# Unified Outliner

[日本語](README.ja.md)

> Reorganize heading sections and list subtrees in an Obsidian note without losing sight of the surrounding structure.

Unified Outliner is an [Obsidian](https://obsidian.md) plugin for structural editing inside a single Markdown note. It lets you move, re-level, inspect, and focus on heading sections and list subtrees through the editor, a dedicated Outline Tree View, and a Partial Edit Pane for editing a focused block.

**Current version:** see [Releases](https://github.com/kazdonkai/unified-outliner/releases) for the latest version and changelog.

**Minimum Obsidian version:** 1.8.7

**Scope:** one note at a time. Unified Outliner never moves content between notes.

## Why Unified Outliner?

Obsidian's built-in Outline is excellent for navigating headings. List-focused outliner plugins make it easier to work with individual list items. Unified Outliner is designed for the point where both approaches are needed in the same note: reorganizing meaningful heading sections and nested list structures as visible, safe units.

| Capability | Obsidian built-in Outline | List-focused outliner plugins | Unified Outliner |
| --- | --- | --- | --- |
| Navigate heading structure | Yes | Varies | Yes, with synchronized tree selection |
| Move a whole heading section with its body and child sections | No | Not the primary focus | Yes |
| Move or reparent a nested list subtree | No | Often supported | Yes |
| Display headings and list items together in one structural tree | No | Varies | Yes, optional list display |
| Edit one selected section or list subtree in a focused pane | No | Varies | Yes, with explicit Apply and conflict protection |
| Preserve view folding per file | No | Varies | Yes, synchronized across open Outline Tree Views |

Unified Outliner does not try to replace search, task managers, Dataview-style aggregation, or AI writing tools. Its purpose is dependable structural editing of Markdown notes.

## Install

### From Community Plugins (recommended)

1. In Obsidian, open **Settings → Community plugins → Browse**. Turn off Restricted mode if necessary.
2. Search for **Unified Outliner**, select it, then choose **Install**.
3. Enable **Unified Outliner** in **Settings → Community plugins**.

You can also open the [Unified Outliner Community Plugins page](https://community.obsidian.md/plugins/unified-outliner) in a browser.

### Beta releases with BRAT

Use [BRAT](https://github.com/TfTHacker/obsidian42-brat) when you want to test beta releases or recent development builds.

1. Install and enable **Obsidian 42 - BRAT** from **Settings → Community plugins → Browse**.
2. Open the Command Palette and run **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/kazdonkai/unified-outliner` and confirm the installation.
4. Enable **Unified Outliner** in **Settings → Community plugins** after BRAT finishes.

BRAT checks the repository for updates, so use it only when you are comfortable testing changes before a normal catalog release.

### Direct download from GitHub Releases

To install a specific release manually, download `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/kazdonkai/unified-outliner/releases).

1. In your vault, create this folder if it does not already exist:

   ```text
   <your-vault>/.obsidian/plugins/unified-outliner/
   ```

2. Copy all three downloaded files into that folder.
3. Open Obsidian and go to **Settings → Community plugins**, then enable **Unified Outliner**.
4. Reload Obsidian if the plugin does not appear immediately.

### Update

Community Plugins and BRAT manage their own updates. For a direct-download installation, replace the same three files in `<your-vault>/.obsidian/plugins/unified-outliner/`, then reload Obsidian. Keep a backup of your vault as part of your normal update routine.

## Example outline note

![A structured Markdown note open in Obsidian](docs/images/structured-note-overview.png)

The screenshot uses `Test/Unified Outliner Test.md` in the Method test vault. It shows the kind of heading and nested-list structure that Unified Outliner is designed to reorganize.

1. Open a Markdown note that contains headings or lists.
2. Open the Command Palette and run **Open outline tree view**, or select the plugin's tree icon in the ribbon.
3. The **Outline Tree View** opens in the right sidebar. Clicking a node moves the cursor to the matching location in the note. Moving the editor cursor highlights the corresponding tree node.
4. Right-click a node to move, indent, outdent, or open it in the Partial Edit Pane.

Enable **Show list items in Outline Tree View** in the plugin settings when you want list items to appear alongside headings.

## Visual guide

### Work from the Outline Tree View

![Outline Tree View beside a structured Markdown note](docs/images/outline-tree.png)

The Outline Tree View shows headings and, when enabled, list items beside the source note. Selecting a node locates its matching text, while the current editor position is reflected in the tree.

<p align="center"><img src="docs/images/outline-context-menu.png" alt="Context menu for a selected tree node" width="560"></p>

Right-click a selected node to choose a structural action. The menu exposes block movement, indentation, node-only heading actions, and focused editing from the same place.

### Focus on and edit a selected block

![Focused editing pane for a selected outline subtree](docs/images/outline-edit-pane.png)

The Partial Edit Pane keeps the selected section or list subtree visible while preserving the surrounding outline for orientation.

![Partial Edit Pane with the selected target and Apply control](docs/images/partial-edit-pane.png)

Apply writes back only after the pane verifies that its original source range has not changed. This protects the note from an accidental overwrite during a concurrent edit.

### Short video walkthroughs

| Task | Video |
| --- | --- |
| Open the Outline Tree View | [Watch the 7-second MP4](docs/media/outline-tree-open.mp4) |
| Collapse and expand a tree node | [Watch the 20-second MP4](docs/media/outline-collapse-expand.mp4) |
| Follow a selected item in the tree | [Watch the 21-second MP4](docs/media/outline-focus.mp4) |
| Move a list subtree | [Watch the 14-second MP4](docs/media/outline-list-move.mp4) |
| Edit a selected subtree in the Partial Edit Pane | [Watch the 49-second MP4](docs/media/partial-edit.mp4) |

## How to use it

### Move and re-level structures

Place the cursor on a heading or list item, then use the Command Palette or assign hotkeys in **Settings → Hotkeys**.

| Command | What it does |
| --- | --- |
| **Move block up / down** | Moves the minimal safe unit at the cursor — a heading section, a list subtree, a plain paragraph, or a whole callout, blockquote, fenced code block, or table when the cursor is inside one — before or after its sibling. |
| **Move section up / down** | Moves the whole enclosing heading section (heading, body, and any child sections), regardless of where the cursor is inside it. |
| **Indent block** | Reparents a list subtree, or safely lowers a heading section's level when the structure allows it. |
| **Outdent block** | Promotes a list subtree, or safely raises a heading section's level when the structure allows it. |
| **Delete block** | Deletes the current heading section or list subtree. |
| **Insert sibling after current block** | Inserts a new, empty heading section or list item after the current one. |
| **Insert child list item** | Inserts a new, empty list item as a child of the current one. |

The same actions are available from a node's context menu in Outline Tree View. Unavailable operations make no change. Enable **Show no-op notices** in the plugin settings to see the reason. A block that Move block / Move section just moved is briefly flash-highlighted in the tree, and, if enabled, a short notice names what moved.

### Use the Outline Tree View

The right-sidebar tree is a working view, not only a navigator.

- **Drag and drop sections** to reorder section subtrees.
- **Drag and drop list items** to reorder or reparent list subtrees when list display is enabled.
- **Collapse or expand nodes** to control the tree's own view state. This state is saved per file and stays in sync across open Outline Tree Views.
- **Use contextual commands** from the right-click menu. A collapsed section is treated as a subtree; an expanded section can use node-only actions.
- **Rename a heading or list item in place**: double-click a row (or select it and press F2, or choose **Rename** from its context menu) to edit its text directly in the tree. Press Enter to commit or Escape to cancel without changing the note.
- **On mobile**: tap a row to select it, tap an already-selected row again to start renaming it, and long-press a row to open its context menu.
- Section rows and list rows are visually distinguishable by an optional background or edge-stripe highlight, configurable in the plugin settings and further customizable through Style Settings (see below).

### Edit a focused subtree

Use **Open partial edit pane for current section** from the Command Palette, or choose the corresponding action from an Outline Tree View context menu.

The **Partial Edit Pane** opens the selected section or list subtree in a dedicated editor. Make your changes, then select **Apply** to write them back to the source note. If the source area changed after the pane opened, the pane protects the note by refusing to apply conflicting content. Reload the target and review the change instead of overwriting it.

An ancestor breadcrumb and a Subtree Navigator let you move up to a parent block or into a child block without leaving the pane. The pane can also be popped out into its own window from a node's context menu, and it asks for confirmation before navigating away from unsaved changes.

### Node-only heading actions

The commands **Move heading label up/down** and **Indent/Outdent heading level** change only the current heading line. They deliberately leave that heading's body and child sections where they are. Use them only when that is exactly the structure you intend; for ordinary reorganization, prefer the block commands.

## Settings

Open **Settings → Community plugins → Unified Outliner** to configure:

- **Allow list moves across sections**: permits root-level list items to move across section boundaries.
- **Normalize ordered list markers to `1.`**: normalizes ordered-list markers after structural edits.
- **Show no-op notices**: explains why an unavailable operation made no change.
- **Show list items in Outline Tree View**: includes list items in the tree.
- **Follow keyboard selection into body editor**: keeps the body editor synchronized while navigating the tree with the keyboard.
- **Sync Outline Tree folding to editor**: folding or unfolding a node in the tree also folds or unfolds the matching content in the active Markdown editor.
- **Section background style in Outline Tree**: subtle background, left-edge stripe, or off, for telling section rows apart from list rows.
- **List row highlight style in Outline Tree**: hover-only (default), always-on subtle background, or off.
- **Preview move target in Outline Tree**: briefly flash-highlights the block a move command just operated on.
- **Show move result toast**: shows a short notice naming what was moved after a move command.
- **Heading prefix in Outline Tree** (General tab): shows an optional badge before a section's heading text in the Outline Tree — off by default, or the heading level as "H1"–"H6" or the literal ATX marker count ("#"–"######"). Purely cosmetic.

Settings are organized into two tabs, **General** and **Extended blocks** (the latter covers callout/blockquote/fenced-code/table display in the Outline Tree).

### Customizing appearance with Style Settings

Install the [Style Settings](https://github.com/community-archive/obsidian-style-settings) community plugin to customize the Outline Tree View's appearance beyond the toggles above, without editing CSS by hand. Under **Settings → Style Settings → Outline Tree View – Appearance** you can adjust, separately for light and dark mode:

- **Font size** of the tree's heading labels.
- **Background color** of the Outline Tree View panel.
- **Text color**, **muted text color** (secondary text, such as the empty-state message), and **list item text color**.
- **Highlighted node color** (the row matching the body editor's cursor) and **keyboard selection background color** (the row selected via keyboard navigation).
- **Section row background** and **list row background** — the colors used by the highlight styles above.
- **Move target preview flash color** — the color of the brief flash shown after a move command.

## Safe use and current boundaries

Structural changes alter Markdown text. Keep normal vault backups and review an edit if your note uses unfamiliar or highly customized Markdown.

- Unified Outliner works within the active note only. It does not move content between notes.
- Frontmatter is excluded from all structural operations.
- Callouts, blockquotes, fenced code blocks (including Mermaid), and tables are shown in the Outline Tree View as read-only nodes: you can see them alongside headings and list items, but the tree does not yet let you move, add, or delete them directly. Move block can still move one of these blocks as a whole when the cursor is inside it in the body editor.
- A focused edit is applied only when the original target has not changed since it was loaded.

## Roadmap

Pop-out windows, breadcrumb navigation, Outline Tree inline rename, and read-only Outline Tree display of callouts, blockquotes, fenced code blocks, and tables are now available (see above). The next development focus is extending that read-only display into full move/insert/delete support for those same block kinds, alongside continued safety validation of hoist-like editing.

See the concise [roadmap](ROADMAP.md) for later directions and deliberate non-goals.

## Contributing

Bug reports and pull requests are welcome. Please include the smallest reproducible Markdown example, the command or tree action you used, the observed result, and the expected result. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and required checks.

Do not include confidential or personal information in a report.

## Development

Large parts of this plugin's implementation were developed with the assistance of [Claude](https://www.anthropic.com/claude) (Anthropic), under the direction and review of the maintainer.

## License

Unified Outliner is released under the [MIT License](LICENSE). Copyright © 2026 Kazdon Kai.
