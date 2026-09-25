/**
 * Phase 5P-2: cursor position -> the single paragraph it belongs to, if
 * any. A pure, Obsidian-free resolver, INDEPENDENT of
 * move/resolveMoveTarget.ts's resolveMoveUnit — that module resolves the
 * "minimal safe MOVE unit" at a cursor, which for a line inside a list
 * item (including a list-item-child paragraph, per Phase 5P-1) is
 * deliberately the ENCLOSING LIST SUBTREE, never the paragraph itself —
 * see that module's own "Paragraph-as-move-unit note" and Phase 5P-1R's
 * isSafeToMoveComplexBlock guard (move/resolveMoveTarget.ts), which
 * exists specifically to keep Move block's surface pinned to its pre-5P-1
 * scope. This resolver answers a different question — "is the cursor on
 * a paragraph that can be hoisted into the Partial Edit Pane, and if so,
 * which one, exactly" — and deliberately DOES accept a list-item-child
 * paragraph as a valid resolution target: Partial Edit hoist has no
 * relationship with Move block's list-scope restriction (see
 * docs/phase5p_paragraph-block-foundation-plan.md §7's 5P-2 scope).
 *
 * This resolver is the sole "extract" step for Phase 5P-2's paragraph
 * Partial Edit hoist — see edit/paragraphPartialEdit.ts for the matching
 * "apply" step (a separate module, not this one, because Apply-time
 * re-resolution needs additional identity bookkeeping — see that module's
 * own doc comment for why). It never inserts anything into
 * ParsedDocument.nodes, never assigns a persistent id to a paragraph
 * (Markdown text is the plugin's only source of truth — see
 * docs/phase5p_paragraph-block-foundation-plan.md), and never touches
 * Obsidian's Editor/EditorView/DOM/Notice APIs — the returned
 * `complexBlockId` is a scan-local id (parser/complexBlocks.ts's own
 * per-call sequence, same convention as every other ComplexBlockInfo),
 * never a stored/persisted identifier.
 *
 * Resolution rules (5P-2 ticket §2-2): a paragraph resolves successfully
 * ONLY when the cursor line sits inside a parser/complexBlocks.ts-
 * recognized paragraph whose editability is "supported" (Phase 5P-1R:
 * boundary/parent/depth confidently resolved) — covering both a
 * section-direct paragraph and a list-item-child paragraph (Phase 5P-1),
 * including a top-level paragraph in a headingless note (parentId null).
 * It fails safely — never guesses — on: a blank line; an ATX heading
 * line; a list-marker line; inside a callout / blockquote / fenced-code
 * (closed or unterminated) / table / thematic-break; inside frontmatter; a
 * boundary-ambiguous paragraph candidate (crosses an existing
 * section/list boundary, or lost a merge-priority conflict — see
 * parser/complexBlocks.ts's mergeBlockRangesSafely doc comment); more than
 * one recognized block claiming the same line (defensive — should not
 * occur among genuinely accepted, non-overlapping candidates, but the
 * merge step can leave an ambiguous duplicate covering an already-accepted
 * block's own range, e.g. a table's own rows also independently
 * "recognized" — and downgraded — by the paragraph scanner); and an
 * out-of-range cursor line. A neighboring heading/list/blockquote/callout/
 * fenced-code/table/thematic-break is never folded into the resolved
 * range — the returned range is always exactly one scanner-recognized
 * paragraph candidate's own range, never wider.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { complexBlockDepth, scanComplexBlocks } from "../parser/complexBlocks";
import { blockBodyText, detectBlockIdLayout } from "../edit/partialEdit";

export type NoParagraphResolutionReason = "out-of-range" | "no-paragraph" | "boundary-ambiguous";

export interface ResolvedParagraphAtCursor {
  kind: "paragraph";
  /**
   * Stable only within the ComplexBlockInfo[] this resolution was computed
   * from (same convention as every other ComplexBlockInfo id — see
   * model/complexBlock.ts's own doc comment) — used, together with
   * parentId/depth/text below, by edit/paragraphPartialEdit.ts's Apply-time
   * re-resolution. Never persisted, never a substitute for the identity
   * checks that module performs on top of it.
   */
  complexBlockId: string;
  rangeStart: number;
  rangeEnd: number;
  parentId: string | null;
  depth: number;
  /**
   * The paragraph's own raw Markdown text (rangeStart..rangeEnd, joined
   * with "\n") — the exact fragment a Partial Edit projection shows, and
   * the "before editing" snapshot edit/paragraphPartialEdit.ts's Apply
   * step compares against.
   */
  text: string;
  /**
   * Block ID field: the paragraph's block id, separated from `text` —
   * `text` is the BODY only (an inline " ^id" suffix, or a paragraph's own
   * trailing lone "^id" line, is removed). See edit/partialEdit.ts's
   * detectBlockIdLayout for the recognized shapes.
   */
  blockId: string | null;
  /** True for a lone "^id" line; false for an inline suffix or no id. */
  blockIdIsStandaloneLine: boolean;
  /**
   * Short, single-line preview for a pane title / command feedback — the
   * paragraph's own first line, trimmed and capped. Purely cosmetic: never
   * used for identity confirmation — see edit/paragraphPartialEdit.ts,
   * which re-derives identity from parentId/depth/text, never from this
   * field.
   */
  preview: string;
}

export interface ResolveParagraphAtCursorResult {
  paragraph: ResolvedParagraphAtCursor | null;
  reason?: NoParagraphResolutionReason;
}

const PREVIEW_MAX_LENGTH = 60;

function buildPreview(text: string): string {
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length <= PREVIEW_MAX_LENGTH) return firstLine;
  return firstLine.slice(0, PREVIEW_MAX_LENGTH - 1).trimEnd() + "…";
}

/**
 * Resolve the paragraph (if any) that owns `cursorLine`.
 *
 * `complexBlocks` defaults to a fresh `scanComplexBlocks(doc).blocks`, but
 * can be passed explicitly by a caller that already has one (mirrors
 * move/resolveMoveTarget.ts's `findComplexSiblingTarget`/`moveComplexBlock`
 * own `scan = scanComplexBlocks(doc)` default-parameter convention) — this
 * is the "receives an already-computed ComplexBlockInfo group" input shape
 * the 5P-2 ticket calls for, without forcing every caller to re-scan when
 * it doesn't need to.
 */
export function resolveParagraphAtCursor(
  doc: ParsedDocument,
  cursorLine: number,
  complexBlocks: ComplexBlockInfo[] = scanComplexBlocks(doc).blocks
): ResolveParagraphAtCursorResult {
  if (cursorLine < 0 || cursorLine >= doc.lines.length) {
    return { paragraph: null, reason: "out-of-range" };
  }

  const candidates = complexBlocks.filter(
    (b) => cursorLine >= b.range.startLine && cursorLine <= b.range.endLine
  );
  if (candidates.length === 0) {
    return { paragraph: null, reason: "no-paragraph" };
  }
  // A non-paragraph kind claiming this line (callout/blockquote/fenced-code/
  // table/thematic-break) always wins the "what IS this line" question over
  // a same-range paragraph candidate that scanParagraphBlocks independently
  // (and legitimately — see that scanner's own doc comment) also produces
  // for the exact same text; see parser/complexBlocks.ts's merge priority
  // (callout > blockquote > (fenced-code, table, thematic-break) >
  // paragraph). This also correctly rejects a cursor sitting on an
  // unterminated fence's interior line, whose surrounding fenced-code
  // candidate is reported "ambiguous" rather than "supported" — see the
  // editability check below, reached only when every candidate here IS a
  // paragraph.
  if (candidates.some((b) => b.kind !== "paragraph")) {
    return { paragraph: null, reason: "no-paragraph" };
  }
  if (candidates.length > 1) {
    // Every candidate here is kind "paragraph" (checked above); more than
    // one covering the same cursor line should not occur for a genuinely
    // single, accepted candidate — fail safe rather than pick arbitrarily.
    return { paragraph: null, reason: "boundary-ambiguous" };
  }

  const block = candidates[0];
  if (block.editability !== "supported") {
    return { paragraph: null, reason: "boundary-ambiguous" };
  }

  const layout = detectBlockIdLayout(doc.lines, block.range.startLine, block.range.endLine, { inline: true });
  const text = blockBodyText(doc.lines, block.range.startLine, layout);
  return {
    paragraph: {
      kind: "paragraph",
      complexBlockId: block.id,
      rangeStart: block.range.startLine,
      rangeEnd: block.range.endLine,
      parentId: block.parentId,
      depth: complexBlockDepth(doc, block.parentId),
      text,
      blockId: layout.blockId,
      blockIdIsStandaloneLine: layout.standalone,
      preview: buildPreview(text),
    },
  };
}
