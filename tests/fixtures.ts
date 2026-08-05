import { BlockNode, ParsedDocument } from "../src/model/block";

/**
 * Shared fixture:
 *
 *  0  # A
 *  1  body a
 *  2
 *  3  - one
 *  4    - one-1
 *  5  - two
 *  6
 *  7  ## B
 *  8  - three
 *  9  - four
 * 10
 * 11  # C
 * 12  text
 */
export const FIX_BASIC = [
  "# A",
  "body a",
  "",
  "- one",
  "  - one-1",
  "- two",
  "",
  "## B",
  "- three",
  "- four",
  "",
  "# C",
  "text",
].join("\n");

export function ownerAt(doc: ParsedDocument, line: number): BlockNode {
  const id = doc.lineToOwningNodeId[line];
  if (!id) throw new Error(`no owner at line ${line}`);
  const node = doc.nodes.get(id);
  if (!node) throw new Error(`dangling id ${id}`);
  return node;
}
