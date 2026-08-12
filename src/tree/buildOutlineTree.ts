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
import {
  compositeBlockDisplayLabel,
  CompositeBlockInfo,
  CompositeBlockMember,
  CompositeBlockRule,
  getCompositeBlockRuleById,
} from "../model/compositeBlock";
import { defaultTranslator, Translator } from "../i18n";

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
  /** Item text with leading indent and the list marker stripped. */
  text: string;
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
 * Phase 5D-0.3: a read-only Tree row for a composite member that has no
 * OTHER representation in the Outline Tree today — a callout or blockquote
 * (model/complexBlock.ts's ComplexBlockInfo), which (unlike a list item)
 * is never itself a BlockNode and so has no existing node kind of its own.
 * This node kind exists ONLY as a CompositeBlock's child; nothing in this
 * module ever creates one outside of buildMemberNode. It carries no
 * structural-edit capability of any kind (see the Phase 5D-0.3 design memo
 * §4/approval §1) — the Tree view must not attach rename/drag-drop/context-
 * menu handling to it.
 */
export interface OutlineTreeComplexMemberNode {
  kind: "complex-member";
  /** Matches the underlying ComplexBlockInfo's id. */
  id: string;
  complexKind: ComplexBlockKind;
  label: string;
  /** 0-based line of the member's own first line (jump target). */
  line: number;
  /** Always [] — complex-block members are not decomposed further in this revision. */
  children: OutlineTreeNode[];
}

export type OutlineTreeNode =
  | OutlineTreeSectionNode
  | OutlineTreeListNode
  | OutlineTreeCompositeNode
  | OutlineTreeComplexMemberNode;

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
}

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
    const text = listItemDisplayText(doc, node);
    return text.length > 0 ? text : t("tree.emptyListItem");
  }
  return "";
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
  ctx: CompositeProjectionContext
): OutlineTreeNode {
  if (member.kind === "list" || member.kind === "single-line-list") {
    const node = doc.nodes.get(member.id);
    if (node && isListNode(node)) return buildListNode(doc, node, ctx);
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
  return {
    kind: "complex-member",
    id: member.id,
    complexKind: member.kind as ComplexBlockKind,
    label,
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
function buildCompositeNode(
  doc: ParsedDocument,
  composite: CompositeBlockInfo,
  ctx: CompositeProjectionContext
): OutlineTreeCompositeNode {
  const rule = getCompositeBlockRuleById(ctx.rules, composite.ruleId);
  return {
    kind: "composite",
    id: composite.id,
    ruleId: composite.ruleId,
    label: rule ? compositeBlockDisplayLabel(rule, ctx.t) : composite.ruleId,
    prefix: rule?.prefix ?? "",
    line: composite.range.startLine,
    children: composite.members.map((m) => buildMemberNode(doc, m, ctx)),
  };
}

function buildListNode(
  doc: ParsedDocument,
  item: ListBlockNode,
  ctx?: CompositeProjectionContext
): OutlineTreeListNode {
  const children: OutlineTreeNode[] = [];
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
    children.push(composite ? buildCompositeNode(doc, composite, ctx!) : buildListNode(doc, child, ctx));
  }
  return {
    kind: "list",
    id: item.id,
    text: listItemDisplayText(doc, item),
    indentDepth: item.depth,
    line: item.range.startLine,
    children,
  };
}

function buildSectionNode(
  doc: ParsedDocument,
  section: SectionBlockNode,
  includeLists: boolean,
  ctx?: CompositeProjectionContext
): OutlineTreeSectionNode {
  return {
    kind: "section",
    id: section.id,
    headingText: section.headingText,
    headingLevel: section.headingLevel,
    line: section.range.startLine,
    children: buildChildren(doc, section.childIds, includeLists, ctx),
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
 */
function buildChildren(
  doc: ParsedDocument,
  ids: string[],
  includeLists: boolean,
  ctx?: CompositeProjectionContext
): OutlineTreeNode[] {
  const withLine: Array<{ node: OutlineTreeNode; line: number }> = [];
  for (const id of ids) {
    const child = doc.nodes.get(id);
    if (!child) continue;
    if (isSectionNode(child)) {
      withLine.push({
        node: buildSectionNode(doc, child, includeLists, ctx),
        line: child.range.startLine,
      });
      continue;
    }
    if (!isListNode(child)) continue;
    const composite = ctx?.firstMemberIdToComposite.get(child.id);
    if (composite) {
      withLine.push({
        node: buildCompositeNode(doc, composite, ctx!),
        line: composite.range.startLine,
      });
    } else if (includeLists) {
      withLine.push({
        node: buildListNode(doc, child, ctx),
        line: child.range.startLine,
      });
    }
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
  return buildChildren(doc, doc.topLevelIds, options?.includeLists ?? false, ctx);
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
      const readOnly =
        inheritedReadOnly || node.kind === "composite" || node.kind === "complex-member";
      if (readOnly) readOnlyIds.add(node.id);
      walk(node.children, readOnly);
    }
  };
  walk(tree, false);
  return readOnlyIds;
}
