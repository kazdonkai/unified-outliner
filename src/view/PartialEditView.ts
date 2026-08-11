/**
 * Phase 3B: Partial Edit Pane (docs/別ペイン実装計画と当面の実装指示.md, forward-looking
 * §7 in spirit — this view is new territory beyond what that doc's earlier
 * phases covered).
 *
 * A focused editing pane for exactly ONE subtree at a time, opened from
 * the Outline Tree View's right-click menu. This is NOT an alternate
 * full-document editor: the original note is always the single source of
 * truth, and this pane only ever holds a temporary, explicitly-applied
 * copy of one subtree's raw Markdown (heading + body + child sections +
 * lists for a section, per section-subtree; item + nested children for a list, per
 * Phase 4A's relocateListSubtree — the exact same range every other
 * block-scoped command already treats as one unit).
 *
 * Deliberately explicit-save, not live-synced: edits made here stay local
 * to the pane's textarea until the user clicks Apply. There is no
 * autosave and no real-time two-way sync with the body editor — see the
 * README's Phase 3B section for the full list of what this phase
 * intentionally does not attempt (multi-node editing, cross-note editing,
 * diff/merge UI, conflict resolution beyond a simple before/after text
 * comparison).
 *
 * Node resolution and the actual text splice are both delegated to
 * ../edit/partialEdit.ts (Obsidian-free, unit-tested) — this view only
 * wires that pure logic to a textarea and to the active note's Editor via
 * ../commands/applyLineEditOutcome.ts, exactly like every other
 * tree-triggered command in this plugin.
 *
 * Phase 4C (list subtrees): originally section-only, this view now loads
 * either kind via the same loadNode()/applyEdit() path — the generalized
 * extractSubtreeText/applySubtreeEdit (edit/partialEdit.ts) don't care
 * which kind of node they're resolving, so nothing here branches on
 * section vs. list except the header label (renderLoadedState below) and
 * the small "(Empty list item)" vs "(Untitled heading)" placeholder text used
 * when a node's own label is empty. Everything else — the textarea, the
 * Apply/Cancel/Close buttons, the conflict check, the unsafeIndent
 * refusal for list nodes — is one shared code path.
 *
 * Real-device follow-up: the header's Apply/Cancel row also has a one-click
 * × (close) button, `this.leaf.detach()` under the hood — before this,
 * closing the pane required Obsidian's own tab-close affordances (the
 * tab's native × or the right-click "Close tab" menu item), a two-step
 * detour compared to every other button on this pane's own header. Closing
 * this way still never applies pending edits, exactly like Cancel and the
 * pre-existing onClose() already didn't.
 *
 * Further real-device follow-up: Apply/Cancel/Close are now each shown
 * conditionally rather than unconditionally whenever a node is loaded —
 * see updateDirtyState (Apply/Cancel only appear once the textarea
 * actually differs from the loaded snapshot) and updateCloseButtonVisibility
 * (this pane's own × only appears where Obsidian doesn't already draw a
 * native tab ×, i.e. while docked directly in the left/right sidebar —
 * see that method's doc comment for the sidebar-vs-tab/popout distinction).
 *
 * Phase 5B (docs/phase5-implementation-plan.md): adds an ancestor
 * breadcrumb below the header row, so the pane (including a popped-out
 * window with no Outline Tree in sight) still shows where the loaded node
 * sits in the document. The node-loading entry point is now split in two:
 * loadNodeInternal (private, unconditional — the old loadNode, renamed)
 * and requestLoadNode (public, the ONLY sanctioned external entry point),
 * which guards loadNodeInternal behind an Apply/Discard/Cancel prompt
 * whenever the pane has an unapplied edit. Every caller that used to reach
 * this pane's loadNode directly — main.ts's activatePartialEditView, and
 * now this file's own breadcrumb segment clicks — goes through
 * requestLoadNode instead, so "switch node" always means the same thing
 * regardless of which UI triggered it. See requestLoadNode's own doc
 * comment for the full rationale.
 *
 * Subtree Navigator (post-Phase-5B follow-up): the downward counterpart to
 * the ancestor breadcrumb above. A third header row (renderSubtreeNavigator)
 * shows the loaded node's own direct children (tree/descendantPath.ts) as
 * clickable chips, so a user can descend into a subtree one level at a
 * time from inside the pane — including a popped-out window with no
 * Outline Tree visible — the same way the breadcrumb lets them climb back
 * up. Every chip (and its overflow Menu, when there are more children than
 * fit inline) calls requestLoadNode, never loadNodeInternal directly, so
 * descending shares the exact same dirty-guard/Apply-Discard-Cancel
 * behavior as breadcrumb and Tree navigation — see requestLoadNode's doc
 * comment, unchanged by this addition.
 */
import { App, ItemView, Menu, Modal, Notice, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { parseDocument } from "../parser/parseDocument";
import { applySubtreeEdit, extractSubtreeText, SubtreeKind } from "../edit/partialEdit";
import { nodeDisplayLabel } from "../tree/buildOutlineTree";
import { AncestorPathEntry, findAncestorPath } from "../tree/ancestorPath";
import { DescendantNavigationEntry, findDirectChildren } from "../tree/descendantPath";
import { applyLineEditOutcome, NOOP_MESSAGES } from "../commands/applyLineEditOutcome";

export const PARTIAL_EDIT_VIEW_TYPE = "unified-outliner-partial-edit";

export class PartialEditView extends ItemView {
  // Shared with OutlineTreeView via plugin.activeMarkdownView, not a local
  // instance. A freshly constructed tracker has no cached view yet, and by
  // the time loadSection() below would call .get(), main.ts's
  // activatePartialEditView has already revealed this pane's own leaf —
  // which shifts workspace.getActiveViewOfType(MarkdownView) to null. The
  // shared, plugin-owned tracker is already warmed up by then (either by
  // OutlineTreeView's continuous refresh cycle, or by
  // activatePartialEditView's own explicit warm-up call), so it still
  // resolves correctly. See the doc comment on the field in main.ts.
  private get activeMarkdownView() {
    return this.plugin.activeMarkdownView;
  }

  private nodeId: string | null = null;
  private nodeKind: SubtreeKind | null = null;
  private label = "";
  /** The pane's "before editing" snapshot — see edit/partialEdit.ts's applySubtreeEdit doc comment. */
  private originalText = "";
  /** Phase 5B: root-first ancestors of the currently loaded node, computed once at load time — see renderBreadcrumb's doc comment for why this is never recomputed mid-edit. */
  private ancestors: AncestorPathEntry[] = [];
  /** Subtree Navigator: the loaded node's own direct children, computed once at load time alongside `ancestors` — see renderSubtreeNavigator's doc comment. */
  private directChildren: DescendantNavigationEntry[] = [];

  /**
   * Phase 5B: how many of the nearest ancestors the breadcrumb shows
   * before collapsing the rest into a leading "…" segment (tooltip-only).
   * A single named constant per the implementation instruction's "マジック
   * ナンバーで散在させない" requirement — every place that needs this number
   * reads it from here.
   */
  private static readonly BREADCRUMB_VISIBLE_ANCESTORS = 3;

  /**
   * Subtree Navigator: how many direct children are shown inline as chips
   * before the rest collapse into a single "More…" chip that opens an
   * Obsidian Menu. Deliberately larger than BREADCRUMB_VISIBLE_ANCESTORS —
   * ancestor chains are usually shallow, but a node can easily have many
   * more direct children than it has ancestors, and the Menu fallback only
   * exists for that long tail.
   */
  private static readonly SUBTREE_VISIBLE_CHILDREN = 5;

  private titleEl!: HTMLElement;
  private breadcrumbEl!: HTMLElement;
  private subtreeNavEl!: HTMLElement;
  private textareaEl!: HTMLTextAreaElement;
  private applyButtonEl!: HTMLButtonElement;
  private cancelButtonEl!: HTMLButtonElement;
  private closeButtonEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: UnifiedOutlinerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return PARTIAL_EDIT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Unified Outliner: Partial Edit";
  }

  getIcon(): string {
    return "edit-3";
  }

  /**
   * Real-device report, two rounds: (1) force-closing this pane after
   * Obsidian's startup layout restore (via workspace.onLayoutReady) caused
   * a visible flash — the leaf was already drawn once before being
   * removed; (2) leaving the restored, empty pane in place instead was
   * worse — it can end up as an orphaned, blank panel with no Outline Tree
   * View nearby to reload it from, which reads as broken rather than
   * merely idle.
   *
   * `workspace.layoutReady` is false only while Obsidian is still
   * reconstructing the saved workspace at startup, and is permanently true
   * for the rest of the session afterward (including every live open via
   * activatePartialEditView). Checking it here, synchronously, at the very
   * start of onOpen — before any DOM is built — means a restored instance
   * detaches itself before it is ever painted, instead of appearing and
   * then disappearing. A live, user-triggered open (layoutReady already
   * true by then) is completely unaffected and renders normally below.
   */
  async onOpen(): Promise<void> {
    if (!this.app.workspace.layoutReady) {
      this.leaf.detach();
      return;
    }

    this.contentEl.empty();
    this.contentEl.addClass("unified-outliner-partial-edit-view");

    const headerEl = this.contentEl.createDiv({ cls: "unified-outliner-partial-edit-header" });
    this.titleEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-title" });

    const actionsEl = headerEl.createDiv({ cls: "unified-outliner-partial-edit-actions" });
    this.applyButtonEl = actionsEl.createEl("button", { text: "Apply", cls: "mod-cta" });
    this.applyButtonEl.addEventListener("click", () => this.applyEdit());
    this.cancelButtonEl = actionsEl.createEl("button", { text: "Cancel" });
    this.cancelButtonEl.addEventListener("click", () => this.cancelEdit());
    // One-click close, in addition to Obsidian's own tab-close affordances
    // (native tab × / right-click "Close tab"). Deliberately NOT gated by
    // whether a section is loaded — unlike Apply/Cancel, closing the pane
    // is always a valid action. Discards any unsaved edit exactly like
    // Cancel/onClose already do; no confirmation prompt (see onClose's doc
    // comment — Close has never applied pending edits in this pane).
    this.closeButtonEl = actionsEl.createDiv({
      cls: "unified-outliner-partial-edit-close clickable-icon",
    });
    setIcon(this.closeButtonEl, "x");
    setTooltip(this.closeButtonEl, "Close");
    this.closeButtonEl.addEventListener("click", () => this.leaf.detach());

    // Phase 5B: a second row below the title+actions header, dedicated to
    // the ancestor breadcrumb. Kept as its own element (not squeezed into
    // titleEl) so the existing header row's layout — title left, actions
    // right — stays exactly as it was; see renderBreadcrumb for what goes
    // in here.
    this.breadcrumbEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-breadcrumb",
    });

    // Subtree Navigator: a third header row, below the ancestor breadcrumb,
    // for descending into the loaded node's own direct children. Its own
    // element (not merged into breadcrumbEl) so the two are visually and
    // structurally distinct — "climb up" vs. "descend down" — per the
    // implementation instruction's explicit requirement that the two not
    // share one row. See renderSubtreeNavigator for what goes in here.
    this.subtreeNavEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-subtree-nav",
    });

    this.textareaEl = this.contentEl.createEl("textarea", {
      cls: "unified-outliner-partial-edit-textarea",
    });
    // See updateDirtyState's doc comment: Apply/Cancel are only shown once
    // there is something to Apply/Cancel, so every keystroke needs to
    // re-check whether the textarea still matches originalText.
    this.textareaEl.addEventListener("input", () => this.updateDirtyState());

    // Real-device follow-up: keep exactly one visible close affordance.
    // See updateCloseButtonVisibility's doc comment for why a lone leaf
    // docked in the sidebar needs this pane's own ×, while a leaf that's
    // been dragged into a normal tab or popped into its own window
    // (Phase 5A's "open in new window" support) already gets a native tab
    // × from Obsidian — showing both there would be a redundant, confusing
    // double close button. `layout-change` fires whenever a leaf moves
    // between containers (sidebar <-> tab <-> popout), so re-checking on
    // every one of those keeps this correct as the user drags the pane
    // around, not just at first open. registerEvent (not a raw
    // workspace.on) ties this listener's lifetime to the view via
    // Component, so it's automatically removed on close instead of
    // outliving this pane.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.updateCloseButtonVisibility())
    );

    this.renderEmptyState();
    this.updateCloseButtonVisibility();
  }

  async onClose(): Promise<void> {
    // Intentionally no auto-save here: per the Phase 3B design, Close
    // (like Cancel) never applies pending edits — only the Apply button
    // does. Nothing to clean up beyond the DOM itself.
    this.contentEl.empty();
  }

  /**
   * Phase 5B: the guarded, PUBLIC entry point every external caller must
   * use to switch which node this pane displays — main.ts's
   * activatePartialEditView (itself called from OutlineTreeView's "Open
   * partial edit pane" / "Edit list subtree in pane" menu items), and this
   * file's own breadcrumb segment clicks (renderBreadcrumb below), both
   * call this instead of loadNodeInternal directly. This is the "single
   * common projection entry point" the implementation instruction calls
   * for: Tree-triggered switches and breadcrumb-triggered switches must
   * behave identically, including the unsaved-edit guard below, so neither
   * path may bypass it.
   *
   * When the pane has no unapplied edit (see isDirty), this is a same-tick
   * passthrough to loadNodeInternal — no behavior change from before
   * Phase 5B. When it does, an Apply/Discard/Cancel modal is shown first:
   * - Cancel: nothing happens; the pane stays exactly as it was.
   * - Discard: the unapplied edit is thrown away and `nodeId` loads.
   * - Apply: applyEdit() runs; `nodeId` only loads if that Apply actually
   *   succeeded (outcome.changed) — a failed Apply (conflict, refused
   *   edit, etc.) leaves the pane on its current node, exactly like
   *   clicking the Apply button directly already does, and applyEdit()
   *   has already shown the user a Notice explaining why.
   * Dismissing the modal any other way (Escape, clicking outside) is
   * treated as Cancel — see DiscardChangesModal's onClose.
   */
  requestLoadNode(nodeId: string): void {
    if (!this.isDirty()) {
      this.loadNodeInternal(nodeId);
      return;
    }
    new DiscardChangesModal(this.app, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadNodeInternal(nodeId);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadNodeInternal(nodeId);
      }
    }).open();
  }

  /**
   * Load `nodeId` (a section OR a list item id) from the currently active
   * note into this pane, replacing whatever was loaded before (the pane
   * always holds at most one node — see the "reuse, don't multiply" leaf
   * policy in main.ts's activatePartialEditView, mirroring
   * activateOutlineTreeView).
   *
   * Phase 4C: renamed from loadSection, then dispatched to
   * extractSubtreeText rather than the section-only extractSectionText —
   * a list item with unsafeIndent is refused here (reason "unsafe-indent",
   * see edit/partialEdit.ts) exactly like an unresolvable id is.
   *
   * Phase 5B: renamed again, from loadNode to loadNodeInternal, and made
   * private — requestLoadNode above is now the only sanctioned way in from
   * outside this class. This method's own behavior is otherwise unchanged
   * (still unconditionally overwrites whatever was loaded before), which
   * is exactly why requestLoadNode's dirty guard has to sit in front of
   * it rather than being folded into it. Also now computes the
   * breadcrumb's ancestor list (findAncestorPath) alongside the existing
   * label lookup, both via the shared nodeDisplayLabel helper so the pane
   * title and the breadcrumb segments never disagree on how a node is
   * labeled. Post-Phase-5B: also computes the Subtree Navigator's direct
   * children (findDirectChildren) the same way — one fresh snapshot per
   * load, covering title, breadcrumb, and navigator together.
   */
  private loadNodeInternal(nodeId: string): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice("Unified Outliner: no active note to load a node from.");
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const extracted = extractSubtreeText(doc, nodeId);
    if (!extracted.ok || !extracted.kind) {
      new Notice(
        NOOP_MESSAGES[extracted.reason ?? "resolve-failed"] ??
          "Unified Outliner: could not load that node."
      );
      return;
    }

    const node = doc.nodes.get(nodeId);
    const label = node ? nodeDisplayLabel(doc, node) : "";

    this.nodeId = nodeId;
    this.nodeKind = extracted.kind;
    this.originalText = extracted.text;
    this.label = label;
    this.ancestors = findAncestorPath(doc, nodeId);
    this.directChildren = findDirectChildren(doc, nodeId);
    this.renderLoadedState();
  }

  private renderEmptyState(): void {
    this.titleEl.setText("Unified Outliner: Partial Edit");
    this.textareaEl.value = "";
    this.textareaEl.disabled = true;
    this.applyButtonEl.disabled = true;
    this.cancelButtonEl.disabled = true;
    this.textareaEl.setAttribute(
      "placeholder",
      "Right-click a node in the Outline Tree View and choose “Open partial edit pane” / “Edit list subtree in pane” to load something here."
    );
    this.ancestors = [];
    this.directChildren = [];
    this.renderBreadcrumb();
    this.renderSubtreeNavigator();
    this.updateDirtyState();
  }

  /**
   * Phase 4C: the title now prefixes the node's kind (Section / List) so
   * the pane stays honest about what range Apply will replace, without
   * otherwise treating the two kinds differently — see class doc comment.
   */
  private renderLoadedState(): void {
    const kindLabel = this.nodeKind === "list" ? "List" : "Section";
    this.titleEl.setText(`Editing (${kindLabel}): ${this.label}`);
    this.textareaEl.disabled = false;
    this.applyButtonEl.disabled = false;
    this.cancelButtonEl.disabled = false;
    this.textareaEl.value = this.originalText;
    this.renderBreadcrumb();
    this.renderSubtreeNavigator();
    this.updateDirtyState();
  }

  /**
   * Phase 5B: draw the ancestor breadcrumb from `this.ancestors`, computed
   * once by loadNodeInternal at load time. Deliberately NOT recomputed on
   * every render or on a timer — the breadcrumb is a read-only aid derived
   * from the same "before editing" snapshot as the textarea, and Phase 5B's
   * design principle #5 is explicit that it must not be live-recalculated
   * against in-progress edits or Tree state before an Apply. Re-running
   * this only happens as part of loadNodeInternal/renderEmptyState, i.e.
   * exactly when the loaded node itself changes.
   *
   * The current node itself is never shown here (see class field doc
   * comment on `ancestors` and requestLoadNode) — titleEl already owns
   * that role, so breadcrumb and title stay complementary rather than
   * redundant.
   */
  private renderBreadcrumb(): void {
    this.breadcrumbEl.empty();
    if (this.ancestors.length === 0) {
      this.breadcrumbEl.toggleVisibility(false);
      return;
    }
    this.breadcrumbEl.toggleVisibility(true);

    const visibleCount = PartialEditView.BREADCRUMB_VISIBLE_ANCESTORS;
    const elided =
      this.ancestors.length > visibleCount
        ? this.ancestors.slice(0, this.ancestors.length - visibleCount)
        : [];
    const visible =
      elided.length > 0 ? this.ancestors.slice(elided.length) : this.ancestors;

    if (elided.length > 0) {
      const ellipsisEl = this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-segment unified-outliner-partial-edit-breadcrumb-ellipsis",
        text: "…",
      });
      setTooltip(ellipsisEl, elided.map((a) => a.label).join(" › "));
      this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-sep",
        text: "›",
      });
    }

    visible.forEach((ancestor, index) => {
      const segEl = this.breadcrumbEl.createSpan({
        cls: "unified-outliner-partial-edit-breadcrumb-segment",
        text: ancestor.label,
      });
      setTooltip(segEl, ancestor.label);
      // Phase 5B design principle #3/#5: a breadcrumb click must resolve
      // through the same guarded projection entry point as a Tree click —
      // never a direct loadNodeInternal call. See requestLoadNode's doc
      // comment for the full rationale (dirty-guard parity above all).
      segEl.addEventListener("click", () => this.requestLoadNode(ancestor.id));
      if (index < visible.length - 1) {
        this.breadcrumbEl.createSpan({
          cls: "unified-outliner-partial-edit-breadcrumb-sep",
          text: "›",
        });
      }
    });
  }

  /**
   * Subtree Navigator: draw the loaded node's direct children
   * (`this.directChildren`, computed once by loadNodeInternal — same
   * "static snapshot until the next load" policy as renderBreadcrumb's
   * ancestors, and for the same reason: this is a read-only navigation aid
   * derived from the pane's "before editing" snapshot, not a live view of
   * in-progress edits). Hidden entirely when the loaded node has no
   * children — a leaf node gets no empty/disabled navigator row, per the
   * implementation instruction's explicit requirement.
   *
   * Up to SUBTREE_VISIBLE_CHILDREN children are shown inline as chips
   * (appendSubtreeChip); any remainder collapses into one "More…" chip
   * that opens an Obsidian Menu — Menu already provides keyboard
   * navigation and correct positioning in every window (main, sidebar
   * split, or popout), so no bespoke popover was written for the overflow
   * case.
   */
  private renderSubtreeNavigator(): void {
    this.subtreeNavEl.empty();
    if (this.directChildren.length === 0) {
      this.subtreeNavEl.toggleVisibility(false);
      return;
    }
    this.subtreeNavEl.toggleVisibility(true);

    this.subtreeNavEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-label",
      text: "Subtree:",
    });

    const visibleCount = PartialEditView.SUBTREE_VISIBLE_CHILDREN;
    const overflow = this.directChildren.length > visibleCount;
    // Reserve one inline slot for the "More…" chip itself when overflowing,
    // so the row never shows more than SUBTREE_VISIBLE_CHILDREN chips total.
    const visible = overflow
      ? this.directChildren.slice(0, visibleCount - 1)
      : this.directChildren;
    const hidden = overflow ? this.directChildren.slice(visible.length) : [];

    for (const child of visible) {
      this.appendSubtreeChip(child);
    }

    if (hidden.length > 0) {
      const moreEl = this.subtreeNavEl.createSpan({
        cls: "unified-outliner-partial-edit-subtree-nav-chip unified-outliner-partial-edit-subtree-nav-more",
        text: `More… (${hidden.length})`,
      });
      moreEl.tabIndex = 0;
      moreEl.setAttribute("role", "button");
      setTooltip(moreEl, `${hidden.length} more`);

      const openOverflowMenu = (anchor: HTMLElement, mouseEvt?: MouseEvent) => {
        const menu = new Menu();
        for (const child of hidden) {
          menu.addItem((item) =>
            item
              .setTitle(child.hasChildren ? `${child.label} ›` : child.label)
              .setIcon(child.kind === "section" ? "heading" : "list")
              // Same guarded entry point as every other Subtree Navigator
              // chip — see appendSubtreeChip's doc comment.
              .onClick(() => this.requestLoadNode(child.id))
          );
        }
        if (mouseEvt) {
          menu.showAtMouseEvent(mouseEvt);
        } else {
          // Keyboard-triggered (no MouseEvent): position explicitly, and
          // pass the anchor's OWN document (not the implicit global one) so
          // this opens correctly in a popped-out Partial Edit Pane window
          // too — same cross-window-safety pattern as the rest of this
          // pane (see class doc comment / Phase 5A).
          const rect = anchor.getBoundingClientRect();
          menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument);
        }
      };
      moreEl.addEventListener("click", (evt) => openOverflowMenu(moreEl, evt));
      moreEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          openOverflowMenu(moreEl);
        }
      });
    }
  }

  /**
   * One Subtree Navigator chip: an icon (heading vs. list — see class doc
   * comment on why kind is never conveyed by color alone), the child's
   * label (CSS-truncated with a tooltip carrying the full text, same
   * pattern as renderBreadcrumb's segments), and a subtle "›" marker when
   * the child itself has further children (hasChildren) — a hint that
   * there's more to descend into below it, without committing to showing
   * that deeper level inline.
   *
   * Focusable (tabIndex + role="button") and Enter/Space-activatable, on
   * top of the click handler — the implementation instruction explicitly
   * requires keyboard operability and visible focus here (see
   * styles.css's :focus-visible rule for this chip class).
   *
   * Activating a chip always calls requestLoadNode, never loadNodeInternal
   * — descending into a child must go through the exact same dirty-guard /
   * Apply-Discard-Cancel path as Tree clicks and breadcrumb clicks. See
   * requestLoadNode's own doc comment for the full rationale; nothing
   * about that guard changes for this new caller.
   */
  private appendSubtreeChip(child: DescendantNavigationEntry): void {
    const chipEl = this.subtreeNavEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip",
    });
    chipEl.tabIndex = 0;
    chipEl.setAttribute("role", "button");
    setTooltip(chipEl, child.label);

    const iconEl = chipEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip-icon",
    });
    setIcon(iconEl, child.kind === "section" ? "heading" : "list");

    chipEl.createSpan({
      cls: "unified-outliner-partial-edit-subtree-nav-chip-label",
      text: child.label,
    });

    if (child.hasChildren) {
      chipEl.createSpan({
        cls: "unified-outliner-partial-edit-subtree-nav-chip-marker",
        text: "›",
      });
    }

    const activate = () => this.requestLoadNode(child.id);
    chipEl.addEventListener("click", activate);
    chipEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        activate();
      }
    });
  }

  /** Revert unsaved edits in the textarea — does not close the pane or change which node is loaded. */
  private cancelEdit(): void {
    if (!this.nodeId) return;
    this.textareaEl.value = this.originalText;
    this.updateDirtyState();
  }

  /**
   * Apply the textarea's current content back to the active note, via the
   * same resolve-fresh -> compute outcome -> applyLineEditOutcome pipeline
   * every other tree-triggered command in this plugin uses. Unlike a
   * passive no-op (which respects the "Show no-op notices" setting), a
   * failed Apply always shows a Notice — silently doing nothing in
   * response to an explicit Apply click would be actively confusing.
   *
   * Phase 5B: now returns whether the apply actually succeeded. The
   * Apply-button click handler still ignores this (a button click doesn't
   * need to react to it — the Notice already tells the user), but
   * requestLoadNode's "Apply and switch" path needs it to decide whether
   * proceeding to load the next node is safe: a failed Apply (conflict,
   * refused edit, no active note, etc.) must leave the pane on its
   * current node rather than discarding the edit that just failed to
   * save.
   */
  private applyEdit(): boolean {
    if (!this.nodeId) {
      new Notice("Unified Outliner: no node loaded in this pane.");
      return false;
    }
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice("Unified Outliner: no active note to apply to.");
      return false;
    }
    const editor = view.editor;
    if (editor.listSelections().length > 1) {
      new Notice("Unified Outliner: multiple cursors are not supported.");
      return false;
    }

    const doc = parseDocument(editor.getValue());
    const outcome = applySubtreeEdit(doc, this.nodeId, this.originalText, this.textareaEl.value);
    const node = doc.nodes.get(this.nodeId);
    const startLine = node ? node.range.startLine : 0;

    if (!outcome.changed) {
      new Notice(
        NOOP_MESSAGES[outcome.reason ?? "resolve-failed"] ??
          "Unified Outliner: could not apply this edit."
      );
      return false;
    }

    // outcome.changed is already true here, so applyLineEditOutcome's own
    // no-op branch never fires — the notify callback is unreachable, but
    // required by its signature.
    applyLineEditOutcome(
      editor,
      { line: startLine, ch: 0 },
      startLine,
      doc.lines,
      outcome,
      () => {}
    );

    this.originalText = this.textareaEl.value;
    this.updateDirtyState();

    const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
    editor.scrollIntoView(
      { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
      true
    );

    new Notice(
      this.nodeKind === "list" ? "Unified Outliner: list subtree updated." : "Unified Outliner: section updated."
    );
    return true;
  }

  /**
   * Real-device follow-up: Apply/Cancel previously stayed visible (only
   * enabled/disabled) for as long as a node was loaded, regardless of
   * whether there was anything to Apply/Cancel. Showing them only while
   * the textarea actually differs from `originalText` (the pane's "before
   * editing" snapshot — see applySubtreeEdit's doc comment in
   * edit/partialEdit.ts) makes the pane read as clean immediately after a
   * fresh load, a successful Apply, or a Cancel, and only surface an
   * action once there's an actual pending edit. `nodeId` is checked too
   * (not just the text comparison) purely for clarity at the empty-state
   * call site — textareaEl.value and originalText are both "" before any
   * node is ever loaded, so the comparison alone would already resolve to
   * false there.
   */
  private updateDirtyState(): void {
    const dirty = this.isDirty();
    this.applyButtonEl.toggleVisibility(dirty);
    this.cancelButtonEl.toggleVisibility(dirty);
  }

  /**
   * Phase 5B: shared by updateDirtyState (Apply/Cancel button visibility)
   * and requestLoadNode (the unsaved-edit guard) — both need the exact
   * same "is there something to Apply/Cancel/lose right now" condition,
   * so it lives in one place instead of being duplicated inline.
   */
  private isDirty(): boolean {
    return this.nodeId !== null && this.textareaEl.value !== this.originalText;
  }

  /**
   * Real-device follow-up: keep exactly one visible "close this pane"
   * control. Obsidian only draws a native tab header (with its own ×) for
   * leaves outside the left/right sidedock (`workspace.leftSplit` /
   * `rightSplit`) — a lone leaf docked directly in the sidebar (this
   * pane's default open location; see main.ts's activatePartialEditView)
   * gets no native close control at all, which is why this pane has its
   * own × in the first place. Once the user drags this pane into a normal
   * tab, or pops it into its own window (activatePartialEditView's
   * `openInNewWindow` support), Obsidian draws a native tab × too — this
   * pane's own × would then be a redundant second close button, so it
   * hides itself whenever `this.leaf.getRoot()` is NOT one of the two
   * sidedocks (i.e. whenever a native × is expected to already be
   * present).
   */
  private updateCloseButtonVisibility(): void {
    const { workspace } = this.app;
    const root = this.leaf.getRoot();
    const inSidebar = root === workspace.leftSplit || root === workspace.rightSplit;
    this.closeButtonEl.toggleVisibility(inSidebar);
  }
}

type DiscardChangesChoice = "apply" | "discard" | "cancel";

/**
 * Phase 5B: the Apply/Discard/Cancel prompt PartialEditView.requestLoadNode
 * shows when it's asked to switch nodes while the pane has an unapplied
 * edit. A plain Obsidian Modal rather than anything home-grown — Modal's
 * own `open()` already shows on the window that's currently active (per
 * its doc comment in obsidian.d.ts), so this needs no cross-window
 * plumbing of its own to work correctly from a popped-out Partial Edit
 * Pane (Phase 5A) exactly as it does from the sidebar-docked pane.
 *
 * `onChoice` fires exactly once per modal instance, either from an
 * explicit button click (choose()) or, if the modal is dismissed any other
 * way (Escape key, clicking the backdrop), from onClose() below — treated
 * the same as an explicit Cancel, since either way the answer to "should
 * the pending edit be discarded" is no.
 */
class DiscardChangesModal extends Modal {
  private resolved = false;

  constructor(app: App, private readonly onChoice: (choice: DiscardChangesChoice) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Unified Outliner: unsaved changes");
    this.contentEl.createEl("p", {
      text:
        "This node has unapplied edits. Apply them before switching, discard them, or stay here.",
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-modal-buttons",
    });
    const applyEl = buttonsEl.createEl("button", { text: "Apply", cls: "mod-cta" });
    applyEl.addEventListener("click", () => this.choose("apply"));
    const discardEl = buttonsEl.createEl("button", { text: "Discard" });
    discardEl.addEventListener("click", () => this.choose("discard"));
    const cancelEl = buttonsEl.createEl("button", { text: "Cancel" });
    cancelEl.addEventListener("click", () => this.choose("cancel"));
  }

  private choose(choice: DiscardChangesChoice): void {
    this.resolved = true;
    this.close();
    this.onChoice(choice);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onChoice("cancel");
    }
  }
}
