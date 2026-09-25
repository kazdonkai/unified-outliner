/**
 * Phase 5M-2: the single predicate "is this complex block a same-note mirror
 * embed line?" — shared by Phase 5M-2's widening of the EXISTING standalone
 * Move/Delete pipelines (parser/compositeBlocks.ts#
 * evaluateStandaloneComplexBlockMovability, edit/moveStandaloneComplexBlock.ts,
 * edit/deleteStandaloneComplexBlock.ts) so a mirror row can reuse them
 * without any mirror-specific move/delete logic of its own.
 *
 * Exactly the shape Phase 5M-0's scanMirrorEmbeds recognizes as a mirror:
 * a supported, single-line paragraph not owned by a list item, whose line
 * parses as a same-note embed. Pure, Obsidian-free; depends only on the
 * dependency-free parser, so parser/* may import it without a cycle.
 */
import { ParsedDocument } from "../model/block";
import { ComplexBlockInfo } from "../model/complexBlock";
import { parseMirrorEmbed } from "./parseMirrorEmbed";

export function isMirrorEmbedBlock(doc: ParsedDocument, info: ComplexBlockInfo): boolean {
  if (info.kind !== "paragraph" || info.editability !== "supported") return false;
  if (info.range.startLine !== info.range.endLine) return false;
  if (info.parentId) {
    const owner = doc.nodes.get(info.parentId);
    if (owner && owner.type === "list") return false;
  }
  return parseMirrorEmbed(doc.lines[info.range.startLine] ?? "", "") !== null;
}
