/**
 * Cursor -> "minimal safe block to move" resolution.
 *
 * Ticket (2026-08-11, "Move block up/down の対象を最小安全ブロックへ"): the
 * body-editor "Move block up/down" command used to resolve ANY cursor
 * position inside a section (including a plain body paragraph that is not
 * inside any list) to that section's own BlockNode — because
 * resolver/resolveCurrentBlock.ts's `lineToOwningNodeId` has no notion of
 * "paragraph" at all (see model/block.ts: a SectionBlockNode IS the whole
 * subtree, not just the heading line), every non-list body line resolved to
 * "the enclosing section," and Move block therefore moved the WHOLE section
 * even when the user's intent was "move just this paragraph." This module
 * is the fix: it re-resolves the cursor to the narrowest Markdown-safe unit
 * BEFORE any move decision is made, using the existing block model for
 * section/list and Phase 5C's complex-block scanner
 * (parser/complexBlocks.ts) for everything else.
 *
 * Design boundary (read before extending): this module answers ONLY "what
 * would Move block operate on right now, from this cursor line, and what is
 * its adjacent sibling in that direction" — for section/list units it is a
 * thin, non-duplicating wrapper around the EXISTING, already-tested
 * move/findMoveTarget.ts + move/moveBlock.ts pair (same sibling-tracking
 * fields, same cross-section list hop, same unsafe-indent guard — nothing
 * about that path changes). Only paragraph/complex-block units
 * (callout/blockquote/fenced-code/table/paragraph) get NEW logic here,
 * because those are not BlockNode's and have no prevSiblingId/nextSiblingId
 * to walk (see model/complexBlock.ts's doc comment: ComplexBlockInfo values
 * are never inserted into ParsedDocument.nodes).
 *
 * Paragraph-as-move-unit note: docs/mixed-structure-spec.md §6 and
 * parser/complexBlocks.ts's scanParagraphBlocks doc comment establish that
 * paragraphs are NEVER a drag & drop / Partial Edit Pane / Tree-node target
 * ("read-only" editability, a permanent policy for those features). This
 * ticket does not revisit that policy — a paragraph still never becomes a
 * Tree row, is still not addressable by id outside a single Move block
 * invocation, and still cannot be opened in the Partial Edit Pane. "Move
 * block" is a narrower, new capability: cut-and-reinsert a contiguous
 * paragraph range in place, exactly the same swapBlocks() primitive
 * section/list moves already use — never a per-line splice. See
 * isSafeToMoveComplexBlock's doc comment for the precise safety gate this
 * introduces, which deliberately does NOT just reuse ComplexBlockInfo's
 * `editability` field as-is (that field's "read-only" value has a different,
 * pre-existing meaning for paragraphs specifically).
 */
import {
  BlockNode,
  isListNode,
  isSectionNode,
  LineRange,
  ParsedDocument,
} from "../model/block";
import { ComplexBlockInfo, ComplexBlockKind } from "../model/complexBlock";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { isBlankLine } from "../parser/parseDocument";
import { resolveCurrentBlock } from "../resolver/resolveCurrentBlock";
import { defaultTranslator, Translator } from "../i18n";
import { MoveDirection } from "./findMoveTarget";
import { swapBlocks } from "./moveBlock";

/** Every kind Move block up/down can now resolve to. */
export type MoveUnitKind = "section" | "list" | ComplexBlockKind;

export interface ResolvedMoveUnit {
  kind: MoveUnitKind;
  range: LineRange;
  /** Enclosing section id, enclosing list-item id, or null (top-of-document / no enclosing container). */
  parentId: string | null;
  /** Set when kind is "section" or "list" — the underlying BlockNode id (move/moveBlock.ts's existing path). */
  nodeId?: string;
  /**
   * Set when kind is a ComplexBlockKind — parser/complexBlocks.ts's
   * scan-local ComplexBlockInfo id. NOT stable across re-parses (see that
   * type's own doc comment), so callers must resolve it again from a fresh
   * scan rather than caching it across an edit.
   */
  complexBlockId?: string;
}

export type ResolveMoveUnitReason =
  | "code-block"
  | "frontmatter"
  | "out-of-range"
  | "no-block"
  | "boundary-unknown";

export interface ResolveMoveUnitResult {
  unit: ResolvedMoveUnit | null;
  reason?: ResolveMoveUnitReason;
}

function isSafeToMoveComplexBlock(block: ComplexBlockInfo): boolean {
  // Paragraph's "read-only" editability means something narrower than
  // "unsafe" here — see this module's top doc comment. A paragraph is safe
  // to relocate as a whole via Move block precisely when its boundary was
  // confidently determined at all (the ordinary case scanParagraphBlocks
  // reports as "read-only"); an "ambiguous" paragraph (boundary genuinely
  // uncertain — e.g. it crosses an existing section/list boundary) is never
  // safe, matching the ticket's "境界を安全に確定できない場合は移動を拒否".
  if (block.kind === "paragraph") return block.editability === "read-only";
  // callout/blockquote/fenced-code/table: only the scanner's strongest
  // confidence level is safe to move — "unsupported" (unmodeled nested
  // structure) and "ambiguous" (boundary itself uncertain) are both
  // rejected, per model/complexBlock.ts's BlockEditability doc comment.
  return block.editability === "supported";
}

function resolveComplexUnitAt(
  doc: ParsedDocument,
  cursorLine: number
): ResolveMoveUnitResult {
  const scan = scanComplexBlocks(doc);
  const block = scan.blocks.find(
    (b) => cursorLine >= b.range.startLine && cursorLine <= b.range.endLine
  );
  if (!block) {
    return { unit: null, reason: "no-block" };
  }
  if (!isSafeToMoveComplexBlock(block)) {
    return { unit: null, reason: "boundary-unknown" };
  }
  return {
    unit: {
      kind: block.kind,
      range: block.range,
      parentId: block.parentId,
      complexBlockId: block.id,
    },
  };
}

/**
 * Resolution rules (ticket §4B):
 *   1. cursor on a heading LINE -> section
 *   2. cursor anywhere in a list item (marker or continuation body) -> that list subtree
 *   3. cursor inside a confidently-bounded callout/blockquote/fenced-code/table -> that block
 *   4. cursor inside an ordinary paragraph -> paragraph
 *   5. anything else (ambiguous/unsupported boundary, code block,
 *      frontmatter, out of range) -> reject, never guess.
 */
export function resolveMoveUnit(
  doc: ParsedDocument,
  cursorLine: number
): ResolveMoveUnitResult {
  // resolver/resolveCurrentBlock.ts unconditionally rejects any line inside
  // a fenced code block (reason "code-block") — a guard that predates this
  // ticket and exists so move/indent/etc. never misread a heading- or
  // list-marker-LOOKING line inside a fence as a real heading/list item.
  // That guard is still correct for THOSE commands, but it would also
  // block this ticket's new "fenced-code is itself a movable unit"
  // requirement (rule 4: "...fenced-codeの内部なら、その複合ブロック全体").
  // Route codeBlockLines through the complex-block scanner FIRST, instead
  // of through resolveCurrentBlock at all, so a confidently-bounded fenced
  // code block still resolves correctly; an unterminated/malformed fence
  // (not in the scanner's output) falls through to "no-block" from
  // resolveComplexUnitAt exactly as it should.
  if (cursorLine >= 0 && cursorLine < doc.lines.length && doc.codeBlockLines[cursorLine]) {
    return resolveComplexUnitAt(doc, cursorLine);
  }

  const resolved = resolveCurrentBlock(doc, cursorLine);
  if (!resolved.node) {
    // "no-block" specifically means "no section/list owns this line" —
    // which is exactly the legitimate case of top-of-document content
    // before the first heading (a paragraph, callout, blockquote, or table
    // that sits before any "# ..." line has parentId: null, per
    // model/complexBlock.ts's ComplexBlockInfo doc comment). Frontmatter,
    // out-of-range, and (pre-fence-fix) code-block reasons are genuine
    // rejections resolveCurrentBlock already got right and are passed
    // through unchanged.
    if (resolved.reason === "no-block" || resolved.reason === undefined) {
      return resolveComplexUnitAt(doc, cursorLine);
    }
    return {
      unit: null,
      reason: resolved.reason as ResolveMoveUnitReason,
    };
  }

  if (isSectionNode(resolved.node)) {
    if (cursorLine !== resolved.node.range.startLine) {
      // Cursor is somewhere in the section's OWN body — not the heading
      // line itself, and not inside a child list item (resolveCurrentBlock
      // would have returned that list node instead). This is exactly the
      // case the old behavior got wrong: re-resolve via the complex-block
      // scanner instead of falling back to "the whole section".
      return resolveComplexUnitAt(doc, cursorLine);
    }
    return {
      unit: {
        kind: "section",
        range: resolved.node.range,
        parentId: resolved.node.parentId,
        nodeId: resolved.node.id,
      },
    };
  }

  // List node (marker line or continuation line — either way the whole
  // subtree is the minimal safe unit, unchanged from the existing
  // move/indent model). Deliberately does NOT dig further into a complex
  // block that might be nested inside this item's own continuation text
  // (e.g. "- item\n  > a blockquote inside the list item") — rule 2 in this
  // module's top doc comment ("カーソルが list item の marker または本文にある
  // なら list subtree") takes priority over rules 3/4 by the ticket's own
  // stated rule ORDER, and list continuation text is already established
  // (docs/mixed-structure-spec.md, parser/complexBlocks.ts's
  // scanParagraphBlocks doc comment) as belonging to its owning list item
  // rather than being independently addressable. findComplexSiblingTarget
  // below still correctly HANDLES a complex block whose parentId is a list
  // item (model/complexBlock.ts documents this as a real, scanner-level
  // case), so this scope decision only affects cursor-based RESOLUTION —
  // nothing else in this module assumes complex blocks are section-only.
  return {
    unit: {
      kind: "list",
      range: resolved.node.range,
      parentId: resolved.node.parentId,
      nodeId: resolved.node.id,
    },
  };
}

export function isComplexMoveUnit(
  kind: MoveUnitKind
): kind is ComplexBlockKind {
  return kind !== "section" && kind !== "list";
}

/**
 * Walk up from any BlockNode to its nearest enclosing SectionBlockNode id —
 * used by "Move section up/down" to resolve "the enclosing section"
 * regardless of how deep the cursor is nested (a list item several levels
 * down, a subsection, ...). Returns null if there is no enclosing section at
 * all (e.g. a root list item that sits before the document's first
 * heading).
 */
export function findEnclosingSectionId(
  doc: ParsedDocument,
  node: BlockNode
): string | null {
  let current: BlockNode | null = node;
  while (current) {
    if (isSectionNode(current)) return current.id;
    current = current.parentId ? doc.nodes.get(current.parentId) ?? null : null;
  }
  return null;
}

export type ResolveEnclosingSectionReason =
  | ResolveMoveUnitReason
  | "not-in-section";

export interface ResolveEnclosingSectionResult {
  sectionId: string | null;
  reason?: ResolveEnclosingSectionReason;
}

/**
 * "Move section up/down"'s own resolution: the enclosing section for ANY
 * cursor position inside it — heading line, own body paragraph, a nested
 * list item at any depth, or inside a nested subsection. This intentionally
 * reuses the OLD (pre-ticket) "Move block" behavior of "resolve to the
 * deepest enclosing section, no matter where the cursor is" — that
 * behavior is correct and wanted for a command explicitly named "Move
 * section"; it was only ever a bug under the name "Move block up/down"
 * (see this module's top doc comment).
 */
export function resolveEnclosingSectionId(
  doc: ParsedDocument,
  cursorLine: number
): ResolveEnclosingSectionResult {
  const resolved = resolveCurrentBlock(doc, cursorLine);
  if (!resolved.node) {
    return {
      sectionId: null,
      reason: (resolved.reason as ResolveMoveUnitReason) ?? "no-block",
    };
  }
  const sectionId = findEnclosingSectionId(doc, resolved.node);
  if (!sectionId) {
    return { sectionId: null, reason: "not-in-section" };
  }
  return { sectionId };
}

// ---------------------------------------------------------------------
// Sibling resolution + apply for paragraph/complex-block units.
// ---------------------------------------------------------------------

export type ComplexSiblingReason = "no-sibling" | "boundary-unknown";

export type ComplexSiblingTarget =
  | { kind: "swap"; withId: string; withRange: LineRange }
  | { kind: "none"; reason: ComplexSiblingReason };

/**
 * Finds the adjacent paragraph/complex block in `direction` that shares the
 * SAME parentId as `unit` (the enclosing section, the enclosing list item,
 * or null for content before the first heading), with nothing but blank
 * lines between the two ranges. A non-blank gap — a list item, a
 * (sub)section heading, or an unsafe/ambiguous complex block sitting
 * between them — means there is no safe sibling in that direction: reject
 * rather than reaching across it, matching the ticket's "境界を安全に確定
 * できない場合は移動を拒否" and "交換相手となる前後の兄弟 block が存在しない"
 * requirements. This deliberately does NOT hop across list/section
 * boundaries the way root list items may (move/findMoveTarget.ts's
 * "insert" cross-section hop) — paragraph/complex-block moves stay within
 * their own container, a narrower and more conservative scope than list
 * moves ever had.
 */
export function findComplexSiblingTarget(
  doc: ParsedDocument,
  unit: ResolvedMoveUnit,
  direction: MoveDirection,
  scan = scanComplexBlocks(doc)
): ComplexSiblingTarget {
  const candidates = scan.blocks.filter((b) => {
    if (b.id === unit.complexBlockId) return false;
    if (b.parentId !== unit.parentId) return false;
    return isSafeToMoveComplexBlock(b);
  });

  let picked: ComplexBlockInfo | null = null;
  if (direction === "up") {
    for (const c of candidates) {
      if (
        c.range.endLine < unit.range.startLine &&
        (!picked || c.range.endLine > picked.range.endLine)
      ) {
        picked = c;
      }
    }
    if (!picked) return { kind: "none", reason: "no-sibling" };
    for (let l = picked.range.endLine + 1; l < unit.range.startLine; l++) {
      if (!isBlankLine(doc.lines[l])) return { kind: "none", reason: "boundary-unknown" };
    }
  } else {
    for (const c of candidates) {
      if (
        c.range.startLine > unit.range.endLine &&
        (!picked || c.range.startLine < picked.range.startLine)
      ) {
        picked = c;
      }
    }
    if (!picked) return { kind: "none", reason: "no-sibling" };
    for (let l = unit.range.endLine + 1; l < picked.range.startLine; l++) {
      if (!isBlankLine(doc.lines[l])) return { kind: "none", reason: "boundary-unknown" };
    }
  }

  return { kind: "swap", withId: picked.id, withRange: picked.range };
}

export interface MoveComplexBlockOutcome {
  changed: boolean;
  lines: string[];
  newStartLine: number;
  reason?: ComplexSiblingReason | "resolve-failed";
}

/**
 * Pure apply step for a paragraph/complex-block move: cut-and-reinsert via
 * the exact same swapBlocks() primitive move/moveBlock.ts's section/list
 * swap already uses (never a line-by-line splice — see that function's own
 * doc comment). No ordered-list renumbering here (unlike moveBlock.ts's
 * normalizeOrderedLists step): paragraphs and complex blocks are never
 * list markers.
 */
export function moveComplexBlock(
  doc: ParsedDocument,
  unit: ResolvedMoveUnit,
  direction: MoveDirection,
  scan = scanComplexBlocks(doc)
): MoveComplexBlockOutcome {
  const target = findComplexSiblingTarget(doc, unit, direction, scan);
  if (target.kind === "none") {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: target.reason };
  }
  const r = swapBlocks(doc.lines, unit.range, target.withRange);
  return { changed: true, lines: r.lines, newStartLine: r.newStartOfA };
}

// Re-exported for convenience so callers (main.ts) that need to describe a
// list unit's subtree size for the move-result toast don't need a second
// import just for isListNode.
export { isListNode };

/** Total number of descendant list items (children, grandchildren, ...) under a list node — used only for the move-result toast's "子項目 N 件を含む" wording. */
function countListDescendants(doc: ParsedDocument, node: BlockNode): number {
  let count = 0;
  for (const childId of node.childIds) {
    count++;
    const child = doc.nodes.get(childId);
    if (child) count += countListDescendants(doc, child);
  }
  return count;
}

const COMPLEX_KIND_KEY: Record<ComplexBlockKind, "unit.callout" | "unit.blockquote" | "unit.codeBlock" | "unit.table" | "unit.paragraph"> = {
  callout: "unit.callout",
  blockquote: "unit.blockquote",
  "fenced-code": "unit.codeBlock",
  table: "unit.table",
  paragraph: "unit.paragraph",
};

/**
 * Human-readable label for the move-result toast (main.ts's
 * announceMoveResult). i18n実装 (2026-08-11): `t` is now an OPTIONAL
 * Translator (src/i18n.ts), defaulting to `defaultTranslator` (English) so
 * every pre-existing caller/test that doesn't pass one keeps this
 * function's original English-by-default behavior byte-for-byte — see
 * tests/resolveMoveTarget.test.ts, which calls this with 2 args and still
 * expects exact English strings. Production callers (main.ts) pass the
 * plugin's own live translator so this toast follows the language setting.
 * Pure and Obsidian-free either way (Translator is just a plain function),
 * so this stays testable alongside the rest of this module.
 */
export function describeMoveUnit(
  doc: ParsedDocument,
  unit: ResolvedMoveUnit,
  t: Translator = defaultTranslator
): string {
  if (unit.kind === "section") {
    const node = unit.nodeId ? doc.nodes.get(unit.nodeId) : null;
    const heading =
      node && isSectionNode(node) && node.headingText.length > 0
        ? node.headingText
        : t("unit.untitledHeading");
    return t("unit.sectionNamed", { heading });
  }
  if (unit.kind === "list") {
    const node = unit.nodeId ? doc.nodes.get(unit.nodeId) : null;
    const count = node ? countListDescendants(doc, node) : 0;
    if (count === 0) return t("unit.listItem");
    return t(count === 1 ? "unit.listItemWithNestedOne" : "unit.listItemWithNestedMany", {
      count,
    });
  }
  return t(COMPLEX_KIND_KEY[unit.kind]);
}
