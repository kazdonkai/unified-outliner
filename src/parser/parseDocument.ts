/**
 * Lightweight line-scanning parser (MVP).
 *
 * Intentionally NOT a full CommonMark parser. It recognizes:
 *   - YAML frontmatter
 *   - fenced code blocks (``` / ~~~)
 *   - ATX headings (# .. ######)
 *   - list items (-, *, +, "1.", "1)") and their indented subtrees
 *
 * The parser is a pure function `parseDocument(text)` so it can be replaced
 * later by an AST-based implementation behind the same ParsedDocument shape.
 */

import {
  BlockNode,
  ListBlockNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";

export const TAB_WIDTH = 4;

const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+.*)?$/;
const FENCE_RE = /^[ \t]*(```+|~~~+)/;

export function indentColumnsOf(ws: string): number {
  let col = 0;
  for (const ch of ws) {
    if (ch === "\t") col += TAB_WIDTH - (col % TAB_WIDTH);
    else col += 1;
  }
  return col;
}

export function leadingWhitespace(line: string): string {
  const m = line.match(/^[ \t]*/);
  return m ? m[0] : "";
}

export function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function isMixedIndent(ws: string): boolean {
  return ws.includes("\t") && ws.includes(" ");
}

export function parseDocument(text: string): ParsedDocument {
  const lines = text.split("\n");
  const n = lines.length;
  const codeBlockLines = new Array<boolean>(n).fill(false);
  const frontmatterLines = new Array<boolean>(n).fill(false);
  const nodes = new Map<string, BlockNode>();
  const topLevelIds: string[] = [];
  const lineToOwningNodeId: (string | null)[] = new Array(n).fill(null);

  // ---- frontmatter ----
  if (n > 0 && lines[0] === "---") {
    let end = -1;
    for (let j = 1; j < n; j++) {
      if (lines[j] === "---" || lines[j] === "...") {
        end = j;
        break;
      }
    }
    if (end !== -1) {
      for (let j = 0; j <= end; j++) frontmatterLines[j] = true;
    }
  }

  // ---- fenced code blocks ----
  let inFence = false;
  let fenceChar = "";
  for (let j = 0; j < n; j++) {
    if (frontmatterLines[j]) continue;
    const m = lines[j].match(FENCE_RE);
    if (!inFence) {
      if (m) {
        inFence = true;
        fenceChar = m[1][0];
        codeBlockLines[j] = true;
      }
    } else {
      codeBlockLines[j] = true;
      if (m && m[1][0] === fenceChar) {
        inFence = false;
      }
    }
  }

  // ---- pass 1: sections ----
  let secSeq = 0;
  const sectionStack: SectionBlockNode[] = [];
  const allSections: SectionBlockNode[] = [];

  const closeSectionsDownTo = (level: number, endLine: number) => {
    while (
      sectionStack.length > 0 &&
      sectionStack[sectionStack.length - 1].headingLevel >= level
    ) {
      const sec = sectionStack.pop();
      if (sec) sec.range.endLine = endLine;
    }
  };

  for (let j = 0; j < n; j++) {
    if (frontmatterLines[j] || codeBlockLines[j]) continue;
    const m = lines[j].match(HEADING_RE);
    if (!m) continue;
    const level = m[1].length;
    closeSectionsDownTo(level, j - 1);
    const parent = sectionStack[sectionStack.length - 1] ?? null;
    const sec: SectionBlockNode = {
      id: `sec-${secSeq++}`,
      type: "section",
      range: { startLine: j, endLine: j },
      parentId: parent ? parent.id : null,
      prevSiblingId: null,
      nextSiblingId: null,
      childIds: [],
      depth: parent ? parent.depth + 1 : 0,
      headingLevel: level,
      headingText: m[2].trim(),
    };
    if (parent) {
      // Link with previous *section* sibling under the same parent.
      for (let k = parent.childIds.length - 1; k >= 0; k--) {
        const prev = nodes.get(parent.childIds[k]);
        if (prev && prev.type === "section") {
          prev.nextSiblingId = sec.id;
          sec.prevSiblingId = prev.id;
          break;
        }
      }
      parent.childIds.push(sec.id);
    } else {
      for (let k = topLevelIds.length - 1; k >= 0; k--) {
        const prev = nodes.get(topLevelIds[k]);
        if (prev && prev.type === "section") {
          prev.nextSiblingId = sec.id;
          sec.prevSiblingId = prev.id;
          break;
        }
      }
      topLevelIds.push(sec.id);
    }
    nodes.set(sec.id, sec);
    allSections.push(sec);
    sectionStack.push(sec);
  }
  closeSectionsDownTo(0, n - 1);

  // Fill section ownership (document order => parents before children,
  // children overwrite their sub-range afterwards).
  for (const sec of allSections) {
    for (let l = sec.range.startLine; l <= sec.range.endLine; l++) {
      lineToOwningNodeId[l] = sec.id;
    }
  }
  const lineToSectionId = lineToOwningNodeId.slice();

  // ---- pass 2: list items ----
  let liSeq = 0;
  const listStack: ListBlockNode[] = [];
  const allListItems: ListBlockNode[] = [];
  let lastRootItem: ListBlockNode | null = null;

  const closeItem = (item: ListBlockNode, beforeLine: number) => {
    let end = beforeLine - 1;
    while (end > item.range.startLine && isBlankLine(lines[end])) end--;
    item.range.endLine = Math.max(end, item.range.startLine);
  };

  const closeItemsWithIndentAtLeast = (indentCol: number, atLine: number) => {
    while (
      listStack.length > 0 &&
      listStack[listStack.length - 1].indentColumns >= indentCol
    ) {
      const item = listStack.pop();
      if (item) closeItem(item, atLine);
    }
  };
  const closeAllItems = (atLine: number) =>
    closeItemsWithIndentAtLeast(0, atLine);

  for (let j = 0; j < n; j++) {
    const line = lines[j];

    if (frontmatterLines[j]) {
      closeAllItems(j);
      lastRootItem = null;
      continue;
    }

    if (isBlankLine(line)) {
      // Blank lines never close items directly; trailing blanks are trimmed
      // when the item is closed.
      continue;
    }

    const ws = leadingWhitespace(line);
    const col = indentColumnsOf(ws);
    const isHeading =
      !codeBlockLines[j] && HEADING_RE.test(line) ? true : false;
    const listMatch = codeBlockLines[j] ? null : line.match(LIST_RE);

    if (isHeading) {
      closeAllItems(j);
      lastRootItem = null;
      continue;
    }

    if (listMatch) {
      const markerIndentWs = listMatch[1];
      const marker = listMatch[2];
      const itemCol = indentColumnsOf(markerIndentWs);
      closeItemsWithIndentAtLeast(itemCol, j);

      const parentItem = listStack[listStack.length - 1] ?? null;
      const item: ListBlockNode = {
        id: `li-${liSeq++}`,
        type: "list",
        range: { startLine: j, endLine: j },
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        childIds: [],
        depth: parentItem ? parentItem.depth + 1 : 0,
        listMarker: marker,
        indentColumns: itemCol,
        unsafeIndent: isMixedIndent(markerIndentWs),
        ordered: /^\d/.test(marker),
      };

      if (parentItem) {
        item.parentId = parentItem.id;
        const prevId =
          parentItem.childIds.length > 0
            ? parentItem.childIds[parentItem.childIds.length - 1]
            : null;
        if (prevId) {
          const prev = nodes.get(prevId);
          if (prev) {
            prev.nextSiblingId = item.id;
            item.prevSiblingId = prev.id;
          }
        }
        parentItem.childIds.push(item.id);
      } else {
        const secId = lineToSectionId[j];
        item.parentId = secId;
        if (lastRootItem && lastRootItem.parentId === secId) {
          lastRootItem.nextSiblingId = item.id;
          item.prevSiblingId = lastRootItem.id;
        }
        if (secId) {
          const sec = nodes.get(secId);
          if (sec) sec.childIds.push(item.id);
        } else {
          topLevelIds.push(item.id);
        }
        lastRootItem = item;
      }

      nodes.set(item.id, item);
      allListItems.push(item);
      listStack.push(item);
      continue;
    }

    // Non-blank, non-list, non-heading line (paragraph / code line / etc).
    if (listStack.length > 0) {
      // Continuation if deeper than the innermost open item, otherwise closes.
      closeItemsWithIndentAtLeast(Math.max(col, 0), j);
      if (listStack.length > 0 && col <= listStack[listStack.length - 1].indentColumns) {
        // Defensive: should not happen because of the close above.
        closeItemsWithIndentAtLeast(col, j);
      }
    }
    if (listStack.length === 0) {
      lastRootItem = null;
    }
  }
  closeAllItems(n);

  // Fill list ownership; creation order = document order, so nested items
  // overwrite their parent's lines afterwards (deepest wins).
  for (const item of allListItems) {
    for (let l = item.range.startLine; l <= item.range.endLine; l++) {
      lineToOwningNodeId[l] = item.id;
    }
  }

  return {
    lines,
    nodes,
    topLevelIds,
    lineToOwningNodeId,
    codeBlockLines,
    frontmatterLines,
  };
}
