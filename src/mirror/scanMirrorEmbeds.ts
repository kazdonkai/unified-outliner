/**
 * Phase 5M-0: recognizes single-note mirror embeds in an already-parsed
 * note and resolves each one — the projection layer the Outline Tree's
 * read-only "Mirror: …" rows are built from.
 *
 * "Extending the existing parser" is done here, as a layer ON TOP of
 * parser/complexBlocks.ts rather than inside it: an embed line such as
 * `![[#Heading]]` is already recognized by scanComplexBlocks as a one-line
 * paragraph, so a mirror candidate is exactly a paragraph ComplexBlockInfo
 * that is
 *   - `editability === "supported"`,
 *   - a single line,
 *   - not owned by a list item (same "top-level / section-direct only"
 *     scope Phase 5P-3's paragraph rows and Phase 5E-0's fenced-code/table
 *     rows use), and
 *   - parsed as a same-note embed by parseMirrorEmbed.
 * parseDocument / scanComplexBlocks themselves are untouched, so with the
 * setting off nothing about parsing changes at all.
 *
 * Pure, Obsidian-free.
 */
import { isListNode, isSectionNode, LineRange, ParsedDocument, SectionBlockNode } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { detectMirrorCycle } from "./detectMirrorCycle";
import { MirrorNode, MirrorResolutionResult, MirrorSource } from "./mirrorTypes";
import { parseMirrorEmbed } from "./parseMirrorEmbed";

/** One recognized mirror embed plus its resolution and where it sits. */
export interface MirrorProjection {
  node: MirrorNode;
  resolution: MirrorResolutionResult;
  /** The paragraph ComplexBlockInfo id the embed line was recognized from (scan-local). */
  paragraphBlockId: string;
  /** The embed line's own parent: its section id, or null at the top level. */
  parentId: string | null;
}

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

function resolveHeading(doc: ParsedDocument, path: string[]): LineRange | null {
  const wanted = path.map(normalizeMirrorHeading);
  const last = wanted[wanted.length - 1];
  const sections = [...doc.nodes.values()]
    .filter(isSectionNode)
    .sort((a, b) => a.range.startLine - b.range.startLine);
  for (const section of sections) {
    if (normalizeMirrorHeading(section.headingText) !== last) continue;
    // Earlier path segments must appear, in order, among the ancestors.
    const ancestors = ancestorSections(doc, section).map((s) => normalizeMirrorHeading(s.headingText));
    let i = 0;
    for (const a of ancestors) if (i < wanted.length - 1 && a === wanted[i]) i++;
    if (i === wanted.length - 1) return { startLine: section.range.startLine, endLine: section.range.endLine };
  }
  return null;
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

function resolveBlockId(doc: ParsedDocument, blocks: ComplexBlockInfo[], blockId: string): LineRange | null {
  let idLine = -1;
  for (let i = 0; i < doc.lines.length; i++) {
    if (doc.frontmatterLines[i] || doc.codeBlockLines[i]) continue;
    const m = BLOCK_ID_AT_END_RE.exec(doc.lines[i]);
    if (m && m[1] === blockId) {
      idLine = i;
      break;
    }
  }
  if (idLine === -1) return null;

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

/** Resolves one parsed mirror source against the note (no cycle check — see scanMirrorEmbeds). */
export function resolveMirrorSource(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  source: MirrorSource
): MirrorResolutionResult {
  const range =
    source.kind === "heading"
      ? resolveHeading(doc, source.headingPath ?? (source.headingText ? [source.headingText] : []))
      : source.blockId
        ? resolveBlockId(doc, blocks, source.blockId)
        : null;
  if (!range) return { status: "unresolved", reason: "not-found", source: { ...source, lineRange: null } };
  return { status: "resolved", source: { ...source, lineRange: range } };
}

/** Human label target for a mirror: the heading text, or `^block-id`. */
export function mirrorTargetLabel(source: MirrorSource): string {
  return source.kind === "heading" ? (source.headingPath ?? [source.headingText ?? ""]).join(" › ") : `^${source.blockId ?? ""}`;
}

/**
 * Every single-note mirror embed in `doc`, in document order, each
 * resolved and cycle-checked. `blocks` is the caller's
 * `scanComplexBlocks(doc).blocks`; `notePath` is the note's own path.
 */
export function scanMirrorEmbeds(
  doc: ParsedDocument,
  blocks: ComplexBlockInfo[],
  notePath: string
): MirrorProjection[] {
  const candidates = blocks
    .filter(
      (b) =>
        b.kind === "paragraph" &&
        b.editability === "supported" &&
        b.range.startLine === b.range.endLine &&
        !(b.parentId && doc.nodes.get(b.parentId) && isListNode(doc.nodes.get(b.parentId)!))
    )
    .sort((a, b) => a.range.startLine - b.range.startLine);

  const projections: MirrorProjection[] = [];
  let ordinal = 0;
  for (const block of candidates) {
    const parsed = parseMirrorEmbed(doc.lines[block.range.startLine], notePath);
    if (!parsed) continue;
    ordinal++;
    const resolution = resolveMirrorSource(doc, blocks, parsed);
    projections.push({
      node: { id: `mirror-${ordinal}`, kind: parsed.kind, source: resolution.source, embedLine: block.range.startLine },
      resolution,
      paragraphBlockId: block.id,
      parentId: block.parentId,
    });
  }

  const { cyclicIds, cycles } = detectMirrorCycle(projections.map((p) => p.node));
  for (const p of projections) {
    if (!cyclicIds.has(p.node.id)) continue;
    const cycle = cycles.find((c) => c.includes(p.node.id)) ?? [p.node.id];
    const from = cycle.indexOf(p.node.id);
    p.resolution = {
      status: "cycle",
      cycle: [...cycle.slice(from), ...cycle.slice(0, from)],
      source: p.node.source,
    };
  }
  return projections;
}
