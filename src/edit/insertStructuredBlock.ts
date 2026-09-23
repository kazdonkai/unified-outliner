/**
 * Phase 5E-3a ("ツリーペインでの fenced-code / table 新規挿入"): pure,
 * Obsidian-free insertion of a brand-new fenced code block or Markdown table
 * immediately below a section heading or a list item, as chosen from the
 * Outline Tree's context menu.
 *
 * Three layers, each independently testable:
 *
 *   1. `insertBlockAtPosition` — the shared, lowest-level splice. Takes the
 *      document's lines, a 0-based insertion line, the block's text and the
 *      number of blank lines to add before/after; returns the new lines
 *      plus the inserted block's own line range. It never removes, merges
 *      or re-normalizes any existing line (existing blank runs survive
 *      byte-for-byte). Designed for reuse by future insert features
 *      (Phase 5M mirror insertion) — it knows nothing about headings,
 *      lists, fences or tables.
 *   2. `resolveStructuredInsertionPoint` — decides WHERE a new block may go
 *      below a given section/list Tree node, or refuses:
 *        - section: directly after its heading line (the first position
 *          inside the section). A non-heading block can never be a true
 *          "sibling" of a section in Markdown — anything placed after a
 *          section's range is absorbed by its deepest last subsection — so
 *          "below the heading" is the only unambiguous section position.
 *        - list item: directly after the item's whole subtree, as the
 *          LIST's next sibling block — only when the item is a root-level
 *          item AND the last item of its list (the next non-blank line
 *          after it is neither a list line nor an indented line). Anywhere
 *          else the new block would either land inside the list (as an
 *          item's child content) or split one list into two — both refused
 *          as "inside a list" per the ticket's rejection rules.
 *   3. `insertStructuredBlockBelowNode` — resolve + splice + a generic
 *      post-insert STRUCTURE-PRESERVATION check: re-parse the result and
 *      require that (a) the new block is recognized as a supported block of
 *      the expected kind exactly at the inserted range, (b) every
 *      pre-existing section/list node and every pre-existing complex block
 *      (fenced code, table, callout, blockquote, paragraph, …) still exists
 *      with the same kind at its line-shifted position, and (c) every
 *      pre-existing CompositeBlock still matches with the same members.
 *      Any difference — a fence pairing that changed, a composite that
 *      split, a paragraph that merged — refuses the insert and leaves the
 *      original lines untouched. This is the ticket's "既存の fenced-code
 *      の対応関係が壊れる / CompositeBlock の構成が変わる可能性がある場合は
 *      拒否" rule, enforced by comparison against ground truth rather than
 *      by predicting every shape in advance.
 *
 * The returned outcome is a LineEditOutcome, applied by the caller through
 * the existing single write path (commands/applyLineEditOutcome.ts via
 * view/OutlineTreeView.ts#dispatchAndApply) — one `replaceRange`, hence
 * one Undo step. No new write path is introduced.
 *
 * Not touched: parser/*, conflict detection, tree/insertionFramework.ts
 * (the Phase 5E-0.5/5E-1 adjacent-to-fenced/table resolver, still unwired),
 * edit/insertBlock.ts, edit/insertParagraph.ts.
 */
import { isListNode, isSectionNode, LineRange, ParsedDocument } from "../model/block";
import { ComplexBlockKind } from "../model/complexBlock";
import { CompositeBlockRule } from "../model/compositeBlock";
import { isBlankLine, parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";

// ---- Layer 1: shared splice -----------------------------------------------

export interface InsertBlockAtPositionResult {
  lines: string[];
  /** The inserted block's own lines (padding blank lines excluded), in the NEW document. */
  range: LineRange;
}

/**
 * Splices `blockText` (split on "\n") into `lines` before index `insertAt`
 * (0 ≤ insertAt ≤ lines.length), preceded by `blankBefore` and followed by
 * `blankAfter` empty lines. Returns null for an out-of-range position, a
 * negative/non-integer blank count, or an empty block. `lines` is never
 * mutated.
 */
export function insertBlockAtPosition(
  lines: readonly string[],
  insertAt: number,
  blockText: string,
  blankBefore: number,
  blankAfter: number
): InsertBlockAtPositionResult | null {
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > lines.length) return null;
  if (!Number.isInteger(blankBefore) || blankBefore < 0) return null;
  if (!Number.isInteger(blankAfter) || blankAfter < 0) return null;
  if (blockText.length === 0) return null;
  const blockLines = blockText.split("\n");
  const segment = [
    ...Array<string>(blankBefore).fill(""),
    ...blockLines,
    ...Array<string>(blankAfter).fill(""),
  ];
  const startLine = insertAt + blankBefore;
  return {
    lines: [...lines.slice(0, insertAt), ...segment, ...lines.slice(insertAt)],
    range: { startLine, endLine: startLine + blockLines.length - 1 },
  };
}

/**
 * The minimum blank-line padding a new standalone block needs at
 * `insertAt`: one blank line on a side only when the existing neighbor on
 * that side is a non-blank line. Existing blank lines are counted as
 * sufficient and are never added to (no normalization, no double blanks).
 * The document edges need no padding.
 */
export function computeRequiredBlankLines(
  lines: readonly string[],
  insertAt: number
): { before: number; after: number } {
  const prev = insertAt > 0 ? lines[insertAt - 1] : undefined;
  const next = insertAt < lines.length ? lines[insertAt] : undefined;
  return {
    before: prev !== undefined && !isBlankLine(prev) ? 1 : 0,
    after: next !== undefined && !isBlankLine(next) ? 1 : 0,
  };
}

// ---- Layer 2: insertion point -----------------------------------------------

export type NoStructuredInsertReason =
  | "resolve-failed"
  | "structured-insert-not-a-target"
  | "structured-insert-inside-list"
  | "structured-insert-unsafe-position"
  | "structured-insert-invalid-template"
  | "structured-insert-structure-changed"
  | "structured-insert-not-recognized";

export type StructuredInsertionPoint =
  | { ok: true; insertAt: number }
  | { ok: false; reason: NoStructuredInsertReason };

const LIST_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/;

/**
 * See this module's top doc comment (layer 2) for the placement rules.
 * Pure over `doc`; cheap enough to call at context-menu build time to
 * decide whether the menu items are enabled.
 */
export function resolveStructuredInsertionPoint(
  doc: ParsedDocument,
  nodeId: string
): StructuredInsertionPoint {
  const node = doc.nodes.get(nodeId);
  if (!node) return { ok: false, reason: "resolve-failed" };

  if (isSectionNode(node)) {
    const headingLine = node.range.startLine;
    if (doc.frontmatterLines[headingLine] || doc.codeBlockLines[headingLine]) {
      return { ok: false, reason: "structured-insert-unsafe-position" };
    }
    return { ok: true, insertAt: headingLine + 1 };
  }

  if (isListNode(node)) {
    if (node.parentId !== null) {
      const parent = doc.nodes.get(node.parentId);
      if (!parent || isListNode(parent)) {
        return { ok: false, reason: "structured-insert-inside-list" };
      }
    }
    const insertAt = node.range.endLine + 1;
    let k = insertAt;
    while (k < doc.lines.length && isBlankLine(doc.lines[k])) k++;
    if (k < doc.lines.length) {
      const nextLine = doc.lines[k];
      if (doc.codeBlockLines[k] && k > 0 && doc.codeBlockLines[k - 1]) {
        // The next content line sits INSIDE a code block that already
        // started before it — the item's range and the code block
        // overlap in a way this phase does not try to interpret.
        return { ok: false, reason: "structured-insert-unsafe-position" };
      }
      if (LIST_LINE_RE.test(nextLine)) {
        return { ok: false, reason: "structured-insert-inside-list" };
      }
      if (/^[ \t]/.test(nextLine)) {
        // An indented line right after the item could be a lazily-attached
        // continuation of it — boundary not confidently known.
        return { ok: false, reason: "structured-insert-unsafe-position" };
      }
    }
    return { ok: true, insertAt };
  }

  return { ok: false, reason: "structured-insert-not-a-target" };
}

// ---- Layer 3: resolve + splice + verify ---------------------------------------

export type StructuredBlockKind = Extract<ComplexBlockKind, "fenced-code" | "table">;

export interface StructuredInsertOutcome extends LineEditOutcome {
  newCursorCh: number;
  reason?: NoStructuredInsertReason;
  /** Set on success: the new block's own range (padding excluded) in the new document. */
  insertedRange?: LineRange;
}

function rejected(lines: string[], reason: NoStructuredInsertReason): StructuredInsertOutcome {
  return { changed: false, lines, newStartLine: -1, newCursorCh: 0, reason };
}

/**
 * Inserts `blockLines` (raw lines of a new `kind` block — see
 * edit/codeBlockPresets.ts's buildFencedCodeBlockLines /
 * buildTableTemplateLines) below Tree node `nodeId` in `text`, or refuses
 * with a stable reason and the original lines unchanged. `rules` must be
 * the caller's currently-enabled CompositeBlockRule set (used for the
 * composite-preservation check).
 */
export function insertStructuredBlockBelowNode(
  text: string,
  nodeId: string,
  kind: StructuredBlockKind,
  blockLines: readonly string[],
  rules: CompositeBlockRule[]
): StructuredInsertOutcome {
  const doc = parseDocument(text);
  if (blockLines.length === 0 || blockLines.some((l) => /[\r\n]/.test(l))) {
    return rejected(doc.lines, "structured-insert-invalid-template");
  }

  const point = resolveStructuredInsertionPoint(doc, nodeId);
  if (!point.ok) return rejected(doc.lines, point.reason);

  const pad = computeRequiredBlankLines(doc.lines, point.insertAt);
  const spliced = insertBlockAtPosition(doc.lines, point.insertAt, blockLines.join("\n"), pad.before, pad.after);
  if (!spliced) return rejected(doc.lines, "structured-insert-unsafe-position");

  const insertedCount = spliced.lines.length - doc.lines.length;
  const shift = (line: number): number => (line < point.insertAt ? line : line + insertedCount);

  const afterText = spliced.lines.join("\n");
  const afterDoc = parseDocument(afterText);

  // (a) the new block is recognized, supported, exactly where we put it.
  const beforeScan = scanComplexBlocks(doc);
  const afterScan = scanComplexBlocks(afterDoc);
  const recognized = afterScan.blocks.find(
    (b) =>
      b.kind === kind &&
      b.range.startLine === spliced.range.startLine &&
      b.range.endLine === spliced.range.endLine &&
      b.editability === "supported"
  );
  if (!recognized) return rejected(doc.lines, "structured-insert-not-recognized");

  // (b) every pre-existing BlockNode and complex block survives, shifted.
  if (afterDoc.nodes.size !== doc.nodes.size) {
    return rejected(doc.lines, "structured-insert-structure-changed");
  }
  const afterNodeKeys = new Set(
    [...afterDoc.nodes.values()].map((n) => `${n.type}:${n.range.startLine}:${n.depth}`)
  );
  for (const n of doc.nodes.values()) {
    if (!afterNodeKeys.has(`${n.type}:${shift(n.range.startLine)}:${n.depth}`)) {
      return rejected(doc.lines, "structured-insert-structure-changed");
    }
  }
  // Blocks lying ENTIRELY inside the inserted segment (padding included)
  // belong to the new block itself and are excluded from the comparison —
  // e.g. scanParagraphBlocks' own pre-existing behavior of also reporting a
  // pipe table's lines as an overlapping "ambiguous" paragraph candidate,
  // which happens for every table, new or old. Anything straddling the
  // segment's edge is NOT excluded, so it can never match a shifted
  // pre-existing block and is refused below.
  const segStart = point.insertAt;
  const segEnd = point.insertAt + insertedCount - 1;
  const outsideSegment = afterScan.blocks.filter(
    (b) => !(b.range.startLine >= segStart && b.range.endLine <= segEnd)
  );
  const complexKey = (k: string, r: LineRange, e: string) => `${k}:${r.startLine}:${r.endLine}:${e}`;
  const afterComplexKeys = new Set(outsideSegment.map((b) => complexKey(b.kind, b.range, b.editability)));
  if (outsideSegment.length !== beforeScan.blocks.length) {
    return rejected(doc.lines, "structured-insert-structure-changed");
  }
  for (const b of beforeScan.blocks) {
    const shifted = { startLine: shift(b.range.startLine), endLine: shift(b.range.endLine) };
    if (!afterComplexKeys.has(complexKey(b.kind, shifted, b.editability))) {
      return rejected(doc.lines, "structured-insert-structure-changed");
    }
  }

  // (c) every pre-existing CompositeBlock keeps the same members.
  const beforeComposites = matchCompositeBlocks(doc, beforeScan, rules);
  const afterComposites = matchCompositeBlocks(afterDoc, afterScan, rules);
  if (beforeComposites.length !== afterComposites.length) {
    return rejected(doc.lines, "structured-insert-structure-changed");
  }
  const compositeKey = (ruleId: string, members: { kind: string; range: LineRange }[]) =>
    ruleId + "|" + members.map((m) => `${m.kind}:${m.range.startLine}:${m.range.endLine}`).join(",");
  const afterCompositeKeys = new Set(afterComposites.map((c) => compositeKey(c.ruleId, c.members)));
  for (const c of beforeComposites) {
    const shiftedMembers = c.members.map((m) => ({
      kind: m.kind,
      range: { startLine: shift(m.range.startLine), endLine: shift(m.range.endLine) },
    }));
    if (!afterCompositeKeys.has(compositeKey(c.ruleId, shiftedMembers))) {
      return rejected(doc.lines, "structured-insert-structure-changed");
    }
  }

  return {
    changed: true,
    lines: spliced.lines,
    newStartLine: spliced.range.startLine,
    newCursorCh: 0,
    insertedRange: spliced.range,
  };
}

/**
 * After a successful insert has been applied, finds the new block's
 * current complex-block id (ids are sequence-based, e.g. "fenced-2", so
 * they must be looked up fresh against the post-insert text) for opening
 * it in the Partial Edit Pane. Null if not found as a supported block.
 */
export function findInsertedStructuredBlockId(
  text: string,
  kind: StructuredBlockKind,
  range: LineRange
): string | null {
  const scan = scanComplexBlocks(parseDocument(text));
  const hit = scan.blocks.find(
    (b) =>
      b.kind === kind &&
      b.range.startLine === range.startLine &&
      b.range.endLine === range.endLine &&
      b.editability === "supported"
  );
  return hit ? hit.id : null;
}
