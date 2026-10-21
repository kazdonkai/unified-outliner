/**
 * 1.0.8 follow-up: "List + Paragraph" member-split editing for a PARENT
 * list item (one that also has a child list).
 *
 * Such an item is never a List + Paragraph CompositeBlock — the composite
 * rule deliberately skips list items that own a child list (see
 * parser/compositeBlocks.ts matchListChildContinuation, condition 4) — so
 * the Partial Edit pane opens it through the Phase 5L-6 parent list item
 * projection (edit/parentListItemProjection.ts), whose own-text editor
 * used to show the item's first line and its child paragraph in ONE box.
 *
 * This module only decides whether that own text can be shown as two
 * boxes — the list line and the paragraph — and joins the two boxes back
 * into the exact own-text body the existing projection expects. Nothing
 * else changes: Apply, dirty tracking, conflict detection and the
 * child-subtree handling all keep running on the joined body through the
 * existing parent projection path (invertParentListItemProjection /
 * applyParentListItemOwnTextEdit / the combined child Apply), so both
 * boxes are always saved together in one write.
 *
 * The split point is never guessed from the text: the own text must be
 * exactly the item's marker line followed by ONE confidently-bounded
 * paragraph (parser/complexBlocks.ts) whose parent is this item and which
 * covers every remaining own-text line. Anything else (task / ordered
 * items, a second paragraph, a blank line, other content) returns null and
 * the pane keeps the single own-text box exactly as before.
 *
 * Round trip: for a resolved split s of projection p,
 *   joinParentOwnTextParagraphSplit(s.listBody, s.paragraphBody)
 *     === projectedParentBodyText(p)
 */
import { ParsedDocument } from "../model/block";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { ParentListItemProjection } from "./parentListItemProjection";

export interface ParentOwnTextParagraphSplit {
  /** The marker-free first line, as the existing own-text projection shows it. */
  listBody: string;
  /** The paragraph lines, as the existing own-text projection shows them (continuation indent removed; block id kept as text). */
  paragraphBody: string;
}

export function resolveParentOwnTextParagraphSplit(
  doc: ParsedDocument,
  projection: ParentListItemProjection
): ParentOwnTextParagraphSplit | null {
  if (projection.ownText.listKind !== "unordered") return null;
  const { startLine, endLine } = projection.ownTextRange;
  if (endLine <= startLine) return null;
  const overlapping = scanComplexBlocks(doc).blocks.filter(
    (b) => b.range.startLine <= endLine && b.range.endLine >= startLine
  );
  if (overlapping.length !== 1) return null;
  const para = overlapping[0];
  if (
    para.kind !== "paragraph" ||
    para.editability !== "supported" ||
    para.parentId !== projection.nodeId ||
    para.range.startLine !== startLine + 1 ||
    para.range.endLine !== endLine
  ) {
    return null;
  }
  const bodyLines = projection.ownText.body.split("\n");
  if (bodyLines.length !== endLine - startLine + 1) return null;
  const split = { listBody: bodyLines[0], paragraphBody: bodyLines.slice(1).join("\n") };
  if (split.paragraphBody.trim() === "") return null;
  return split;
}

/**
 * Joins the two boxes into the own-text body. A line break typed into the
 * list box (the box already turns one into a space) is turned into a space
 * here too, so list text can never spill into the paragraph. An emptied
 * paragraph box drops the paragraph lines — the same text the single box
 * produced when every paragraph line was deleted.
 */
export function joinParentOwnTextParagraphSplit(listBody: string, paragraphBody: string): string {
  const list = listBody.replace(/\r?\n|\r/g, " ");
  return paragraphBody === "" ? list : `${list}\n${paragraphBody}`;
}
