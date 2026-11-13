/**
 * Phase 5E-3M ("Mermaid 構造化部分編集"): splits the BODY of a Mermaid
 * fenced code block (fence lines already removed by edit/partialEdit.ts)
 * into
 *
 *   preamble    — blank lines, `%%` comments, `%%{…}%%` directives and a
 *                 leading `---` frontmatter block, all before the declaration
 *   declaration — the diagram-type line (e.g. `mindmap`, `flowchart TD`)
 *   body        — every line after the declaration, verbatim
 *
 * and joins them back. The Markdown note stays the only source of truth:
 * the structure exists only while the Partial Edit Pane shows it, and what
 * is written on Apply is always serializeMermaidStructure()'s plain string.
 *
 * Invariants (tests/mermaidStructure.test.ts):
 *   1. parse → serialize with no change returns the input byte-for-byte
 *      (including CRLF "\r", indentation and trailing whitespace).
 *   2. a keyword spelling (graph/flowchart, stateDiagram/stateDiagram-v2)
 *      or direction spelling (TB/TD) changes only when the user re-picks.
 *   3. a block that does not parse is never rewritten by this module.
 *
 * Pure: no Obsidian, no Mermaid runtime.
 */
import {
  findMermaidDiagramType,
  findMermaidDiagramTypeByKeyword,
  isMermaidFlowchartDirection,
  MermaidDiagramType,
  MermaidFlowchartDirection,
} from "./mermaidDiagramTypes";

export interface MermaidDeclaration {
  /** The declaration line exactly as written. */
  rawLine: string;
  /** Leading whitespace of the declaration line. */
  indent: string;
  /** The keyword as spelled in the source (e.g. "graph", "stateDiagram-v2"). */
  keyword: string;
  /** Everything after the keyword, leading whitespace included, verbatim (e.g. " TD", "" or "\r"). */
  suffix: string;
}

export interface MermaidStructure {
  /** Lines before the declaration, verbatim. */
  preambleLines: string[];
  declaration: MermaidDeclaration;
  /** Lines after the declaration, verbatim. */
  bodyLines: string[];
}

export type MermaidParseFailureReason =
  | "no-declaration"
  | "unknown-diagram"
  | "unsupported-suffix"
  | "unclosed-frontmatter"
  | "unclosed-directive"
  | "empty";

export type MermaidParseResult =
  | { ok: true; structure: MermaidStructure; diagramTypeId: string }
  | { ok: false; reason: MermaidParseFailureReason };

const LEADING_WS_RE = /^[ \t]*/;

/** Splits a declaration line into indent / keyword / suffix (always reversible: indent + keyword + suffix === line). */
function splitDeclarationLine(line: string): { indent: string; keyword: string; suffix: string } {
  const indent = (line.match(LEADING_WS_RE) ?? [""])[0];
  const rest = line.slice(indent.length);
  const keyword = (rest.match(/^\S+/) ?? [""])[0];
  return { indent, keyword, suffix: rest.slice(keyword.length) };
}

/** Whether `suffix` is allowed for `type` (see MermaidSuffixPolicy). */
export function isMermaidSuffixAllowed(type: MermaidDiagramType, suffix: string): boolean {
  switch (type.suffixPolicy) {
    case "raw":
      return !/[\n]/.test(suffix);
    case "empty":
      return suffix.trim() === "";
    case "direction": {
      const t = suffix.trim();
      if (t === "") return true;
      // Leading whitespace is required between the keyword and a direction.
      return /^\s/.test(suffix) && isMermaidFlowchartDirection(t);
    }
  }
}

export function parseMermaidStructure(text: string): MermaidParseResult {
  if (text.trim() === "") return { ok: false, reason: "empty" };

  const lines = text.split("\n");
  const n = lines.length;
  const preambleLines: string[] = [];
  let frontmatterSeen = false;
  let substantiveSeen = false;
  let i = 0;

  while (i < n) {
    const line = lines[i];
    const t = line.trim();
    if (t === "") {
      preambleLines.push(line);
      i++;
      continue;
    }
    if (t.startsWith("%%{")) {
      // A directive runs until the line containing "}%%" (possibly this one).
      const firstClose = line.indexOf("}%%", line.indexOf("%%{") + 3);
      let j = i;
      if (firstClose < 0) {
        j = i + 1;
        while (j < n && !lines[j].includes("}%%")) j++;
        if (j >= n) return { ok: false, reason: "unclosed-directive" };
      }
      for (let k = i; k <= j; k++) preambleLines.push(lines[k]);
      i = j + 1;
      continue;
    }
    if (t.startsWith("%%")) {
      preambleLines.push(line);
      i++;
      continue;
    }
    if (t === "---" && !frontmatterSeen && !substantiveSeen) {
      let j = i + 1;
      while (j < n && lines[j].trim() !== "---") j++;
      if (j >= n) return { ok: false, reason: "unclosed-frontmatter" };
      for (let k = i; k <= j; k++) preambleLines.push(lines[k]);
      frontmatterSeen = true;
      substantiveSeen = true;
      i = j + 1;
      continue;
    }
    break;
  }

  if (i >= n) return { ok: false, reason: "no-declaration" };

  const rawLine = lines[i];
  const { indent, keyword, suffix } = splitDeclarationLine(rawLine);
  const type = findMermaidDiagramTypeByKeyword(keyword);
  if (!type) return { ok: false, reason: "unknown-diagram" };
  if (!isMermaidSuffixAllowed(type, suffix)) return { ok: false, reason: "unsupported-suffix" };

  return {
    ok: true,
    diagramTypeId: type.id,
    structure: {
      preambleLines,
      declaration: { rawLine, indent, keyword, suffix },
      bodyLines: lines.slice(i + 1),
    },
  };
}

/** The declaration line: the original rawLine unless keyword or suffix (or indent) changed. */
export function mermaidDeclarationLine(decl: MermaidDeclaration): string {
  const original = splitDeclarationLine(decl.rawLine);
  if (original.indent === decl.indent && original.keyword === decl.keyword && original.suffix === decl.suffix) {
    return decl.rawLine;
  }
  return decl.indent + decl.keyword + decl.suffix;
}

export function serializeMermaidStructure(structure: MermaidStructure): string {
  return [...structure.preambleLines, mermaidDeclarationLine(structure.declaration), ...structure.bodyLines].join("\n");
}

/** The registered diagram type of a parsed structure (by its current keyword). */
export function mermaidDiagramTypeOf(structure: MermaidStructure): MermaidDiagramType | undefined {
  return findMermaidDiagramTypeByKeyword(structure.declaration.keyword);
}

/** Trailing whitespace of a suffix (keeps a CRLF "\r" when the declaration is rewritten). */
function trailingWhitespace(suffix: string): string {
  return (suffix.match(/\s*$/) ?? [""])[0];
}

/**
 * Re-picks the diagram type. Only the declaration's keyword/suffix change;
 * preamble and body are returned as the same arrays' copies, untouched.
 * Picking the type the block already has returns the structure unchanged
 * (so an original "graph" or "stateDiagram" spelling survives).
 */
export function setMermaidDiagramType(structure: MermaidStructure, typeId: string): MermaidStructure {
  const next = findMermaidDiagramType(typeId);
  if (!next) return structure;
  const current = mermaidDiagramTypeOf(structure);
  if (current && current.id === next.id) return structure;
  const trail = trailingWhitespace(structure.declaration.suffix);
  const suffix = next.defaultSuffix === "" ? trail : next.defaultSuffix + trail;
  return {
    preambleLines: [...structure.preambleLines],
    declaration: { ...structure.declaration, keyword: next.keywords[0], suffix },
    bodyLines: [...structure.bodyLines],
  };
}

/** The flowchart direction currently written ("" = none), or null when this is not a direction-policy type. */
export function getMermaidFlowchartDirection(structure: MermaidStructure): MermaidFlowchartDirection | "" | null {
  const type = mermaidDiagramTypeOf(structure);
  if (!type || type.suffixPolicy !== "direction") return null;
  const t = structure.declaration.suffix.trim();
  return isMermaidFlowchartDirection(t) ? t : "";
}

/**
 * Sets the flowchart direction ("" = none). Choosing the direction already
 * written returns the structure unchanged (TB stays TB, TD stays TD).
 */
export function setMermaidFlowchartDirection(
  structure: MermaidStructure,
  direction: MermaidFlowchartDirection | ""
): MermaidStructure {
  const current = getMermaidFlowchartDirection(structure);
  if (current === null || current === direction) return structure;
  const suffix0 = structure.declaration.suffix;
  const lead = (suffix0.match(LEADING_WS_RE) ?? [""])[0];
  const trail = trailingWhitespace(suffix0.slice(lead.length));
  const suffix = direction === "" ? trail : (lead === "" ? " " : lead) + direction + trail;
  return { ...structure, declaration: { ...structure.declaration, suffix } };
}

/** The editable text of a "raw"-policy suffix: without its leading separator or trailing whitespace. */
export function getMermaidRawSuffixText(structure: MermaidStructure): string {
  return structure.declaration.suffix.trim();
}

/**
 * Sets a "raw"-policy suffix from the small text field. A value equal to
 * the current one returns the structure unchanged; a value containing a
 * line break is refused (returns null).
 */
export function setMermaidRawSuffixText(structure: MermaidStructure, value: string): MermaidStructure | null {
  if (/[\r\n]/.test(value)) return null;
  const v = value.trim();
  if (v === getMermaidRawSuffixText(structure)) return structure;
  const suffix0 = structure.declaration.suffix;
  const lead = (suffix0.match(LEADING_WS_RE) ?? [""])[0];
  const trail = trailingWhitespace(suffix0.slice(lead.length));
  const suffix = v === "" ? trail : (lead === "" ? " " : lead) + v + trail;
  return { ...structure, declaration: { ...structure.declaration, suffix } };
}

/** True when the body has no non-whitespace content (no lines, or only blank/whitespace lines). */
export function isMermaidBodyBlank(bodyLines: readonly string[]): boolean {
  return bodyLines.every((l) => l.trim() === "");
}

/**
 * Applies the chosen type's template ONLY when the body is blank; a body
 * with any content is returned unchanged (templates never overwrite text).
 */
export function applyMermaidTemplateIfBlank(structure: MermaidStructure): MermaidStructure {
  if (!isMermaidBodyBlank(structure.bodyLines)) return structure;
  const type = mermaidDiagramTypeOf(structure);
  if (!type) return structure;
  return { ...structure, bodyLines: [...type.template] };
}

/** Body text (fence lines excluded) of a NEW Mermaid block of `typeId`: declaration + template. */
export function buildMermaidTemplateText(typeId: string): string | null {
  const type = findMermaidDiagramType(typeId);
  if (!type) return null;
  return [type.keywords[0] + type.defaultSuffix, ...type.template].join("\n");
}
