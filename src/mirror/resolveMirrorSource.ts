/**
 * Phase 5M-1 ("ミラーの作成 UI と参照先解決"): resolution of a single-note
 * mirror's referenced ("source") side — moved here from Phase 5M-0's
 * mirror/scanMirrorEmbeds.ts (which re-exports it unchanged) and extended
 * with duplicate reporting. Pure, Obsidian-free.
 *
 *   - heading: the FIRST heading (document order) whose text matches —
 *     compared after dropping the characters Obsidian cannot keep in a link
 *     (see normalizeMirrorHeading) — honoring a nested `#A#B` path through
 *     the ancestors. When more than one heading matches, the first one is
 *     still used (Obsidian's own behavior) and `matchCount` reports how
 *     many matched, so a caller can warn.
 *   - block-id: the block identified by the (first) line carrying `^id` —
 *     a list item with an inline id is the item with its children; a line
 *     holding only `^id` labels the block before it (Obsidian's convention
 *     for callouts/quotes/tables/code); otherwise the smallest supported
 *     block containing the line. `matchCount` > 1 means the id is not unique.
 *   - not found: `{ status: "unresolved", reason: "not-found" }`.
 *
 * Cycles are decided over a whole set of mirrors with Phase 5M-0's
 * detectMirrorCycle — see applyMirrorCycles / resolveMirrorGraph below.
 */
import { isListNode, isSectionNode, LineRange, ParsedDocument, SectionBlockNode } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { detectMirrorCycle } from "./detectMirrorCycle";
import { MirrorNode, MirrorResolutionResult, MirrorSource } from "./mirrorTypes";

/** Heading text as Obsidian compares it in a link: link-special characters dropped, whitespace collapsed. */
export function normalizeMirrorHeading(text: string): string {
  return text
    .replace(/[#|^:%[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ancestorSections(doc: ParsedDocument, section: SectionBlockNode): SectionBlockNode[] {
  const out: SectionBlockNode[] = [];
  let parentId = section.parentId;
  while (parentId) {
    const parent = doc.nodes.get(parentId);
    if (!parent || !isSectionNode(parent)) break;
    out.unshift(parent);
    parentId = parent.parentId;
  }
  return out;
}

function resolveHeading(doc: ParsedDocument, path: string[]): { range: LineRange; matchCount: number } | null {
  const wanted = path.map(normalizeMirrorHeading);
  const last = wanted[wanted.length - 1];
  const sections = [...doc.nodes.values()]
    .filter(isSectionNode)
    .sort((a, b) => a.range.startLine - b.range.startLine);
  let first: LineRange | null = null;
  let matchCount = 0;
  for (const section of sections) {
    if (normalizeMirrorHeading(section.headingText) !== last) continue;
    // Earlier path segments must appear, in order, among the ancestors.
    const ancestors = ancestorSections(doc, section).map((s) => normalizeMirrorHeading(s.headingText));
    let i = 0;
    for (const a of ancestors) if (i < wanted.length - 1 && a === wanted[i]) i++;
    if (i !== wanted.length - 1) continue;
    matchCount++;
    if (!first) first = { startLine: section.range.startLine, endLine: section.range.endLine };
  }
  return first ? { range: first, matchCount } : null;
}

const BLOCK_ID_AT_END_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

function smallestContaining(blocks: ComplexBlockInfo[], line: number): ComplexBlockInfo | null {
  let best: ComplexBlockInfo | null = null;
  for (const b of blocks) {
    if (b.editability !== "supported") continue;
    if (line < b.range.startLine || line > b.range.endLine) continue;
    if (!best || b.range.endLine - b.range.startLine < best.range.endLine - best.range.startLine) best = b;
  }
  return best;
}

/** Every line (outside frontmatter / fenced code) that ends with `^blockId`, in order. */
export function findBlockIdLines(doc: ParsedDocument, blockId: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < doc.lines.length; i++) {
    if (doc.frontmatterLines[i] || doc.codeBlockLines[i]) continue;
    const m = BLOCK_ID_AT_END_RE.exec(doc.lines[i]);
    if (m && m[1] === blockId) out.push(i);
  }
  return out;
}

function resolveBlockId(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  blockId: string
): { range: LineRange; matchCount: number } | null {
  const idLines = findBlockIdLines(doc, blockId);
  if (idLines.length === 0) return null;
  const range = blockRangeForIdLine(doc, blocks, blockId, idLines[0]);
  return { range, matchCount: idLines.length };
}

/** The block a `^blockId` found on `idLine` identifies (see this module's top doc comment). */
export function blockRangeForIdLine(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  blockId: string,
  idLine: number
): LineRange {
  // A line holding ONLY "^id" labels the block right before it (Obsidian's
  // convention for lists/tables/quotes) — resolve from that block instead.
  let anchorLine = idLine;
  if (doc.lines[idLine].trim() === `^${blockId}`) {
    let k = idLine - 1;
    while (k >= 0 && doc.lines[k].trim() === "") k--;
    if (k >= 0) anchorLine = k;
  }

  // Deepest list item containing the line (a "- item ^id" embeds the item).
  let deepestList: { start: number; end: number; depth: number } | null = null;
  for (const n of doc.nodes.values()) {
    if (!isListNode(n)) continue;
    if (anchorLine < n.range.startLine || anchorLine > n.range.endLine) continue;
    if (!deepestList || n.depth > deepestList.depth) {
      deepestList = { start: n.range.startLine, end: n.range.endLine, depth: n.depth };
    }
  }
  if (deepestList) return { startLine: deepestList.start, endLine: Math.max(deepestList.end, idLine) };

  const block = smallestContaining(blocks, anchorLine);
  if (block) return { startLine: block.range.startLine, endLine: Math.max(block.range.endLine, idLine) };
  return { startLine: anchorLine, endLine: idLine };
}

/** Resolves one parsed mirror source against the note (no cycle check — see applyMirrorCycles). */
export function resolveMirrorSource(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  source: MirrorSource
): MirrorResolutionResult {
  const hit =
    source.kind === "heading"
      ? resolveHeading(doc, source.headingPath ?? (source.headingText ? [source.headingText] : []))
      : source.blockId
        ? resolveBlockId(doc, blocks, source.blockId)
        : null;
  if (!hit) return { status: "unresolved", reason: "not-found", source: { ...source, lineRange: null } };
  return { status: "resolved", source: { ...source, lineRange: hit.range }, matchCount: hit.matchCount };
}

/**
 * Re-marks every mirror that lies on a cycle (Phase 5M-0's
 * detectMirrorCycle over `nodes`, whose `source.lineRange` must already be
 * resolved) as `{ status: "cycle" }`. `resolutions[i]` belongs to `nodes[i]`.
 */
export function applyMirrorCycles(
  nodes: readonly MirrorNode[],
  resolutions: readonly MirrorResolutionResult[]
): MirrorResolutionResult[] {
  const { cyclicIds, cycles } = detectMirrorCycle(nodes);
  return nodes.map((node, i) => {
    if (!cyclicIds.has(node.id)) return resolutions[i];
    const cycle = cycles.find((c) => c.includes(node.id)) ?? [node.id];
    const from = cycle.indexOf(node.id);
    return { status: "cycle", cycle: [...cycle.slice(from), ...cycle.slice(0, from)], source: node.source };
  });
}

