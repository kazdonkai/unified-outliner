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
 *
 * Phase 5C-4 (2026-08-14, "Standalone Callout / Blockquote の Partial Edit
 * Popout 完成と元ノート同一性の安全化"): adds an "Open in new window" menu
 * item for standalone (non-composite-member) callout/blockquote rows (see
 * view/OutlineTreeView.ts's showStandaloneComplexBlockMenu) — reusing this
 * pane's pre-existing, unchanged Phase 5A popout support
 * (activatePartialEditView's `openInNewWindow` option) rather than adding
 * any new window-management code here. This ticket also adds `sourcePath`
 * — the file path of the note this pane's currently-loaded node was
 * actually read from, recorded once per loadNodeInternal call — as an
 * ADDITIONAL, path-based safety valve checked by applyEdit before its
 * existing content-based conflict check, never a replacement for it. See
 * view/partialEditSourceNoteCheck.ts's own doc comment for the full
 * rationale (popout makes "switch notes in the other window, then Apply"
 * an easier mistake to make than it was while the pane was always docked).
 *
 * Phase 5P-2 (2026-08-17, paragraph Partial Edit hoist): adds a SECOND,
 * parallel "what is loaded" identity — `paragraphAnchor` — alongside the
 * existing `nodeId`/`nodeKind` pair above, rather than folding a paragraph
 * into the nodeId-based model. A paragraph has no BlockNode/ComplexBlockInfo
 * id known in advance (the only entry point is a body-editor cursor line —
 * resolver/resolveParagraphAtCursor.ts) and its Apply-time safety contract
 * needs extra parentId/depth re-verification callout/blockquote's existing
 * id-only path has no equivalent for (see edit/paragraphPartialEdit.ts's own
 * doc comment) — reusing extractSubtreeText/applySubtreeEdit's contract
 * as-is would silently drop that extra check. Exactly one of `nodeId` /
 * `paragraphAnchor` is ever non-null at a time (both loadNodeInternal and
 * loadParagraphInternal below clear the other). A loaded paragraph
 * deliberately shows none of the breadcrumb / sibling-nav / Subtree
 * Navigator rows — `ancestors`/`directChildren`/`siblingState` all stay at
 * their empty-state values (mirroring the existing standalone
 * callout/blockquote path, which also leaves them empty), and
 * renderSiblingNav's own visibility check already hinges on `nodeId`
 * specifically (null for a loaded paragraph), so it stays hidden with no
 * further change needed. This is intentional, approved 5P-2 scope — no
 * Tree-based paragraph selection, no always-on Tree display, no paragraph
 * D&D/rename/insert/delete; see resolver/resolveParagraphAtCursor.ts's own
 * doc comment for the full non-goal list.
 */
import {
  App,
  Editor,
  ItemView,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  debounce,
  setIcon,
  setTooltip,
} from "obsidian";
import type UnifiedOutlinerPlugin from "../main";
import { parseDocument } from "../parser/parseDocument";
import { applySubtreeEdit, extractSubtreeText, SubtreeKind } from "../edit/partialEdit";
import { nodeDisplayLabel, standaloneComplexBlockLabel } from "../tree/buildOutlineTree";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { ParsedDocument } from "../model/block";
import { AncestorPathEntry, findAncestorPath } from "../tree/ancestorPath";
import { DescendantNavigationEntry, findDirectChildren } from "../tree/descendantPath";
import { SiblingNavigationState, getSiblingNavigationState } from "../tree/siblingNavigation";
import { applyLineEditOutcome } from "../commands/applyLineEditOutcome";
import { checkPartialEditSourceNote } from "./partialEditSourceNoteCheck";
import { TranslationKey } from "../i18n";
import { resolveParagraphAtCursor } from "../resolver/resolveParagraphAtCursor";
import {
  applyParagraphEdit,
  buildParagraphEditAnchor,
  ParagraphEditAnchor,
  resolveParagraphAnchorText,
} from "../edit/paragraphPartialEdit";
import { classifySyncOutcome, shouldRunStaleCheck } from "./partialEditSyncClassification";
import {
  buildQuotePrefixProjection,
  CalloutFoldMarker,
  invertQuotePrefixProjection,
  projectedDisplayText,
  QuotePrefixProjection,
  reconstructQuoteHeader,
} from "../edit/quotePrefixProjection";
import {
  applyCompositeBlockEdit,
  compositePartialEditReasonText,
  extractCompositeBlockText,
} from "../edit/compositeBlockPartialEdit";
import { CompositeBlockSnapshot } from "../edit/deleteCompositeBlock";
import { compositeBlockDisplayLabel, getCompositeBlockRuleById } from "../model/compositeBlock";
import { getEnabledCompositeBlockRules } from "../settingsDefaults";

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
  private nodeKind: SubtreeKind | "paragraph" | "composite" | null = null;
  /**
   * Phase 5P-2: set instead of (never alongside) `nodeId` when the pane is
   * currently showing a paragraph loaded via requestLoadParagraphAtCursor —
   * see this class's own doc comment for why this is a separate field
   * rather than an extension of nodeId's own contract.
   */
  private paragraphAnchor: ParagraphEditAnchor | null = null;
  /**
   * Phase 5D-2A: set instead of (never alongside) `nodeId`/`paragraphAnchor`
   * when the pane is currently showing an ENTIRE CompositeBlock (list item
   * + callout/blockquote, loaded via requestLoadComposite) as one atomic
   * editing unit. Exactly one of nodeId/paragraphAnchor/compositeAnchor is
   * ever non-null at a time — see this class's own doc comment. Never
   * re-identified by any id (composite-N, or any member's own id) across a
   * re-parse — see edit/compositeBlockPartialEdit.ts's own top doc comment
   * for why a CompositeBlockSnapshot's CONTENT (ruleId/sectionId/range/
   * members) is the only safe re-identification basis.
   */
  private compositeAnchor: CompositeBlockSnapshot | null = null;
  private label = "";
  /** The pane's "before editing" snapshot — see edit/partialEdit.ts's applySubtreeEdit doc comment. */
  private originalText = "";
  /**
   * Phase 5D-0.5: set (never for a paragraph/section/list, and never for a
   * callout/blockquote that failed to project — see loadNodeInternal) when
   * the loaded node is a callout/blockquote whose body is currently shown
   * PREFIX-STRIPPED in the textarea. `originalText` above ALWAYS stays the
   * raw, `>`-prefixed snapshot regardless of this field — see
   * currentDisplayText's doc comment for the one place the two are
   * reconciled. null means "show `originalText` verbatim" (every non-quote
   * kind, a quote block with no body to project, and a fresh empty pane).
   */
  private quoteProjection: QuotePrefixProjection | null = null;
  /**
   * Phase 5C-4: the file path of the note `nodeId` was actually loaded
   * from, recorded once per loadNodeInternal call (never recomputed
   * mid-edit, same "static until the next load" policy as `ancestors`/
   * `directChildren`/`siblingState` below). `null` only before any node has
   * ever been loaded, or if the resolved MarkdownView had no file (see
   * loadNodeInternal). Read by applyEdit as the ADDITIONAL, path-based
   * safety check — see view/partialEditSourceNoteCheck.ts.
   */
  private sourcePath: string | null = null;
  /** Phase 5B: root-first ancestors of the currently loaded node, computed once at load time — see renderBreadcrumb's doc comment for why this is never recomputed mid-edit. */
  private ancestors: AncestorPathEntry[] = [];
  /** Subtree Navigator: the loaded node's own direct children, computed once at load time alongside `ancestors` — see renderSubtreeNavigator's doc comment. */
  private directChildren: DescendantNavigationEntry[] = [];
  /** Sibling前後移動: the loaded node's previous/next sibling, computed once at load time alongside `ancestors`/`directChildren` — see renderSiblingNav's doc comment. */
  private siblingState: SiblingNavigationState = { previous: null, next: null };

  /**
   * Phase 5A-1 ("Partial Edit Pane の stale 状態検知・安全な再読み込み"):
   * whether the note's actual content, at the range this pane last
   * loaded/re-anchored from, still matches `originalText` (or, for a
   * CompositeBlock/paragraph, its own anchor snapshot). "synced" is the
   * default and the only state that ever existed before this ticket
   * (unchanged clean/dirty semantics — see isDirty()). "stale" means the
   * note changed elsewhere and Apply would be refused as a conflict by
   * the existing, UNCHANGED fail-closed check inside
   * applySubtreeEdit/applyParagraphEdit/applyCompositeBlockEdit — this
   * field never gates or replaces that check, it only pre-emptively
   * disables the visible Apply button (see updateDirtyState) so the user
   * isn't invited to click a button that's guaranteed to fail. "unavailable"
   * means the target itself could not be resolved at all (the source note
   * was deleted, or the target range no longer resolves) — see
   * transitionToUnavailable's own doc comment for why this never clears
   * itself automatically. Reset to "synced" on every fresh load
   * (loadNodeInternal/loadParagraphInternal/loadCompositeInternal/
   * renderEmptyState) and on a successful performAutoReload/executeReload.
   */
  private syncState: "synced" | "stale" | "unavailable" = "synced";

  /**
   * Phase 5A-1: set once in onClose, checked at the top of every method
   * that may still run after this pane's DOM/leaf is gone — a pending
   * `vault.cachedRead` promise (performStaleCheck) or a debounced
   * `scheduleStaleCheck` callback can both still fire after close, since
   * neither is itself tied to this Component's registerEvent lifecycle
   * (only the workspace/vault event LISTENERS are — the debounced
   * function and any in-flight async read survive independently). Every
   * such method treats a closed pane as a safe no-op rather than touching
   * now-detached DOM or stale internal state.
   */
  private closed = false;

  /**
   * Phase 5A-1 hardening §1 (self-Apply suppression): true for the exact
   * span of applyEdit()'s own note-mutating call — set immediately before
   * applyLineEditOutcome and cleared (via try/finally, so an exception or
   * early return can never leave it stuck true) right after this pane's
   * own re-anchoring finishes — for every one of applyEdit()'s three
   * branches (paragraph/composite/node), success path only (a failed
   * Apply returns before ever reaching applyLineEditOutcome, so it never
   * sets this at all — see each branch's own comment).
   *
   * Closes a theoretical self-Apply race this ticket's own safety review
   * flagged: IF `editor-change` were ever to fire synchronously from
   * `editor.replaceRange` (unconfirmed) inside a leading-edge-synchronous
   * `debounce` (also unconfirmed — see scheduleStaleCheck's own doc
   * comment), a stale check could otherwise run inside applyEdit()'s own
   * call stack, BEFORE this.originalText / the relevant anchor is
   * reassigned to match the just-applied content, and incorrectly read
   * that gap as staleness — with no automatic path back to "synced"
   * afterward (see the now-retracted claim this ticket's review
   * explicitly walked back).
   *
   * Checked by BOTH performStaleCheck (via shouldRunStaleCheck, so a
   * suppressed synchronous re-entrant call is a cheap no-op before even
   * touching the vault) AND evaluateAgainstText itself (so an ALREADY
   * in-flight `vault.cachedRead` promise scheduled before this Apply
   * started, whose `.then()` callback could in principle still run later,
   * is equally inert — defense-in-depth that does not rely on any
   * assumption about microtask/debounce ordering). Events arriving during
   * suppression are fully discarded, never queued — see
   * scheduleStaleCheck's own doc comment for why an explicit, single
   * `scheduleStaleCheck()` call right after releasing suppression (inside
   * each applyEdit() branch, after the try/finally) is what guarantees a
   * fresh re-check still happens afterward, rather than relying on
   * whatever debounced call may or may not have been swallowed.
   */
  private isApplyingOwnEdit = false;

  /**
   * Phase 5A-1: the single per-Pane, per-instance debounced stale check —
   * every event source below (editor-change/vault modify/active-leaf-
   * change/file-open) schedules through this SAME debouncer, so a burst of
   * several events (e.g. Apply's own editor-change firing alongside a
   * near-simultaneous vault "modify" for the same edit) collapses into one
   * performStaleCheck() call rather than several redundant ones. 150ms,
   * `resetTimer: true` — the same call shape OutlineTreeView.ts's own
   * scheduleRefresh already uses for its own editor-change/active-leaf-
   * change/file-open debounce (see that file's own doc comment); reusing
   * the identical, already-proven-safe call shape here rather than
   * inventing a different debounce configuration.
   */
  private scheduleStaleCheck = debounce(() => this.performStaleCheck(), 150, true);

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

  /**
   * Phase 5D-1C: the `id` shared between quoteTypeDatalistEl and
   * quoteTypeInputEl's own `list` attribute — this ticket's own approved
   * literal id string.
   */
  private static readonly QUOTE_TYPE_DATALIST_ID = "unified-outliner-callout-types";
  /**
   * Phase 5D-1C: the 13 standard Obsidian callout type keywords, per this
   * ticket's own approved candidate list — deliberately excludes type
   * aliases (e.g. "caution" for "warning"); alias coverage is explicitly
   * deferred to a future, separate UX ticket. Populates
   * quoteTypeDatalistEl's `<option>` children once, in onOpen.
   */
  private static readonly QUOTE_TYPE_DATALIST_OPTIONS = [
    "note",
    "abstract",
    "info",
    "todo",
    "tip",
    "success",
    "question",
    "warning",
    "failure",
    "danger",
    "bug",
    "example",
    "quote",
  ];

  private titleEl!: HTMLElement;
  /**
   * Phase 5A-1: the stale/unavailable indicator + Reload button row,
   * placed between the title/actions header and the ancestor breadcrumb
   * (see onOpen) — "near the Pane header/breadcrumb" per this ticket's own
   * UI placement requirement. Hidden entirely (toggleVisibility(false))
   * whenever `syncState === "synced"` or nothing is loaded — see
   * renderSyncStatus.
   */
  private syncStatusEl!: HTMLElement;
  private syncStatusLabelEl!: HTMLElement;
  private syncStatusReloadEl!: HTMLButtonElement;
  private breadcrumbEl!: HTMLElement;
  private siblingNavEl!: HTMLElement;
  private siblingPrevEl!: HTMLButtonElement;
  private siblingPrevTargetEl!: HTMLElement;
  private siblingNextEl!: HTMLButtonElement;
  private siblingNextTargetEl!: HTMLElement;
  private subtreeNavEl!: HTMLElement;
  /**
   * Phase 5D-0.5: container row shown ABOVE the textarea for a projecting
   * callout/blockquote — see renderQuoteHeader's doc comment. Stays
   * hidden for every other case (blockquote has no header; a raw-loaded
   * node has nothing to separate out).
   *
   * Phase 5D-1A: this container now holds `quoteHeaderLabelEl` (read-
   * only: quote prefix and the literal `[!`/`]` brackets, since 5D-1C —
   * originally also carried the type/fold marker/separator, see that
   * field's own doc comment) and `quoteTitleInputEl` (the editable
   * title). Never call `.setText()` on `quoteHeaderEl` itself any more —
   * that would wipe out its children as a side effect, since `setText`
   * replaces the element's entire text content including child elements.
   * Always target `quoteHeaderLabelEl` for the read-only text instead.
   *
   * Phase 5D-1B: a THIRD child, `quoteMarkerSelectEl`, sits between the
   * label and the title input — see that field's own doc comment.
   *
   * Phase 5D-1C: a FOURTH and FIFTH child, `quoteTypeInputEl` (editable
   * type combobox) and `quoteTypeCloseLabelEl` (read-only literal `]`),
   * sit between `quoteHeaderLabelEl` (now just quote prefix + literal
   * `[!`) and `quoteMarkerSelectEl` — see each field's own doc comment.
   * The row now reads left-to-right as "quote prefix + `[!`" ->
   * "type" -> "`]`" -> "fold behavior" -> "title".
   */
  private quoteHeaderEl!: HTMLElement;
  /** Phase 5D-1A: the read-only label child of quoteHeaderEl (see that field's own doc comment for why this exists as a separate child rather than text directly on quoteHeaderEl). Phase 5D-1B: no longer includes the fold marker or separator whitespace — those are represented by quoteMarkerSelectEl's own selected option, not rendered as raw text in this label. Phase 5D-1C: no longer includes `[!type]` either — only the quote prefix plus the literal `[!` opening bracket; the type itself is `quoteTypeInputEl`, and the closing `]` is `quoteTypeCloseLabelEl`. */
  private quoteHeaderLabelEl!: HTMLElement;
  /**
   * Phase 5D-1C: single-line, editable callout-type combobox — a plain
   * `<input type="text">` with a `list` attribute pointing at
   * `quoteTypeDatalistEl`'s id, per this ticket's own approved UI
   * decision (a closed-set `<select>`, like `quoteMarkerSelectEl`, was
   * explicitly rejected for TYPE specifically, because Obsidian callout
   * types are NOT a closed set — any string is syntactically valid, and
   * an unrecognized one merely falls back to `note`'s ICON/COLOR at
   * render time, never at the raw-text level; see
   * reconstructQuoteHeader's own doc comment). The `<datalist>` offers
   * the 13 standard type keywords purely as suggestions — it never
   * constrains what can actually be typed or pasted here, so any custom
   * type, alias, or unknown type already present in the user's vault
   * (e.g. the real `[!ai]` example that motivated this ticket) loads and
   * round-trips completely unmodified. Shown/hidden and enabled/disabled
   * in lockstep with `quoteTitleInputEl`/`quoteMarkerSelectEl` — all
   * three are gated on the exact same
   * `this.quoteProjection?.titleSlot != null` condition, since all three
   * are carved out of the same header line's same titleSlot.
   */
  private quoteTypeInputEl!: HTMLInputElement;
  /**
   * Phase 5D-1C: the `<datalist>` backing `quoteTypeInputEl`'s `list`
   * attribute — created once in onOpen with the 13 standard callout type
   * keywords (note/abstract/info/todo/tip/success/question/warning/
   * failure/danger/bug/example/quote) as its `<option>` children, per
   * this ticket's own approved candidate list. Deliberately does NOT
   * include type aliases (e.g. "caution", "tldr") — the ticket's own
   * explicit instruction defers alias coverage to a future, separate UX
   * ticket. Never itself shown/hidden — a `<datalist>` has no visual
   * presence of its own; only `quoteTypeInputEl`'s own visibility matters.
   */
  private quoteTypeDatalistEl!: HTMLDataListElement;
  /** Phase 5D-1C: the read-only label child rendering the literal closing `]` of `[!type]`, immediately after `quoteTypeInputEl` — shown/hidden in lockstep with it. Kept as its own element (rather than baked into `quoteHeaderLabelEl`, which sits BEFORE the now-editable type) so the header row's static bracket punctuation survives the type becoming an editable control in between. */
  private quoteTypeCloseLabelEl!: HTMLElement;
  /**
   * Phase 5D-1B: single-line fold-marker picker — a native tri-state
   * `<select>` (this view's first `<select>` element) offering exactly
   * the three values `CalloutFoldMarker` allows: `""` (not foldable),
   * `"+"` (foldable, expanded by default), `"-"` (foldable, collapsed by
   * default). A closed-set control by design — see reconstructQuoteHeader's
   * own doc comment for why this is what keeps "invalid-marker" a
   * defensive, effectively-unreachable path rather than something a user
   * can trigger from this UI (contrast `quoteTypeInputEl` above, whose
   * own "invalid-type" failure IS user-reachable). Shown/hidden and
   * enabled/disabled in lockstep with `quoteTitleInputEl`/
   * `quoteTypeInputEl` — all are gated on the exact same
   * `this.quoteProjection?.titleSlot != null` condition, since all are
   * carved out of the same header line's same titleSlot.
   */
  private quoteMarkerSelectEl!: HTMLSelectElement;
  /**
   * Phase 5D-1A: single-line, editable title input — the first
   * `<input type="text">` this view (or this plugin's view layer at all)
   * has ever needed; every other editable surface here is the one big
   * `<textarea>` below. Shown only when the loaded callout's title was
   * successfully split out (`this.quoteProjection?.titleSlot != null`) —
   * hidden and cleared for blockquote, non-projecting nodes, and a
   * header-only callout's raw fallback (title editing is explicitly out
   * of scope there — see renderQuoteHeader's doc comment).
   */
  private quoteTitleInputEl!: HTMLInputElement;
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

    // Phase 5A-1: the stale/unavailable indicator + Reload button row,
    // placed directly below the title/actions header and ABOVE the
    // breadcrumb — "near the Pane header/breadcrumb" per this ticket's own
    // placement requirement (R2). aria-live="polite" is this ticket's
    // minimal aria-live-equivalent announcement: when renderSyncStatus
    // below changes syncStatusLabelEl's text, a screen reader announces it
    // without the user needing to navigate to this row explicitly.
    this.syncStatusEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-sync-status",
    });
    this.syncStatusEl.setAttribute("aria-live", "polite");
    this.syncStatusLabelEl = this.syncStatusEl.createSpan({
      cls: "unified-outliner-partial-edit-sync-status-label",
    });
    this.syncStatusReloadEl = this.syncStatusEl.createEl("button", {
      cls: "unified-outliner-partial-edit-sync-status-reload",
      text: this.plugin.t("partialEdit.reload"),
    });
    this.syncStatusReloadEl.addEventListener("click", () => {
      void this.performReload();
    });
    this.syncStatusEl.toggleVisibility(false);

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
    // setIcon(el, ...) replaces ALL of el's existing children with just the
    // icon svg — harmless for siblingPrevEl above (its icon is set first,
    // while the button is still empty), but calling it directly on
    // siblingNextEl here — AFTER the target and label spans above already
    // exist — silently wiped both of them out, leaving "Next" with no
    // target-label preview ever rendered (reported: previous shows its
    // target label, next never does). Fixed by giving the icon its own
    // empty wrapper span that setIcon can safely clear/populate without
    // touching its siblings, instead of calling setIcon on siblingNextEl
    // itself.
    const siblingNextIconEl = this.siblingNextEl.createSpan({
      cls: "unified-outliner-partial-edit-sibling-nav-icon",
    });
    setIcon(siblingNextIconEl, "chevron-right");
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

    // Phase 5D-0.5: created once here (like every other row in this
    // method), visibility/content toggled per-load by renderQuoteHeader —
    // same "create once in onOpen, mutate on each render" policy as
    // breadcrumbEl/siblingNavEl/subtreeNavEl above.
    //
    // Phase 5D-1A: now a multi-child row — quoteHeaderLabelEl (read-only)
    // and quoteTitleInputEl (editable) — see both fields' own doc
    // comments for why `.setText()` must never be called on
    // quoteHeaderEl itself any more.
    // Phase 5D-1B: quoteMarkerSelectEl is created BETWEEN the two, so the
    // header row reads left-to-right as "quote prefix + [!type]" ->
    // "fold behavior" -> "title".
    // Phase 5D-1C: quoteTypeInputEl (+ its quoteTypeDatalistEl) and
    // quoteTypeCloseLabelEl are created between quoteHeaderLabelEl and
    // quoteMarkerSelectEl, so the row now reads "quote prefix + [!" ->
    // "type" -> "]" -> "fold behavior" -> "title".
    this.quoteHeaderEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-quote-header",
    });
    this.quoteHeaderLabelEl = this.quoteHeaderEl.createSpan({
      cls: "unified-outliner-partial-edit-quote-header-label",
    });
    // Phase 5D-1C: the editable type combobox and its backing datalist —
    // created BETWEEN quoteHeaderLabelEl (quote prefix + literal `[!`)
    // and quoteTypeCloseLabelEl (literal `]`), so the row's static
    // bracket punctuation still reads naturally around the now-editable
    // type. The datalist only ever offers suggestions — see
    // quoteTypeInputEl's own doc comment for why its `list` attribute
    // never constrains what can actually be typed/pasted here.
    this.quoteTypeDatalistEl = this.quoteHeaderEl.createEl("datalist", {
      attr: { id: PartialEditView.QUOTE_TYPE_DATALIST_ID },
    });
    for (const type of PartialEditView.QUOTE_TYPE_DATALIST_OPTIONS) {
      this.quoteTypeDatalistEl.createEl("option", { value: type });
    }
    this.quoteTypeInputEl = this.quoteHeaderEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-partial-edit-quote-type-input",
      attr: { list: PartialEditView.QUOTE_TYPE_DATALIST_ID },
    });
    setTooltip(this.quoteTypeInputEl, this.plugin.t("partialEdit.quoteTypeLabel"));
    // Same dirty-tracking policy as quoteTitleInputEl/quoteMarkerSelectEl's
    // own listeners — every keystroke in the type combobox must also
    // re-check isDirty(), since isDirty() now considers the type input
    // too. It must ALSO re-filter the datalist's own suggestion list —
    // see refreshQuoteTypeDatalistOptions's own doc comment for why the
    // browser's native filtering isn't good enough here.
    this.quoteTypeInputEl.addEventListener("input", () => {
      this.refreshQuoteTypeDatalistOptions();
      this.updateDirtyState();
    });
    this.quoteTypeCloseLabelEl = this.quoteHeaderEl.createSpan({
      cls: "unified-outliner-partial-edit-quote-header-label",
    });
    this.quoteMarkerSelectEl = this.quoteHeaderEl.createEl("select", {
      cls: "unified-outliner-partial-edit-quote-marker-select",
    });
    this.quoteMarkerSelectEl.createEl("option", {
      value: "",
      text: this.plugin.t("partialEdit.quoteFoldMarkerNone"),
    });
    this.quoteMarkerSelectEl.createEl("option", {
      value: "+",
      text: this.plugin.t("partialEdit.quoteFoldMarkerExpand"),
    });
    this.quoteMarkerSelectEl.createEl("option", {
      value: "-",
      text: this.plugin.t("partialEdit.quoteFoldMarkerCollapse"),
    });
    setTooltip(this.quoteMarkerSelectEl, this.plugin.t("partialEdit.quoteFoldMarkerLabel"));
    // Same dirty-tracking policy as quoteTitleInputEl/textareaEl's own
    // listeners — every change to the select must also re-check
    // isDirty(), since isDirty() now considers the marker select too.
    this.quoteMarkerSelectEl.addEventListener("change", () => this.updateDirtyState());
    this.quoteTitleInputEl = this.quoteHeaderEl.createEl("input", {
      type: "text",
      cls: "unified-outliner-partial-edit-quote-title-input",
    });
    this.quoteTitleInputEl.setAttribute("placeholder", this.plugin.t("partialEdit.quoteTitleLabel"));
    setTooltip(this.quoteTitleInputEl, this.plugin.t("partialEdit.quoteTitleLabel"));
    // Same dirty-tracking policy as textareaEl's own input listener right
    // below — every keystroke in the title input must also re-check
    // isDirty(), since isDirty() now considers the title input too.
    this.quoteTitleInputEl.addEventListener("input", () => this.updateDirtyState());

    this.textareaEl = this.contentEl.createEl("textarea", {
      cls: "unified-outliner-partial-edit-textarea",
    });
    // See updateDirtyState's doc comment: Apply/Cancel are only shown once
    // there is something to Apply/Cancel, so every keystroke needs to
    // re-check whether the textarea still matches its loaded snapshot
    // (originalText, or — Phase 5D-0.5 — the projected displayText for a
    // projecting callout/blockquote; see isDirty/currentDisplayText).
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

    // Phase 5A-1: the sole authoritative sources for "did this pane's
    // loaded content go stale" — every one of them ultimately funnels into
    // the SAME debounced performStaleCheck() (see scheduleStaleCheck's own
    // doc comment), never `this.plugin.activeMarkdownView`
    // (ActiveMarkdownViewTracker), which is a PLUGIN-SHARED, single
    // "most-recently-focused" cache — not per-file — and was the v1
    // design's own root-cause bug (see the design doc's revision history).
    //
    // editor-change: fires for BOTH a user keystroke AND a programmatic
    // edit (Apply's own editor.replaceRange call — obsidian.d.ts's own doc
    // comment: "either programmatically or from a user event"), so this
    // pane's OWN Apply also fires this. That is not a false-positive risk
    // here: applyEdit() already reassigns `this.originalText` (or the
    // relevant anchor's originalText) SYNCHRONOUSLY, in the same call
    // stack as the replaceRange call that triggers this event — by the
    // time this debounced check actually runs (at least one full event
    // loop turn later), `this.originalText` and the live editor content
    // already agree, so performStaleCheck resolves to "synced", never a
    // spurious "stale". `info.file?.path === this.sourcePath` is the
    // match — never `activeMarkdownViewTracker` — so a background/
    // inactive/popped-out Pane still detects a change to its own
    // sourcePath.
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor: Editor, info: MarkdownView | MarkdownFileInfo) =>
        this.handleEditorChange(editor, info)
      )
    );
    // vault "modify"/"rename"/"delete": path-based, so these catch a
    // change to `sourcePath` even while it has no open editor at all
    // (background file, or a file never opened in this window) — the
    // case editor-change alone can never cover.
    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => this.handleVaultModify(file))
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
        this.handleVaultRename(file, oldPath)
      )
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => this.handleVaultDelete(file))
    );
    // active-leaf-change / file-open: deliberately ONLY a re-check
    // trigger, never the primary sourcePath-matching path — neither
    // handler inspects which file/leaf triggered it; both simply ask
    // performStaleCheck to re-verify THIS pane's own sourcePath, which
    // performStaleCheck itself no-ops on when nothing is loaded. Switching
    // to an unrelated file therefore never staleifies/unavailable-izes
    // this pane by itself.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleStaleCheck()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleStaleCheck()));

    this.renderEmptyState();
    this.updateCloseButtonVisibility();
  }

  async onClose(): Promise<void> {
    // Intentionally no auto-save here: per the Phase 3B design, Close
    // (like Cancel) never applies pending edits — only the Apply button
    // does. Nothing to clean up beyond the DOM itself.
    //
    // Phase 5A-1: `closed` is checked at the top of every method that
    // might still run after this point (a pending vault.cachedRead
    // promise, or a debounced scheduleStaleCheck callback already queued
    // before this pane closed) — see that field's own doc comment for why
    // registerEvent's automatic unregistration alone isn't enough to make
    // those paths inert.
    this.closed = true;
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
   * Phase 5P-2: the paragraph counterpart to requestLoadNode above — the
   * sole external entry point for loading a paragraph into this pane
   * (main.ts's activatePartialEditViewForParagraph, itself called from the
   * "Edit paragraph at cursor" command). Same unsaved-edit guard
   * (Apply/Discard/Cancel), reusing the exact same DiscardChangesModal —
   * deliberately not a second modal/flow.
   */
  requestLoadParagraphAtCursor(cursorLine: number): void {
    if (!this.isDirty()) {
      this.loadParagraphInternal(cursorLine);
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadParagraphInternal(cursorLine);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadParagraphInternal(cursorLine);
      }
    }).open();
  }

  /**
   * Phase 5D-2A: the CompositeBlock counterpart to requestLoadNode/
   * requestLoadParagraphAtCursor above — the sole external entry point for
   * loading an ENTIRE CompositeBlock (main.ts's
   * activatePartialEditViewForComposite, itself called from the CompositeBlock
   * parent's "Open extended block in partial edit" context-menu item).
   * Same unsaved-edit guard (Apply/Discard/Cancel), reusing the exact same
   * DiscardChangesModal — deliberately not a third modal/flow.
   */
  requestLoadComposite(snapshot: CompositeBlockSnapshot): void {
    if (!this.isDirty()) {
      this.loadCompositeInternal(snapshot);
      return;
    }
    new DiscardChangesModal(this.app, this.plugin, (choice) => {
      if (choice === "cancel") return;
      if (choice === "discard") {
        this.loadCompositeInternal(snapshot);
        return;
      }
      // choice === "apply"
      if (this.applyEdit()) {
        this.loadCompositeInternal(snapshot);
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

    // Phase 5D-0.5: the quote-prefix-projection gate — deliberately BEFORE
    // any field on this pane is mutated below, so a "nested" refusal
    // leaves the pane exactly as it was (whatever was loaded before this
    // call, or the empty state) and never touches the note. Only
    // callout/blockquote ever attempt a projection; every other kind
    // (section/list) leaves `quoteProjection` at null, same as a
    // callout/blockquote whose reason is "no-body" (see
    // buildQuotePrefixProjection's own doc comment) — both fall through to
    // this pane's existing, unmodified raw-text load path below.
    let quoteProjection: QuotePrefixProjection | null = null;
    if (extracted.kind === "callout" || extracted.kind === "blockquote") {
      const built = buildQuotePrefixProjection(extracted.text, extracted.kind);
      if (!built.ok && built.reason === "nested") {
        new Notice(this.plugin.t("partialEdit.quoteNestedUnsupported"));
        return;
      }
      if (built.ok) {
        quoteProjection = built.projection;
      }
      // built.reason === "no-body": quoteProjection stays null, and
      // loadNodeInternal proceeds exactly as it always has — this specific
      // callout is shown raw, `>` prefix and all, via the untouched path
      // below (see renderLoadedState/currentDisplayText).
    }

    const t = this.plugin.t.bind(this.plugin);
    const node = doc.nodes.get(nodeId);
    let label: string;
    if (node) {
      label = nodeDisplayLabel(doc, node, t);
    } else {
      // Phase 5C-2: extracted.ok is true and node is undefined only for
      // the new standalone callout/blockquote path (see
      // extractSubtreeText's own doc comment). A fresh scanComplexBlocks()
      // re-lookup (rather than trusting extracted fields as an id-free
      // proxy) keeps this resolution independently re-verified, same
      // policy as every other CompositeBlock-adjacent module.
      const complexBlock = scanComplexBlocks(doc).blocks.find((b) => b.id === nodeId);
      label = complexBlock ? standaloneComplexBlockLabel(doc, complexBlock, t) : "";
    }

    this.nodeId = nodeId;
    this.nodeKind = extracted.kind;
    // Phase 5P-2/5D-2A: clear any previously-loaded paragraph/composite
    // identity — exactly one of nodeId/paragraphAnchor/compositeAnchor is
    // ever active at a time (see this class's own doc comment).
    this.paragraphAnchor = null;
    this.compositeAnchor = null;
    this.originalText = extracted.text;
    this.quoteProjection = quoteProjection;
    this.label = label;
    // Phase 5C-4: recorded fresh on every load, from the SAME `view` this
    // method already resolved `doc` from above — see the class field's own
    // doc comment and view/partialEditSourceNoteCheck.ts for why this
    // exists and how applyEdit uses it.
    this.sourcePath = view.file?.path ?? null;
    // Phase 5A-1: a fresh load is by definition in sync with what it was
    // just read from — see the `syncState` field's own doc comment for
    // when this gets set to anything else.
    this.syncState = "synced";
    // Phase 5C-2: breadcrumb / sibling nav / Subtree Navigator stay at
    // their empty state for a callout/blockquote — this ticket's own
    // approved scope explicitly leaves those three unextended
    // ("complex 対応は今回実装しない"). findAncestorPath/findDirectChildren/
    // getSiblingNavigationState are all doc.nodes-based (BlockNode-only)
    // and are simply not called for a node that isn't one.
    if (node) {
      this.ancestors = findAncestorPath(doc, nodeId, t);
      this.directChildren = findDirectChildren(doc, nodeId, t);
      this.siblingState = getSiblingNavigationState(doc, nodeId, t);
    } else {
      this.ancestors = [];
      this.directChildren = [];
      this.siblingState = { previous: null, next: null };
    }
    this.renderLoadedState();
  }

  /**
   * Phase 5P-2: paragraph counterpart to loadNodeInternal above — loads the
   * SINGLE paragraph at `cursorLine` in the currently active note into this
   * pane. Deliberately NOT a branch inside loadNodeInternal itself: a
   * paragraph has no BlockNode/ComplexBlockInfo id known in advance (the
   * caller only has a cursor line, resolved here via
   * resolver/resolveParagraphAtCursor.ts), and its Apply-time
   * re-resolution needs parentId/depth captured alongside the usual id +
   * "before editing" snapshot — see edit/paragraphPartialEdit.ts's own doc
   * comment for why that extra bookkeeping can't reuse
   * extractSubtreeText/applySubtreeEdit's existing id-only contract as-is.
   */
  private loadParagraphInternal(cursorLine: number): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const resolved = resolveParagraphAtCursor(doc, cursorLine);
    if (!resolved.paragraph) {
      const reasonKey = ("reason." + (resolved.reason ?? "no-paragraph")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
      return;
    }
    const paragraph = resolved.paragraph;

    this.nodeId = null;
    this.paragraphAnchor = buildParagraphEditAnchor(doc, paragraph);
    // Phase 5D-2A: clear any previously-loaded composite identity — see
    // this class's own doc comment on the three-way exclusivity.
    this.compositeAnchor = null;
    this.nodeKind = "paragraph";
    this.originalText = paragraph.text;
    // Phase 5D-0.5: a paragraph never projects — see this class field's own
    // doc comment (quoteProjection is exclusively a callout/blockquote
    // concept). Reset alongside originalText/nodeKind above so a pane that
    // was just showing a projected quote body doesn't leave a stale
    // projection behind for currentDisplayText/isDirty to trip over.
    this.quoteProjection = null;
    this.label = paragraph.preview;
    // Phase 5C-4 convention, reused as-is: recorded fresh on every load,
    // from the SAME `view` this method already resolved `doc` from above.
    this.sourcePath = view.file?.path ?? null;
    // Phase 5A-1: see loadNodeInternal's identical reset — a fresh load is
    // always in sync with what it was just read from.
    this.syncState = "synced";
    // Phase 5P-2 explicit scope: no breadcrumb / sibling nav / Subtree
    // Navigator for a paragraph — see this class's own doc comment.
    // renderSiblingNav's own visibility check hinges on `this.nodeId`
    // (null here), so it stays hidden with no further change needed;
    // renderBreadcrumb/renderSubtreeNavigator hide themselves whenever
    // their backing arrays are empty, which they are here too.
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
    this.renderLoadedState();
  }

  /**
   * Phase 5D-2A: CompositeBlock counterpart to loadNodeInternal/
   * loadParagraphInternal above — loads the ENTIRE CompositeBlock (list
   * item + callout/blockquote) described by `snapshot` as ONE raw-Markdown
   * range. Never trusts `snapshot`'s own id/member ids as current truth —
   * extractCompositeBlockText re-parses/re-scans/re-matches fresh and
   * re-identifies the target purely by content (see that module's own top
   * doc comment). Deliberately NOT a branch inside loadNodeInternal: a
   * CompositeBlock has no BlockNode/ComplexBlockInfo id of its own (it is
   * a read-only VIEW over two other models — model/compositeBlock.ts's own
   * top doc comment), so its Apply-time re-resolution needs the whole
   * CompositeBlockSnapshot, not a single id — same reasoning
   * loadParagraphInternal's own doc comment gives for why IT can't reuse
   * extractSubtreeText/applySubtreeEdit's id-only contract either.
   *
   * Per this ticket's approved scope: no quote-prefix-projection, no
   * callout header title input/fold-marker select/type combobox, no
   * breadcrumb/sibling-nav/Subtree Navigator — the pane shows the whole
   * range as plain raw Markdown, at the same safety level as the existing
   * section/list raw Partial Edit, and nothing more.
   */
  private loadCompositeInternal(snapshot: CompositeBlockSnapshot): void {
    const view = this.activeMarkdownView.get();
    if (!view) {
      new Notice(this.plugin.t("partialEdit.noActiveNote"));
      return;
    }

    const doc = parseDocument(view.editor.getValue());
    const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
    const extracted = extractCompositeBlockText(doc, snapshot, rules);
    if (!extracted.ok || !extracted.resolvedSnapshot) {
      // Phase 5D-2A: see the Apply-time branch's identical use of
      // compositePartialEditReasonText below for why this is not a plain
      // "reason." + extracted.reason concatenation.
      new Notice(compositePartialEditReasonText(this.plugin.t.bind(this.plugin), extracted.reason));
      return;
    }

    const t = this.plugin.t.bind(this.plugin);
    const rule = getCompositeBlockRuleById(rules, extracted.resolvedSnapshot.ruleId);
    const label = rule ? compositeBlockDisplayLabel(rule, t) : extracted.resolvedSnapshot.ruleId;

    this.nodeId = null;
    this.paragraphAnchor = null;
    this.compositeAnchor = extracted.resolvedSnapshot;
    this.nodeKind = "composite";
    this.originalText = extracted.text;
    // Phase 5D-2A explicit scope: no projection for the whole-CompositeBlock
    // pane — see this method's own doc comment and currentDisplayText's
    // doc comment (quoteProjection === null shows originalText verbatim).
    this.quoteProjection = null;
    this.label = label;
    this.sourcePath = view.file?.path ?? null;
    // Phase 5A-1: see loadNodeInternal's identical reset — a fresh load is
    // always in sync with what it was just read from.
    this.syncState = "synced";
    // Phase 5D-2A explicit scope: no breadcrumb / sibling nav / Subtree
    // Navigator for a CompositeBlock — mirrors loadParagraphInternal's own
    // identical choice above.
    this.ancestors = [];
    this.directChildren = [];
    this.siblingState = { previous: null, next: null };
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
    // Phase 5C-4: reset alongside the other per-load fields above — see
    // the class field's own doc comment.
    this.sourcePath = null;
    // Phase 5A-1: an empty pane has nothing to be stale/unavailable about
    // — see the `syncState` field's own doc comment.
    this.syncState = "synced";
    // Phase 5P-2: reset alongside nodeId/nodeKind — this method already
    // implicitly leaves nodeId/nodeKind at their initial null values (never
    // set here), so paragraphAnchor is cleared explicitly to match.
    this.paragraphAnchor = null;
    // Phase 5D-2A: reset alongside paragraphAnchor above — see the class
    // field's own doc comment on the three-way exclusivity.
    this.compositeAnchor = null;
    // Phase 5D-0.5: reset alongside paragraphAnchor above — see the class
    // field's own doc comment.
    this.quoteProjection = null;
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.renderQuoteHeader();
    this.updateDirtyState();
  }

  /**
   * Phase 4C: the title now prefixes the node's kind (Section / List) so
   * the pane stays honest about what range Apply will replace, without
   * otherwise treating the two kinds differently — see class doc comment.
   */
  private renderLoadedState(): void {
    // Phase 5C-2: extended from a binary list/section ternary to cover the
    // two new standalone-complex-block kinds. kind display is otherwise
    // unified with section/list (same title template, same textarea/Apply/
    // Cancel wiring below) — see class doc comment.
    const kindLabel = ((): string => {
      switch (this.nodeKind) {
        case "list":
          return this.plugin.t("partialEdit.kindList");
        case "callout":
          return this.plugin.t("partialEdit.kindCallout");
        case "blockquote":
          return this.plugin.t("partialEdit.kindBlockquote");
        case "paragraph":
          return this.plugin.t("partialEdit.kindParagraph");
        case "composite":
          return this.plugin.t("partialEdit.kindComposite");
        case "section":
        default:
          return this.plugin.t("partialEdit.kindSection");
      }
    })();
    this.titleEl.setText(this.plugin.t("partialEdit.editingTitle", { kind: kindLabel, label: this.label }));
    this.textareaEl.disabled = false;
    this.applyButtonEl.disabled = false;
    this.cancelButtonEl.disabled = false;
    // Phase 5D-0.5: currentDisplayText() returns the prefix-stripped
    // projectedDisplayText for a projecting callout/blockquote, and
    // `this.originalText` verbatim for every other case (including a
    // callout/blockquote that fell back to raw editing) — see that
    // method's own doc comment.
    this.textareaEl.value = this.currentDisplayText();
    this.renderBreadcrumb();
    this.renderSiblingNav();
    this.renderSubtreeNavigator();
    this.renderQuoteHeader();
    this.updateDirtyState();
  }

  /**
   * Phase 5D-0.5: the pane's "what should the textarea currently show"
   * value. Deliberately the ONLY place these two are reconciled — every
   * other reader (applySubtreeEdit's conflict re-extraction inside
   * applyEdit, the paragraph branch's own originalText bookkeeping) keeps
   * reading `this.originalText` directly and must keep doing so, since
   * that field is the raw snapshot applySubtreeEdit's contract requires.
   * `quoteProjection` is non-null only for a callout/blockquote whose body
   * was successfully projected (see loadNodeInternal/buildQuotePrefixProjection);
   * every other case — section, list, paragraph, and a callout/blockquote
   * that fell back to raw editing (the "no-body" case) — has
   * `quoteProjection === null` and simply shows `originalText` verbatim,
   * exactly as this pane always has.
   */
  private currentDisplayText(): string {
    return this.quoteProjection ? projectedDisplayText(this.quoteProjection) : this.originalText;
  }

  /**
   * Phase 5D-1C fix: Chromium's own native `<datalist>` filtering matches
   * a candidate whenever the typed text appears ANYWHERE in it (e.g.
   * typing "n" also surfaces "warning"/"question"/"danger"), not just at
   * the start — so left on its own it does not give the prefix-only
   * suggestion behavior ("n" -> "note" alone) this ticket's UI is meant
   * to offer. This never touches what can actually be typed/pasted/
   * Applied (the datalist only ever offers candidates — see
   * quoteTypeInputEl's own doc comment); it only narrows which
   * `<option>` children quoteTypeDatalistEl currently exposes, so the
   * suggestion dropdown itself does prefix-only matching. Called on every
   * keystroke in quoteTypeInputEl, and again whenever its value is set
   * programmatically (render/cancel), so the suggestion list never goes
   * stale after a node switch or a revert.
   */
  private refreshQuoteTypeDatalistOptions(): void {
    const query = this.quoteTypeInputEl.value.toLowerCase();
    this.quoteTypeDatalistEl.empty();
    for (const type of PartialEditView.QUOTE_TYPE_DATALIST_OPTIONS) {
      if (type.startsWith(query)) {
        this.quoteTypeDatalistEl.createEl("option", { value: type });
      }
    }
  }

  /**
   * Phase 5D-0.5: draw (or hide) the callout-header row above the
   * textarea. Only ever visible for a projecting CALLOUT — a projecting
   * blockquote has no header concept at all (`quoteProjection.header` is
   * always null for kind "blockquote"; see QuotePrefixProjection's own
   * doc comment), and a non-projecting node of any kind has nothing to
   * separate out. Re-run only from loadNodeInternal's render call,
   * renderEmptyState, and applyEdit's post-apply rebuild — i.e. exactly
   * when the loaded node itself (or its just-applied raw text) changes —
   * never on every keystroke, matching renderBreadcrumb's own "static
   * until the next load" policy immediately below.
   *
   * Phase 5D-1A: the row is no longer uniformly read-only. When
   * `quoteProjection.titleSlot` is set (a callout whose title was
   * successfully split out — see buildQuoteHeaderTitleSlot), this shows
   * the READ-ONLY portion in `quoteHeaderLabelEl`, and reveals
   * `quoteTitleInputEl` pre-filled with the loaded `title` — type/prefix
   * stay exactly as read-only as they were before this ticket, only the
   * title itself becomes editable. Every other case (blockquote, non-
   * projecting, or a callout whose title slot failed to build — see
   * QuotePrefixProjection's own doc comment on `titleSlot`) hides
   * `quoteTitleInputEl` and falls back to the pre-5D-1A behavior: the
   * full raw header line shown read-only in `quoteHeaderLabelEl`, or
   * nothing at all.
   *
   * Phase 5D-1B: `quoteHeaderLabelEl` now shows ONLY `titleSlot.beforeMarker`
   * (quote prefix + `[!type]`) — the fold marker itself is no longer
   * rendered as raw `+`/`-` text here at all, since `quoteMarkerSelectEl`
   * (revealed/pre-filled in lockstep with `quoteTitleInputEl`, same
   * `titleSlot` gate) now represents it as a real, editable control
   * instead. `titleSlot.separator` is likewise never rendered literally —
   * it is a reconstruction-time concern only (see reconstructQuoteHeader),
   * with the header row's own visual spacing coming from CSS layout
   * (flex gap) between the three DOM children instead.
   *
   * Phase 5D-1C: `quoteHeaderLabelEl` now shows ONLY `titleSlot.quotePrefix
   * + "[!"` — the type itself moved to `quoteTypeInputEl` (revealed/
   * pre-filled in lockstep, same `titleSlot` gate) verbatim, with no
   * case-folding/trimming/fallback-to-"note" of any kind. The literal
   * closing `]` is rendered by `quoteTypeCloseLabelEl`, shown/hidden in
   * the exact same lockstep.
   */
  private renderQuoteHeader(): void {
    const titleSlot = this.quoteProjection?.titleSlot ?? null;
    if (titleSlot) {
      this.quoteHeaderEl.toggleVisibility(true);
      this.quoteHeaderLabelEl.setText(titleSlot.quotePrefix + "[!");
      this.quoteTypeInputEl.toggleVisibility(true);
      this.quoteTypeInputEl.disabled = false;
      this.quoteTypeInputEl.value = titleSlot.type;
      this.refreshQuoteTypeDatalistOptions();
      this.quoteTypeCloseLabelEl.toggleVisibility(true);
      this.quoteTypeCloseLabelEl.setText("]");
      this.quoteMarkerSelectEl.toggleVisibility(true);
      this.quoteMarkerSelectEl.disabled = false;
      this.quoteMarkerSelectEl.value = titleSlot.marker;
      this.quoteTitleInputEl.toggleVisibility(true);
      this.quoteTitleInputEl.disabled = false;
      this.quoteTitleInputEl.value = titleSlot.title;
      return;
    }
    this.quoteTypeInputEl.toggleVisibility(false);
    this.quoteTypeInputEl.value = "";
    this.refreshQuoteTypeDatalistOptions();
    this.quoteTypeCloseLabelEl.toggleVisibility(false);
    this.quoteTypeCloseLabelEl.setText("");
    this.quoteMarkerSelectEl.toggleVisibility(false);
    this.quoteMarkerSelectEl.value = "";
    this.quoteTitleInputEl.toggleVisibility(false);
    this.quoteTitleInputEl.value = "";

    const header = this.quoteProjection?.header ?? null;
    if (header === null) {
      this.quoteHeaderEl.toggleVisibility(false);
      this.quoteHeaderLabelEl.setText("");
      return;
    }
    this.quoteHeaderEl.toggleVisibility(true);
    this.quoteHeaderLabelEl.setText(header);
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

  /** Revert unsaved edits in the textarea (and, Phase 5D-1A, the title input) — does not close the pane or change which node is loaded. */
  private cancelEdit(): void {
    if (!this.nodeId && !this.paragraphAnchor) return;
    // Phase 5D-0.5: reverts to the projected displayText (not the raw
    // originalText) for a projecting callout/blockquote — see
    // currentDisplayText's own doc comment. Every other kind is
    // unaffected, since currentDisplayText falls through to originalText
    // verbatim whenever quoteProjection is null.
    this.textareaEl.value = this.currentDisplayText();
    // Phase 5D-1A: revert the title input to its loaded value too, when a
    // title slot is active — a no-op (value already unchanged) otherwise,
    // since quoteTitleInputEl is empty/hidden whenever titleSlot is null.
    // Phase 5D-1B: revert the fold-marker select the same way, in the
    // same branch — both are carved out of the same titleSlot.
    // Phase 5D-1C: revert the type combobox the same way too — verbatim
    // back to the loaded titleSlot.type, no case/trim normalization.
    const titleSlot = this.quoteProjection?.titleSlot ?? null;
    if (titleSlot) {
      this.quoteTypeInputEl.value = titleSlot.type;
      this.refreshQuoteTypeDatalistOptions();
      this.quoteMarkerSelectEl.value = titleSlot.marker;
      this.quoteTitleInputEl.value = titleSlot.title;
    }
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
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) {
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

    // Phase 5C-4: an ADDITIONAL, path-based safety valve, checked BEFORE
    // the existing content-based conflict check below — never a
    // replacement for it (that check, in applySubtreeEdit, is completely
    // unchanged by this ticket). `view` here may already be a DIFFERENT
    // note than the one `this.sourcePath` was recorded from, if the active
    // note changed elsewhere (in another window, when this pane is popped
    // out) since this pane last loaded — see
    // view/partialEditSourceNoteCheck.ts's own doc comment for the full
    // rationale. Both "note changed" and "path unavailable" fail safe:
    // Apply is refused and the editor is left byte-for-byte untouched,
    // exactly like every other refusal reason in this method.
    const sourceNoteCheck = checkPartialEditSourceNote(this.sourcePath, view.file?.path ?? null);
    if (sourceNoteCheck !== "ok") {
      const reasonKey: TranslationKey =
        sourceNoteCheck === "changed"
          ? "reason.partialEditSourceNoteChanged"
          : "reason.partialEditSourceNoteUnknown";
      new Notice(this.plugin.t(reasonKey));
      return false;
    }

    const doc = parseDocument(editor.getValue());

    // Phase 5P-2: a loaded paragraph is a fully separate re-resolution path
    // — see edit/paragraphPartialEdit.ts's own doc comment for why it
    // cannot reuse applySubtreeEdit's id-only contract (a paragraph also
    // needs parentId/depth re-verified, not just its scan-local id and
    // content). This branch never touches this.nodeId/applySubtreeEdit
    // below, and the reverse is equally true — exactly one of
    // nodeId/paragraphAnchor is ever set (see this class's own doc
    // comment), so the two paths cannot interfere with each other.
    if (this.paragraphAnchor) {
      const outcome = applyParagraphEdit(doc, this.paragraphAnchor, this.textareaEl.value);
      if (!outcome.changed) {
        const reasonKey = ("reason." + (outcome.reason ?? "anchor-unresolved")) as TranslationKey;
        new Notice(this.plugin.t(reasonKey));
        return false;
      }

      // Phase 5A-1 hardening §1: suppress this pane's OWN stale-check
      // reaction to the editor-change this call is about to fire, for the
      // exact span from immediately before the note mutation through
      // re-anchoring completion — see isApplyingOwnEdit's own doc comment
      // for the full rationale. try/finally guarantees the flag is always
      // released, even if applyLineEditOutcome/re-anchoring/updateDirtyState
      // were ever to throw.
      this.isApplyingOwnEdit = true;
      try {
        applyLineEditOutcome(
          editor,
          { line: outcome.newStartLine, ch: 0 },
          outcome.newStartLine,
          doc.lines,
          outcome,
          () => {}
        );

        this.originalText = this.textareaEl.value;
        // Phase 5P-4 supplement: re-anchor from a FRESH re-resolution at the
        // outcome's own new position, rather than blindly spreading the old
        // anchor. applyParagraphEdit may have resolved via its Pass 2
        // structural re-search (a same-parent paragraph<->paragraph swap
        // happened elsewhere while this pane was open) — in that case the
        // OLD anchor's complexBlockId no longer points at this paragraph at
        // all, and spreading it forward would silently reintroduce the exact
        // staleness this fix exists to close. Re-resolving via
        // resolveParagraphAtCursor at outcome.newStartLine, against the
        // just-applied document, always yields the correct current id/
        // siblingCount — a SECOND Apply within the same pane session then
        // starts from a fully current anchor, not a stale one.
        const freshDoc = parseDocument(editor.getValue());
        const freshResolved = resolveParagraphAtCursor(freshDoc, outcome.newStartLine);
        this.paragraphAnchor = freshResolved.paragraph
          ? buildParagraphEditAnchor(freshDoc, freshResolved.paragraph)
          : { ...this.paragraphAnchor, originalText: this.textareaEl.value };
        // Phase 5A-1 hardening §1: this pane just re-anchored from its own
        // just-applied content, so it is synced by definition — set
        // explicitly rather than left to whatever it happened to be before
        // Apply (requestLoadNode's "Apply and switch" flow can reach this
        // branch even while stale — see class doc comment on
        // requestLoadNode's "apply" choice).
        this.syncState = "synced";
        this.updateDirtyState();
      } finally {
        this.isApplyingOwnEdit = false;
      }
      // Exactly one debounced re-check after releasing suppression — see
      // isApplyingOwnEdit's own doc comment for why this is what
      // guarantees a fresh check still happens even if an event arriving
      // during suppression was discarded rather than queued. Idempotent
      // and cheap when nothing actually changed concurrently (the common
      // case): performStaleCheck simply confirms "synced" again.
      this.scheduleStaleCheck();

      const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
        true
      );

      // Phase 5T-5A: selection-follow — see UnifiedOutlinerPlugin
      // #queueOutlineTreeSelectionFollow's own doc comment. A no-op when
      // no Outline Tree View leaf currently has this paragraph selected;
      // resolveSelectionAfterRefresh re-resolves from CURRENT body content
      // on the next refresh, exactly like every other Tree-dispatched
      // move/edit.
      this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

      new Notice(this.plugin.t("partialEdit.paragraphUpdated"));
      return true;
    }

    // Phase 5D-2A: a loaded CompositeBlock is a third, fully separate
    // re-resolution path — see edit/compositeBlockPartialEdit.ts's own top
    // doc comment for why it cannot reuse the node branch's nodeId-only
    // contract below (a CompositeBlockSnapshot re-identifies by ruleId/
    // sectionId/range/member kind-id-range, never by any scan-local id
    // alone). This branch never touches this.nodeId/this.paragraphAnchor,
    // or the node/paragraph branches' own apply calls, and the reverse is
    // equally true — exactly one of nodeId/paragraphAnchor/compositeAnchor
    // is ever set (see this class's own doc comment), so the three paths
    // cannot interfere with each other. Explicit scope reminder (Phase
    // 5D-2A ticket): this pane
    // is raw-Markdown-only for a CompositeBlock — this.quoteProjection is
    // always null here (loadCompositeInternal never sets it), so
    // this.textareaEl.value is already the raw text to splice, exactly
    // like the non-projecting node branch below.
    if (this.compositeAnchor) {
      const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
      const outcome = applyCompositeBlockEdit(
        doc,
        this.compositeAnchor,
        this.originalText,
        this.textareaEl.value,
        rules
      );
      if (!outcome.changed) {
        // Phase 5D-2A: mapped via compositePartialEditReasonText, not a
        // plain "reason." + outcome.reason concatenation — see that
        // function's own doc comment (edit/compositeBlockPartialEdit.ts)
        // for why "range-invalid"/"snapshot-mismatch"/"conflict" each need
        // this module's own dedicated, non-reused i18n key.
        new Notice(compositePartialEditReasonText(this.plugin.t.bind(this.plugin), outcome.reason));
        return false;
      }

      // Phase 5A-1 hardening §1: same self-Apply suppression span as the
      // paragraph branch above — see isApplyingOwnEdit's own doc comment.
      this.isApplyingOwnEdit = true;
      try {
        applyLineEditOutcome(
          editor,
          { line: outcome.newStartLine, ch: 0 },
          outcome.newStartLine,
          doc.lines,
          outcome,
          () => {}
        );

        // Phase 5D-2A: re-anchor from outcome.resolvedSnapshot — present
        // only when the just-applied text still forms a CompositeBlock
        // matching the ORIGINAL ruleId at the same position (see that
        // field's own doc comment on ApplyCompositeBlockEditOutcome). When
        // it does not (方針A: a structure-breaking edit was permitted
        // through), compositeAnchor becomes null and any FURTHER Apply from
        // this same pane session correctly falls through to the top guard's
        // "no node loaded" refusal, rather than silently operating against a
        // CompositeBlock that no longer exists.
        this.originalText = this.textareaEl.value;
        this.compositeAnchor = outcome.resolvedSnapshot ?? null;
        // Phase 5A-1 hardening §1: see the paragraph branch's identical
        // comment above — explicitly synced right after this pane's own
        // re-anchoring, regardless of what syncState held before Apply.
        this.syncState = "synced";
        this.updateDirtyState();
      } finally {
        this.isApplyingOwnEdit = false;
      }
      // See the paragraph branch's identical comment above.
      this.scheduleStaleCheck();

      const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
        true
      );

      // Phase 5T-5A: same selection-follow as the paragraph/node branches.
      this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

      // Phase 5D-2A: the exact, user-required Notice text fires only when
      // ruleStillMatches is explicitly false — never on double-Apply,
      // Markdown auto-correction, or any automatic blank-line/member
      // repositioning (applyCompositeBlockEdit never performs any of
      // those; ruleStillMatches is a pure, non-gating re-derivation of
      // what the user's OWN edit produced — see that field's own doc
      // comment).
      new Notice(
        outcome.ruleStillMatches === false
          ? this.plugin.t("partialEdit.compositeRuleNoLongerMatches")
          : this.plugin.t("partialEdit.compositeUpdated")
      );
      return true;
    }

    // Phase 5D-0.5: for a projecting callout/blockquote, the textarea
    // holds prefix-stripped display text — invert it back to raw Markdown
    // BEFORE handing anything to the raw-text splice call below (unmodified
    // by this ticket — it only ever knows about raw text). A
    // line-count-changed edit (add/remove/newline-split a line) is refused
    // right here, with its own dedicated Notice, and never reaches that
    // splice call at all — no partial/best-effort splice is attempted.
    // Every other kind (quoteProjection === null) is untouched: newRawText
    // is simply whatever the textarea already held, exactly as before
    // this ticket.
    let newRawText = this.textareaEl.value;
    if (this.quoteProjection) {
      const inverted = invertQuotePrefixProjection(this.quoteProjection, this.textareaEl.value);
      if (!inverted.ok) {
        new Notice(this.plugin.t("partialEdit.quoteLineCountChanged"));
        return false;
      }
      newRawText = inverted.rawText;

      // Phase 5D-1A: when this callout's title was successfully split out
      // (titleSlot non-null), reconstruct its header from the title
      // input's CURRENT value (and, Phase 5D-1B, the fold-marker select's
      // CURRENT value) and splice it in as the new first line —
      // `inverted.rawText` above already reattached the OLD, unedited
      // header verbatim (invertQuotePrefixProjection itself is untouched
      // by this ticket), so this replaces exactly that one line, ONE
      // combined type+marker+title reconstruction, ONE splice — never
      // multiple separate rewrites. A validation failure on any of the
      // three refuses the WHOLE Apply here, before the raw-text splice
      // call below is ever reached — any body edit already computed
      // above is discarded along with it, matching the
      // quoteLineCountChanged refusal's own "reject the whole thing,
      // zero-byte-change" contract.
      // Blockquote/non-title-editable callouts (titleSlot null) leave
      // newRawText exactly as invertQuotePrefixProjection produced it,
      // unchanged from pre-5D-1A behavior.
      const titleSlot = this.quoteProjection.titleSlot;
      if (titleSlot) {
        // Phase 5D-1C: quoteTypeInputEl is free text — unlike
        // quoteMarkerSelectEl's closed-set <select> below, a user CAN
        // reach reconstructQuoteHeader's "invalid-type" refusal through
        // completely ordinary typing/pasting (clearing the field, or
        // pasting a string containing "]" or a line break), so this is a
        // real, user-facing failure mode — see the Notice branch below.
        const newType = this.quoteTypeInputEl.value;
        // Phase 5D-1B: quoteMarkerSelectEl is a closed-set <select> whose
        // only possible values are "", "+", "-" (see that field's own
        // doc comment) — this cast reflects that DOM-level guarantee.
        // reconstructQuoteHeader still runtime-guards against anything
        // else reaching it (e.g. via out-of-band DOM manipulation) and
        // returns reason "invalid-marker" rather than throwing; since
        // that path is unreachable through this view's own UI, it is
        // handled as a silent, safe no-op below rather than a new
        // user-facing Notice (no Notice text would accurately describe a
        // state the UI itself can never produce).
        const newMarker = this.quoteMarkerSelectEl.value as CalloutFoldMarker;
        const reconstructed = reconstructQuoteHeader(
          titleSlot,
          newType,
          newMarker,
          this.quoteTitleInputEl.value
        );
        if (!reconstructed.ok) {
          if (reconstructed.reason === "newline") {
            new Notice(this.plugin.t("partialEdit.quoteTitleNewlineUnsupported"));
          } else if (reconstructed.reason === "invalid-type") {
            new Notice(this.plugin.t("partialEdit.quoteTypeInvalidUnsupported"));
          }
          return false;
        }
        const bodyOnlyLines = newRawText.split("\n").slice(1);
        newRawText = [reconstructed.header, ...bodyOnlyLines].join("\n");
      }
    }

    const outcome = applySubtreeEdit(doc, this.nodeId!, this.originalText, newRawText);
    const node = doc.nodes.get(this.nodeId!);
    const startLine = node ? node.range.startLine : 0;

    if (!outcome.changed) {
      const reasonKey = ("reason." + (outcome.reason ?? "resolve-failed")) as TranslationKey;
      new Notice(this.plugin.t(reasonKey));
      return false;
    }

    // Phase 5A-1 hardening §1: same self-Apply suppression span as the
    // paragraph/composite branches above — see isApplyingOwnEdit's own
    // doc comment. outcome.changed is already true here, so
    // applyLineEditOutcome's own no-op branch never fires — the notify
    // callback is unreachable, but required by its signature.
    this.isApplyingOwnEdit = true;
    try {
      applyLineEditOutcome(
        editor,
        { line: startLine, ch: 0 },
        startLine,
        doc.lines,
        outcome,
        () => {}
      );

      // Phase 5D-0.5: originalText re-anchors to the RECONSTRUCTED raw text
      // (never the textarea's own, possibly prefix-stripped, value) — for
      // every non-projecting kind newRawText === this.textareaEl.value
      // already, so this is byte-identical to the pre-5D-0.5 behavior there.
      this.originalText = newRawText;
      if (this.quoteProjection) {
        // Rebuild the projection/line-mapping fresh from the just-applied
        // raw text, rather than trusting the pre-apply projection's now
        // possibly-stale prefixes — this is what guarantees a SECOND Apply
        // in the same pane session starts from a fully current basis (see
        // the class doc comment's originalText/quoteProjection contract).
        // A rebuild can fail here ONLY with reason "nested" — never
        // "no-body" (line count, and therefore body-line count, cannot
        // change on this path; see invertQuotePrefixProjection) — if the
        // user's own edited content happened to introduce a literal leading
        // `>` into a line (typed, not structural). That is not a data-loss
        // risk (the Apply above already succeeded and the note already
        // holds newRawText); this pane simply, safely degrades to showing
        // that node raw from here on, exactly like the "no-body" fallback
        // already does for a header-only callout.
        // Phase 5D-1A: the freshly rebuilt projection's own `titleSlot` is
        // recomputed from `newRawText`'s new header line (which already
        // reflects any title edit just applied above), so calling
        // renderQuoteHeader() right below also re-syncs quoteTitleInputEl
        // to the just-applied title — no separate title re-sync needed
        // here.
        const kind = this.quoteProjection.kind;
        const rebuilt = buildQuotePrefixProjection(newRawText, kind);
        this.quoteProjection = rebuilt.ok ? rebuilt.projection : null;
        this.renderQuoteHeader();
        // Keep the textarea itself in sync with whatever currentDisplayText()
        // now resolves to (projected again, or raw on the rare degrade
        // above) — normally a no-op, since projecting the just-reconstructed
        // raw text back should reproduce exactly what the textarea already
        // shows.
        this.textareaEl.value = this.currentDisplayText();
      }
      // Phase 5A-1 hardening §1: see the paragraph branch's identical
      // comment above — explicitly synced right after this pane's own
      // re-anchoring, regardless of what syncState held before Apply.
      this.syncState = "synced";
      this.updateDirtyState();
    } finally {
      this.isApplyingOwnEdit = false;
    }
    // See the paragraph branch's identical comment above.
    this.scheduleStaleCheck();

    const lineLen = editor.getLine(outcome.newStartLine)?.length ?? 0;
    editor.scrollIntoView(
      { from: { line: outcome.newStartLine, ch: 0 }, to: { line: outcome.newStartLine, ch: lineLen } },
      true
    );

    // Phase 5T-5A: same selection-follow as the paragraph branch above,
    // for symmetry — a section/list subtree edit doesn't relocate the
    // node's own start line (applySubtreeEdit never moves content, only
    // rewrites it in place), so this is a low-risk, mostly-defensive
    // addition rather than the primary fix this ticket targets.
    this.plugin.queueOutlineTreeSelectionFollow(outcome.newStartLine);

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

    // Phase 5A-1: Apply is ALSO disabled whenever this pane is stale or
    // unavailable — deliberately a UX-layer-only precaution, never a
    // replacement for (or weakening of) the existing, unchanged
    // fail-closed conflict check inside applySubtreeEdit/
    // applyParagraphEdit/applyCompositeBlockEdit, which would refuse the
    // exact same Apply anyway (that check is precisely WHAT makes a pane
    // "stale" in the first place — see resolveCurrentTarget). This only
    // pre-empts a click that is guaranteed to fail, with an explanatory
    // tooltip for both visual and non-visual (screen reader) users.
    // `anyLoaded` mirrors isDirty()'s own "something is loaded" condition
    // exactly, so an empty pane's Apply button stays disabled=true exactly
    // as it always has (renderEmptyState's own explicit `disabled = true`
    // is left untouched by this — this line simply reproduces the same
    // value for the empty case rather than overriding it differently).
    const anyLoaded = this.nodeId !== null || this.paragraphAnchor !== null || this.compositeAnchor !== null;
    const applyBlockedBySync = anyLoaded && this.syncState !== "synced";
    this.applyButtonEl.disabled = anyLoaded ? applyBlockedBySync : true;
    setTooltip(
      this.applyButtonEl,
      applyBlockedBySync
        ? this.plugin.t(
            this.syncState === "stale"
              ? "partialEdit.staleApplyDisabledReason"
              : "partialEdit.unavailableApplyDisabledReason"
          )
        : ""
    );

    this.renderSyncStatus();
  }

  /**
   * Phase 5A-1: renders the stale/unavailable indicator + Reload row
   * (syncStatusEl) from `this.syncState` — called from updateDirtyState so
   * every place that already re-renders dirty/Apply state (load, Cancel,
   * Apply, and this ticket's own transitionToStale/transitionToUnavailable/
   * performAutoReload) keeps this row in sync for free, with no separate
   * call site to remember. Hidden whenever synced or nothing is loaded —
   * mirrors the `anyLoaded` condition updateDirtyState above already uses
   * for the Apply button's own sync-based disabling.
   */
  private renderSyncStatus(): void {
    const anyLoaded = this.nodeId !== null || this.paragraphAnchor !== null || this.compositeAnchor !== null;
    const show = anyLoaded && this.syncState !== "synced";
    this.syncStatusEl.toggleVisibility(show);
    this.syncStatusEl.toggleClass(
      "unified-outliner-partial-edit-sync-status-stale",
      show && this.syncState === "stale"
    );
    this.syncStatusEl.toggleClass(
      "unified-outliner-partial-edit-sync-status-unavailable",
      show && this.syncState === "unavailable"
    );
    if (!show) return;
    this.syncStatusLabelEl.setText(
      this.plugin.t(this.syncState === "stale" ? "partialEdit.staleLabel" : "partialEdit.unavailableLabel")
    );
  }

  /**
   * Phase 5B: shared by updateDirtyState (Apply/Cancel button visibility)
   * and requestLoadNode (the unsaved-edit guard) — both need the exact
   * same "is there something to Apply/Cancel/lose right now" condition,
   * so it lives in one place instead of being duplicated inline.
   */
  private isDirty(): boolean {
    // Phase 5D-0.5: compares against currentDisplayText() (the projected
    // displayText for a projecting callout/blockquote, originalText
    // verbatim otherwise) — NEVER against raw originalText directly for a
    // projecting node, or every keystroke in the prefix-stripped textarea
    // would spuriously read as dirty relative to the still-`>`-prefixed
    // raw snapshot. See currentDisplayText's own doc comment.
    //
    // Phase 5D-1A: ALSO dirty when the title input differs from its
    // loaded titleSlot.title — titleSlot is null (titleDirty forced
    // false) for every case except a callout whose title was
    // successfully split out, so this is a no-op addition for
    // blockquote/section/list/paragraph/non-title-editable callouts.
    // Phase 5D-1B: ALSO dirty when the fold-marker select differs from
    // its loaded titleSlot.marker, same gating as titleDirty.
    // Phase 5D-1C: ALSO dirty when the type combobox differs from its
    // loaded titleSlot.type, same gating as titleDirty/markerDirty.
    const titleSlot = this.quoteProjection?.titleSlot ?? null;
    const titleDirty = titleSlot !== null && this.quoteTitleInputEl.value !== titleSlot.title;
    const markerDirty = titleSlot !== null && this.quoteMarkerSelectEl.value !== titleSlot.marker;
    const typeDirty = titleSlot !== null && this.quoteTypeInputEl.value !== titleSlot.type;
    // Phase 5D-2A: ALSO counts a loaded CompositeBlock (compositeAnchor)
    // as "something is loaded" here — otherwise a composite-wide edit
    // would never register as dirty, silently defeating the unsaved-edit
    // guard every requestLoadNode/requestLoadParagraphAtCursor/
    // requestLoadComposite call already relies on via `if (!this.isDirty())`.
    return (
      (this.nodeId !== null || this.paragraphAnchor !== null || this.compositeAnchor !== null) &&
      (this.textareaEl.value !== this.currentDisplayText() || titleDirty || markerDirty || typeDirty)
    );
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

  // ---------------------------------------------------------------------
  // Phase 5A-1 ("Partial Edit Pane の stale 状態検知・安全な再読み込み"):
  // event handlers, the debounced stale check, and Reload. See this file's
  // top-level doc comment's Phase 5A-1 paragraph and
  // docs/phase5a1_partial_edit_stale_pane_synchronization_design.md for
  // the full design and rationale; each method below only carries the
  // parts of that rationale a reader needs locally.
  // ---------------------------------------------------------------------

  /**
   * editor-change handler — matches purely on `info.file?.path`, NEVER on
   * `this.plugin.activeMarkdownView` (see onOpen's own doc comment on this
   * registration for why). `info` is `MarkdownView | MarkdownFileInfo`
   * (obsidian.d.ts) — both expose `.file` uniformly, so no instanceof
   * check is needed before reading it.
   */
  private handleEditorChange(_editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    if (this.closed || !this.sourcePath) return;
    if (info.file?.path !== this.sourcePath) return;
    this.scheduleStaleCheck();
  }

  /** vault "modify" handler — path-based, works even with no open editor for sourcePath. */
  private handleVaultModify(file: TAbstractFile): void {
    if (this.closed || !this.sourcePath) return;
    if (!(file instanceof TFile) || file.path !== this.sourcePath) return;
    this.scheduleStaleCheck();
  }

  /**
   * vault "rename" handler — follows `sourcePath` to the file's new path
   * WITHOUT touching the textarea or any loaded content (a rename alone
   * says nothing about whether the CONTENT changed). `this.sourcePath` is
   * reassigned synchronously here, so every downstream read of it — this
   * debounced check's own eventual callback included, since that callback
   * always reads `this.sourcePath` live rather than closing over a local
   * copy — sees the new path, never a stale one, regardless of how much
   * later the debounced check actually executes.
   */
  private handleVaultRename(file: TAbstractFile, oldPath: string): void {
    if (this.closed || !this.sourcePath) return;
    if (!(file instanceof TFile) || oldPath !== this.sourcePath) return;
    this.sourcePath = file.path;
    this.scheduleStaleCheck();
  }

  /**
   * vault "delete" handler — an unambiguous, immediate transition to
   * "unavailable" (no debounce needed: there is nothing left to compare
   * against). Deliberately does NOT clear `nodeId`/`paragraphAnchor`/
   * `compositeAnchor`/`originalText`/the textarea's own buffered value —
   * an in-progress dirty edit is never force-discarded just because its
   * source note disappeared. See transitionToUnavailable's own doc
   * comment for why this state does not auto-clear if the path later
   * becomes valid again (e.g. a same-named file recreated, or an undo of
   * the deletion) — only an explicit Reload re-attempts resolution.
   */
  private handleVaultDelete(file: TAbstractFile): void {
    if (this.closed || !this.sourcePath) return;
    if (!(file instanceof TFile) || file.path !== this.sourcePath) return;
    this.transitionToUnavailable();
  }

  /**
   * E5 (design doc §3, "two-stage"): the first stage — search every open
   * MarkdownView (via `getLeavesOfType`, which per obsidian.d.ts's own doc
   * comment also searches leaves inside pop-out windows when no root is
   * given) for one whose `.file?.path` equals `this.sourcePath`. Returns
   * that view's live `Editor` when found (its `getValue()` reflects
   * every keystroke, even totally unsaved ones — the freshest possible
   * source), or `null` when `sourcePath` has no open editor anywhere
   * (background file, inactive tab never focused this session, etc.) —
   * callers fall back to `vault.cachedRead` in that case. Never trusts
   * `this.plugin.activeMarkdownView` — see onOpen's own doc comment.
   */
  private findOpenEditorForSourcePath(): Editor | null {
    if (!this.sourcePath) return null;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.sourcePath) {
        return view.editor;
      }
    }
    return null;
  }

  /**
   * The debounced target of `scheduleStaleCheck` — see that field's own
   * doc comment for the debounce configuration and why every event source
   * funnels here. Skips entirely once `syncState === "unavailable"`: per
   * this ticket's own requirement, "unavailable" never auto-clears itself
   * — only an explicit Reload (executeReload below) re-attempts
   * resolution. `vault.cachedRead` (E4, the no-open-editor fallback) is
   * used here ONLY for a safe, read-only staleness COMPARISON — never to
   * silently overwrite the textarea; see evaluateAgainstText's own
   * `fromLiveEditor` gate for where that distinction is enforced.
   */
  private performStaleCheck(): void {
    if (!this.sourcePath) return;
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;
    // Phase 5A-1 hardening §1: closed / self-Apply-suppressed / already-
    // "unavailable" are now one shared, Obsidian-free decision
    // (partialEditSyncClassification.ts#shouldRunStaleCheck) — see that
    // function's own doc comment, and isApplyingOwnEdit's own doc comment
    // for why a suppressed re-entrant call must no-op here BEFORE even
    // touching the vault, not just at evaluateAgainstText's own guard.
    if (
      !shouldRunStaleCheck({
        closed: this.closed,
        suppressed: this.isApplyingOwnEdit,
        currentSyncState: this.syncState,
      })
    ) {
      return;
    }

    const path = this.sourcePath;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.transitionToUnavailable();
      return;
    }

    const openEditor = this.findOpenEditorForSourcePath();
    if (openEditor) {
      this.evaluateAgainstText(openEditor.getValue(), path, true);
      return;
    }
    // Phase 5A-1 hardening §3: a rejected cachedRead (e.g. a transient I/O
    // error, or the file vanishing between getAbstractFileByPath above and
    // this read) must fail closed — this is the PASSIVE detection path
    // (never explicitly requested by the user), so the chosen behavior is
    // to change nothing at all: no textarea/quote-input/originalText/
    // anchor/snapshot mutation, no incorrect auto-reload, no substituted
    // or guessed content, and no syncState transition either (a transient
    // read failure here is not itself evidence the target is actually
    // unavailable — see executeReload's own doc comment for why an
    // EXPLICIT Reload's own read failure is treated differently). The
    // rejection is swallowed rather than surfaced as a Notice — a silent,
    // periodic background check failing once is not something the user
    // needs interrupted for, and the next debounced check (editor-change/
    // vault modify/active-leaf-change/file-open) will simply try again.
    void this.app.vault
      .cachedRead(file)
      .then((text) => {
        this.evaluateAgainstText(text, path, false);
      })
      .catch(() => {
        /* Fail closed — see this method's own comment above. */
      });
  }

  /**
   * Re-resolves the currently loaded target against a fresh parse of
   * `doc`, reusing exactly the same read-only resolvers
   * applySubtreeEdit/applyParagraphEdit/applyCompositeBlockEdit
   * themselves call for their own conflict check — see each branch's own
   * comment below. This is what guarantees stale-detection can never be
   * weaker than Apply's own fail-closed contract: it IS that contract's
   * own read side, never a separately re-implemented approximation of it.
   *
   * `ambiguous` distinguishes a paragraph whose position could not be
   * safely, uniquely re-identified (deletion, an ambiguous duplicate, or
   * a nearby structural change — see applyParagraphEdit's own doc
   * comment for "anchor-unresolved") from a section/list/callout/
   * blockquote/CompositeBlock's more definitive resolve-failure. Per this
   * ticket's own explicit instruction, an ambiguous case leans toward
   * "stale" rather than "unavailable" when merely DETECTED (see
   * evaluateAgainstText) — only a subsequent, explicit Reload attempt
   * that ALSO fails escalates it to "unavailable" (see executeReload).
   */
  private resolveCurrentTarget(doc: ParsedDocument): { ok: boolean; text: string | null; ambiguous: boolean } {
    if (this.nodeId) {
      const extracted = extractSubtreeText(doc, this.nodeId);
      return { ok: extracted.ok, text: extracted.ok ? extracted.text : null, ambiguous: false };
    }

    if (this.paragraphAnchor) {
      // Phase 5A-1 hardening §2: reuses edit/paragraphPartialEdit.ts's own
      // dedicated, explicitly read-only `resolveParagraphAnchorText` —
      // never the discarded-result no-op-probe pattern (re-splicing the
      // anchor's own snapshot text via the Apply-time function below,
      // purely to read its outcome) this ticket's own safety review
      // flagged as a responsibility-boundary risk: an "Apply"-named
      // function reused for reads, with no explicit read-only contract.
      // See resolveParagraphAnchorText's own doc comment for the full
      // two-pass identity-resolution algorithm (mirroring, but not
      // identical to, the Apply-time function's own — see ITS doc comment
      // for exactly how and why the two intentionally differ) and why it
      // is provably free of any Editor/Vault/DOM/Notice dependency.
      return resolveParagraphAnchorText(doc, this.paragraphAnchor);
    }

    if (this.compositeAnchor) {
      const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
      const extracted = extractCompositeBlockText(doc, this.compositeAnchor, rules);
      return { ok: extracted.ok, text: extracted.ok ? extracted.text : null, ambiguous: false };
    }

    return { ok: false, text: null, ambiguous: false };
  }

  /**
   * Classifies the result of one resolveCurrentTarget call against
   * `this.originalText` and either: (a) clears back to "synced" (content
   * matches), (b) silently, safely auto-reloads (see performAutoReload's
   * own doc comment for the full condition list this branch enforces), or
   * (c) marks stale/unavailable for display only, never touching the
   * textarea. `fromLiveEditor` is `true` only for the E3/open-editor path
   * (performStaleCheck) — auto-reload (silently updating the textarea
   * without a confirmation) is restricted to exactly that case, per this
   * ticket's own explicit instruction; the E4/vault.cachedRead path is
   * always read-only-comparison-only here, never an auto-textarea-update,
   * regardless of dirty state.
   */
  private evaluateAgainstText(text: string, path: string, fromLiveEditor: boolean): void {
    // Phase 5A-1 hardening §1: `isApplyingOwnEdit` is checked here too,
    // not just at performStaleCheck's own entry — a `vault.cachedRead`
    // promise scheduled BEFORE this Apply started could in principle still
    // have its `.then()` callback reach this method later; guarding here
    // as well makes that inert regardless of any assumption about
    // microtask/debounce ordering. See isApplyingOwnEdit's own doc comment.
    if (this.closed || this.isApplyingOwnEdit || this.sourcePath !== path) return;
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;

    const doc = parseDocument(text);
    const resolved = this.resolveCurrentTarget(doc);

    // Phase 5A-1 hardening §4: the actual classification decision is now a
    // pure, Obsidian-free function (partialEditSyncClassification.ts) —
    // see its own doc comment for the full decision table (mirrored from
    // this method's pre-hardening inline logic, unit-tested there with
    // real assertions rather than only via this file's own static-source
    // checks). Everything below is purely dispatch: apply whichever side
    // effect the decision calls for, never re-deciding anything itself.
    const decision = classifySyncOutcome({
      resolved,
      originalText: this.originalText,
      isDirty: this.isDirty(),
      fromLiveEditor,
    });

    switch (decision) {
      case "unavailable":
        this.transitionToUnavailable();
        return;
      case "stale":
        this.transitionToStale();
        return;
      case "already-synced":
        if (this.syncState !== "synced") {
          this.syncState = "synced";
          this.updateDirtyState();
        }
        return;
      case "clean-pane-auto-reload":
        // resolved.text is guaranteed non-null whenever classifySyncOutcome
        // returns "clean-pane-auto-reload" (see that function's own doc
        // comment) — this null check exists only so TypeScript can narrow
        // resolved.text's type across the pure-function boundary; it is
        // not a reachable runtime branch.
        if (resolved.text === null) return;
        this.performAutoReload(resolved.text, doc);
        return;
    }
  }

  /** See `syncState`'s own doc comment. Idempotent (a no-op re-render when already stale). */
  private transitionToStale(): void {
    if (this.closed) return;
    if (this.syncState === "stale") return;
    this.syncState = "stale";
    this.updateDirtyState();
  }

  /**
   * See `syncState`'s own doc comment for what "unavailable" means and
   * why it never clears itself automatically (performStaleCheck's own
   * early-return on `syncState === "unavailable"` is the other half of
   * that contract) — a deleted-then-recreated file, or a target that
   * starts resolving again for any other reason, is picked up again ONLY
   * via an explicit Reload (executeReload), never silently. Idempotent.
   */
  private transitionToUnavailable(): void {
    if (this.closed) return;
    if (this.syncState === "unavailable") return;
    this.syncState = "unavailable";
    this.updateDirtyState();
  }

  /**
   * Applies a freshly re-resolved `newText` to this pane's OWN in-memory
   * state — never to the note (no editor.replaceRange call anywhere in
   * this method) — from either the clean-Pane auto-reload path
   * (evaluateAgainstText) or an explicit Reload (executeReload). Mirrors
   * applyEdit()'s own existing post-Apply re-anchoring for each of the
   * three anchor kinds (see that method's own paragraph/composite/node
   * branches), reused here for the same reason: a second Apply (or a
   * second stale check) after this must start from a fully current basis.
   */
  private performAutoReload(newText: string, doc: ParsedDocument): void {
    this.originalText = newText;
    if (this.nodeId && this.quoteProjection) {
      const kind = this.quoteProjection.kind;
      const rebuilt = buildQuotePrefixProjection(newText, kind);
      this.quoteProjection = rebuilt.ok ? rebuilt.projection : null;
    }
    if (this.paragraphAnchor) {
      this.paragraphAnchor = { ...this.paragraphAnchor, originalText: newText };
    }
    if (this.compositeAnchor) {
      const rules = getEnabledCompositeBlockRules(this.plugin.settings.compositeBlocks);
      const extracted = extractCompositeBlockText(doc, this.compositeAnchor, rules);
      if (extracted.ok && extracted.resolvedSnapshot) {
        this.compositeAnchor = extracted.resolvedSnapshot;
      }
    }
    this.syncState = "synced";
    this.textareaEl.value = this.currentDisplayText();
    this.renderQuoteHeader();
    this.updateDirtyState();
  }

  /**
   * The Reload button's click handler (syncStatusReloadEl, onOpen). Clean
   * Pane (isDirty() === false): reloads immediately, no confirmation — per
   * this ticket's own explicit requirement. Dirty Pane: reuses the EXISTING
   * DiscardChangesModal (R2 — see that class's own doc comment for the
   * `showApply` extension), but with `showApply: false` and Reload-specific
   * title/body text — Apply is never offered here, since a dirty+stale/
   * unavailable Apply is guaranteed to be refused by the very same
   * fail-closed check that made this pane stale in the first place, and
   * offering it would only give a false expectation. "Cancel" (the only
   * other reachable choice — "apply" is never sent when showApply is
   * false) preserves the buffered edit and current syncState exactly as
   * they were; only "discard" proceeds to executeReload.
   */
  private async performReload(): Promise<void> {
    if (this.closed || !this.sourcePath) return;
    if (!this.nodeId && !this.paragraphAnchor && !this.compositeAnchor) return;

    if (this.isDirty()) {
      new DiscardChangesModal(
        this.app,
        this.plugin,
        (choice) => {
          if (choice === "discard") {
            void this.executeReload();
          }
          // "cancel": no-op — the buffered edit and current syncState stay
          // exactly as they were. ("apply" is unreachable here since the
          // modal is opened with showApply: false below.)
        },
        {
          showApply: false,
          titleKey: "partialEdit.reloadConfirmTitle",
          bodyKey: "partialEdit.reloadConfirmBody",
          discardButtonKey: "partialEdit.reloadConfirmDiscardButton",
        }
      ).open();
      return;
    }

    await this.executeReload();
  }

  /**
   * The actual read-then-resolve-then-apply-locally reload, shared by both
   * performReload's clean-Pane immediate path and its dirty-Pane
   * post-Discard path. Unlike performStaleCheck/evaluateAgainstText (which
   * restrict auto-textarea-updates to the E3/open-editor case only), an
   * EXPLICIT Reload is allowed to use `vault.cachedRead` (E4) too — the
   * user asked for this, so it is no longer an unsolicited auto-update.
   * A resolution failure here (still unavailable, or the ambiguous
   * paragraph case still unresolved) is the one place this ticket
   * escalates an "ambiguous" result to "unavailable" — see
   * resolveCurrentTarget's own doc comment for why a mere DETECTION leans
   * toward "stale" instead, while a deliberate, explicit Reload attempt
   * that still fails is treated as more conclusive.
   */
  private async executeReload(): Promise<void> {
    if (this.closed) return;
    const path = this.sourcePath;
    if (!path) return;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.transitionToUnavailable();
      new Notice(this.plugin.t("partialEdit.reloadFailedNotice"));
      return;
    }

    const openEditor = this.findOpenEditorForSourcePath();
    // Phase 5A-1 hardening §3: unlike performStaleCheck's own passive
    // cachedRead (which silently swallows a rejection — see that method's
    // own comment), this IS an explicit, user-requested action, so a read
    // failure here is treated exactly like any other resolution failure
    // just below: transition to "unavailable" and show the same
    // reloadFailedNotice (never the raw error/path itself). The buffered
    // textarea/quote-inputs and current anchor are left completely
    // untouched either way — this catch returns before performAutoReload
    // is ever reached.
    let text: string;
    try {
      text = openEditor ? openEditor.getValue() : await this.app.vault.cachedRead(file);
    } catch {
      if (this.closed || this.sourcePath !== path) return;
      this.transitionToUnavailable();
      new Notice(this.plugin.t("partialEdit.reloadFailedNotice"));
      return;
    }
    if (this.closed || this.sourcePath !== path) return;

    const doc = parseDocument(text);
    const resolved = this.resolveCurrentTarget(doc);
    if (!resolved.ok || resolved.text === null) {
      this.transitionToUnavailable();
      new Notice(this.plugin.t("partialEdit.reloadFailedNotice"));
      return;
    }

    this.performAutoReload(resolved.text, doc);
    new Notice(this.plugin.t("partialEdit.reloadedNotice"));
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
/**
 * Phase 5A-1 (R2, minimal-change extension): `showApply` defaults to
 * `true`, so every pre-existing call site (requestLoadNode/
 * requestLoadParagraphAtCursor/requestLoadComposite's own node-switch
 * guard, all THREE unchanged by this ticket, still calling
 * `new DiscardChangesModal(this.app, this.plugin, (choice) => {...})`
 * with no 4th argument) keeps its exact pre-5A-1 Apply/Discard/Cancel
 * behavior byte-for-byte. Only the NEW dirty+stale/unavailable Reload
 * confirmation (PartialEditView#performReload) passes
 * `{ showApply: false, titleKey: ..., bodyKey: ... }`, per this ticket's
 * own explicit requirement that a stale/unavailable Reload confirmation
 * must never offer Apply as a choice (a stale Apply is guaranteed to be
 * refused as a conflict by the existing, unchanged fail-closed check —
 * offering it would give the user a false expectation). `titleKey`/
 * `bodyKey` default to the original unsavedChanges* keys, so the
 * node-switch-guard call sites' wording is also completely unchanged.
 *
 * `discardButtonKey` (2026-09-08 UX fix, real-device B-1 feedback):
 * defaults to `undefined`, in which case onOpen falls back to
 * `common.discard` exactly as before — so all three node-switch call
 * sites, none of which pass this option, keep showing the shared plain
 * "Discard"/"破棄" label byte-for-byte unchanged. Only performReload's
 * Reload confirmation passes `partialEdit.reloadConfirmDiscardButton`
 * ("Discard changes and reload" / "変更を破棄して再読み込み"): a bare
 * "Discard" is ambiguous in a dialog whose only two choices are that
 * button and Cancel (does it discard the edits and leave the pane as-is,
 * or does it also reload?) — this dialog's one real action is BOTH
 * discarding the pane's unapplied edits AND reloading the current note
 * content, and the label says so explicitly. A separate key (rather than
 * changing `common.discard` itself, which is shared with the three
 * node-switch call sites) keeps their wording untouched. Deliberately
 * never uses "Apply"/"Reapply"/"Save"/"Overwrite" (or their ja
 * equivalents) — this modal's Reload context never offers Apply as a
 * choice (`showApply: false`), and a stale/unavailable Apply would be
 * refused as a conflict by the unchanged low-level fail-closed check
 * regardless, so such wording would only mislead the user about what this
 * dialog can do.
 */
interface DiscardChangesModalOptions {
  showApply?: boolean;
  titleKey?: TranslationKey;
  bodyKey?: TranslationKey;
  discardButtonKey?: TranslationKey;
}

class DiscardChangesModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly plugin: UnifiedOutlinerPlugin,
    private readonly onChoice: (choice: DiscardChangesChoice) => void,
    private readonly options: DiscardChangesModalOptions = {}
  ) {
    super(app);
  }

  onOpen(): void {
    const showApply = this.options.showApply ?? true;
    this.titleEl.setText(this.plugin.t(this.options.titleKey ?? "partialEdit.unsavedChangesTitle"));
    this.contentEl.createEl("p", {
      text: this.plugin.t(this.options.bodyKey ?? "partialEdit.unsavedChangesBody"),
    });

    const buttonsEl = this.contentEl.createDiv({
      cls: "unified-outliner-partial-edit-modal-buttons",
    });
    if (showApply) {
      const applyEl = buttonsEl.createEl("button", {
        text: this.plugin.t("common.apply"),
        cls: "mod-cta",
      });
      applyEl.addEventListener("click", () => this.choose("apply"));
    }
    const discardEl = buttonsEl.createEl("button", {
      text: this.plugin.t(this.options.discardButtonKey ?? "common.discard"),
    });
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
