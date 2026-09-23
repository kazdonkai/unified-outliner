/**
 * Phase 5E-3a ("ツリーペインでの fenced-code / table 新規挿入"): the single
 * CodeBlockPreset registry — one entry per fenced-code "kind" the user can
 * pick, carrying its canonical info string, the aliases that should
 * auto-match an existing block's info string, its i18n label key, and the
 * minimal body template a freshly INSERTED block starts with.
 *
 * Two consumers:
 *   - view/CodeBlockPresetModal.ts (new in 5E-3a): the language selector
 *     shown when inserting a new fenced code block from the Outline Tree.
 *   - view/PartialEditView.ts's FENCED_CODE_LANGUAGE_OPTIONS (Phase 5E-3):
 *     now derived from this table rather than keeping its own copy, so the
 *     insert-time selector and the edit-time selector can never drift
 *     apart. The order, values, aliases and label keys are byte-identical
 *     to the Phase 5E-3 table that used to live inline there.
 *
 * Deliberately pure (no Obsidian import) so tests and future phases
 * (e.g. Phase 5M mirror insertion) can reuse it without a DOM.
 *
 * Scope (ticket §設計原則): registration + templates only. Nothing here
 * changes the range parser, conflict detection, or how an existing block's
 * info string is read or written.
 */
import type { TranslationKey } from "../i18n";

export interface CodeBlockPreset {
  /** Stable id (also the canonical info string, "" for plain). */
  id: string;
  /** Canonical info string written on the opening fence ("" = none). */
  infoString: string;
  /** Info strings that should auto-match this preset when LOADING an existing block. */
  aliases: string[];
  labelKey: TranslationKey;
  /**
   * Body text (fence lines excluded) a newly inserted block starts with.
   * Split on "\n" to obtain the interior lines; "" yields one empty
   * interior line (a place to start typing). A trailing "\n" likewise
   * leaves an empty last interior line — e.g. Mermaid's "flowchart TD\n"
   * yields ["flowchart TD", ""], which the Partial Edit Pane's fence-free
   * textarea shows back as exactly "flowchart TD\n".
   */
  bodyTemplate: string;
}

export const CODE_BLOCK_PRESETS: readonly CodeBlockPreset[] = [
  { id: "", infoString: "", aliases: [""], labelKey: "partialEdit.fencedCode.lang.plain", bodyTemplate: "" },
  { id: "mermaid", infoString: "mermaid", aliases: ["mermaid"], labelKey: "partialEdit.fencedCode.lang.mermaid", bodyTemplate: "flowchart TD\n" },
  { id: "dataview", infoString: "dataview", aliases: ["dataview"], labelKey: "partialEdit.fencedCode.lang.dataview", bodyTemplate: "" },
  { id: "dataviewjs", infoString: "dataviewjs", aliases: ["dataviewjs"], labelKey: "partialEdit.fencedCode.lang.dataviewjs", bodyTemplate: "" },
  { id: "javascript", infoString: "javascript", aliases: ["javascript", "js"], labelKey: "partialEdit.fencedCode.lang.javascript", bodyTemplate: "" },
  { id: "typescript", infoString: "typescript", aliases: ["typescript", "ts"], labelKey: "partialEdit.fencedCode.lang.typescript", bodyTemplate: "" },
  { id: "python", infoString: "python", aliases: ["python"], labelKey: "partialEdit.fencedCode.lang.python", bodyTemplate: "" },
  { id: "bash", infoString: "bash", aliases: ["bash", "sh"], labelKey: "partialEdit.fencedCode.lang.bash", bodyTemplate: "" },
  { id: "sql", infoString: "sql", aliases: ["sql"], labelKey: "partialEdit.fencedCode.lang.sql", bodyTemplate: "" },
  { id: "json", infoString: "json", aliases: ["json"], labelKey: "partialEdit.fencedCode.lang.json", bodyTemplate: "" },
  { id: "yaml", infoString: "yaml", aliases: ["yaml"], labelKey: "partialEdit.fencedCode.lang.yaml", bodyTemplate: "" },
  { id: "css", infoString: "css", aliases: ["css"], labelKey: "partialEdit.fencedCode.lang.css", bodyTemplate: "" },
  { id: "html", infoString: "html", aliases: ["html"], labelKey: "partialEdit.fencedCode.lang.html", bodyTemplate: "" },
];

export function findCodeBlockPreset(id: string): CodeBlockPreset | undefined {
  return CODE_BLOCK_PRESETS.find((p) => p.id === id);
}

export type CustomInfoStringValidation =
  | { ok: true; infoString: string }
  | { ok: false; reason: "contains-newline" | "contains-backtick" | "too-long" };

/** Upper bound on a user-typed info string — generous, only there to refuse pasted garbage. */
export const MAX_CUSTOM_INFO_STRING_LENGTH = 64;

/**
 * Validates a free-text ("Custom…") info string for a NEW backtick fence.
 * Trimmed; an empty result is allowed (equivalent to Plain). A backtick is
 * refused because CommonMark forbids it in a backtick fence's info string
 * (the opening line would stop being a fence, breaking the open/close
 * pairing the ticket's rejection rules protect).
 */
export function validateCustomInfoString(raw: string): CustomInfoStringValidation {
  if (/[\r\n]/.test(raw)) return { ok: false, reason: "contains-newline" };
  const infoString = raw.trim();
  if (infoString.includes("`")) return { ok: false, reason: "contains-backtick" };
  if (infoString.length > MAX_CUSTOM_INFO_STRING_LENGTH) return { ok: false, reason: "too-long" };
  return { ok: true, infoString };
}

/**
 * The raw (unindented) lines of a new fenced code block: opening fence with
 * `infoString`, the body template's interior lines, closing fence. Always
 * uses a 3-backtick fence — no preset/template contains a backtick run, and
 * validateCustomInfoString refuses backticks in the info string, so a
 * 3-backtick fence can never be closed early by its own contents.
 */
export function buildFencedCodeBlockLines(infoString: string, bodyTemplate: string): string[] {
  return ["```" + infoString, ...bodyTemplate.split("\n"), "```"];
}

export const MIN_TABLE_COLUMNS = 1;
export const MAX_TABLE_COLUMNS = 8;
export const DEFAULT_TABLE_COLUMNS = 2;

/**
 * The raw lines of a new GFM pipe table: header row ("Column 1" …), a
 * `---` delimiter row, and ONE empty body row — the ticket's minimum
 * template (default 2 columns × 1 row). Returns null for a column count
 * outside [MIN_TABLE_COLUMNS, MAX_TABLE_COLUMNS] or a non-integer.
 * Every row is shaped so parser/complexBlocks.ts#scanTableBlocks recognizes
 * it as a supported table (header/delimiter cell counts match) and
 * edit/partialEdit.ts's Apply-time table validation accepts it unchanged.
 */
export function buildTableTemplateLines(columns: number): string[] | null {
  if (!Number.isInteger(columns) || columns < MIN_TABLE_COLUMNS || columns > MAX_TABLE_COLUMNS) {
    return null;
  }
  const idx = Array.from({ length: columns }, (_, i) => i + 1);
  const header = "| " + idx.map((i) => `Column ${i}`).join(" | ") + " |";
  const delimiter = "| " + idx.map(() => "---").join(" | ") + " |";
  const body = "|" + idx.map(() => "  |").join("");
  return [header, delimiter, body];
}
