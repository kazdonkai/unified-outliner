/**
 * v1.0.4: pure, Obsidian-free projection of a "List item + Paragraph"
 * CompositeBlock (model/compositeBlock.ts — rule "list-paragraph") for the
 * Partial Edit Pane, and its exact inverse.
 *
 * The pane shows, in this order:
 *   1. the list item's own line (the pane shows it marker-free through
 *      edit/listMarkerProjection.ts, exactly like a List + Callout list
 *      row; this module always works with the RAW line);
 *   2. the paragraph body, with the paragraph's common indentation and its
 *      existing block id removed;
 *   3. the paragraph's existing block id, read-only.
 *
 * composeListParagraphText rebuilds the composite range from the edited
 * list line and body: every non-blank body line gets the paragraph's
 * original indentation back, and the block id is re-attached INSIDE the
 * paragraph in its original shape — an inline ` ^id` suffix on the last
 * body line (original spacing kept), or the original lone `^id` line as
 * the paragraph's last line. The id never moves to the list line, is never
 * dropped, and is never created for a paragraph that had none.
 *
 * Round-trip invariant: for any accepted snapshot,
 *   composeListParagraphText(p, p.listLine, p.body).text
 *     === lines.slice(range.startLine, range.endLine + 1).join("\n")
 *
 * verifyBlockIdStaysInParagraph is the Apply-time guard: after the
 * composed text is spliced into the whole note, the id must still be the
 * block id of a confidently-bounded paragraph and sit on that paragraph's
 * last line. An edit that would break that (an empty body, a last body
 * line turned into a list item / heading, …) is refused before anything is
 * written. Any OTHER structural change (a blank line, under-indentation, a
 * child list, …) is allowed: it is written as typed, and the composite
 * simply stops matching on the next parse.
 */
import { CompositeBlockSnapshot } from "./deleteCompositeBlock";
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { readBlockIdWithinRange } from "../parser/blockIdInRange";

export type ListParagraphBlockIdShape = "inline" | "standalone";

export interface ListParagraphProjection {
  /** The list item's own line, byte-for-byte (marker and indentation included). */
  listLine: string;
  /** Longest leading-whitespace prefix shared by every paragraph line; removed for display, restored on compose. */
  indent: string;
  /** The paragraph body for display: indent removed, block id (inline suffix or lone id line) removed. */
  body: string;
  /** The paragraph's existing block id (no caret), or null. */
  blockId: string | null;
  /** Shape of `blockId`; null when there is none. */
  idShape: ListParagraphBlockIdShape | null;
  /**
   * Original id text, re-attached verbatim: for "inline", everything from
   * the whitespace before the caret to the end of the line (e.g. "  ^a1");
   * for "standalone", the whole original id line (e.g. "  ^a1").
   */
  idText: string;
}

export type BuildListParagraphProjectionOutcome =
  | { ok: true; projection: ListParagraphProjection }
  | { ok: false; reason: "not-list-paragraph" | "range-invalid" | "body-empty" };

/** True when `snapshot` has the "List item + Paragraph" member shape. */
export function isListParagraphSnapshot(snapshot: CompositeBlockSnapshot): boolean {
  return (
    snapshot.members.length === 2 &&
    snapshot.members[0].kind === "single-line-list" &&
    snapshot.members[1].kind === "paragraph"
  );
}

function commonLeadingWhitespace(lines: string[]): string {
  let prefix: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const ws = /^[ \t]*/.exec(line)![0];
    if (prefix === null) {
      prefix = ws;
      continue;
    }
    let k = 0;
    while (k < prefix.length && k < ws.length && prefix[k] === ws[k]) k++;
    prefix = prefix.slice(0, k);
  }
  return prefix ?? "";
}

const INLINE_ID_RE = /([ \t]+\^[A-Za-z0-9-]+[ \t]*)$/;

/**
 * Builds the projection from the note's CURRENT `lines` and the freshly
 * re-resolved `snapshot` (extractCompositeBlockText's resolvedSnapshot).
 */
export function buildListParagraphProjection(
  lines: readonly string[],
  snapshot: CompositeBlockSnapshot
): BuildListParagraphProjectionOutcome {
  if (!isListParagraphSnapshot(snapshot)) return { ok: false, reason: "not-list-paragraph" };
  const [list, para] = snapshot.members;
  if (
    list.range.startLine !== list.range.endLine ||
    para.range.startLine !== list.range.endLine + 1 ||
    para.range.endLine < para.range.startLine ||
    para.range.endLine >= lines.length
  ) {
    return { ok: false, reason: "range-invalid" };
  }

  const paraLines = lines.slice(para.range.startLine, para.range.endLine + 1);
  const indent = commonLeadingWhitespace(paraLines);
  const blockId = readBlockIdWithinRange(lines, para.range);

  let bodyLines = paraLines.slice();
  let idShape: ListParagraphBlockIdShape | null = null;
  let idText = "";
  if (blockId !== null) {
    const last = bodyLines[bodyLines.length - 1];
    const m = INLINE_ID_RE.exec(last);
    if (bodyLines.length > 1 && last.trim() === `^${blockId}`) {
      idShape = "standalone";
      idText = last;
      bodyLines = bodyLines.slice(0, -1);
    } else if (m) {
      idShape = "inline";
      idText = m[1];
      bodyLines[bodyLines.length - 1] = last.slice(0, m.index);
    } else {
      return { ok: false, reason: "range-invalid" };
    }
  }
  const body = bodyLines.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart())).join("\n");
  if (body.trim() === "") return { ok: false, reason: "body-empty" };

  return {
    ok: true,
    projection: { listLine: lines[list.range.startLine], indent, body, blockId, idShape, idText },
  };
}

export type ComposeListParagraphOutcome =
  | { ok: true; text: string; idLineOffset: number | null }
  | { ok: false; reason: "list-line-newline" | "body-empty-with-block-id" };

/**
 * Inverse of buildListParagraphProjection. `idLineOffset` is the 0-based
 * offset, within the returned text, of the line that carries the block id
 * (null when there is no id) — used by verifyBlockIdStaysInParagraph.
 */
export function composeListParagraphText(
  projection: ListParagraphProjection,
  editedListLine: string,
  editedBody: string
): ComposeListParagraphOutcome {
  if (editedListLine.includes("\n")) return { ok: false, reason: "list-line-newline" };
  let bodyLines = editedBody.split("\n");
  if (projection.blockId !== null) {
    // Trailing blank lines would push the id below the paragraph.
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();
    if (bodyLines.length === 0) return { ok: false, reason: "body-empty-with-block-id" };
  }
  const indented = bodyLines.map((l) => (l.trim() === "" ? "" : projection.indent + l));
  let idLineOffset: number | null = null;
  if (projection.blockId !== null) {
    if (projection.idShape === "standalone") {
      indented.push(projection.idText);
    } else {
      indented[indented.length - 1] = indented[indented.length - 1] + projection.idText;
    }
    idLineOffset = indented.length; // +1 for the list line, -1 for 0-based
  }
  return { ok: true, text: [editedListLine, ...indented].join("\n"), idLineOffset };
}

/**
 * Apply-time guard: in the whole note `lines` (after the splice), the
 * line at `idLine` must be the LAST line of a confidently-bounded
 * paragraph whose own block id is `blockId`.
 */
export function verifyBlockIdStaysInParagraph(lines: readonly string[], idLine: number, blockId: string): boolean {
  const doc = parseDocument(lines.join("\n"));
  const para = scanComplexBlocks(doc).blocks.find(
    (b) => b.kind === "paragraph" && b.range.startLine <= idLine && idLine <= b.range.endLine
  );
  if (!para || para.editability !== "supported" || para.range.endLine !== idLine) return false;
  return readBlockIdWithinRange(doc.lines, para.range) === blockId;
}

/**
 * Raw-fallback guard (a "List item + Paragraph" session that could not be
 * projected and is edited as raw text): `blockId` must still be the own
 * block id of some confidently-bounded paragraph that lies entirely within
 * `startLine..endLine` of the whole note `lines`.
 */
export function blockIdKeptInParagraphWithin(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  blockId: string
): boolean {
  const doc = parseDocument(lines.join("\n"));
  return scanComplexBlocks(doc).blocks.some(
    (b) =>
      b.kind === "paragraph" &&
      b.editability === "supported" &&
      b.range.startLine >= startLine &&
      b.range.endLine <= endLine &&
      readBlockIdWithinRange(doc.lines, b.range) === blockId
  );
}
