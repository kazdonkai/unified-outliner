/**
 * Phase 5E-Copy ("Outline Tree でのブロックコピー操作"): pure, Obsidian-free
 * block COPY (duplicate) — never a move. The source block's own lines are
 * only ever READ; every successful outcome is "the original document with
 * one freshly built copy (plus, where needed, blank separator lines)
 * spliced in", nothing else. See docs/phase5e-copy_block-copy-design-memo.md
 * for the full design.
 *
 * ---- Supported source kinds ----
 *
 *   - "section"     — heading + its whole subtree (SectionBlockNode.range)
 *   - "list"        — list item + all of its descendants (ListBlockNode.range)
 *   - "callout" / "blockquote" / "fenced-code" / "table" / "paragraph"
 *                   — a standalone ("flat") ComplexBlockInfo, editability
 *                     "supported", not nested inside a list item.
 *
 * CompositeBlock parents and CompositeBlock members (including a composite's
 * anchor list item) are NOT copy sources in this phase ("copy-composite-
 * member"); they ARE valid paste targets — see the placement rules below.
 *
 * ---- Relationship to the existing Drag and Drop implementation ----
 *
 * Placement reuses the exact same position rules as the existing D&D
 * resolvers, only with "insert a copy" instead of "cut and re-insert":
 *
 *   - section source: move/relocateSection.ts's before/after/inside rules
 *     (before -> target heading line, after -> after target's subtree,
 *     inside -> after target's subtree with a whole-subtree heading-level
 *     cascade to target level + 1, via move/indentBlock.ts's
 *     collectSectionSubtree + level/headingLevel.ts's setHeadingLevel).
 *   - list source: move/relocateListSubtree.ts's rules, reusing its
 *     (now exported) childIndentColumnsOf / ownContentInsertionLine /
 *     reindent helpers unchanged.
 *   - flat source: move/findStandaloneComplexBlockDropTarget.ts's
 *     before/after rules plus edit/dropStandaloneComplexBlock.ts's (now
 *     exported) ensureBlankSeparation, applied unconditionally exactly as
 *     that executor now does.
 *
 * The one deliberate difference from D&D: dropping a block "before"/"after"
 * ITSELF is a no-op for a move (and is rejected there as "self-drop"), but
 * is the whole point of "Duplicate below" for a copy — so it is allowed.
 * Pasting anywhere strictly INSIDE the source block (including "inside"
 * itself, or relative to one of its own descendants) is rejected as
 * "copy-inside-source".
 *
 * ---- Safety ----
 *
 *   1. The copy snapshot carries the source's exact lines at copy time. At
 *      paste time the source is re-resolved from the CURRENT text by kind
 *      + exact content (preferring its original range); if it vanished,
 *      changed, or became ambiguous, the paste is refused rather than
 *      guessed at ("copy-source-changed" / "copy-source-ambiguous").
 *   2. The target hint is re-verified against the current text too
 *      ("copy-target-changed").
 *   3. The insertion line may never sit inside frontmatter, inside a fenced
 *      code block, strictly inside any recognized complex block (callout
 *      `>` prefix run, table, paragraph, ...) or strictly inside a
 *      CompositeBlock.
 *   4. After splicing, the result is re-parsed and must show (a) every
 *      pre-existing section/list node, complex block and CompositeBlock
 *      unchanged apart from the line shift — same kind, extent, editability,
 *      depth and parent — and (b) the inserted segment containing exactly a
 *      structural replica of the source. Anything else (the copy merging
 *      with a neighbor, a neighbor being re-parented under a pasted heading,
 *      a lazily-continued paragraph, ...) refuses the whole paste with
 *      "copy-structure-changed" and leaves the text unchanged. This mirrors
 *      edit/insertStructuredBlock.ts's own post-insert structure-
 *      preservation check.
 *   5. Existing lines are never rewritten: ordered-list renumbering
 *      (normalizeOrderedMarkers) is deliberately NOT applied to a copy, so
 *      the original — and every other existing line — stays byte-identical.
 *
 * The outcome is a plain LineEditOutcome, applied by the caller through the
 * existing single write path (commands/applyLineEditOutcome.ts) — one
 * `replaceRange`, hence one Undo step. No new write path is introduced.
 */
import {
  isListNode,
  isSectionNode,
  LineRange,
  ListBlockNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../model/complexBlock";
import { CompositeBlockInfo, CompositeBlockRule } from "../model/compositeBlock";
import { leadingWhitespace, parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { collectSectionSubtree } from "../move/indentBlock";
import { setHeadingLevel } from "../level/headingLevel";
import { childIndentColumnsOf, ownContentInsertionLine, reindent } from "../move/relocateListSubtree";
import { ensureBlankSeparation } from "./dropStandaloneComplexBlock";
import { insertBlockAtPosition } from "./insertStructuredBlock";

// ---- Types ------------------------------------------------------------------

export const BLOCK_COPY_FLAT_KINDS = ["callout", "blockquote", "fenced-code", "table", "paragraph"] as const;
export type BlockCopyFlatKind = (typeof BLOCK_COPY_FLAT_KINDS)[number];
export type BlockCopyKind = "section" | "list" | BlockCopyFlatKind;

export function isBlockCopyKind(kind: string): kind is BlockCopyKind {
  return kind === "section" || kind === "list" || isBlockCopyFlatKind(kind);
}

export function isBlockCopyFlatKind(kind: string): kind is BlockCopyFlatKind {
  return (BLOCK_COPY_FLAT_KINDS as readonly string[]).includes(kind);
}

/** What the caller wants to copy: a block kind plus its CURRENT range (e.g. from a Tree row or resolveMoveUnit). */
export interface BlockCopySourceRef {
  kind: string;
  range: LineRange;
}

/**
 * The copy "clipboard": the source's kind, its range at copy time, and its
 * exact lines at copy time. Lines are captured so that a paste never
 * silently copies content the user did not see when they chose "Copy
 * block" — see this module's top doc comment, Safety §1.
 */
export interface BlockCopySnapshot {
  kind: BlockCopyKind;
  range: LineRange;
  lines: readonly string[];
}

export type BlockCopyTargetKind = "section" | "list" | "complex" | "paragraph" | "composite";

/** A paste TARGET as seen at menu-build time: its kind, range and parentId (composite: parentId ignored). */
export interface BlockCopyTargetHint {
  kind: BlockCopyTargetKind;
  range: LineRange;
  parentId: string | null;
}

export type BlockPastePosition = "before" | "after" | "inside";

export type BlockCopyRejectReason =
  | "copy-unsupported-kind"
  | "copy-composite-member"
  | "copy-nested-in-list"
  | "copy-unsafe-indent"
  | "copy-source-changed"
  | "copy-source-ambiguous"
  | "copy-target-changed"
  | "copy-invalid-target"
  | "copy-inside-source"
  | "copy-composite-internal-boundary"
  | "copy-unsafe-position"
  | "copy-max-heading-level"
  | "copy-structure-changed";

export const BLOCK_COPY_REJECT_REASONS: readonly BlockCopyRejectReason[] = [
  "copy-unsupported-kind",
  "copy-composite-member",
  "copy-nested-in-list",
  "copy-unsafe-indent",
  "copy-source-changed",
  "copy-source-ambiguous",
  "copy-target-changed",
  "copy-invalid-target",
  "copy-inside-source",
  "copy-composite-internal-boundary",
  "copy-unsafe-position",
  "copy-max-heading-level",
  "copy-structure-changed",
];

export interface BlockCopyOutcome extends LineEditOutcome {
  reason?: BlockCopyRejectReason;
  /** On success: the inserted copy's own range (blank separator lines excluded) in the NEW document. */
  insertedRange?: LineRange;
}

type ResolvedSource =
  | { kind: "section"; range: LineRange; node: SectionBlockNode }
  | { kind: "list"; range: LineRange; node: ListBlockNode }
  | { kind: BlockCopyFlatKind; range: LineRange; block: ComplexBlockInfo };

type ResolvedTarget =
  | { kind: "section"; range: LineRange; node: SectionBlockNode }
  | { kind: "list"; range: LineRange; node: ListBlockNode }
  | { kind: "complex" | "paragraph"; range: LineRange; block: ComplexBlockInfo }
  | { kind: "composite"; range: LineRange; composite: CompositeBlockInfo };

interface Placement {
  insertAt: number;
  /** list source only: the copy's new marker column. */
  newIndentColumns?: number;
  /** section source "inside" only: the copy root's new heading level. */
  newRootLevel?: number;
  /** Whether ensureBlankSeparation runs around the copy. */
  separate: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: BlockCopyRejectReason };

function fail<T>(reason: BlockCopyRejectReason): Result<T> {
  return { ok: false, reason };
}

function rejected(lines: string[], reason: BlockCopyRejectReason): BlockCopyOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

function sameRange(a: LineRange, b: LineRange): boolean {
  return a.startLine === b.startLine && a.endLine === b.endLine;
}

function sliceRange(lines: readonly string[], range: LineRange): string[] {
  return lines.slice(range.startLine, range.endLine + 1);
}

function linesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i]);
}

function isOwnedByList(doc: ParsedDocument, parentId: string | null): boolean {
  if (!parentId) return false;
  const owner = doc.nodes.get(parentId);
  return !!owner && isListNode(owner);
}

// ---- Source resolution ------------------------------------------------------

function findSourceAt(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  kind: BlockCopyKind,
  range: LineRange
): ResolvedSource | null {
  if (kind === "section" || kind === "list") {
    for (const node of doc.nodes.values()) {
      if (!sameRange(node.range, range)) continue;
      if (kind === "section" && isSectionNode(node)) return { kind, range: node.range, node };
      if (kind === "list" && isListNode(node)) return { kind, range: node.range, node };
    }
    return null;
  }
  const block = scan.blocks.find((b) => b.kind === kind && sameRange(b.range, range));
  return block ? { kind, range: block.range, block } : null;
}

function allSourceCandidates(doc: ParsedDocument, scan: ComplexBlockScanResult, kind: BlockCopyKind): ResolvedSource[] {
  const out: ResolvedSource[] = [];
  if (kind === "section" || kind === "list") {
    for (const node of doc.nodes.values()) {
      if (kind === "section" && isSectionNode(node)) out.push({ kind, range: node.range, node });
      if (kind === "list" && isListNode(node)) out.push({ kind, range: node.range, node });
    }
    return out;
  }
  for (const block of scan.blocks) {
    if (block.kind === kind) out.push({ kind, range: block.range, block });
  }
  return out;
}

/** null when `source` may be copied; otherwise the reason it may not. */
function sourceIneligibility(
  doc: ParsedDocument,
  composites: CompositeBlockInfo[],
  source: ResolvedSource
): BlockCopyRejectReason | null {
  // A CompositeBlock member (its anchor list item or its callout/blockquote
  // member) is never copied on its own — only standalone blocks are copy
  // sources in this phase (the composite as a whole is not either).
  if (composites.some((c) => c.members.some((m) => sameRange(m.range, source.range)))) {
    return "copy-composite-member";
  }
  if (source.kind === "section") return null;
  if (source.kind === "list") return source.node.unsafeIndent ? "copy-unsafe-indent" : null;
  if (source.block.editability !== "supported") return "copy-unsupported-kind";
  if (isOwnedByList(doc, source.block.parentId)) return "copy-nested-in-list";
  return null;
}

/**
 * Builds a copy snapshot for `ref` against `doc`/`scan` (the CURRENT text),
 * or reports why it cannot be copied. Cheap and pure — safe to call at
 * context-menu build time to decide whether "Copy block" is available.
 */
export function buildBlockCopySnapshot(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  ref: BlockCopySourceRef
): Result<BlockCopySnapshot> {
  if (!isBlockCopyKind(ref.kind)) return fail("copy-unsupported-kind");
  const source = findSourceAt(doc, scan, ref.kind, ref.range);
  if (!source) return fail("copy-source-changed");
  const bad = sourceIneligibility(doc, composites, source);
  if (bad) return fail(bad);
  return {
    ok: true,
    value: {
      kind: ref.kind,
      range: { startLine: source.range.startLine, endLine: source.range.endLine },
      lines: sliceRange(doc.lines, source.range),
    },
  };
}

/**
 * Re-resolves `snapshot` against the CURRENT text: a block of the same kind
 * whose lines are exactly the snapshot's lines. The block still at the
 * snapshot's own range wins; otherwise exactly one content match is
 * required (the source may have shifted because of an edit above it).
 */
function resolveSnapshotSource(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  snapshot: BlockCopySnapshot
): Result<ResolvedSource> {
  if (!isBlockCopyKind(snapshot.kind) || snapshot.lines.length === 0) return fail("copy-source-changed");
  const matches = allSourceCandidates(doc, scan, snapshot.kind).filter((c) =>
    linesEqual(sliceRange(doc.lines, c.range), snapshot.lines)
  );
  const exact = matches.find((c) => sameRange(c.range, snapshot.range));
  const chosen = exact ?? (matches.length === 1 ? matches[0] : null);
  if (!chosen) return fail(matches.length === 0 ? "copy-source-changed" : "copy-source-ambiguous");
  const bad = sourceIneligibility(doc, composites, chosen);
  if (bad) return fail(bad);
  return { ok: true, value: chosen };
}

/**
 * Where the pending copy's source currently is, or null when it can no
 * longer be resolved (changed / gone / ambiguous). Display-only helper
 * for the Outline Tree's "this row is being copied" marker — never a
 * substitute for the paste-time re-resolution inside pasteBlockCopy.
 */
export function locateBlockCopySource(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  snapshot: BlockCopySnapshot
): LineRange | null {
  const r = resolveSnapshotSource(doc, scan, composites, snapshot);
  return r.ok ? r.value.range : null;
}

// ---- Target resolution --------------------------------------------------------

function resolveTargetHint(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  hint: BlockCopyTargetHint
): ResolvedTarget | null {
  switch (hint.kind) {
    case "section":
    case "list":
      for (const node of doc.nodes.values()) {
        if (!sameRange(node.range, hint.range) || node.parentId !== hint.parentId) continue;
        if (hint.kind === "section" && isSectionNode(node)) return { kind: "section", range: node.range, node };
        if (hint.kind === "list" && isListNode(node)) return { kind: "list", range: node.range, node };
      }
      return null;
    case "complex":
    case "paragraph": {
      const block = scan.blocks.find(
        (b) =>
          (hint.kind === "paragraph" ? b.kind === "paragraph" : b.kind !== "paragraph") &&
          sameRange(b.range, hint.range) &&
          b.parentId === hint.parentId
      );
      return block ? { kind: hint.kind, range: block.range, block } : null;
    }
    case "composite": {
      const composite = composites.find((c) => sameRange(c.range, hint.range));
      return composite ? { kind: "composite", range: composite.range, composite } : null;
    }
  }
}

/** The target that "Duplicate below" pastes after: the source itself. */
function selfTarget(source: ResolvedSource): ResolvedTarget {
  if (source.kind === "section") return { kind: "section", range: source.range, node: source.node };
  if (source.kind === "list") return { kind: "list", range: source.range, node: source.node };
  return {
    kind: source.kind === "paragraph" ? "paragraph" : "complex",
    range: source.range,
    block: source.block,
  };
}

function isSameBlock(source: ResolvedSource, target: ResolvedTarget): boolean {
  if (!sameRange(source.range, target.range)) return false;
  if (source.kind === "section") return target.kind === "section";
  if (source.kind === "list") return target.kind === "list";
  return target.kind === (source.kind === "paragraph" ? "paragraph" : "complex");
}

function targetParentId(target: ResolvedTarget): string | null {
  if (target.kind === "section" || target.kind === "list") return target.node.parentId;
  if (target.kind === "composite") return null;
  return target.block.parentId;
}

// ---- Placement ----------------------------------------------------------------

const MAX_HEADING_LEVEL = 6;

function resolvePlacement(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  source: ResolvedSource,
  target: ResolvedTarget,
  position: BlockPastePosition
): Result<Placement> {
  const S = source.range;
  const T = target.range;
  const self = isSameBlock(source, target);

  // Pasting relative to something INSIDE the source (a descendant section/
  // list item, or a block within the copied range) is always refused.
  if (!self && T.startLine >= S.startLine && T.endLine <= S.endLine) return fail("copy-inside-source");
  if (self && position === "inside") return fail("copy-inside-source");

  let placement: Placement;
  if (source.kind === "section") {
    if (target.kind !== "section") return fail("copy-invalid-target");
    if (position === "before") {
      placement = { insertAt: T.startLine, separate: true };
    } else if (position === "after") {
      placement = { insertAt: T.endLine + 1, separate: true };
    } else {
      const newRootLevel = target.node.headingLevel + 1;
      const delta = newRootLevel - source.node.headingLevel;
      for (const sec of collectSectionSubtree(doc, source.node)) {
        if (sec.headingLevel + delta > MAX_HEADING_LEVEL) return fail("copy-max-heading-level");
      }
      placement = { insertAt: T.endLine + 1, newRootLevel, separate: true };
    }
  } else if (source.kind === "list") {
    if (target.kind === "list") {
      if (target.node.unsafeIndent) return fail("copy-unsafe-indent");
      if (position === "before") {
        placement = { insertAt: T.startLine, newIndentColumns: target.node.indentColumns, separate: false };
      } else if (position === "after") {
        placement = { insertAt: T.endLine + 1, newIndentColumns: target.node.indentColumns, separate: false };
      } else {
        placement = {
          insertAt: T.endLine + 1,
          newIndentColumns: childIndentColumnsOf(doc, target.node),
          separate: false,
        };
      }
    } else if (target.kind === "section") {
      placement = {
        insertAt: position === "before" ? T.startLine : ownContentInsertionLine(doc, target.node),
        newIndentColumns: 0,
        separate: true,
      };
    } else {
      return fail("copy-invalid-target");
    }
  } else {
    // flat source (callout / blockquote / fenced-code / table / paragraph)
    if (target.kind === "section") {
      placement = {
        insertAt: position === "before" ? T.startLine : ownContentInsertionLine(doc, target.node),
        separate: true,
      };
    } else {
      if (position === "inside") return fail("copy-invalid-target");
      if (isOwnedByList(doc, targetParentId(target))) return fail("copy-invalid-target");
      placement = { insertAt: position === "before" ? T.startLine : T.endLine + 1, separate: true };
    }
  }

  const x = placement.insertAt;
  if (x > S.startLine && x <= S.endLine) return fail("copy-inside-source");
  if (x < 0 || x > doc.lines.length) return fail("copy-unsafe-position");
  if (x < doc.lines.length && doc.frontmatterLines[x]) return fail("copy-unsafe-position");
  if (x > 0 && x < doc.lines.length && doc.codeBlockLines[x - 1] && doc.codeBlockLines[x]) {
    return fail("copy-unsafe-position");
  }
  for (const c of composites) {
    if (x > c.range.startLine && x <= c.range.endLine) return fail("copy-composite-internal-boundary");
  }
  for (const b of scan.blocks) {
    if (x > b.range.startLine && x <= b.range.endLine) return fail("copy-unsafe-position");
  }
  return { ok: true, value: placement };
}

// ---- Build + verify ---------------------------------------------------------

const COPY_LIST_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/;
const COPY_HEADING_RE = /^#{1,6}[ \t]/;

function isNonBlank(line: string | undefined): line is string {
  return line !== undefined && line.trim() !== "";
}

/**
 * Blank-line separation around a pasted copy: first exactly the D&D
 * executor's own `ensureBlankSeparation` (edit/dropStandaloneComplexBlock.ts,
 * reused unchanged — a blank line next to any neighbor that is not blank,
 * a heading or a list line), then two copy-specific additions that D&D
 * never needed because it only ever relocated a block the user was
 * looking at:
 *
 *   - flat copy (callout/blockquote/fenced-code/table/paragraph) next to a
 *     LIST line also gets a blank line. Without it a pasted callout/
 *     blockquote right after a single-line list item would silently form a
 *     brand-new CompositeBlock with it, and a pasted paragraph right before
 *     an ordered item not numbered "1." would be rendered as one lazily
 *     continued paragraph by CommonMark — both "unintended merges".
 *   - section copy followed directly by a heading gets a blank line after
 *     its last non-blank line (purely cosmetic; a heading needs none).
 *
 * Never removes or doubles an existing blank line.
 */
function ensureCopySeparation(
  lines: string[],
  start: number,
  length: number,
  kind: BlockCopyKind
): { lines: string[]; newStart: number } {
  let { lines: out, newStart: s } = ensureBlankSeparation(lines, start, length);
  const end = s + length - 1;
  if (isBlockCopyFlatKind(kind)) {
    if (isNonBlank(out[end + 1]) && COPY_LIST_LINE_RE.test(out[end + 1])) {
      out = [...out.slice(0, end + 1), "", ...out.slice(end + 1)];
    }
    if (isNonBlank(out[s - 1]) && COPY_LIST_LINE_RE.test(out[s - 1])) {
      out = [...out.slice(0, s), "", ...out.slice(s)];
      s += 1;
    }
  } else if (kind === "section") {
    if (isNonBlank(out[end]) && isNonBlank(out[end + 1]) && COPY_HEADING_RE.test(out[end + 1])) {
      out = [...out.slice(0, end + 1), "", ...out.slice(end + 1)];
    }
  }
  return { lines: out, newStart: s };
}

interface BuiltCopy {
  lines: string[];
  /** Where the inserted segment (copy + separators) begins, in both old and new numbering. */
  segStart: number;
  /** Number of inserted lines (copy + separators). */
  segCount: number;
  copyStart: number;
  copyLength: number;
}

function buildCopyLines(
  doc: ParsedDocument,
  source: ResolvedSource,
  placement: Placement
): BuiltCopy | null {
  let copy = sliceRange(doc.lines, source.range);

  if (source.kind === "list" && placement.newIndentColumns !== undefined) {
    const delta = placement.newIndentColumns - source.node.indentColumns;
    const useTabs = leadingWhitespace(copy[0]).includes("\t");
    copy = reindent(copy, 0, copy.length - 1, delta, useTabs);
  }
  if (source.kind === "section" && placement.newRootLevel !== undefined) {
    const delta = placement.newRootLevel - source.node.headingLevel;
    if (delta !== 0) {
      for (const sec of collectSectionSubtree(doc, source.node)) {
        copy = setHeadingLevel(copy, sec.range.startLine - source.range.startLine, sec.headingLevel + delta);
      }
    }
  }

  const spliced = insertBlockAtPosition(doc.lines, placement.insertAt, copy.join("\n"), 0, 0);
  if (!spliced) return null;
  let out = spliced.lines;
  let copyStart = placement.insertAt;
  if (placement.separate) {
    const sep = ensureCopySeparation(out, placement.insertAt, copy.length, source.kind);
    out = sep.lines;
    copyStart = sep.newStart;
  }
  return {
    lines: out,
    segStart: placement.insertAt,
    segCount: out.length - doc.lines.length,
    copyStart,
    copyLength: copy.length,
  };
}

/**
 * Structure-preservation check — see this module's top doc comment,
 * Safety §4. Returns true only when every pre-existing structure survived
 * (line-shifted only) and the inserted segment is a faithful replica of
 * the source.
 */
function verifyCopyStructure(
  before: { doc: ParsedDocument; scan: ComplexBlockScanResult; composites: CompositeBlockInfo[] },
  source: ResolvedSource,
  placement: Placement,
  built: BuiltCopy,
  rules: CompositeBlockRule[]
): boolean {
  const afterDoc = parseDocument(built.lines.join("\n"));
  const afterScan = scanComplexBlocks(afterDoc);
  const afterComposites = matchCompositeBlocks(afterDoc, afterScan, rules);

  const segEnd = built.segStart + built.segCount - 1;
  const inSeg = (line: number) => line >= built.segStart && line <= segEnd;
  const shift = (line: number) => (line < built.segStart ? line : line + built.segCount);
  const S = source.range;
  const inSource = (line: number) => line >= S.startLine && line <= S.endLine;
  const relSrc = (line: number) => line - S.startLine;
  const relCopy = (line: number) => line - built.copyStart;

  // (1) BlockNodes (sections / list items): keyed by start line.
  const beforeNodeKey = (id: string | null): string => {
    if (!id) return "-";
    const n = before.doc.nodes.get(id);
    return n ? `${n.type}@${shift(n.range.startLine)}` : "?";
  };
  const afterNodeKey = (id: string | null): string => {
    if (!id) return "-";
    const n = afterDoc.nodes.get(id);
    return n ? `${n.type}@${n.range.startLine}` : "?";
  };
  const outsideBefore = [...before.doc.nodes.values()].map(
    (n) => `${n.type}:${shift(n.range.startLine)}:${n.depth}:${beforeNodeKey(n.parentId)}`
  );
  const afterNodes = [...afterDoc.nodes.values()];
  const outsideAfter = afterNodes
    .filter((n) => !inSeg(n.range.startLine))
    .map((n) => `${n.type}:${n.range.startLine}:${n.depth}:${afterNodeKey(n.parentId)}`);
  if (!sameMultiset(outsideBefore, outsideAfter)) return false;

  const srcNodes = [...before.doc.nodes.values()].filter((n) => inSource(n.range.startLine));
  const copyNodes = afterNodes.filter((n) => inSeg(n.range.startLine));
  const srcRootDepth = srcNodes.length > 0 ? Math.min(...srcNodes.map((n) => n.depth)) : 0;
  const copyRootDepth = copyNodes.length > 0 ? Math.min(...copyNodes.map((n) => n.depth)) : 0;
  if (
    !sameMultiset(
      srcNodes.map((n) => `${n.type}:${relSrc(n.range.startLine)}:${n.depth - srcRootDepth}`),
      copyNodes.map((n) => `${n.type}:${relCopy(n.range.startLine)}:${n.depth - copyRootDepth}`)
    )
  ) {
    return false;
  }

  // (2) Complex blocks: keyed by kind + full extent + editability.
  const blockInSeg = (b: ComplexBlockInfo) => inSeg(b.range.startLine) && inSeg(b.range.endLine);
  const blockInSource = (b: ComplexBlockInfo) => inSource(b.range.startLine) && inSource(b.range.endLine);
  if (
    !sameMultiset(
      before.scan.blocks.map((b) => `${b.kind}:${shift(b.range.startLine)}:${shift(b.range.endLine)}:${b.editability}`),
      afterScan.blocks
        .filter((b) => !blockInSeg(b))
        .map((b) => `${b.kind}:${b.range.startLine}:${b.range.endLine}:${b.editability}`)
    )
  ) {
    return false;
  }
  if (
    !sameMultiset(
      before.scan.blocks
        .filter(blockInSource)
        .map((b) => `${b.kind}:${relSrc(b.range.startLine)}:${relSrc(b.range.endLine)}:${b.editability}`),
      afterScan.blocks
        .filter(blockInSeg)
        .map((b) => `${b.kind}:${relCopy(b.range.startLine)}:${relCopy(b.range.endLine)}:${b.editability}`)
    )
  ) {
    return false;
  }

  // (3) CompositeBlocks: keyed by rule + every member's kind/extent.
  const compositeInSeg = (c: CompositeBlockInfo) => inSeg(c.range.startLine) && inSeg(c.range.endLine);
  const compositeInSource = (c: CompositeBlockInfo) => inSource(c.range.startLine) && inSource(c.range.endLine);
  const compositeKey = (c: CompositeBlockInfo, map: (l: number) => number) =>
    c.ruleId + "|" + c.members.map((m) => `${m.kind}:${map(m.range.startLine)}:${map(m.range.endLine)}`).join(",");
  if (
    !sameMultiset(
      before.composites.map((c) => compositeKey(c, shift)),
      afterComposites.filter((c) => !compositeInSeg(c)).map((c) => compositeKey(c, (l) => l))
    )
  ) {
    return false;
  }
  if (
    !sameMultiset(
      before.composites.filter(compositeInSource).map((c) => compositeKey(c, relSrc)),
      afterComposites.filter(compositeInSeg).map((c) => compositeKey(c, relCopy))
    )
  ) {
    return false;
  }

  // (4) The copy's own root is recognized exactly where it was put.
  const copyEnd = built.copyStart + built.copyLength - 1;
  if (source.kind === "section") {
    const expectedLevel = placement.newRootLevel ?? source.node.headingLevel;
    const root = afterNodes.find((n) => isSectionNode(n) && n.range.startLine === built.copyStart);
    if (!root || !isSectionNode(root) || root.headingLevel !== expectedLevel) return false;
  } else if (source.kind === "list") {
    const root = afterNodes.find((n) => isListNode(n) && n.range.startLine === built.copyStart);
    if (!root || !isListNode(root) || root.range.endLine !== copyEnd) return false;
    if (placement.newIndentColumns !== undefined && root.indentColumns !== placement.newIndentColumns) return false;
  } else {
    const root = afterScan.blocks.find(
      (b) =>
        b.kind === source.kind &&
        b.range.startLine === built.copyStart &&
        b.range.endLine === copyEnd &&
        b.editability === "supported"
    );
    if (!root || isOwnedByList(afterDoc, root.parentId)) return false;
  }

  return true;
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const k of a) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const k of b) {
    const c = counts.get(k);
    if (!c) return false;
    counts.set(k, c - 1);
  }
  return true;
}

// ---- Public entry points ------------------------------------------------------

function copyAt(
  text: string,
  snapshot: BlockCopySnapshot,
  pickTarget: (
    doc: ParsedDocument,
    scan: ComplexBlockScanResult,
    composites: CompositeBlockInfo[],
    source: ResolvedSource
  ) => ResolvedTarget | null,
  position: BlockPastePosition,
  rules: CompositeBlockRule[]
): BlockCopyOutcome {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, scan, rules);

  const source = resolveSnapshotSource(doc, scan, composites, snapshot);
  if (!source.ok) return rejected(doc.lines, source.reason);

  const target = pickTarget(doc, scan, composites, source.value);
  if (!target) return rejected(doc.lines, "copy-target-changed");

  const placement = resolvePlacement(doc, scan, composites, source.value, target, position);
  if (!placement.ok) return rejected(doc.lines, placement.reason);

  const built = buildCopyLines(doc, source.value, placement.value);
  if (!built) return rejected(doc.lines, "copy-unsafe-position");

  if (!verifyCopyStructure({ doc, scan, composites }, source.value, placement.value, built, rules)) {
    return rejected(doc.lines, "copy-structure-changed");
  }

  return {
    changed: true,
    lines: built.lines,
    newStartLine: built.copyStart,
    newCursorCh: 0,
    insertedRange: { startLine: built.copyStart, endLine: built.copyStart + built.copyLength - 1 },
  };
}

export interface BlockPasteRequest {
  snapshot: BlockCopySnapshot;
  target: BlockCopyTargetHint;
  position: BlockPastePosition;
}

/**
 * Pastes an independent copy of `request.snapshot`'s block at
 * `request.position` relative to `request.target`, in `text`. The source
 * block itself is never modified. `rules` must be the caller's currently-
 * enabled CompositeBlockRule set.
 */
export function pasteBlockCopy(
  text: string,
  request: BlockPasteRequest,
  rules: CompositeBlockRule[]
): BlockCopyOutcome {
  return copyAt(
    text,
    request.snapshot,
    (doc, scan, composites) => resolveTargetHint(doc, scan, composites, request.target),
    request.position,
    rules
  );
}

/**
 * "Duplicate below": inserts an independent copy of `snapshot`'s block
 * directly after the block itself (after its whole subtree for a section/
 * list item), at the same heading level / indentation.
 */
export function duplicateBlockBelow(
  text: string,
  snapshot: BlockCopySnapshot,
  rules: CompositeBlockRule[]
): BlockCopyOutcome {
  return copyAt(text, snapshot, (_doc, _scan, _composites, source) => selfTarget(source), "after", rules);
}

/**
 * A short, single-line human label for a copied block (Notices / the Tree's
 * copy banner): its first non-blank line, with heading/list/quote markers
 * stripped, truncated to `max` characters.
 */
export function blockCopyLabel(lines: readonly string[], max = 40): string {
  const first = lines.find((l) => l.trim() !== "") ?? "";
  const stripped = first
    .trim()
    .replace(/^#{1,6}[ \t]+/, "")
    .replace(/^(?:>[ \t]?)+/, "")
    .replace(/^(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?/, "")
    .trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

/** Whether a rejection means the pending copy itself is no longer usable (so the copy-pending state should be dropped). */
export function isBlockCopySourceLost(reason: BlockCopyRejectReason | undefined): boolean {
  return reason === "copy-source-changed" || reason === "copy-source-ambiguous";
}
