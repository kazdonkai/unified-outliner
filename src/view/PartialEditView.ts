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
 *
 * Sibling前後移動 (docs/phase5b_sibling-navigation-spec.md): the sideways
 * counterpart to both of the above. A fourth header row (renderSiblingNav),
 * between the breadcrumb and the Subtree Navigator, holds two buttons —
 * previous/next sibling of the loaded node, resolved by
 * tree/siblingNavigation.ts directly from the node's existing
 * `prevSiblingId`/`nextSiblingId` (no new sibling-order computation). Both
 * buttons call requestLoadNode exactly like every other navigation control
 * on this pane — no new projection path, no new dirty guard. Unlike the
 * breadcrumb and Subtree Navigator (hidden entirely when empty), this row
 * stays visible whenever a node is loaded and disables whichever button has
 * no target, per the spec's §3 UI 仕様.
 */
import { App, ItemView, Menu, Modal, Notice, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { parseDocument } from "../parser/parseDocument";
import { applySubtreeEdit, extractSubtreeText, SubtreeKind } from "../edit/partialEdit";
import { nodeDisplayLabel } from "../tree/buildOutlineTree";
import { AncestorPathEntry, findAncestorPath } from "../tree/ancestorPath";
import { DescendantNavigationEntry, findDirectChildren } from "../tree/descendantPath";
import { SiblingNavigationState, getSiblingNavigationState } from "../tree/siblingNavigation";
import { applyLineEditOutcome } from "../commands/applyLineEditOutcome";
import { TranslationKey } from "../i18n";

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
  /** Sibling前後移動: the loaded node's previous/next sibling, computed once at load time alongside `ancestors`/`directChildren` — see renderSiblingNav's doc comment. */
  private siblingState: SiblingNavigationState = { previous: null, next: null };

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
  private siblingNavEl!: HTMLElement;
  private siblingPrevEl!: HTMLButtonElement;
  private siblingPrevTargetEl!: HTMLElement;
  private siblingNextEl!: HTMLButtonElement;
  private siblingNextTargetEl!: HTMLElement;
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
    return this.plugin.t("partialEdit.viewName");
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
    this.applyButtonEl = actionsEl.createEl("button", {
      text: this.plugin.t("common.apply"),
      cls: "mod-cta",
    });
    this.applyButtonEl.addEventListener("click", () => this.applyEdit());
    this.cancelButtonEl = actionsEl.createEl("button", { text: this.plugin.t("common.cancel") });
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
    setTooltip(this.closeButtonEl, this.plugin.t("partialEdit.close"));
    this.closeButtonEl.addEventListener("click", () => this.leaf.detach());

    // Phase 5B: a second row below the title+actions header, dedicated to
    // the ancestor breadcrumb. Kept as its own element (not squeezed into
    // titleEl) so the existing header row's layout — title left, actions
    // right — stays exactly as it was; see renderBreadcrumb for what goes
    // in here.
    this.breadcrumbEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-breadcrumb",
    });

    // Sibling前後移動: a row between the ancestor breadcrumb and the Subtree
    // Navigator, for moving sideways to the loaded node's previous/next
    // sibling. Its own element (not merged into breadcrumbEl) per the spec's
    // explicit requirement that breadcrumb's own structure stay untouched —
    // see renderSiblingNav for what goes in here. Unlike breadcrumbEl and
    // subtreeNavEl, its two buttons are created once here and only ever
    // toggled/relabeled by renderSiblingNav afterward, since there are
    // always exactly two of them (no variable-length list to rebuild).
    this.siblingNavEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-sibling-nav",
    });
    this.siblingPrevEl = this.siblingNavEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sibling-nav-button unified-outliner-partial-edit-sibling-nav-prev",
    });
    setIcon(this.siblingPrevEl, "chevron-left");
    this.siblingPrevEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-label",
      text: this.plugin.t("partialEdit.previousSibling"),
    });
    // Preview of the previous sibling's own displayLabel, so the pane shows
    // where "Previous" actually goes before it's clicked — see
    // renderSiblingNav for how this span's text/visibility is kept in sync
    // with this.siblingState.previous. CSS-truncated (styles.css) rather
    // than JS-truncated, matching how renderBreadcrumb's segments and
    // appendSubtreeChip's labels already truncate; the button's own tooltip
    // (set in renderSiblingNav) still carries the untruncated label, same
    // pattern as those two.
    this.siblingPrevTargetEl = this.siblingPrevEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-target",
    });
    // Reads this.siblingState.previous fresh at click time rather than
    // capturing it in a stale closure — renderSiblingNav updates that field
    // on every load without ever recreating this button. Same guarded
    // projection entry point as breadcrumb segments and Subtree Navigator
    // chips (see requestLoadNode's own doc comment) — never loadNodeInternal
    // directly.
    this.siblingPrevEl.addEventListener("click", () => {
      const target = this.siblingState.previous;
      if (target) this.requestLoadNode(target.nodeId);
    });

    this.siblingNextEl = this.siblingNavEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sibling-nav-button unified-outliner-partial-edit-sibling-nav-next",
    });
    // Next sibling's target-label span is created FIRST (before the "Next"
    // word and its icon), so it sits closest to the row's center — mirrored
    // against siblingPrevTargetEl, which sits closest to the center on the
    // other side (right after "Previous", before nothing). Reading order
    // ends up "‹ Previous  [target]" / "[target]  Next ›", pointing outward
    // from the loaded node toward each sibling.
    this.siblingNextTargetEl = this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-target",
    });
    this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-label",
      text: this.plugin.t("partialEdit.nextSibling"),
    });
    setIcon(this.siblingNextEl, "chevron-right");
    this.siblingNextEl.addEventListener("click", () => {
      const target = this.siblingState.next;
      if (target) this.requestLoadNode(target.nodeId);
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
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
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
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const extracted = extractSubtreeText(doc, nodeId);
    if (!extracted.ok || !extracted.kind) {
      const reasonKey = ("reason." + (extracted.reason ?? "resolve-failed")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
      return;
    }

    const node = doc.nodes.get(nodeId);
    const t = this.plugin.t.bind(this.plugin);
    const label = node ? nodeDisplayLabel(doc, node, t) : "";

    this.nodeId = nodeId;
    this.nodeKind = extracted.kind;
    this.originalText = extracted.text;
    this.label = label;
    this.ancestors = findAncestorPath(doc, nodeId, t);
    this.directChildren = findDirectChildren(doc, nodeId, t);
    this.siblingState = getSiblingNavigationState(doc, nodeId, t);
    this.renderLoadedState();
  }

  private renderEmptyState(): void {
    this.titleEl.setText(this.plugin.t("partialEdit.viewName"));
    this.textareaEl.value = "";
    this.textareaEl.disabled = true;
    this.applyButtonEl.disabled = true;
    this.cancelButtonEl.disabled = true;
    this.textareaEl.setAttribute("placeholder", this.plugin.t("partialEdit.emptyPlaceholder"));
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.updateDirtyState();
  }

  /**
   * Phase 4C: the title now prefixes the node's kind (Section / List) so
   * the pane stays honest about what range Apply will replace, without
   * otherwise treating the two kinds differently — see class doc comment.
   */
  private renderLoadedState(): void {
    const kindLabel =
      this.nodeKind === "list" ? this.plugin.t("partialEdit.kindList") : this.plugin.t("partialEdit.kindSection");
    this.titleEl.setText(this.plugin.t("partialEdit.editingTitle", { kind: kindLabel, label: this.label }));
    this.textareaEl.disabled = false;
    this.applyButtonEl.disabled = false;
    this.cancelButtonEl.disabled = false;
    this.textareaEl.value = this.originalText;
    this.renderBreadcrumb();
    this.renderSiblingNav();
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
   * Sibling前後移動 (docs/phase5b_sibling-navigation-spec.md §3/§4): update
   * the two sibling-nav buttons from `this.siblingState`, computed once by
   * loadNodeInternal at load time — same "static snapshot until the next
   * load" policy as renderBreadcrumb/renderSubtreeNavigator's own fields,
   * for the same reason (a read-only navigation aid derived from the pane's
   * "before editing" snapshot, not live-recalculated against in-progress
   * edits).
   *
   * Unlike renderBreadcrumb/renderSubtreeNavigator, this never rebuilds the
   * DOM tree itself (no empty()/createSpan for the buttons) — the two
   * buttons, and their target-label spans, are created once in onOpen and
   * always exist; only `disabled` state, tooltip, and the target-label
   * text/visibility change here. The row itself is hidden only when no node
   * is loaded at all (`!this.nodeId`); once a node IS loaded, the row stays
   * visible and each button disables itself independently when that
   * direction has no sibling — deliberately different from the breadcrumb
   * and Subtree Navigator's "hide the whole row when empty" policy, since a
   * node with siblings on only one side should still make that one
   * direction discoverable.
   *
   * Target-label preview: each button's *TargetEl span shows the
   * destination sibling's own displayLabel (same field the breadcrumb and
   * Subtree Navigator already use — see AncestorPathEntry.label /
   * DescendantNavigationEntry.label), so the pane shows where "Previous" /
   * "Next" actually lead before either is clicked. CSS truncates a long
   * label (styles.css); the button's own tooltip below always carries the
   * full, untruncated label. When a direction has no sibling, its target
   * span is cleared and hidden rather than showing empty space — no target
   * label for a disabled button, matching the button's own disabled state.
   */
  private renderSiblingNav(): void {
    if (!this.nodeId) {
      this.siblingNavEl.toggleVisibility(false);
      return;
    }
    this.siblingNavEl.toggleVisibility(true);

    const previous = this.siblingState.previous;
    this.siblingPrevEl.disabled = !previous;
    setTooltip(
      this.siblingPrevEl,
      previous ? previous.displayLabel : this.plugin.t("partialEdit.noPreviousSibling")
    );
    this.siblingPrevTargetEl.setText(previous ? previous.displayLabel : "");
    this.siblingPrevTargetEl.toggleVisibility(!!previous);

    const next = this.siblingState.next;
    this.siblingNextEl.disabled = !next;
    setTooltip(
      this.siblingNextEl,
      next ? next.displayLabel : this.plugin.t("partialEdit.noNextSibling")
    );
    this.siblingNextTargetEl.setText(next ? next.displayLabel : "");
    this.siblingNextTargetEl.toggleVisibility(!!next);
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
      text: this.plugin.t("partialEdit.subtreeLabel"),
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
        text: this.plugin.t("partialEdit.moreChip", { count: hidden.length }),
      });
      moreEl.tabIndex = 0;
      moreEl.setAttribute("role", "button");
      setTooltip(moreEl, this.plugin.t("partialEdit.moreCount", { count: hidden.length }));

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
      new Notice(this.plugin.t("partialEdit.noNodeLoaded"));
      return false;
    }
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice(this.plugin.t("partialEdit.noActiveNoteToApply"));
      return false;
    }
    const editor = view.editor;
    if (editor.listSelections().length > 1) {
      new Notice(this.plugin.t("notice.multipleCursors"));
      return false;
    }

    const doc = parseDocument(editor.getValue());
    const outcome = applySubtreeEdit(doc, this.nodeId, this.originalText, this.textareaEl.value);
    const node = doc.nodes.get(this.nodeId);
    const startLine = node ? node.range.startLine : 0;

    if (!outcome.changed) {
      const reasonKey = ("reason." + (outcome.reason ?? "resolve-failed")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
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
      this.nodeKind === "list"
        ? this.plugin.t("partialEdit.listSubtreeUpdated")
        : this.plugin.t("partialEdit.sectionUpdated")
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

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly onChoice: (choice: DiscardChangesChoice) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.plugin.t("partialEdit.unsavedChangesTitle"));
    this.contentEl.createEl("p", {
      text: this.plugin.t("partialEdit.unsavedChangesBody"),
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-modal-buttons",
    });
    const applyEl = buttonsEl.createEl("button", {
      text: this.plugin.t("common.apply"),
      cls: "mod-cta",
    });
    applyEl.addEventListener("click", () => this.choose("apply"));
    const discardEl = buttonsEl.createEl("button", { text: this.plugin.t("common.discard") });
    discardEl.addEventListener("click", () => this.choose("discard"));
    const cancelEl = buttonsEl.createEl("button", { text: this.plugin.t("common.cancel") });
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
