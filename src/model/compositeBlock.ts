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
}

/** One matched member inside a CompositeBlockInfo. */
export interface CompositeBlockMember {
  kind: CompositeMemberKind;
  /** The underlying BlockNode.id or ComplexBlockInfo.id — never a CompositeBlockInfo id. */
  id: string;
  range: LineRange;
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
