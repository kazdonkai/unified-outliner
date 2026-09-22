/**
 * Build a display-ready outline tree from a ParsedDocument. Pure function,
 * no Obsidian dependency — this is the data model behind the Outline Tree
 * View (docs/別ペイン実装計画と当面の実装指示.md §3.1).
 *
 * Phase 2A through 3B only ever built a *section*-only tree: list items were
 * intentionally left out ("Markdown 文書の見出し構造をツリーとして可視化する";
 * list subtree integration was explicitly out of scope until Phase 3C).
 *
 * Phase 3C (docs, forward-looking §Outline List Display) adds an opt-in
 * `includeLists` mode that folds root list items into the same tree as
 * sibling children of their owning section (or as top-level nodes, for
 * pre-heading root lists), with nested list items becoming children of their
 * parent list node — sections and lists share one tree, distinguished by
 * `kind`. The default (`includeLists` unset / false) is unchanged from
 * every prior phase, so existing callers that only ever wanted the heading
 * structure keep working exactly as before.
 *
 * A section's own `childIds` mixes list items and child sections, and does
 * NOT preserve their relative document order once mixed (see
 * parser/parseDocument.ts: all child *sections* are appended during pass 1,
 * then all root *list items* are appended afterward during pass 2) — so
 * this module always re-sorts by line number when includeLists is on,
 * rather than trusting childIds order directly.
 */
import {
  BlockNode,
  isListNode,
  isSectionNode,
  ListBlockNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";
import { ComplexBlockInfo, ComplexBlockKind } from "../model/complexBlock";
import { complexBlockDepth } from "../parser/complexBlocks";
import {
  compositeBlockDisplayLabel,
  CompositeBlockInfo,
  CompositeBlockMember,
  CompositeBlockRule,
  getCompositeBlockRuleById,
} from "../model/compositeBlock";
import { defaultTranslator, Translator } from "../i18n";
import { HeadingPrefixStyle, ListPrefixStyle } from "../settingsDefaults";

export interface OutlineTreeSectionNode {
  kind: "section";
  /** Matches the underlying SectionBlockNode's id. */
  id: string;
  headingText: string;
  headingLevel: number;
  /** 0-based line of the heading itself (jump target). */
  line: number;
  children: OutlineTreeNode[];
}

export interface OutlineTreeListNode {
  kind: "list";
  /** Matches the underlying ListBlockNode's id. */
  id: string;
  /**
   * Item text with the leading indent stripped. For an ORDERED item
   * ("1.", "2)", a restart like "3.", ...) the item's own `listMarker` is
   * kept as a literal prefix ("3. Buy eggs") — see the 2026-08-12
   * "数字リストの番号非表示バグ" fix; before that fix this field silently
   * dropped ordered markers the same way it drops unordered bullets
   * ("-"/"*"/"+"), which are still stripped here (bullets rely on
   * indentation/kind styling in the Tree row instead of a printed glyph).
   * Built by listItemTreeDisplayText() below, deliberately kept separate
   * from listItemDisplayText() (marker-free) because that other function's
   * output ALSO becomes the rename textarea's initial editable value —
   * baking the marker into that shared string would let a re-typed "3. "
   * leak into the item's saved body text.
   */
  text: string;
  /**
   * UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"): the
   * item's own actual Markdown list marker (`item.listMarker` — "-", "*",
   * "+", "1.", "2)", a mid-list restart like "3.", ...), as an independent
   * prefix rendered BEFORE `text` — the same "separate <span>, resolved
   * once at build time" architecture OutlineTreeCompositeNode.prefix /
   * OutlineTreeComplexMemberNode.prefix already use (see
   * view/OutlineTreeView.ts's renderNode list branch for where this is
   * rendered). `null` when settings.listPrefixStyle is "none" — see
   * listPrefixText below, the pure function that produces this value.
   *
   * Before this ticket, an ORDERED item's marker was baked directly into
   * `text` itself (listItemTreeDisplayText's pre-UXP-04 behavior); that is
   * now moved here instead, so `text` is always the item's pure body label
   * with no marker of any kind mixed in, for both ordered and unordered
   * items alike. This field is independent of whether `text` is empty (the
   * empty-list-item fallback is applied at render time, in
   * OutlineTreeView.ts) — a marker can be shown even for an otherwise-empty
   * list item.
   */
  prefix: string | null;
  /** List nesting depth (root list item = 0), for indent-based rendering. */
  indentDepth: number;
  /** 0-based line of the item's own first line (jump target). */
  line: number;
  children: OutlineTreeNode[];
}

/**
 * Phase 5D-0.3: a projected CompositeBlock (model/compositeBlock.ts) — a
 * read-only grouping of two or more already-recognized member blocks (see
 * buildCompositeNode below) into one collapsible Tree unit. `id` matches
 * the underlying CompositeBlockInfo's id (stable only within one
 * buildOutlineTree() call, same convention as every other node kind here).
 * `label`/`prefix` are resolved ONCE at build time (from the matching
 * CompositeBlockRule — see compositeBlockDisplayLabel), not re-derived by
 * the view layer, so every consumer (rendering, tests, a future
 * accessible-name computation) reads the exact same string.
 */
export interface OutlineTreeCompositeNode {
  kind: "composite";
  id: string;
  ruleId: string;
  label: string;
  /** Decorative symbol (e.g. "◉"); "" means no prefix — renderers must not emit an empty decorative element for that case. */
  prefix: string;
  /** 0-based line of the FIRST member's own first line (jump target). */
  line: number;
  /** The composite's members, each projected via buildMemberNode below — never empty (a CompositeBlockInfo always has >= 2 members). */
  children: OutlineTreeNode[];
}

/**
 * Phase 5D-0.3: a read-only Tree row for a callout or blockquote
 * (model/complexBlock.ts's ComplexBlockInfo), which (unlike a list item) is
 * never itself a BlockNode and so has no existing node kind of its own.
 *
 * Phase 5C-2 (2026-08-14) widened this node kind's role: it was originally
 * documented as existing ONLY as a CompositeBlock's child (produced solely
 * by buildMemberNode below) — that is still true for a composite's own
 * members, but this same node kind is now ALSO used, independently, for a
 * STANDALONE callout/blockquote (one that is NOT part of any matched
 * CompositeBlock) shown as a section-level sibling row — see
 * `isStandalone`/`buildStandaloneComplexNode` below. Both uses share this
 * one type and the exact same read-only treatment (readOnlyNodeIds,
 * renderNode's isComplexMember branch, foldIdentity's "complex-member"
 * pool) — see `isStandalone`'s own doc comment for the one behavioral
 * difference the Tree view is allowed to make between the two (a
 * standalone row gets its own "Open in Partial Edit" context menu; a
 * composite-member row still gets none, unchanged from before Phase 5C-2).
 * It carries no structural-edit capability of any kind either way (see the
 * Phase 5D-0.3 design memo §4/approval §1) — the Tree view must not attach
 * rename/drag-drop/move/delete handling to it regardless of `isStandalone`.
 */
export interface OutlineTreeComplexMemberNode {
  kind: "complex-member";
  /** Matches the underlying ComplexBlockInfo's id. */
  id: string;
  complexKind: ComplexBlockKind;
  label: string;
  /**
   * Phase 5C-2: an optional decorative prefix (e.g. "▣ "), analogous to
   * OutlineTreeCompositeNode.prefix — rendered as its own <span> (see
   * OutlineTreeView.ts's renderNode isComplexMember branch) so it stays
   * part of the row's semantic textContent, exactly like the composite
   * prefix already does. Set for a standalone row (buildStandaloneComplexNode,
   * always paired with isStandalone: true) via STANDALONE_CALLOUT_PREFIX /
   * STANDALONE_BLOCKQUOTE_PREFIX below.
   *
   * Phase 5D-1L: ALSO set for a composite-member row (buildMemberNode)
   * whose `complexKind` is "callout" — the exact same STANDALONE_CALLOUT_PREFIX
   * constant, so a callout reads as the same kind of thing whether it's
   * standalone or grouped inside a CompositeBlock (this ticket's own
   * approved "callout member prefix parity" scope).
   *
   * Phase 5D-2B: ALSO set for a composite-member row whose `complexKind`
   * is "blockquote" — the exact same STANDALONE_BLOCKQUOTE_PREFIX constant
   * ("❝ "), for the same reason: a blockquote reads as the same kind of
   * thing whether it's standalone or grouped inside a CompositeBlock (e.g.
   * a "List + Quote" composite). This coexists with the composite parent's
   * own OutlineTreeCompositeNode.prefix (e.g. "❖") without conflict, since
   * the two prefixes render on separate Tree nodes/rows — the parent row
   * signals the composite unit, this row signals the member's own kind.
   * Still undefined for any composite-member kind besides callout/
   * blockquote, none of which exist today.
   */
  prefix?: string;
  /**
   * Phase 5C-2: true for a STANDALONE callout/blockquote row (not part of
   * any matched CompositeBlock) — the one signal view/OutlineTreeView.ts's
   * renderNode needs to decide whether this row gets its own "Open in
   * Partial Edit" context menu. A composite-member row (buildMemberNode)
   * always sets this false, keeping its existing no-context-menu behavior
   * byte-for-byte unchanged — composite-member Partial Edit integration is
   * explicitly out of scope for Phase 5C-2 (see this ticket's own approved
   * scope note: composite-member rows are read-only navigation only, same
   * as before).
   */
  isStandalone: boolean;
  /** 0-based line of the member's own first line (jump target). */
  line: number;
  /** Always [] — complex-block members are not decomposed further in this revision. */
  children: OutlineTreeNode[];
}

/**
 * Phase 5P-3 (docs/phase5p3d_paragraph-tree-display-design.md): a read-only,
 * navigation-only Tree row for a plain Markdown paragraph
 * (parser/complexBlocks.ts's ComplexBlockInfo, kind "paragraph"), projected
 * ONLY when `BuildOutlineTreeOptions.paragraphs` is passed (in practice,
 * only when settings.showParagraphsInOutline is on — see
 * view/OutlineTreeView.ts's refresh()).
 *
 * Deliberately a NEW, independent node kind — never `"complex-member"`,
 * even though a paragraph is projected via the same "group by resolved
 * parent, sort by line" shape `standaloneComplexBlocks` already uses (see
 * groupParagraphBlocks/buildParagraphTreeNode below). Reusing
 * `"complex-member"` would make a paragraph row match
 * view/OutlineTreeView.ts's `isComplexMember && node.isStandalone` branch,
 * which attaches a context menu with an "Open in Partial Edit" item — that
 * would silently open a NEW, Tree-triggered entry point into paragraph
 * Partial Edit, defeating Phase 5P-2's explicit "cursor-only" contract
 * (design doc §5-2). A distinct kind makes that impossible by construction:
 * no existing branch in this codebase's kind-based dispatch (row rendering,
 * context menu attachment, rename allowlist, drag & drop) matches
 * `"paragraph"` unless a NEW branch is deliberately added for it.
 *
 * `id` is NEVER the underlying ComplexBlockInfo's own scan-local
 * `complexBlockId` (parser/complexBlocks.ts's per-call `paragraph-N`
 * sequence) — see paragraphViewId() below. It is a temporary,
 * render-pass-scoped view identity: unique within one buildOutlineTree()
 * call, in a namespace (`tree-paragraph:N`) that can never collide with any
 * other node kind's id format (`sec-N`, `li-N`, or a raw dash-based
 * ComplexBlockInfo id reused verbatim by a composite/complex-member row).
 * It is never written to `persistence/foldStateStore.ts` (a paragraph node
 * is never given a `tree/foldIdentity.ts` identity at all — see that
 * module's own `"paragraph"` case) and never treated as a stable key across
 * refreshes: `view/OutlineTreeView.ts`'s existing `ensureSelection()`
 * fallback (exact id match -> highlightedId -> first visible node) is left
 * completely unchanged, so a paragraph selection that fails to re-resolve
 * after a re-parse simply degrades to that same existing fallback, never a
 * crash or a wrong-content selection — see design doc §4-2/§4-3.
 */
export interface OutlineTreeParagraphNode {
  kind: "paragraph";
  /** Temporary view identity — see this interface's own doc comment. Never persisted, never reused as a fold/selection key across refreshes. */
  id: string;
  /** 0-based start line of the paragraph's own range (matches `line` below). */
  rangeStart: number;
  /** 0-based end line (inclusive) of the paragraph's own range. */
  rangeEnd: number;
  /** The enclosing section id, the owning list item id, or null (headingless top-level) — parser/complexBlocks.ts's own resolveParentId contract (Phase 5P-1/5P-1R), unchanged here. */
  parentId: string | null;
  depth: number;
  label: string;
  /** Always true — a paragraph row is read-only navigation only (design doc §6). Also present in `collectReadOnlyOutlineNodeIds`'s output for the same reason; kept as an explicit field too so a consumer that only has one node in hand (not the whole readOnlyNodeIds Set) can still tell. */
  isReadOnly: true;
  /** Always true — a paragraph never has Tree children and is never fold-capable (design doc §4-2). */
  isLeaf: true;
  /** 0-based line of the paragraph's own first line (jump target) — always equal to `rangeStart`. */
  line: number;
  /** Always [] — see `isLeaf`. */
  children: OutlineTreeNode[];
}

export type OutlineTreeNode =
  | OutlineTreeSectionNode
  | OutlineTreeListNode
  | OutlineTreeCompositeNode
  | OutlineTreeComplexMemberNode
  | OutlineTreeParagraphNode;

export interface BuildOutlineTreeOptions {
  /**
   * Include list items as tree nodes alongside sections. Default false,
   * matching every prior phase's section-only tree. Does NOT gate
   * CompositeBlock projection (see `composites` below) — a list item that
   * is a matched composite's first member is shown regardless of this flag
   * (Phase 5D-0.3 approval §4).
   */
  includeLists?: boolean;
  /**
   * Phase 5D-0.3: project CompositeBlocks (model/compositeBlock.ts) already
   * matched against this EXACT `doc` — via parser/compositeBlocks.ts's
   * matchCompositeBlocks, itself run over parser/complexBlocks.ts's
   * scanComplexBlocks(doc) — as OutlineTreeCompositeNode/
   * OutlineTreeComplexMemberNode entries. This function does no scanning or
   * matching of its own (stays a pure projection over already-computed
   * inputs, matching this whole module's existing contract); omit this
   * option entirely (or pass `infos: []`) to get the pre-5D-0.3 tree
   * unchanged. `complexBlocksById` must contain every ComplexBlockInfo any
   * composite in `infos` references as a non-list member (typically
   * `scanComplexBlocks(doc).blocks`, keyed by `.id`); `rules` resolves each
   * composite's `ruleId` back to its prefix/display-label (typically
   * whatever rule list was passed to matchCompositeBlocks itself).
   *
   * NOT every entry in `infos` is guaranteed to actually be projected: a
   * composite whose members (or `ruleId`) don't cleanly resolve against
   * THIS `doc`/`complexBlocksById`/`rules` is silently skipped and its
   * members render as if it weren't a composite at all — see
   * `isCompositeSafelyProjectable` below (2026-08-12 amendment §A). This is
   * a no-op for the normal refresh() pipeline, where `infos` is always
   * matched against the exact same inputs passed here.
   */
  composites?: {
    infos: CompositeBlockInfo[];
    complexBlocksById: Map<string, ComplexBlockInfo>;
    rules: CompositeBlockRule[];
  };
  /** Translator for composite/complex-member display labels and fallback text. Defaults to English, same convention as every other optional `t` in this codebase. */
  t?: Translator;
  /**
   * Phase 5C-2 (2026-08-14): project STANDALONE callout/blockquote
   * ComplexBlockInfo entries (i.e. NOT already consumed as some
   * CompositeBlockInfo's own member — see `options.composites` above) as
   * section-level sibling OutlineTreeComplexMemberNode rows
   * (isStandalone: true). Independent of `composites`/`includeLists`: a
   * caller may pass this alone (composite matching disabled or unused) and
   * still get standalone callout/blockquote rows.
   *
   * `blocks` is typically the caller's own `scanComplexBlocks(doc).blocks`
   * — every ComplexBlockKind, not just callout/blockquote; this function
   * filters to callout/blockquote with `editability === "supported"`
   * itself (see isStandaloneComplexBlockEligible below), so passing the
   * full unfiltered scan result is both simplest for the caller and safest
   * (no risk of the caller's own filtering disagreeing with this module's).
   *
   * Phase 5C-2 (2026-08-14) originally projected EVERY callout/blockquote as
   * a SECTION-level sibling, even when its own `parentId` resolved to a
   * list item ("list itemの子としての表示は今回見送る...section直下へ委譲
   * して構いません"). Phase 5C-5 (2026-08-14, "Standalone Callout /
   * Blockquote の list 子表示") replaces that blanket delegation with a
   * DISPLAY-ONLY fix: a block whose `parentId` resolves to an actual list
   * item is now projected as that list item's own child (see
   * resolveStandaloneGroupKey/buildListNode below); only a block whose
   * `parentId` is a section (or null — top-of-document content) still
   * resolves via resolveEnclosingSectionId, unchanged from before. This is
   * purely a Tree-projection correction, not a parser change: parser/
   * complexBlocks.ts's own `resolveParentId` already correctly resolves a
   * list-owned block's parentId to that list item — see this ticket's own
   * investigation report — nothing in the parser layer changed for this.
   * No structural-edit capability is added either way: a list-child
   * complex-member row remains exactly as read-only as a section-level one
   * (readOnlyNodeIds, draggable-exclusion, move's own pre-existing
   * "nested-in-list" rejection in edit/moveStandaloneComplexBlock.ts — all
   * three untouched by this ticket).
   */
  standaloneComplexBlocks?: {
    blocks: ComplexBlockInfo[];
    /**
     * Phase 5E-0: widen isStandaloneComplexBlockEligible (below) to also
     * accept kind "fenced-code" (still gated by editability ===
     * "supported", exactly like callout/blockquote). Omitted/false is
     * byte-identical to every pre-Phase-5E-0 caller — mirrors the
     * `paragraphs` option's own "presence/flag is the gate, off by
     * default" convention. Independent of `includeTables` below per this
     * ticket's own confirmed "別々のスイッチ2つ" user decision.
     */
    includeFencedCode?: boolean;
    /** Phase 5E-0: the table counterpart of includeFencedCode above. */
    includeTables?: boolean;
  };
  /**
   * UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"):
   * settings.listPrefixStyle, threaded through to every buildListNode call
   * (including nested list items, and a list item reached via a composite
   * member — see buildMemberNode) so OutlineTreeListNode.prefix is resolved
   * ONCE at build time, matching how composite/complex-member prefixes are
   * already resolved here rather than at render time in
   * view/OutlineTreeView.ts (deliberately UNLIKE headingPrefixStyle, which
   * IS read at render time — see this ticket's own investigation report for
   * why list was given the build-time treatment instead: "設定値を直接View
   * に散在させず、Tree build 層で prefix を確定させる構造を優先してくださ
   * い"). Omitted (or "none") produces `prefix: null` on every list node,
   * i.e. the pre-UXP-04 tree shape.
   */
  listPrefixStyle?: ListPrefixStyle;
  /**
   * Phase 5P-3 (docs/phase5p3d_paragraph-tree-display-design.md): project
   * paragraph ComplexBlockInfo entries (kind "paragraph", editability
   * "supported") as OutlineTreeParagraphNode leaf rows. Omit this option
   * entirely (the default for every caller) to get byte-identical output to
   * before this phase — this is the "don't project when the setting is
   * off" design (§2-3): there is no separate on/off flag inside this
   * option, its mere PRESENCE is the gate, mirroring how
   * `standaloneComplexBlocks` above already works.
   *
   * `blocks` is typically the caller's own already-computed
   * `scanComplexBlocks(doc).blocks` — same convention as
   * `standaloneComplexBlocks.blocks`; this function filters to paragraph +
   * "supported" itself, so passing the full unfiltered scan result is both
   * simplest and safest for the caller.
   */
  paragraphs?: {
    blocks: ComplexBlockInfo[];
  };
}

/**
 * Phase 5P-3: shorthand for groupParagraphBlocks' return type, threaded
 * through buildChildren/buildListNode/buildCompositeNode/buildMemberNode
 * exactly like `standaloneByParentId`'s own (inline) map type, kept as a
 * named alias purely so each of those signatures doesn't repeat the full
 * three-field object type.
 */
type ParagraphByParentId = Map<
  string | null,
  { info: ComplexBlockInfo; label: string; viewId: string }[]
>;

/** Threaded through the recursive build below only when `options.composites` is set — see BuildOutlineTreeOptions.composites's doc comment. */
interface CompositeProjectionContext {
  /** Keyed by a ListBlockNode's own id — set only for ids that are some CompositeBlockInfo's members[0]. */
  firstMemberIdToComposite: Map<string, CompositeBlockInfo>;
  complexBlocksById: Map<string, ComplexBlockInfo>;
  rules: CompositeBlockRule[];
  t: Translator;
}

export function isOutlineSectionNode(
  node: OutlineTreeNode
): node is OutlineTreeSectionNode {
  return node.kind === "section";
}

export function isOutlineListNode(
  node: OutlineTreeNode
): node is OutlineTreeListNode {
  return node.kind === "list";
}

export function isOutlineCompositeNode(
  node: OutlineTreeNode
): node is OutlineTreeCompositeNode {
  return node.kind === "composite";
}

export function isOutlineComplexMemberNode(
  node: OutlineTreeNode
): node is OutlineTreeComplexMemberNode {
  return node.kind === "complex-member";
}

/** Phase 5P-3: see OutlineTreeParagraphNode's own doc comment. */
export function isOutlineParagraphNode(
  node: OutlineTreeNode
): node is OutlineTreeParagraphNode {
  return node.kind === "paragraph";
}

const LIST_ITEM_TEXT_RE = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+(.*))?$/;

/**
 * Item text with the leading indent and list marker stripped for display.
 * Exported so view/PartialEditView.ts (Phase 4C) can derive the same
 * short, one-line label for a list subtree's Partial Edit Pane header
 * without duplicating the marker-stripping regex.
 */
export function listItemDisplayText(doc: ParsedDocument, item: ListBlockNode): string {
  const raw = doc.lines[item.range.startLine] ?? "";
  const m = raw.match(LIST_ITEM_TEXT_RE);
  return (m?.[1] ?? raw).trim();
}

/**
 * 2026-08-12 "数字リストの番号非表示バグ" fix, UPDATED by UXP-04 (2026-08-15,
 * "Configurable List Marker Prefix Display"): originally this function
 * restored the ORDERED marker (item.listMarker — "1.", "2)", a mid-list
 * restart like "3.", ...) as a literal prefix baked directly into the
 * returned body string. UXP-04 moved that marker display into its own
 * independent field (OutlineTreeListNode.prefix, produced by
 * listPrefixText below) — the same "separate <span>, not mixed into the
 * body" architecture composite/complex-member prefixes already use — so
 * this function is now a pure pass-through: it returns `body` unchanged
 * regardless of `item.ordered`. Kept as its own named function (rather
 * than having callers just use listItemDisplayText's output directly)
 * purely so both of this function's own call sites (nodeDisplayLabel
 * below, and buildListNode's own `text` field) keep reading as "the
 * Tree/breadcrumb display text for a list item" without each needing its
 * own comment re-explaining that marker display now lives elsewhere.
 *
 * This DOES mean nodeDisplayLabel's output (also used for the ancestor
 * breadcrumb and the Partial Edit Pane's title — see that function's own
 * doc comment) no longer shows an ordered marker either, since breadcrumb/
 * title text has no independent prefix rendering slot to move it into.
 * This is a deliberate, in-scope consequence of UXP-04's own explicit
 * instruction to stop embedding the marker in body text at all — flagged
 * here, and in this ticket's own completion report, rather than left
 * silent.
 */
function listItemTreeDisplayText(item: ListBlockNode, body: string): string {
  void item;
  return body;
}

/**
 * UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"): pure
 * style -> prefix-string mapping for settings.listPrefixStyle, mirroring
 * headingPrefixText's own role for settings.headingPrefixStyle just above
 * it were it not for one deliberate difference — see
 * BuildOutlineTreeOptions.listPrefixStyle's doc comment for why this one is
 * resolved at TREE-BUILD time (buildListNode below) rather than at render
 * time in view/OutlineTreeView.ts.
 *
 * "none" returns `null` (not "", unlike headingPrefixText) so
 * OutlineTreeListNode.prefix's own `string | null` type directly expresses
 * "no prefix" without a separate empty-string sentinel — renderers skip the
 * prefix <span> entirely when this is `null` (or an empty/whitespace-only
 * string, defensively — see below), the same "no prefix -> no element at
 * all" pattern the composite/complex-member prefix spans already use.
 *
 * "marker" returns `item.listMarker` VERBATIM — never re-derived from the
 * raw source line, never normalized/renumbered, and never replaced with a
 * synthetic symbol (e.g. a shared "•" for every unordered marker) per this
 * ticket's own explicit "listMarker をそのまま表示する" /
 * "新しい共通記号を導入しない" requirements: the whole point is showing
 * exactly which marker character(s) the Markdown source actually uses. A
 * defensively-guarded empty/whitespace-only marker (should not occur from
 * real parsed data — parser/parseDocument.ts's own list-item regex requires
 * a non-empty marker — but not asserted against here, consistent with this
 * codebase's "resolve safely rather than throw" policy) falls back to
 * `null` rather than rendering a blank prefix element.
 */
export function listPrefixText(style: ListPrefixStyle, item: ListBlockNode): string | null {
  if (style !== "marker") return null;
  // Emptiness is checked against the TRIMMED marker, but the VERBATIM
  // (untrimmed) item.listMarker is what's returned — see this function's
  // own doc comment on why the marker is never altered before display.
  return item.listMarker.trim().length > 0 ? item.listMarker : null;
}

/**
 * Phase 5B: shared display label for a section or list node — the exact
 * same text view/PartialEditView.ts's pane title has used since Phase 4C
 * ("(Untitled heading)" / "(Empty list item)" fallbacks for an empty
 * heading/item), now extracted here so tree/ancestorPath.ts's breadcrumb
 * labels and PartialEditView's title can both call one function instead of
 * keeping two copies of the same fallback rule in sync by hand. Lives
 * alongside listItemDisplayText (which it delegates to for the list case)
 * rather than in edit/partialEdit.ts or PartialEditView.ts, since both of
 * this function's callers are themselves tree-shaped: the Outline Tree's
 * own node labels and the breadcrumb's ancestor labels are the same
 * concept.
 *
 * i18n実装 (2026-08-11): `t` is an OPTIONAL Translator (src/i18n.ts),
 * defaulting to `defaultTranslator` (English) so every pre-existing
 * caller/test that doesn't pass one keeps this function's original
 * English-by-default fallback text byte-for-byte — see
 * tests/buildOutlineTree.test.ts and tests/descendantPath.test.ts, both of
 * which call this (directly or via descendantPath.ts) with the
 * pre-existing 2-arg shape and still expect exact English fallback text.
 * Production callers (OutlineTreeView.ts, PartialEditView.ts,
 * ancestorPath.ts, descendantPath.ts) pass the plugin's own live
 * translator so these fallback labels follow the language setting too.
 */
export function nodeDisplayLabel(
  doc: ParsedDocument,
  node: BlockNode,
  t: Translator = defaultTranslator
): string {
  if (isSectionNode(node)) {
    return node.headingText.length > 0 ? node.headingText : t("tree.untitledHeading");
  }
  if (isListNode(node)) {
    const text = listItemTreeDisplayText(node, listItemDisplayText(doc, node));
    return text.length > 0 ? text : t("tree.emptyListItem");
  }
  return "";
}

/**
 * 2026-08-12 "Heading prefix 表示設定" ticket: pure level -> prefix-string
 * mapping for settings.headingPrefixStyle, used by view/OutlineTreeView.ts's
 * section-rendering branch to build an optional badge shown before a
 * section's heading text in the Outline Tree. Deliberately kept separate
 * from nodeDisplayLabel (whose plain-text output also feeds the rename
 * textarea and breadcrumb labels) — this is a display-only decoration,
 * never part of the editable/matchable label text, so it's returned as its
 * own string rather than folded into nodeDisplayLabel's output.
 *
 * "none" returns "" — OutlineTreeView.ts skips rendering the badge entirely
 * when this is empty, the same pattern already used for the composite-block
 * prefix. "hLevel" returns "H1".."H6" (uppercase, no trailing period).
 * "atx" returns the literal ATX marker run ("#".."######") with NO trailing
 * space — any separating space between the badge and the heading text is
 * the caller's (CSS/DOM) concern, not this string's.
 *
 * headingLevel is clamped to the 1-6 range parser/parseDocument.ts's own
 * HEADING_RE already enforces (`#{1,6}`), so out-of-range input cannot occur
 * from real parsed data — the clamp below is defensive only.
 */
export function headingPrefixText(style: HeadingPrefixStyle, headingLevel: number): string {
  const level = Math.min(6, Math.max(1, Math.round(headingLevel)));
  switch (style) {
    case "hLevel":
      return `H${level}`;
    case "atx":
      return "#".repeat(level);
    case "none":
    default:
      return "";
  }
}

/**
 * Phase 5D-0.3: strips a quote-prefixed line's leading `>` (+ following
 * whitespace) for display. Intentionally NOT byte-identical to
 * parser/complexBlocks.ts's own quote-handling regexes (this one only
 * strips one level and is display-only — never used for boundary
 * detection), so it lives here rather than being imported from that
 * scanner-only module.
 */
function stripQuotePrefixForDisplay(line: string): string {
  const m = line.match(/^[ \t]*>[ \t]?(.*)$/);
  return (m?.[1] ?? line).trim();
}

const CALLOUT_TITLE_RE = /^[ \t]*>[ \t]?\[!([^\]]+)\]([+-])?[ \t]*(.*)$/;

/**
 * Phase 5D-0.3: display label for a complex-block composite member
 * (callout/blockquote — see OutlineTreeComplexMemberNode's doc comment).
 * A callout prefers its own title text (the part after `[!type]`, e.g.
 * "> [!ocr] Scan 1" -> "Scan 1"); if there is none, or for any other quote-
 * prefixed kind (currently only "blockquote" reaches this function in
 * practice), the first non-empty body line with its `>` prefix stripped is
 * used instead ("既存の block label 推定規則を再利用" — the amendment's
 * instruction to reuse whatever heuristic already exists before falling
 * back).
 *
 * If every candidate line is empty, the fallback is now KIND-SPECIFIC
 * (2026-08-12 amendment §C) rather than one generic "(empty)" string: a
 * callout falls back to `t("tree.complexMember.calloutFallback")`
 * ("Callout"/"コールアウト") and a blockquote to
 * `t("tree.complexMember.blockquoteFallback")` ("Quote"/"引用"), so an
 * otherwise-unlabelable member row is still identifiable by KIND at a
 * glance rather than showing a content-free "(empty)". Any other
 * ComplexBlockKind that might reach this function in a future revision
 * (none do today — only callout/blockquote are ever composite-block
 * members) keeps the old generic `t("tree.emptyComplexMember")` fallback,
 * consistent with this whole codebase's "resolve safely, never guess"
 * policy for cases that aren't explicitly specified.
 */
export function complexMemberDisplayLabel(
  doc: ParsedDocument,
  info: ComplexBlockInfo,
  t: Translator = defaultTranslator
): string {
  const firstLine = doc.lines[info.range.startLine] ?? "";
  // A callout's own header line (`> [!type] title`) has already been fully
  // considered by the title check above — its remainder is either a real
  // title (returned immediately) or empty. Re-running the generic body-line
  // fallback over that SAME line would instead pick up the bracketed marker
  // itself (stripQuotePrefixForDisplay("> [!ocr]") -> "[!ocr]", a non-empty
  // string that is not real content), so the fallback loop for a callout
  // starts one line AFTER its header; a blockquote has no such header line
  // (every line is quote content), so it keeps starting at its own
  // range.startLine as before.
  let bodyStartLine = info.range.startLine;
  if (info.kind === "callout") {
    const m = firstLine.match(CALLOUT_TITLE_RE);
    const title = m?.[3]?.trim();
    if (title) return title;
    bodyStartLine += 1;
  }
  for (let l = bodyStartLine; l <= info.range.endLine; l++) {
    const body = stripQuotePrefixForDisplay(doc.lines[l] ?? "");
    if (body.length > 0) return body;
  }
  if (info.kind === "callout") return t("tree.complexMember.calloutFallback");
  if (info.kind === "blockquote") return t("tree.complexMember.blockquoteFallback");
  return t("tree.emptyComplexMember");
}

/**
 * Phase 5C-2 (2026-08-14): decorative prefixes for a STANDALONE
 * callout/blockquote row (isStandalone: true) — analogous to
 * CompositeBlockRule.prefix, but deliberately a separate, plain display
 * constant rather than a rule field: standalone rows have no
 * CompositeBlockRule of their own (they are, by definition, NOT a matched
 * composite), and this ticket's approved scope explicitly keeps the two
 * prefix concepts separate. Not i18n keys — these are decorative glyphs,
 * not translated text, matching how CompositeBlockRule.prefix ("◉"/"❖")
 * is also plain model data rather than an i18n key. Kept as named
 * constants (not inlined) so a future settings-driven override has one
 * place to redirect.
 */
export const STANDALONE_CALLOUT_PREFIX = "▣ ";
export const STANDALONE_BLOCKQUOTE_PREFIX = "❝ ";
/**
 * Phase 5E-0 ("Fenced Code Block / Markdown Table 読み取り専用 Outline
 * Tree 投影基盤"): the fenced-code/table counterparts of
 * STANDALONE_CALLOUT_PREFIX/STANDALONE_BLOCKQUOTE_PREFIX above — same
 * role (a decorative glyph for a STANDALONE row, isStandalone: true),
 * same "plain display constant, not an i18n key" convention. Chosen to
 * be visually distinct from every existing prefix/icon already in use
 * (▣ callout, ❝ blockquote, ◉/❖ composite rules, ¶ paragraph).
 */
export const STANDALONE_FENCED_CODE_PREFIX = "◫ ";
export const STANDALONE_TABLE_PREFIX = "▦ ";

/**
 * Phase 5C-2: maximum length (in characters) of a standalone
 * callout/blockquote's generated label (standaloneComplexBlockLabel,
 * below) before it is truncated with a trailing "…". Applied at the pure
 * label-generation layer (not left to CSS text-overflow alone, unlike the
 * list-row label — see buildListNode's `text` field) so a pathologically
 * long callout title or first body line can never produce an oversized
 * label value flowing into tests, tooltips, or any other consumer of this
 * string, not just the rendered DOM row.
 */
const STANDALONE_COMPLEX_LABEL_MAX_LENGTH = 80;

function truncateStandaloneLabel(label: string): string {
  if (label.length <= STANDALONE_COMPLEX_LABEL_MAX_LENGTH) return label;
  return label.slice(0, STANDALONE_COMPLEX_LABEL_MAX_LENGTH - 1).trimEnd() + "…";
}

/**
 * Phase 5C-2: `[!type]` -> a simple, safe-for-any-unknown-type display
 * name, per this ticket's approved "簡易整形で構わない" instruction — no
 * i18n dictionary of callout type names is introduced. Strips everything
 * except ASCII letters/digits/hyphen/underscore, splits on hyphen/
 * underscore runs, capitalizes each resulting word's first letter, and
 * rejoins with single spaces ("info-box" -> "Info Box", "TIP" -> "TIP",
 * "note" -> "Note"). Returns "" (never throws, never returns a
 * bracket/punctuation fragment) when the type string has nothing left
 * after stripping, so callers can safely treat "" as "no usable type name,
 * fall through to the next fallback tier".
 */
function formatCalloutTypeName(rawType: string): string {
  const cleaned = rawType.replace(/[^a-zA-Z0-9_-]/g, "");
  if (cleaned.length === 0) return "";
  return cleaned
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Phase 5C-2: display label for a STANDALONE callout/blockquote row —
 * deliberately a SEPARATE function from complexMemberDisplayLabel above,
 * not a wrapper around it, because the two fallback ORDERS genuinely
 * differ (this ticket's own approved spec):
 *
 *   callout:    title -> type display name -> first non-empty body line
 *               -> existing tree.complexMember.calloutFallback key
 *   blockquote: first non-empty body line -> existing
 *               tree.complexMember.blockquoteFallback key
 *
 * (complexMemberDisplayLabel's own order has no "type display name" tier
 * at all and must stay exactly as it is — it still drives every
 * composite-member row, which this ticket does not touch.) Reuses
 * CALLOUT_TITLE_RE and stripQuotePrefixForDisplay from
 * complexMemberDisplayLabel's own neighborhood rather than duplicating
 * either regex/helper. Truncation (truncateStandaloneLabel) is applied to
 * whichever tier's text is actually returned — never to the final
 * fallback-key text, which is always short by construction.
 *
 * Per-block-only: this function has no knowledge of sibling rows, so two
 * standalone blocks that happen to fall through to the exact same fallback
 * text (most commonly the kind-fallback tier) will get IDENTICAL labels
 * from this function alone — see disambiguateStandaloneLabels, below,
 * which is what actually appends a "#N" suffix when that happens within
 * one section's sibling group ("種別＋通番").
 */
export function standaloneComplexBlockLabel(
  doc: ParsedDocument,
  info: ComplexBlockInfo,
  t: Translator = defaultTranslator
): string {
  const firstLine = doc.lines[info.range.startLine] ?? "";
  if (info.kind === "callout") {
    const m = firstLine.match(CALLOUT_TITLE_RE);
    const title = m?.[3]?.trim();
    if (title) return truncateStandaloneLabel(title);
    const typeName = m?.[1] ? formatCalloutTypeName(m[1]) : "";
    if (typeName) return truncateStandaloneLabel(typeName);
    for (let l = info.range.startLine + 1; l <= info.range.endLine; l++) {
      const body = stripQuotePrefixForDisplay(doc.lines[l] ?? "");
      if (body.length > 0) return truncateStandaloneLabel(body);
    }
    return t("tree.complexMember.calloutFallback");
  }
  if (info.kind === "fenced-code") {
    return standaloneFencedCodeLabel(doc, info, t);
  }
  if (info.kind === "table") {
    return standaloneTableLabel(doc, info, t);
  }
  // Only "blockquote" remains — the four ComplexBlockKind values this
  // function is ever called with (isStandaloneComplexBlockEligible's own
  // allow-list): callout (handled above), fenced-code/table (handled
  // just above), and blockquote here.
  for (let l = info.range.startLine; l <= info.range.endLine; l++) {
    const body = stripQuotePrefixForDisplay(doc.lines[l] ?? "");
    if (body.length > 0) return truncateStandaloneLabel(body);
  }
  return t("tree.complexMember.blockquoteFallback");
}

/**
 * Phase 5E-0: display label for a STANDALONE fenced-code row — a
 * kind/language PREFIX (Mermaid/Dataview/DataviewJS get their own
 * literal, untranslated proper-noun-like prefix per this ticket's
 * approved spec; any other non-empty info string is used verbatim as
 * the prefix; an EMPTY info string falls back to the translated
 * "Code block" text as the prefix instead) followed by ": " and the
 * first non-empty, whitespace-normalized BODY line — i.e. never the
 * opening/closing fence line itself (the body scan runs strictly
 * between range.startLine+1 and range.endLine-1 inclusive). When the
 * body has no non-empty line at all (an empty code block), the prefix
 * alone is returned, matching callout/blockquote's own "kind name
 * alone" empty-body fallback shape. Never executes, renders, or
 * otherwise interprets the code body — this is plain string scanning,
 * exactly like every other standalone label tier in this file.
 */
function standaloneFencedCodeLabel(
  doc: ParsedDocument,
  info: ComplexBlockInfo,
  t: Translator
): string {
  const infoString = (info.infoString ?? "").trim();
  const lang = infoString.toLowerCase();
  const prefix =
    lang === "mermaid"
      ? "Mermaid"
      : lang === "dataview"
        ? "Dataview"
        : lang === "dataviewjs"
          ? "DataviewJS"
          : infoString.length > 0
            ? infoString
            : t("tree.complexMember.fencedCodeFallback");
  for (let l = info.range.startLine + 1; l < info.range.endLine; l++) {
    const body = normalizeParagraphLabelText(doc.lines[l] ?? "");
    if (body.length > 0) return truncateStandaloneLabel(`${prefix}: ${body}`);
  }
  return truncateStandaloneLabel(prefix);
}

/**
 * Phase 5E-0: a small, LOCAL, display-only pipe-row splitter —
 * deliberately NOT a reuse of parser/complexBlocks.ts's own private
 * splitTableRow (that module's scanner-tuned helper is not exported,
 * and this ticket's approved scope explicitly forbids introducing a
 * full table parser here just to generate a label: "ラベル生成のため
 * に完全な table parser を新設しない"). Strips one optional leading
 * and trailing `|`, splits on `|` (no escaped-pipe handling — a
 * deliberately simple, best-effort summary, never a correctness-
 * critical parse), normalizes each cell's whitespace, and drops empty
 * cells. Returns null (never `""` or an all-empty-cell array) when
 * there is nothing worth showing, so the caller can fall through to
 * the fixed "Table" label instead of a blank/near-blank one.
 */
function standaloneTableHeaderSummary(headerLine: string): string | null {
  let body = headerLine.trim();
  if (body.length === 0) return null;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  const cells = body
    .split("|")
    .map((c) => normalizeParagraphLabelText(c))
    .filter((c) => c.length > 0);
  if (cells.length === 0) return null;
  return cells.join(" / ");
}

/**
 * Phase 5E-0: display label for a STANDALONE table row —
 * "<Table>: <header column names, short summary>", or just the fixed,
 * translated "Table" label (standaloneTableHeaderSummary returning
 * null) when the header row cannot be safely/usefully summarized —
 * per this ticket's own "複雑なヘッダーを安全に要約できなければ
 * 'Table' 固定ラベルに戻す" requirement. `info.range.startLine` is
 * always the table's own header row (never the delimiter row below
 * it) — see parser/complexBlocks.ts#scanTableBlocks's own range
 * construction.
 */
function standaloneTableLabel(
  doc: ParsedDocument,
  info: ComplexBlockInfo,
  t: Translator
): string {
  const headerLine = doc.lines[info.range.startLine] ?? "";
  const summary = standaloneTableHeaderSummary(headerLine);
  const tableWord = t("tree.complexMember.tableFallback");
  if (!summary) return tableWord;
  return truncateStandaloneLabel(`${tableWord}: ${summary}`);
}

/**
 * Phase 5P-3: maximum length (in characters) of a paragraph Tree label
 * before truncation with a trailing "…" — the same 60-character budget
 * design doc §3-3 fixes (deliberately independent of
 * STANDALONE_COMPLEX_LABEL_MAX_LENGTH's 80, and of
 * resolver/resolveParagraphAtCursor.ts's own PREVIEW_MAX_LENGTH, which
 * happens to also be 60 but is a SEPARATE constant for a SEPARATE purpose —
 * see paragraphTreeLabel's own doc comment for why these two 60s are not
 * the same value merely coinciding).
 */
export const PARAGRAPH_LABEL_MAX_LENGTH = 60;

/**
 * Phase 5P-3: collapses every run of whitespace — including embedded
 * newlines, per this ticket's explicit "改行・連続空白は単一空白へ正規化す
 * る" requirement — into a single space, and trims the result. A Tree row
 * is one line; a multi-line paragraph's raw text cannot be shown as-is
 * without visually breaking the row.
 */
function normalizeParagraphLabelText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Phase 5P-3: true when `s` contains at least one letter or digit (any
 * script — `\p{L}`/`\p{N}` are Unicode property escapes, not
 * ASCII-only), i.e. `s` is neither empty nor made up only of punctuation/
 * symbols/whitespace. Used to decide whether a normalized preview is
 * "worth showing" or should fall through to the `段落 N` fallback — per
 * this ticket's explicit "空白だけの内容、記号だけの内容、ラベル抽出不能
 * 時は「段落 N」にフォールバックする" requirement.
 */
function isParagraphLabelWorthy(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

function truncateParagraphLabel(label: string): string {
  if (label.length <= PARAGRAPH_LABEL_MAX_LENGTH) return label;
  return label.slice(0, PARAGRAPH_LABEL_MAX_LENGTH - 1).trimEnd() + "…";
}

/**
 * Phase 5P-3: display label for a paragraph Tree row. Deliberately a NEW
 * function, not a reuse of resolver/resolveParagraphAtCursor.ts's own
 * (unexported) buildPreview — that helper only looks at a paragraph's
 * FIRST LINE (a Partial Edit Pane title has no room for more and no
 * newline-collapsing need, since it's read from `text.split("\n", 1)[0]`),
 * whereas a Tree label must first collapse a multi-line paragraph's
 * embedded newlines/runs of whitespace into one line (this ticket's own
 * normalization requirement) — a genuinely different rule, not just a
 * different call site for the same one. Two different 60-character caps
 * that happen to share the same number is coincidence, not a shared
 * constant, since the two functions round/trim different source text
 * (first line only vs. the whole normalized paragraph).
 *
 * This function's output is DISPLAY-ONLY: it is never read back by
 * resolver/resolveParagraphAtCursor.ts or edit/paragraphPartialEdit.ts —
 * paragraph identity/Apply safety is entirely independent of this label
 * (design doc §3-3's own "preview の表示は Tree 専用であり、5P-2 の Apply
 * anchor / paragraph 同一性判定には使わない" requirement), and this
 * function never mutates or returns anything derived that could
 * accidentally be mistaken for editable body text.
 *
 * `<!-- uo-title: ... -->` is deliberately NOT read here — see
 * docs/phase5p3d_paragraph-tree-display-design.md §3-2. Under the current
 * parser/complexBlocks.ts boundary rules (scanParagraphBlocks' `isCandidate`
 * treats an HTML comment line exactly like any other body line), a
 * uo-title comment placed immediately above a paragraph with no blank-line
 * separator MERGES into that paragraph's own text range rather than
 * staying a separate, safely associable title line — so honoring it here
 * would either display the paragraph's own body text as if it were a
 * distinct title, or misattribute an unrelated stray HTML comment that
 * happens to precede unrelated text as that paragraph's "title". 5P-3D
 * concluded there is no safe association rule available without changing
 * scanParagraphBlocks' boundary contract, which is out of this phase's
 * scope (5P-1/5P-1R's boundary rules are a separately-reviewed, tested
 * contract) — so this function always starts at label priority tier 2
 * (normalized preview), falling through to tier 3 (`段落 N`) only when
 * tier 2 has nothing label-worthy.
 */
export function paragraphTreeLabel(text: string, ordinal: number, t: Translator): string {
  const normalized = normalizeParagraphLabelText(text);
  if (isParagraphLabelWorthy(normalized)) {
    return truncateParagraphLabel(normalized);
  }
  return t("tree.paragraphFallback", { n: ordinal });
}

/**
 * Phase 5P-3: `id` is NEVER the underlying ComplexBlockInfo's own
 * scan-local `complexBlockId` — see OutlineTreeParagraphNode.id's own doc
 * comment. `n` is `paragraphOrdinalById`'s already-unique, document-order
 * ordinal (see buildParagraphOrdinals below), so `tree-paragraph:${n}` is
 * guaranteed unique within one buildOutlineTree() call without any
 * separately-threaded mutable counter, and the colon-based format can never
 * collide with any other node kind's own id format in this file
 * (`sec-N`/`li-N`, or a raw dash-based ComplexBlockInfo id reused verbatim
 * by a composite/complex-member row).
 */
export function paragraphViewId(n: number): string {
  return `tree-paragraph:${n}`;
}

/**
 * Phase 5P-3: `段落 N` fallback numbering is a DOCUMENT-WIDE ordinal — "the
 * Nth eligible paragraph in the whole document, in document order" — not
 * scoped per parent group, so a paragraph's fallback number stays stable
 * (until the document's own paragraph count/order actually changes)
 * regardless of which section/list item it happens to land under. This is
 * also reused, unchanged, as the numeric suffix of paragraphViewId's view
 * identity (see that function's own doc comment) — one pass serves both
 * needs.
 */
export function buildParagraphOrdinals(blocks: ComplexBlockInfo[]): Map<string, number> {
  const eligible = blocks
    .filter((b) => b.kind === "paragraph" && b.editability === "supported")
    .slice()
    .sort((a, b) => a.range.startLine - b.range.startLine);
  const map = new Map<string, number>();
  eligible.forEach((info, idx) => map.set(info.id, idx + 1));
  return map;
}

/**
 * Phase 5C-2: `info.kind` is callout/blockquote AND `info.editability ===
 * "supported"` — the ONLY ComplexBlockInfo values this ticket ever
 * projects as a standalone Tree row. "read-only"/"unsupported"/"ambiguous"
 * are all deliberately excluded (this ticket's own approved instruction:
 * "誤表示しない、を最優先できる" — a boundary this phase isn't fully
 * confident about is simply not shown, never shown-but-disabled). Every
 * other ComplexBlockKind (fenced-code/table/paragraph/thematic-break) is
 * out of scope for this ticket and excluded unconditionally.
 */
function isStandaloneComplexBlockEligible(
  info: ComplexBlockInfo,
  includeFencedCode: boolean,
  includeTables: boolean
): boolean {
  if (info.editability !== "supported") return false;
  if (info.kind === "callout" || info.kind === "blockquote") return true;
  // Phase 5E-0: fenced-code/table are each independently opt-in — see
  // BuildOutlineTreeOptions.standaloneComplexBlocks.includeFencedCode/
  // includeTables's own doc comments. Every other ComplexBlockKind
  // (paragraph/thematic-break) remains unconditionally excluded here,
  // exactly as before this ticket — paragraph has its own entirely
  // separate projection path (groupParagraphBlocks), and thematic-break
  // has no standalone Tree row of any kind, by design.
  if (info.kind === "fenced-code") return includeFencedCode;
  if (info.kind === "table") return includeTables;
  return false;
}

/**
 * Phase 5C-2: walks a ComplexBlockInfo's own `parentId` chain up to the
 * nearest enclosing SECTION, or null (top-of-document, no enclosing
 * heading) — mirroring parser/compositeBlocks.ts's own
 * resolveMemberSectionId, reimplemented locally rather than imported for
 * the same reason that function's own doc comment gives (keeping this
 * layer independent of parser/*'s internals; this module already has its
 * own equally small copy of that walk-up pattern, so a second small copy
 * here is consistent with the existing precedent rather than a new one).
 * This is what implements this ticket's approved "list itemの子としての
 * 表示は今回見送る...section直下へ委譲" decision: a callout/blockquote
 * whose OWN parentId is a list item still resolves here to that list
 * item's OWN enclosing section, not to the list item itself.
 */
function resolveEnclosingSectionId(doc: ParsedDocument, parentId: string | null): string | null {
  let id: string | null = parentId;
  const visited = new Set<string>();
  while (id) {
    if (visited.has(id)) return null; // defensive: never trust a cycle
    visited.add(id);
    const node = doc.nodes.get(id);
    if (!node) return null;
    if (node.type === "section") return node.id;
    id = node.parentId;
  }
  return null;
}

/**
 * Phase 5C-2: appends a "#N" suffix ("種別＋通番") to any label that
 * exactly duplicates an earlier sibling's label within the same group
 * (always one section's worth of standalone entries — see
 * groupStandaloneComplexBlocks, below, which is the only caller). Applied
 * generically to ANY duplicate, not specifically to blocks that hit the
 * kind-fallback tier — in practice that tier (a short, kind-only string
 * like "Callout") is overwhelmingly the one that repeats, since a real
 * title/type-name/body-summary is very unlikely to collide by accident,
 * but this function does not need to know or care which tier produced a
 * given label. Numbering is 1-based and restarts at 1 for each distinct
 * label value, in the group's own document order (the caller is expected
 * to have already sorted `entries` by line).
 */
function disambiguateStandaloneLabels(
  entries: { info: ComplexBlockInfo; label: string }[]
): Map<string, string> {
  const totalByLabel = new Map<string, number>();
  for (const e of entries) totalByLabel.set(e.label, (totalByLabel.get(e.label) ?? 0) + 1);

  const runningIndexByLabel = new Map<string, number>();
  const finalLabelById = new Map<string, string>();
  for (const e of entries) {
    const total = totalByLabel.get(e.label) ?? 1;
    if (total <= 1) {
      finalLabelById.set(e.info.id, e.label);
      continue;
    }
    const nextIndex = (runningIndexByLabel.get(e.label) ?? 0) + 1;
    runningIndexByLabel.set(e.label, nextIndex);
    finalLabelById.set(e.info.id, `${e.label} #${nextIndex}`);
  }
  return finalLabelById;
}

/**
 * Phase 5C-5: the grouping KEY for one standalone ComplexBlockInfo — its own
 * `parentId` directly, when that id resolves in `doc.nodes` to an actual
 * ListBlockNode (so buildListNode, below, can later attach it as that list
 * item's own child); otherwise falls through to the pre-existing
 * resolveEnclosingSectionId walk (section id, or null for top-of-document
 * content), completely UNCHANGED from Phase 5C-2's original behavior for
 * every block whose parentId is a section or null. This is the one place
 * this ticket's "list itemの子としての表示" decision is actually made —
 * everything downstream (buildChildren/buildListNode) just merges whatever
 * key groupStandaloneComplexBlocks produced.
 */
function resolveStandaloneGroupKey(doc: ParsedDocument, parentId: string | null): string | null {
  if (parentId) {
    const parentNode = doc.nodes.get(parentId);
    if (parentNode && isListNode(parentNode)) return parentId;
  }
  return resolveEnclosingSectionId(doc, parentId);
}

/**
 * Phase 5C-2, generalized by Phase 5C-5: groups every ELIGIBLE, non-
 * composite-member ComplexBlockInfo in `blocks` by resolveStandaloneGroupKey
 * — a LIST ITEM id when the block's own parentId resolves to one, otherwise
 * its resolved enclosing section id (or null) exactly as before Phase 5C-5
 * — sorted by line within each group, with disambiguateStandaloneLabels
 * already applied (scoped to each group independently, list-item groups and
 * section groups alike). The exact, ready-to-render `{info, label}[]` list
 * buildChildren (section/top-level groups) and buildListNode (list-item
 * groups) each merge in for their own respective key.
 * `consumedComplexBlockIds` is every ComplexBlockInfo id already used as
 * some CompositeBlockInfo's own (non-list) member — see buildOutlineTree's
 * own construction of that set — so a callout/blockquote that's already
 * shown as a composite's own read-only child is never ALSO shown as a
 * second, standalone row for the same underlying content (this exclusion
 * itself is unchanged by Phase 5C-5).
 */
function groupStandaloneComplexBlocks(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  consumedComplexBlockIds: Set<string>,
  t: Translator,
  includeFencedCode: boolean,
  includeTables: boolean
): Map<string | null, { info: ComplexBlockInfo; label: string }[]> {
  const byParentKey = new Map<string | null, ComplexBlockInfo[]>();
  for (const info of blocks) {
    if (!isStandaloneComplexBlockEligible(info, includeFencedCode, includeTables)) continue;
    if (consumedComplexBlockIds.has(info.id)) continue;
    const groupKey = resolveStandaloneGroupKey(doc, info.parentId);
    const list = byParentKey.get(groupKey) ?? [];
    list.push(info);
    byParentKey.set(groupKey, list);
  }

  const result = new Map<string | null, { info: ComplexBlockInfo; label: string }[]>();
  for (const [groupKey, infos] of byParentKey) {
    infos.sort((a, b) => a.range.startLine - b.range.startLine);
    const labeled = infos.map((info) => ({ info, label: standaloneComplexBlockLabel(doc, info, t) }));
    const finalLabelById = disambiguateStandaloneLabels(labeled);
    result.set(
      groupKey,
      infos.map((info) => ({ info, label: finalLabelById.get(info.id) ?? "" }))
    );
  }
  return result;
}

/**
 * Phase 5C-2: projects one standalone (isStandalone: true) callout/
 * blockquote into an OutlineTreeComplexMemberNode — the prefix-bearing
 * counterpart to buildMemberNode's composite-member construction (which
 * always sets isStandalone: false and prefix: undefined). `label` is
 * already fully resolved (standaloneComplexBlockLabel +
 * disambiguateStandaloneLabels, both applied by groupStandaloneComplexBlocks
 * before this is ever called) — this function does no label computation
 * of its own.
 */
function buildStandaloneComplexNode(
  info: ComplexBlockInfo,
  label: string
): OutlineTreeComplexMemberNode {
  return {
    kind: "complex-member",
    id: info.id,
    complexKind: info.kind,
    label,
    prefix:
      info.kind === "callout"
        ? STANDALONE_CALLOUT_PREFIX
        : info.kind === "blockquote"
          ? STANDALONE_BLOCKQUOTE_PREFIX
          : info.kind === "fenced-code"
            ? STANDALONE_FENCED_CODE_PREFIX
            : STANDALONE_TABLE_PREFIX,
    isStandalone: true,
    line: info.range.startLine,
    children: [],
  };
}

/**
 * Phase 5P-3: paragraph counterpart of groupStandaloneComplexBlocks above —
 * deliberately a SEPARATE function (not a generalization of that one), per
 * docs/phase5p3d_paragraph-tree-display-design.md §5-1's explicit
 * "paragraph 用の専用分岐または明示的な kind 分岐として実装すること"
 * instruction: a paragraph must never be merged into the SAME candidate
 * pool as callout/blockquote, because that pool feeds
 * buildStandaloneComplexNode, which unconditionally tags every entry
 * `kind: "complex-member"` — see OutlineTreeParagraphNode's own doc comment
 * for why a paragraph must never carry that kind. Reusing
 * resolveStandaloneGroupKey itself (not the whole grouping function) is
 * fine: that helper is generic over any ComplexBlockInfo's own `parentId`,
 * with no complex-block-specific knowledge of its own — reusing it here is
 * exactly the "share the small pure parentId-resolution helper, keep the
 * node-kind-specific parts independent" split the design doc calls for.
 *
 * Unlike groupStandaloneComplexBlocks, there is no
 * disambiguateStandaloneLabels step here: the `段落 N` fallback label is
 * already a document-wide, globally unique ordinal (paragraphOrdinalById —
 * see buildParagraphOrdinals), so it can never collide with another
 * paragraph's fallback label regardless of grouping. Two paragraphs CAN
 * still end up with the identical label if their own PREVIEW text
 * genuinely is byte-identical — that is accepted as a purely cosmetic
 * consequence (design doc §4: paragraph identity never depends on its
 * label), not a disambiguation this phase needs to add.
 */
function groupParagraphBlocks(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  paragraphOrdinalById: Map<string, number>,
  t: Translator
): Map<string | null, { info: ComplexBlockInfo; label: string; viewId: string }[]> {
  const byParentKey = new Map<string | null, ComplexBlockInfo[]>();
  for (const info of blocks) {
    if (info.kind !== "paragraph" || info.editability !== "supported") continue;
    const groupKey = resolveStandaloneGroupKey(doc, info.parentId);
    const list = byParentKey.get(groupKey) ?? [];
    list.push(info);
    byParentKey.set(groupKey, list);
  }

  const result = new Map<string | null, { info: ComplexBlockInfo; label: string; viewId: string }[]>();
  for (const [groupKey, infos] of byParentKey) {
    infos.sort((a, b) => a.range.startLine - b.range.startLine);
    result.set(
      groupKey,
      infos.map((info) => {
        const text = doc.lines.slice(info.range.startLine, info.range.endLine + 1).join("\n");
        const ordinal = paragraphOrdinalById.get(info.id) ?? 0;
        return {
          info,
          label: paragraphTreeLabel(text, ordinal, t),
          viewId: paragraphViewId(ordinal),
        };
      })
    );
  }
  return result;
}

/**
 * Phase 5P-3: projects one paragraph ComplexBlockInfo into an
 * OutlineTreeParagraphNode. `label`/`viewId` are already fully resolved
 * (groupParagraphBlocks, above, calls paragraphTreeLabel/paragraphViewId
 * before this is ever called) — this function does no label/id computation
 * of its own, mirroring buildStandaloneComplexNode's own shape.
 */
function buildParagraphTreeNode(
  doc: ParsedDocument,
  info: ComplexBlockInfo,
  label: string,
  viewId: string
): OutlineTreeParagraphNode {
  return {
    kind: "paragraph",
    id: viewId,
    rangeStart: info.range.startLine,
    rangeEnd: info.range.endLine,
    parentId: info.parentId,
    depth: complexBlockDepth(doc, info.parentId),
    label,
    isReadOnly: true,
    isLeaf: true,
    line: info.range.startLine,
    children: [],
  };
}

/**
 * Phase 5D-0.3: projects one CompositeBlockMember into an OutlineTreeNode.
 * A "list"/"single-line-list" member reuses buildListNode verbatim (same
 * id, same recursive nested-list handling, including further nested
 * composites — see buildListNode's own composite check below), so it keeps
 * every existing capability the Tree already gives a plain list row
 * EXCEPT what the Phase 5D-0.3 approval explicitly withholds from composite
 * children — see OutlineTreeView.ts's renderNode for where that
 * read-only-while-inside-a-composite restriction is actually enforced (this
 * function only builds the DATA node; it carries no interactivity of its
 * own). Any other member kind (callout/blockquote today) becomes a
 * read-only OutlineTreeComplexMemberNode with no children of its own.
 */
function buildMemberNode(
  doc: ParsedDocument,
  member: CompositeBlockMember,
  ctx: CompositeProjectionContext,
  standaloneByParentId?: Map<string | null, { info: ComplexBlockInfo; label: string }[]>,
  listPrefixStyle: ListPrefixStyle = "none",
  paragraphByParentId?: ParagraphByParentId
): OutlineTreeNode {
  if (member.kind === "list" || member.kind === "single-line-list") {
    const node = doc.nodes.get(member.id);
    if (node && isListNode(node)) {
      return buildListNode(doc, node, ctx, standaloneByParentId, listPrefixStyle, paragraphByParentId);
    }
  }
  const info = ctx.complexBlocksById.get(member.id);
  // 2026-08-12 self-review §9 論点5: `info` is falsy only for a member that
  // isCompositeSafelyProjectable (buildOutlineTree, below) should already
  // have rejected — this function is only ever reached via a composite that
  // already passed that check, so this `member.id` raw-id fallback is not
  // exercised by any input that reaches here through buildOutlineTree's own
  // public entry point today. Left in place (not asserted/thrown) as
  // defense-in-depth against a future refactor that calls buildCompositeNode/
  // buildMemberNode from somewhere else without going through that gate.
  const label = info ? complexMemberDisplayLabel(doc, info, ctx.t) : member.id;
  // Phase 5D-1L: a callout member gets the exact same decorative prefix a
  // STANDALONE callout row gets (STANDALONE_CALLOUT_PREFIX, "▣ ") — reused
  // verbatim, not a new icon — so the same callout block reads as the same
  // kind of thing whether it's shown on its own or grouped inside a
  // CompositeBlock (see this ticket's own approved scope).
  //
  // Phase 5D-2B: a blockquote member gets the same treatment, reusing the
  // exact same STANDALONE_BLOCKQUOTE_PREFIX constant ("❝ ") a STANDALONE
  // blockquote row gets. This is the same existing OutlineTreeComplexMemberNode
  // .prefix field / OutlineTreeView.ts isComplexMember render branch /
  // unified-outliner-complex-member-prefix CSS class already used for the
  // callout case above — no new constant, node type, render branch, or CSS
  // was introduced. It coexists with the CompositeBlock parent's own "❖"
  // prefix without collision, since the two render on separate Tree nodes
  // (parent row vs. this member row). `member.kind` (not `info.kind`)
  // drives this check for the same reason `complexKind` right below already
  // does — see this function's own existing cast.
  const prefix =
    member.kind === "callout"
      ? STANDALONE_CALLOUT_PREFIX
      : member.kind === "blockquote"
        ? STANDALONE_BLOCKQUOTE_PREFIX
        : undefined;
  return {
    kind: "complex-member",
    id: member.id,
    complexKind: member.kind as ComplexBlockKind,
    label,
    prefix,
    isStandalone: false,
    line: member.range.startLine,
    children: [],
  };
}

/**
 * Phase 5D-0.3: projects one CompositeBlockInfo into an OutlineTreeCompositeNode.
 * `label`/`prefix` are resolved from the matching CompositeBlockRule in
 * `ctx.rules` (the same rule list the caller passed to matchCompositeBlocks
 * — see BuildOutlineTreeOptions.composites's doc comment); a `ruleId` with
 * no matching rule (should not happen in practice — every CompositeBlockInfo
 * was produced BY one of `ctx.rules`) falls back to the raw ruleId/no
 * prefix rather than throwing, consistent with this whole codebase's
 * "resolve safely" policy.
 */
/**
 * Phase 5C-5: `standaloneByParentId` is threaded all the way down here (and
 * on into buildMemberNode -> buildListNode below) SOLELY so a standalone
 * complex block nested inside one of THIS composite's own member list
 * item's further-nested child list items keeps being displayed exactly as
 * it was before this ticket (via buildListNode's own merge, once that
 * nested list item is reached) — see buildListNode's own doc comment. This
 * is plumbing only: composite matching, movability, deletability, and
 * Partial-Edit exclusion for composite members are all completely
 * unchanged by this ticket.
 */
function buildCompositeNode(
  doc: ParsedDocument,
  composite: CompositeBlockInfo,
  ctx: CompositeProjectionContext,
  standaloneByParentId?: Map<string | null, { info: ComplexBlockInfo; label: string }[]>,
  listPrefixStyle: ListPrefixStyle = "none",
  paragraphByParentId?: ParagraphByParentId
): OutlineTreeCompositeNode {
  const rule = getCompositeBlockRuleById(ctx.rules, composite.ruleId);
  return {
    kind: "composite",
    id: composite.id,
    ruleId: composite.ruleId,
    label: rule ? compositeBlockDisplayLabel(rule, ctx.t) : composite.ruleId,
    prefix: rule?.prefix ?? "",
    line: composite.range.startLine,
    children: composite.members.map((m) =>
      buildMemberNode(doc, m, ctx, standaloneByParentId, listPrefixStyle, paragraphByParentId)
    ),
  };
}

/**
 * Phase 5C-5: standalone complex blocks whose own `parentId` resolves to
 * THIS list item (per groupStandaloneComplexBlocks' resolveStandaloneGroupKey)
 * are merged into `children` alongside nested list items / composites,
 * sorted into document order together — the list-item counterpart of
 * buildChildren's own section-level merge below. `standaloneByParentId` is
 * optional and defaults to no merge (undefined -> `?.get(item.id) ?? []`
 * -> empty), so every pre-Phase-5C-5 caller that doesn't pass it gets
 * byte-identical behavior to before this ticket.
 *
 * Sorting by line (previously this function just pushed nested list items
 * in `item.childIds` order, which is already document order by
 * construction — see parser/parseDocument.ts) is now REQUIRED rather than
 * incidental, since a merged-in standalone entry is not part of
 * `item.childIds` at all and must be interleaved by its own line number —
 * mirrors buildChildren's own pre-existing sort for exactly the same
 * reason.
 */
function buildListNode(
  doc: ParsedDocument,
  item: ListBlockNode,
  ctx?: CompositeProjectionContext,
  standaloneByParentId?: Map<string | null, { info: ComplexBlockInfo; label: string }[]>,
  listPrefixStyle: ListPrefixStyle = "none",
  paragraphByParentId?: ParagraphByParentId
): OutlineTreeListNode {
  const withLine: Array<{ node: OutlineTreeNode; line: number }> = [];
  for (const id of item.childIds) {
    const child = doc.nodes.get(id);
    // Nested list items only — a list item never owns a section.
    if (!child || !isListNode(child)) continue;
    // Phase 5D-0.3: a nested list item that is itself some composite's
    // first member is projected as that composite instead of a plain list
    // row — same substitution buildChildren applies at the root/section
    // level below, mirrored here so a composite can be reached at any
    // nesting depth once its own ancestor chain is already visible.
    const composite = ctx?.firstMemberIdToComposite.get(child.id);
    withLine.push({
      node: composite
        ? buildCompositeNode(doc, composite, ctx!, standaloneByParentId, listPrefixStyle, paragraphByParentId)
        : buildListNode(doc, child, ctx, standaloneByParentId, listPrefixStyle, paragraphByParentId),
      line: child.range.startLine,
    });
  }
  for (const { info, label } of standaloneByParentId?.get(item.id) ?? []) {
    withLine.push({ node: buildStandaloneComplexNode(info, label), line: info.range.startLine });
  }
  // Phase 5P-3: paragraph children of THIS list item (a paragraph indented
  // to the item's own content-start column — Phase 5P-1's contract),
  // merged in exactly like the standalone-complex-block merge just above —
  // see groupParagraphBlocks' own doc comment for why this is a separate
  // loop over a separate map rather than folding paragraph into the
  // standalone loop above.
  for (const { info, label, viewId } of paragraphByParentId?.get(item.id) ?? []) {
    withLine.push({
      node: buildParagraphTreeNode(doc, info, label, viewId),
      line: info.range.startLine,
    });
  }
  withLine.sort((a, b) => a.line - b.line);
  return {
    kind: "list",
    id: item.id,
    text: listItemTreeDisplayText(item, listItemDisplayText(doc, item)),
    prefix: listPrefixText(listPrefixStyle, item),
    indentDepth: item.depth,
    line: item.range.startLine,
    children: withLine.map((x) => x.node),
  };
}

function buildSectionNode(
  doc: ParsedDocument,
  section: SectionBlockNode,
  includeLists: boolean,
  ctx?: CompositeProjectionContext,
  standaloneByParentId?: Map<string | null, { info: ComplexBlockInfo; label: string }[]>,
  listPrefixStyle: ListPrefixStyle = "none",
  paragraphByParentId?: ParagraphByParentId
): OutlineTreeSectionNode {
  return {
    kind: "section",
    id: section.id,
    headingText: section.headingText,
    headingLevel: section.headingLevel,
    line: section.range.startLine,
    children: buildChildren(
      doc,
      section.childIds,
      includeLists,
      section.id,
      ctx,
      standaloneByParentId,
      listPrefixStyle,
      paragraphByParentId
    ),
  };
}

/**
 * Resolve `ids` (a section's childIds, or doc.topLevelIds) into tree nodes,
 * re-sorted by line number since childIds itself does not preserve document
 * order once sections and list items are mixed (see class doc comment).
 * Every list item reachable this way is already a root item (depth 0) by
 * construction — parseDocument.ts only ever pushes root items into a
 * section's childIds / topLevelIds; nested items live under their parent
 * item's own childIds instead (see buildListNode).
 *
 * Phase 5D-0.3: a list item that is some composite's first member is
 * projected as that OutlineTreeCompositeNode INSTEAD of a plain list row,
 * regardless of `includeLists` (approval §4 — composite projection is
 * controlled solely by each CompositeBlockRule's own enabled flag, which
 * already determined whether `ctx.firstMemberIdToComposite` even has an
 * entry for this id; this function does not re-check settings itself). A
 * plain (non-composite) list item still follows `includeLists` exactly as
 * before.
 *
 * Phase 5C-2 (2026-08-14), key generalized by Phase 5C-5: `sectionId` (this
 * call's own enclosing section id, or null for the top-level call) is
 * looked up in `standaloneByParentId` — already fully grouped/labeled by
 * groupStandaloneComplexBlocks, keyed by resolveStandaloneGroupKey — and
 * any entries found are merged in as additional OutlineTreeComplexMemberNode
 * children, sorted into document order alongside every other child exactly
 * like a composite or plain list row already is. Only entries whose group
 * key IS this section (or null, at the top level) are ever found here — a
 * list-item-keyed entry is instead picked up by buildListNode's own merge,
 * once that list item is reached. Independent of `includeLists`/`ctx` (a
 * standalone callout/blockquote is not a BlockNode-backed row at all, so
 * neither flag is relevant to it). `standaloneByParentId` is also passed
 * down into buildListNode/buildCompositeNode below so the SAME map serves
 * every nesting depth, not just this call's own direct children.
 */
function buildChildren(
  doc: ParsedDocument,
  ids: string[],
  includeLists: boolean,
  sectionId: string | null,
  ctx?: CompositeProjectionContext,
  standaloneByParentId?: Map<string | null, { info: ComplexBlockInfo; label: string }[]>,
  listPrefixStyle: ListPrefixStyle = "none",
  paragraphByParentId?: ParagraphByParentId
): OutlineTreeNode[] {
  const withLine: Array<{ node: OutlineTreeNode; line: number }> = [];
  for (const id of ids) {
    const child = doc.nodes.get(id);
    if (!child) continue;
    if (isSectionNode(child)) {
      withLine.push({
        node: buildSectionNode(
          doc,
          child,
          includeLists,
          ctx,
          standaloneByParentId,
          listPrefixStyle,
          paragraphByParentId
        ),
        line: child.range.startLine,
      });
      continue;
    }
    if (!isListNode(child)) continue;
    const composite = ctx?.firstMemberIdToComposite.get(child.id);
    if (composite) {
      withLine.push({
        node: buildCompositeNode(doc, composite, ctx!, standaloneByParentId, listPrefixStyle, paragraphByParentId),
        line: composite.range.startLine,
      });
    } else if (includeLists) {
      withLine.push({
        node: buildListNode(doc, child, ctx, standaloneByParentId, listPrefixStyle, paragraphByParentId),
        line: child.range.startLine,
      });
    }
  }
  for (const { info, label } of standaloneByParentId?.get(sectionId) ?? []) {
    withLine.push({ node: buildStandaloneComplexNode(info, label), line: info.range.startLine });
  }
  // Phase 5P-3: paragraph children whose resolved group key IS this section
  // (or null, at the top level) — same shape as the standalone-complex-block
  // merge just above, kept as its own loop over its own map (see
  // groupParagraphBlocks' own doc comment for why).
  for (const { info, label, viewId } of paragraphByParentId?.get(sectionId) ?? []) {
    withLine.push({
      node: buildParagraphTreeNode(doc, info, label, viewId),
      line: info.range.startLine,
    });
  }
  withLine.sort((a, b) => a.line - b.line);
  return withLine.map((x) => x.node);
}

/**
 * 2026-08-12 amendment §A: "同一 section 内であっても、member が安全に一つの
 * 親投影位置を共有できない場合は、CompositeBlock を Tree に投影しない。基本
 * block 表示へ安全にフォールバックすること。" A CompositeBlock's Tree
 * position is entirely inherited from its FIRST member (see buildChildren/
 * buildListNode's substitution — the composite replaces whatever tree slot
 * the first member would otherwise occupy), so that inheritance is only
 * well-defined when:
 *
 *   1. the first member is itself a list kind (only a ListBlockNode has an
 *      independent Tree parent/position to inherit at all — a callout or
 *      blockquote has none, see OutlineTreeComplexMemberNode's doc comment),
 *      AND it resolves in `doc.nodes` to an actual ListBlockNode; and
 *   2. EVERY member (not just the first) resolves in its respective source
 *      — a list/single-line-list member via `doc.nodes`, any other member
 *      via `complexBlocksById` — since buildMemberNode has no safe rendering
 *      for a member id that resolves to nothing; and
 *   3. `info.ruleId` itself resolves in `rules` — a composite whose rule
 *      can't be found would otherwise still get projected by
 *      buildCompositeNode via its own (necessarily raw-id/no-prefix)
 *      fallback, which is a degraded-but-rendered composite, not the
 *      "fall back to normal per-member display" this amendment asks for.
 *      2026-08-12 self-review §9 論点2: originally this function only
 *      checked member resolution; ruleId resolution is included too so
 *      every failure mode this function is responsible for goes through
 *      the SAME "skip projecting entirely" fallback, not two different
 *      degradation behaviors depending on which part of the composite is
 *      unresolvable.
 *
 * In the real refresh() pipeline (view/OutlineTreeView.ts) this can never
 * actually fail: `infos`/`complexBlocksById`/`rules` are always derived from
 * the exact same `doc`/`complexScan`/`enabledRules` in the same refresh(),
 * so every member and every ruleId is guaranteed to resolve. This check
 * exists as a defensive INVARIANT for callers that pass mismatched inputs
 * (e.g. a stale `infos` array from a previous parse, or a `rules` list that
 * doesn't match the one `infos` was matched against) — matching this whole
 * codebase's "never guess on an uncertain boundary" policy (see
 * parser/complexBlocks.ts's "ambiguous"/"unsupported" editability, applied
 * here at the projection layer instead of the recognition layer). A
 * composite that fails this check is simply left out of
 * `firstMemberIdToComposite` entirely — every one of its members then falls
 * back to whatever it would render as on its own (a plain list row per
 * `includeLists`, or — for a callout/blockquote — no Tree representation at
 * all, exactly as if Phase 5D-0.3 didn't exist for that member).
 */
function isCompositeSafelyProjectable(
  doc: ParsedDocument,
  info: CompositeBlockInfo,
  complexBlocksById: Map<string, ComplexBlockInfo>,
  rules: CompositeBlockRule[]
): boolean {
  const first = info.members[0];
  if (!first || (first.kind !== "list" && first.kind !== "single-line-list")) return false;
  if (!getCompositeBlockRuleById(rules, info.ruleId)) return false;

  // 2026-08-12 self-review §9 論点1: the first member's resolvability is
  // checked ONCE here, as part of the same loop that checks every other
  // member — it used to also be checked separately (redundantly) before
  // this loop; `index === 0` covers exactly the same case the old
  // standalone pre-check did (list/single-line-list -> must resolve via
  // `doc.nodes` to an actual ListBlockNode), just without doing that
  // specific lookup twice.
  for (const member of info.members) {
    if (member.kind === "list" || member.kind === "single-line-list") {
      const node = doc.nodes.get(member.id);
      if (!node || !isListNode(node)) return false;
    } else if (!complexBlocksById.has(member.id)) {
      return false;
    }
  }
  return true;
}

/**
 * Top-level tree nodes, in document order. `doc.topLevelIds` mixes
 * pre-heading root list items with top-level sections; with `includeLists`
 * off (default) this filters to sections only, exactly like every prior
 * phase (composite-matched list items are the one exception — see
 * `buildChildren`'s doc comment).
 */
export function buildOutlineTree(
  doc: ParsedDocument,
  options?: BuildOutlineTreeOptions
): OutlineTreeNode[] {
  const t = options?.t ?? defaultTranslator;
  let ctx: CompositeProjectionContext | undefined;
  // Phase 5C-2: every ComplexBlockInfo id already consumed as some
  // CompositeBlockInfo's own (non-list) member — collected from
  // options.composites.infos regardless of whether those composites are
  // themselves safely projectable, so a standalone row can never appear
  // for content that's already shown (or would be shown, if its own
  // safety check passed) as a composite's own child. Deliberately
  // independent of isCompositeSafelyProjectable's own per-composite check
  // below — this set only needs to know "which ids are SPOKEN FOR", not
  // "which composites are RENDERABLE".
  const consumedComplexBlockIds = new Set<string>();
  if (options?.composites) {
    for (const info of options.composites.infos) {
      for (const member of info.members) {
        if (member.kind !== "list" && member.kind !== "single-line-list") {
          consumedComplexBlockIds.add(member.id);
        }
      }
    }
  }
  if (options?.composites && options.composites.infos.length > 0) {
    const { complexBlocksById, rules } = options.composites;
    const firstMemberIdToComposite = new Map<string, CompositeBlockInfo>();
    for (const info of options.composites.infos) {
      if (!isCompositeSafelyProjectable(doc, info, complexBlocksById, rules)) continue;
      const first = info.members[0];
      firstMemberIdToComposite.set(first.id, info);
    }
    ctx = {
      firstMemberIdToComposite,
      complexBlocksById,
      rules: options.composites.rules,
      t,
    };
  }

  // Phase 5C-5: renamed from standaloneBySection — the map's keys are no
  // longer exclusively section ids (or null); see resolveStandaloneGroupKey.
  const standaloneByParentId = options?.standaloneComplexBlocks
    ? groupStandaloneComplexBlocks(
        doc,
        options.standaloneComplexBlocks.blocks,
        consumedComplexBlockIds,
        t,
        options.standaloneComplexBlocks.includeFencedCode ?? false,
        options.standaloneComplexBlocks.includeTables ?? false
      )
    : undefined;
  const listPrefixStyle = options?.listPrefixStyle ?? "none";
  // Phase 5P-3: options.paragraphs is the ENTIRE gate — its mere presence
  // (not a separate on/off flag inside it) decides whether ANY paragraph
  // node is ever produced. When absent (every pre-Phase-5P-3 caller, and
  // view/OutlineTreeView.ts's own refresh() when
  // settings.showParagraphsInOutline is false), paragraphByParentId stays
  // undefined and buildChildren/buildListNode's own `paragraphByParentId?.get(...) ?? []`
  // merges in nothing — i.e. paragraph is never even considered, not
  // "considered and filtered out" — matching design doc §2-3's "don't
  // project when off" decision exactly.
  const paragraphByParentId = options?.paragraphs
    ? groupParagraphBlocks(
        doc,
        options.paragraphs.blocks,
        buildParagraphOrdinals(options.paragraphs.blocks),
        t
      )
    : undefined;
  return buildChildren(
    doc,
    doc.topLevelIds,
    options?.includeLists ?? false,
    null,
    ctx,
    standaloneByParentId,
    listPrefixStyle,
    paragraphByParentId
  );
}

/** Flatten a tree back into a list, depth-first, document order. */
export function flattenOutlineTree(tree: OutlineTreeNode[]): OutlineTreeNode[] {
  const out: OutlineTreeNode[] = [];
  const walk = (nodes: OutlineTreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * 2026-08-12 amendment §A/§C: every node id that must render read-only in
 * the Outline Tree — a CompositeBlock's own row, every one of its member
 * rows (list item / callout / blockquote), and — recursively — any
 * further-nested list item under one of those member rows. Extracted as a
 * pure, Obsidian-free function over the already-built tree (rather than
 * threaded through view/OutlineTreeView.ts's renderNode as a boolean
 * parameter re-derived during each recursive render call) so the exact same
 * "which rows are read-only" decision that gates rename/drag-drop/context-
 * menu/mobile-long-press-menu attachment there is ALSO independently
 * unit-testable without an Obsidian runtime — see this module's own tests
 * for the read-only-propagation guarantees this underpins (a composite
 * member's read-only status must not depend on where in a nested list
 * hierarchy the composite happens to sit).
 */
export function collectReadOnlyOutlineNodeIds(tree: OutlineTreeNode[]): Set<string> {
  const readOnlyIds = new Set<string>();
  const walk = (nodes: OutlineTreeNode[], inheritedReadOnly: boolean): void => {
    for (const node of nodes) {
      // Phase 5P-3 (design doc §6 #1/#3/#6): paragraph is read-only-
      // navigation-only in the Tree — rename/delete/insert/drag/indent-
      // outdent/Move/CompositeBlock-edit/context-menu-edit must all be
      // rejected for it, the same way they already are for composite and
      // complex-member. Adding it here is an explicit allowlist inclusion
      // (not reliance on an accidental "unimplemented" gap).
      const readOnly =
        inheritedReadOnly ||
        node.kind === "composite" ||
        node.kind === "complex-member" ||
        node.kind === "paragraph";
      if (readOnly) readOnlyIds.add(node.id);
      walk(node.children, readOnly);
    }
  };
  walk(tree, false);
  return readOnlyIds;
}

/**
 * UI-only follow-up (2026-09-08, "Outline Tree の CompositeBlock 視認性改善"):
 * display-only grouping info for the Outline Tree's CompositeBlock
 * left-accent-border + tint indicator (view/OutlineTreeView.ts's renderNode
 * / styles.css's `.unified-outliner-composite-accent`) — deliberately a
 * SEPARATE derived Set from `collectReadOnlyOutlineNodeIds` above, not a
 * reuse of it: that function's `readOnlyIds` ALSO includes every
 * `"paragraph"` row (Phase 5P-3), which is never a CompositeBlock member
 * and must never get this visual treatment — conflating the two would
 * incorrectly paint a plain paragraph row as if it were part of a grouped
 * CompositeBlock. This function touches no parser/rule/range/snapshot/
 * member-matching logic at all: it is a pure, read-only projection over an
 * already-built `OutlineTreeNode[]` tree, exactly like
 * `collectReadOnlyOutlineNodeIds` itself.
 *
 * `groupNodeIds`: every node id that is a CompositeBlock's own parent row
 * (`kind === "composite"`), or any one of its descendant rows —
 * `complex-member` rows (callout/blockquote members) and, recursively, any
 * further-nested `list` row under one of those member rows (a list member
 * can itself have nested list-item children, which are plain `"list"`
 * nodes with no CompositeBlock-specific `kind` of their own — see
 * `collectReadOnlyOutlineNodeIds`'s own "further-nested list item" test for
 * the identical propagation shape this mirrors). A composite is never
 * itself nested inside another composite in this codebase's current
 * matcher (a composite's members are always list/callout/blockquote
 * leaves, never a further CompositeBlockInfo), so `markDescendants` below
 * does not special-case a nested "composite" kind — it only needs to ever
 * fire from the top-level `walk`'s own `"composite"` branch.
 *
 * `groupEndNodeIds`: exactly one node id per composite — the single,
 * deepest "last child of the last child of..." row, i.e. the last row
 * `view/OutlineTreeView.ts`'s renderNode actually paints for that
 * composite's subtree, in document order. Used to mark the visual
 * "terminus" of a group (a bolder left accent) — computed structurally
 * from `children` array order (already document order; see every other
 * consumer of `OutlineTreeNode.children` in this file) rather than by any
 * line-number comparison, so it stays correct regardless of how a member's
 * own text is projected.
 */
export interface CompositeGroupInfo {
  groupNodeIds: Set<string>;
  groupEndNodeIds: Set<string>;
}

export function collectCompositeGroupInfo(tree: OutlineTreeNode[]): CompositeGroupInfo {
  const groupNodeIds = new Set<string>();
  const groupEndNodeIds = new Set<string>();

  const markDescendants = (nodes: OutlineTreeNode[]): void => {
    for (const node of nodes) {
      groupNodeIds.add(node.id);
      markDescendants(node.children);
    }
  };

  // A composite's own `children` is never empty (OutlineTreeCompositeNode's
  // own doc comment: "never empty (a CompositeBlockInfo always has >= 2
  // members)"), so this always terminates on a real node id, never the
  // composite's own id itself.
  const lastDescendantId = (node: OutlineTreeNode): string => {
    if (node.children.length === 0) return node.id;
    return lastDescendantId(node.children[node.children.length - 1]);
  };

  const walk = (nodes: OutlineTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "composite") {
        groupNodeIds.add(node.id);
        markDescendants(node.children);
        groupEndNodeIds.add(lastDescendantId(node));
      } else {
        walk(node.children);
      }
    }
  };
  walk(tree);
  return { groupNodeIds, groupEndNodeIds };
}
