/**
 * Phase 5D-0: CompositeBlock — a THIRD, separate aggregation layer on top of
 * the existing two block models. Read this file's doc comment before
 * touching model/complexBlock.ts or parser/compositeBlocks.ts; the naming
 * distinction below is deliberate and must not be blurred.
 *
 * ---- Why a third model, and why NOT named "ComplexBlock*" ----
 *
 * model/block.ts's `BlockNode` (section/list) and model/complexBlock.ts's
 * `ComplexBlockInfo` (callout/blockquote/fenced-code/table/paragraph/
 * thematic-break) both describe exactly ONE underlying Markdown construct
 * each. `CompositeBlockInfo` here describes something categorically
 * different: a USER-CONFIGURABLE grouping of two or more ALREADY-RECOGNIZED
 * blocks (from either of the two models above) into one operable/display
 * unit, purely for the Outline Tree projection layer (Phase 5D-0.3 — see
 * docs/phase5d0_3_composite-block-outline-tree-projection-design-memo.md)
 * — e.g. a one-line list item immediately followed by a callout, a common
 * "image + OCR transcript" authoring pattern.
 *
 * `docs/phase5c_block-model-and-tree-display-spec.md` §6 already reserved
 * the term "complex block" / `ComplexBlockKind` for the FIRST model above,
 * and separately reserved "future unified block model" for a hypothetical
 * `BlockNode | ComplexBlockInfo` union. `CompositeBlock` is neither of
 * those — it is read-only, never registered into `ParsedDocument.nodes` or
 * `ComplexBlockScanResult.blocks`, and never changes any existing block's
 * own range, kind, or parent/child relationship. It only OBSERVES the
 * output of parser/parseDocument.ts and parser/complexBlocks.ts and groups
 * some of it. See parser/compositeBlocks.ts's doc comment for the matching
 * algorithm and required conditions.
 *
 * Non-goals (Phase 5D-0.3 design memo §4): CompositeBlock move / drag & drop
 * / indent-outdent / Partial Edit Pane integration, multi-select, a
 * free-form rule-authoring UI (only enabling/disabling the built-in default
 * rules below), nested CompositeBlocks.
 */
import { LineRange } from "./block";
import { ComplexBlockKind } from "./complexBlock";
import { defaultTranslator, TranslationKey, Translator } from "../i18n";

/**
 * A member kind a CompositeBlockRule's kindSequence may reference.
 *
 * "single-line-list" (Phase 5D-0.3) is a list item with NO continuation
 * lines and NO nested child list — see parser/compositeBlocks.ts for why
 * `range.startLine === range.endLine` on the underlying ListBlockNode is
 * sufficient to prove both at once. It replaces the earlier
 * `requireSingleLineList` boolean flag: the constraint is now encoded
 * directly in the member kind itself, matching how the rest of this
 * plugin's block models express constraints as distinct kinds rather than
 * kind+flag pairs.
 *
 * "list" (plain, WITHOUT the single-line restriction) and "section" are
 * model/block.ts's BlockNode kinds; the rest are model/complexBlock.ts's
 * ComplexBlockKind. Only kinds with a well-defined, confidently-bounded
 * range should ever appear here — "section" is included for
 * forward-compatibility with a future rule but parser/compositeBlocks.ts's
 * matcher does not currently emit "section" candidates, so no rule that
 * includes it can match yet.
 */
export type CompositeMemberKind = ComplexBlockKind | "list" | "single-line-list" | "section";

/**
 * A single composite-matching rule. `kindSequence` must have length >= 2 —
 * a "composite" of one block is meaningless. Rules are tried in the array
 * order the caller supplies them (see parser/compositeBlocks.ts's
 * matchCompositeBlocks doc comment); the FIRST rule whose kindSequence
 * matches at a given starting candidate wins, per this phase's "規則が競合
 * する場合は、優先順位が最も高い規則だけを採用すること" requirement.
 */
export interface CompositeBlockRule {
  id: string;
  kindSequence: CompositeMemberKind[];
  /**
   * Short, non-translated decorative symbol shown before the composite's
   * label in the Outline Tree (e.g. "◉"). Kept as plain model data (not a
   * CSS ::before injection) so it participates in the node's textContent —
   * copy/paste, accessible name, and DOM assertions in tests all see it —
   * per the Phase 5D-0.3 design memo §5 decision. Never undefined; use ""
   * for "no prefix" (renderers must not emit an empty decorative element
   * for that case — see tree/buildOutlineTree.ts's buildCompositeNode,
   * which copies this field verbatim onto OutlineTreeCompositeNode.prefix,
   * and view/OutlineTreeView.ts's renderNode composite branch, which is the
   * one place that actually renders it).
   */
  prefix: string;
  /**
   * Built-in rules (this file's DEFAULT_COMPOSITE_BLOCK_RULES) leave this
   * unset and resolve their display label via i18n, keyed by `id` (see
   * BUILTIN_COMPOSITE_RULE_DISPLAY_NAME_KEYS below) — so the same rule
   * always reads in the user's chosen UI language. A FUTURE user-defined
   * rule (no free-form authoring UI exists yet — see this file's top doc
   * comment) would instead set `customLabel` to whatever literal string the
   * user typed; that string is never translated. `compositeBlockDisplayLabel`
   * below is the single place that reconciles the two: customLabel wins
   * when present, otherwise the built-in i18n key is used, otherwise `id`
   * itself is the last-resort fallback. This is the "衝突しない model"
   * requested by the Phase 5D-0.3 approval: a built-in rule and a
   * (currently hypothetical) user-defined rule can never disagree about
   * which string wins, because exactly one of the two label sources is
   * ever populated for any given rule.
   */
  customLabel?: string;
  /**
   * v1.0.4 (list + paragraph): HOW the members relate to each other in the
   * note. Omitted / "adjacent-sequence" is the original Phase 5D-0 shape —
   * members are consecutive, zero-gap, independently-bounded blocks that
   * share one enclosing section (e.g. a one-line list item followed by a
   * column-0 callout). "list-child-continuation" is the v1.0.4 shape: the
   * FIRST member is a list item and the second member is a paragraph that
   * Phase 5P's scanner itself resolved as that list item's CHILD
   * (ComplexBlockInfo.parentId === the list item's id, i.e. indented to the
   * item's content-start column). See parser/compositeBlocks.ts's
   * matchListChildContinuation for the exact condition list.
   */
  geometry?: CompositeRuleGeometry;
  /**
   * v1.0.4 / v1.0.4 Tree+Partial Edit phase: when true, composites of this
   * rule are projected into the Outline Tree and can be opened and edited
   * as one unit in the Partial Edit Pane, but are NEVER moved, dragged,
   * dropped onto, deleted, indented/outdented or copied as a unit — their
   * parent row and every member row stay strictly read-only in the Tree
   * (the parent row's context menu / long-press offers "Open in Partial
   * Edit" only). Such rules are therefore kept OUT of
   * settingsDefaults.ts's getEnabledCompositeBlockRules — the rule set every
   * structural operation and editor command uses — and appear only in
   * getEnabledTreeCompositeBlockRules (Tree projection + Partial Edit).
   * Omitted = false.
   */
  treeReadOnly?: boolean;
}

/** See CompositeBlockRule.geometry. */
export type CompositeRuleGeometry = "adjacent-sequence" | "list-child-continuation";

/** One matched member inside a CompositeBlockInfo. */
export interface CompositeBlockMember {
  kind: CompositeMemberKind;
  /** The underlying BlockNode.id or ComplexBlockInfo.id — never a CompositeBlockInfo id. */
  id: string;
  /**
   * The member's OWN lines. For a "list-child-continuation" composite's
   * list member this is the list item's marker line only (the item's own
   * one-line text) — NOT the underlying ListBlockNode.range, which also
   * spans the child paragraph — so member ranges never overlap.
   */
  range: LineRange;
  /**
   * v1.0.4: the Obsidian block id (`^id`, stored WITHOUT the caret) already
   * written inside a "paragraph" member's own range — an inline ` ^id`
   * suffix on its last line, or a lone `^id` last line of the paragraph.
   * `null` when that paragraph has none. Absent (undefined) for every
   * non-paragraph member. Read-only structural information: nothing in
   * this layer ever issues or writes a block id. See
   * parser/blockIdInRange.ts's readBlockIdWithinRange.
   */
  blockId?: string | null;
}

export interface CompositeBlockInfo {
  id: string;
  ruleId: string;
  /** Spans every member's range: members[0].range.startLine .. members[last].range.endLine. */
  range: LineRange;
  /** In document order, matching the rule's kindSequence 1:1. */
  members: CompositeBlockMember[];
  /** The section every member was independently confirmed to share, or null if none (top-of-document, no enclosing heading). */
  sectionId: string | null;
}

/**
 * Phase 5C-1 (ticket 1 — "CompositeBlock 編集可能化" design/model step,
 * 2026-08-13): delete-eligibility classification for a CompositeBlockInfo.
 * DELIBERATELY NOT model/complexBlock.ts's `BlockEditability` — that type
 * answers a narrower question ("can THIS SINGLE callout/blockquote/
 * fenced-code/table's own boundary be trusted"), which is necessary but not
 * sufficient here. A CompositeBlockInfo can be simultaneously:
 *
 *   - RECOGNIZED (produced by parser/compositeBlocks.ts's
 *     matchCompositeBlocks — every member already independently
 *     "supported"/resolvable, see that function's own doc comment), AND
 *   - RENDERABLE (passes tree/buildOutlineTree.ts's
 *     isCompositeSafelyProjectable, i.e. safely shown as a read-only Tree
 *     row today), AND YET
 *   - NOT DELETABLE — e.g. because one of its members sits nested inside
 *     another list item (this phase's deletable set is deliberately
 *     restricted to single-section/top-level-relative composites only; see
 *     parser/compositeBlocks.ts's evaluateCompositeBlockDeletability doc
 *     comment for the full condition list).
 *
 * These three questions (recognized / renderable / deletable) are
 * intentionally kept as three separate, non-overlapping concerns — this
 * ticket must not blur "can be shown" with "can be safely removed as one
 * unit". `CompositeBlockDeletability` is produced FRESH, on demand, by
 * evaluateCompositeBlockDeletability; it is NEVER stored as a field on
 * CompositeBlockInfo itself (CompositeBlockInfo, like ComplexBlockInfo,
 * stays a read-only recognition value with no baked-in judgment about what
 * a future editing phase may do with it).
 *
 * Phase 5C-1 ticket 1 performs NO deletion of any kind and is not wired
 * into the Outline Tree, any context menu, or any editor mutation — this
 * type and its evaluator exist solely so a future edit/deleteCompositeBlock.ts
 * (a later, separate ticket) has one already-vetted safety gate to consult
 * before ever touching doc.lines. See parser/compositeBlocks.ts for the
 * evaluator and describeCompositeBlockRejection (the id-based lookup
 * wrapper, mirroring parser/complexBlocks.ts's describeComplexBlockRejection).
 */
export type CompositeBlockDeleteRejectionReason =
  | "member-resolve-failed"
  | "member-not-supported"
  | "member-has-diagnostic"
  | "member-unsafe-indent"
  | "unsupported-member-kind"
  | "nested-in-list"
  | "ambiguous-section";

export interface CompositeBlockDeletability {
  deletable: boolean;
  /** Present whenever deletable === false. */
  reason?: CompositeBlockDeleteRejectionReason;
  /**
   * Present whenever deletable === false AND the rejection is scoped to one
   * specific member (member.id) rather than the composite as a whole.
   * Omitted for "ambiguous-section", which by definition implicates a
   * disagreement across members rather than any single one of them.
   */
  offendingMemberId?: string;
}

/**
 * Result of describeCompositeBlockRejection — see parser/compositeBlocks.ts.
 * Mirrors model/complexBlock.ts's ComplexBlockRejection shape exactly (same
 * blocked:true/false discriminated union convention), so a future caller
 * that already knows one can trivially learn the other.
 */
export type CompositeBlockRejection =
  | { blocked: true; ruleId: string; reason: string }
  | { blocked: false };

/**
 * Phase 5C-1 ticket 4-1 (2026-08-14, revised): move-eligibility
 * classification for a CompositeBlockInfo, in a given up/down direction. A
 * DIFFERENT, narrower question than CompositeBlockDeletability above — it
 * reuses a subset of the same structural preconditions (top-level/single-
 * section composite, no unsafe indent) but additionally asks whether a
 * valid adjacent block exists, at the SAME structural level, in the
 * requested direction. See parser/compositeBlocks.ts's
 * evaluateCompositeBlockMovability doc comment for the exact,
 * independently-re-derived condition list — including why this deliberately
 * does NOT rely on ListBlockNode's own prevSiblingId/nextSiblingId (a
 * composite's own second member routinely severs that chain; see that
 * doc comment's design-memo section for the full, empirically-verified
 * rationale) and instead resolves adjacency by scanning the raw document
 * around composite.range. This type and its evaluator do NOT trust
 * CompositeBlockDeletability's result, matching this whole ticket's "never
 * guess, always re-verify against current ground truth" policy.
 *
 * "eligible: true" means only that a swap partner has been safely
 * confirmed to exist — it says nothing about what that partner IS; see
 * move/findCompositeMoveTarget.ts's CompositeMoveTarget for the actual
 * resolved ranges to swap.
 */
export type CompositeBlockMoveRejectionReason =
  | "nested-in-list"
  | "unsafe-indent"
  | "no-adjacent-compatible-unit"
  | "different-parent-or-depth";

export type CompositeBlockMovability =
  | { eligible: true }
  | { eligible: false; reason: CompositeBlockMoveRejectionReason };

/**
 * Built-in default rules (Phase 5D-0.3 approval §3): the "image + OCR
 * transcript" authoring pattern (a one-line list item immediately followed
 * by a callout) and its blockquote variant. Array order doubles as
 * priority order when both are enabled — see parser/compositeBlocks.ts's
 * matchCompositeBlocks. settingsDefaults.ts's `CompositeBlockSettings`
 * stores only an enabled/disabled flag per rule id here; the rule
 * DEFINITIONS themselves are not user-editable in this revision (no
 * free-form rule-authoring UI — see this file's top doc comment).
 */
export const DEFAULT_COMPOSITE_BLOCK_RULES: CompositeBlockRule[] = [
  {
    id: "image-ocr",
    kindSequence: ["single-line-list", "callout"],
    prefix: "◉",
  },
  {
    id: "image-quote",
    kindSequence: ["single-line-list", "blockquote"],
    prefix: "❖",
  },
];

/**
 * v1.0.4: built-in TREE-READ-ONLY rules (see CompositeBlockRule
 * .treeReadOnly). Deliberately kept OUT of DEFAULT_COMPOSITE_BLOCK_RULES,
 * which remains exactly the operable rule set (move, drag & drop, delete,
 * copy, editor commands) — so none of those paths changes.
 *
 * "list-paragraph": a list item whose own text is one line (its marker
 * line), followed with no blank line by a paragraph that is that item's
 * child (indented to the item's content-start column). Only the FIRST such
 * paragraph is taken, and only when the list item contains nothing else
 * (no child list, no further block) — see parser/compositeBlocks.ts's
 * matchListChildContinuation.
 */
export const STRUCTURAL_COMPOSITE_BLOCK_RULES: CompositeBlockRule[] = [
  {
    id: "list-paragraph",
    kindSequence: ["single-line-list", "paragraph"],
    // "≡" (U+2261): a plain, widely-available text glyph suggesting lines
    // of text under a list item; deliberately unlike every other Tree
    // prefix (◉ ❖ composite rules, ▣ ❝ ◫ ▦ ¶ ⧉ blocks/mirrors).
    prefix: "≡",
    geometry: "list-child-continuation",
    treeReadOnly: true,
  },
];

/**
 * Every built-in rule in match-priority order: the existing operable rules
 * FIRST, then the recognition-only rules — so an existing rule always wins
 * any conflict and the v1.0.4 rule is evaluated only afterwards.
 */
export const BUILTIN_COMPOSITE_BLOCK_RULES: CompositeBlockRule[] = [
  ...DEFAULT_COMPOSITE_BLOCK_RULES,
  ...STRUCTURAL_COMPOSITE_BLOCK_RULES,
];

/**
 * v1.0.4: the existing block id of the composite's FIRST paragraph member,
 * or null when it has none or the composite has no paragraph member.
 * Pure read of CompositeBlockMember.blockId — never issues an id.
 */
export function getCompositeParagraphBlockId(composite: CompositeBlockInfo): string | null {
  const paragraph = composite.members.find((m) => m.kind === "paragraph");
  return paragraph?.blockId ?? null;
}

/** O(1) lookup by rule id — used by matchCompositeBlocks callers and the Tree/settings display-label resolvers below. */
export function getCompositeBlockRuleById(
  rules: CompositeBlockRule[],
  ruleId: string
): CompositeBlockRule | undefined {
  return rules.find((r) => r.id === ruleId);
}

/**
 * i18n keys for each BUILT-IN rule's display label — see CompositeBlockRule
 * .customLabel's doc comment for why this table (rather than a literal
 * string on the rule itself) is the source of truth for built-in rules.
 * A rule id with no entry here (a future built-in, or any user-defined
 * rule that also happens to leave customLabel unset) falls back to its raw
 * `id` string — see compositeBlockDisplayLabel below.
 */
const BUILTIN_COMPOSITE_RULE_DISPLAY_NAME_KEYS: Record<string, TranslationKey> = {
  "image-ocr": "compositeBlock.imageOcr.displayName",
  "image-quote": "compositeBlock.imageQuote.displayName",
  "list-paragraph": "compositeBlock.listParagraph.displayName",
};

/**
 * Resolves the display label for a CompositeBlockRule, reconciling
 * built-in (i18n-backed) and future user-defined (literal `customLabel`)
 * rules per the doc comment on CompositeBlockRule.customLabel. `t` follows
 * the same optional-Translator, default-to-English convention already used
 * throughout tree/buildOutlineTree.ts and model/complexBlock.ts's sibling
 * modules (see src/i18n.ts).
 */
export function compositeBlockDisplayLabel(
  rule: CompositeBlockRule,
  t: Translator = defaultTranslator
): string {
  if (rule.customLabel !== undefined) return rule.customLabel;
  const key = BUILTIN_COMPOSITE_RULE_DISPLAY_NAME_KEYS[rule.id];
  return key ? t(key) : rule.id;
}
