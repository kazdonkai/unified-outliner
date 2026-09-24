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
import { isListNode, ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { MirrorNode, MirrorResolutionResult, MirrorSource } from "./mirrorTypes";
import { parseMirrorEmbed } from "./parseMirrorEmbed";
import { applyMirrorCycles, resolveMirrorSource } from "./resolveMirrorSource";

// Phase 5M-1: resolution moved to its own module (mirror/resolveMirrorSource.ts);
// re-exported here so Phase 5M-0 call sites/tests keep working unchanged.
export { normalizeMirrorHeading, resolveMirrorSource } from "./resolveMirrorSource";

/** One recognized mirror embed plus its resolution and where it sits. */
export interface MirrorProjection {
  node: MirrorNode;
  resolution: MirrorResolutionResult;
  /** The paragraph ComplexBlockInfo id the embed line was recognized from (scan-local). */
  paragraphBlockId: string;
  /** The embed line's own parent: its section id, or null at the top level. */
  parentId: string | null;
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

  const resolutions = applyMirrorCycles(
    projections.map((p) => p.node),
    projections.map((p) => p.resolution)
  );
  projections.forEach((p, i) => {
    p.resolution = resolutions[i];
  });
  return projections;
}
