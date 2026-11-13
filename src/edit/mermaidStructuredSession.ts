/**
 * Phase 5E-3M ("Mermaid 構造化部分編集"): the Obsidian-free state machine
 * behind the Partial Edit Pane's Mermaid "Structured" / "Source" views.
 * view/PartialEditView.ts owns the DOM and calls these functions; keeping
 * the transitions here lets tests check "unsaved edits survive a view
 * switch", "Cancel restores", and "dirty = serialized text differs"
 * without a DOM.
 *
 * Model:
 *   - `baseline` is the parse of the text the pane LOADED (originalText),
 *     or null when that did not parse. It never changes until the next
 *     load / Apply / Cancel.
 *   - `working` holds the current preamble + declaration in the Structured
 *     view. The body is NOT stored here while structured — it lives in the
 *     pane's body editor (textarea), and is folded back in by
 *     `mermaidFullText`.
 *   - In the Source view the textarea holds the whole block body (fence
 *     lines excluded), exactly as for any other fenced code block.
 *
 * Nothing here is ever written to the note directly: Apply always passes
 * `mermaidFullText(...)` (a plain string) to the existing applySubtreeEdit.
 */
import { MermaidFlowchartDirection } from "./mermaidDiagramTypes";
import {
  getMermaidFlowchartDirection,
  isMermaidBodyBlank,
  MermaidParseFailureReason,
  MermaidStructure,
  mermaidDiagramTypeOf,
  parseMermaidStructure,
  serializeMermaidStructure,
  setMermaidDiagramType,
  setMermaidFlowchartDirection,
  setMermaidRawSuffixText,
} from "./mermaidStructure";
import { findMermaidDiagramType } from "./mermaidDiagramTypes";

/** Info strings that turn the structured Mermaid editor on (exact match, like the language selector's alias list). */
export const MERMAID_INFO_STRINGS: readonly string[] = ["mermaid"];

export function isMermaidInfoString(infoString: string | null | undefined): boolean {
  return infoString !== null && infoString !== undefined && MERMAID_INFO_STRINGS.includes(infoString.trim());
}

export interface MermaidSessionState {
  view: "structured" | "source";
  baseline: MermaidStructure | null;
  working: MermaidStructure | null;
  /** Why the loaded text (or the last Source → Structured attempt) could not be structured. */
  failure: MermaidParseFailureReason | null;
  /** True right after a diagram-type change on a non-empty body (the "body is not converted" notice). */
  typeChangedNotice: boolean;
}

/** The text the body editor shows for `state` when it was just (re)initialized. */
export interface MermaidEditorUpdate {
  state: MermaidSessionState;
  editorValue: string;
}

function bodyText(structure: MermaidStructure): string {
  return structure.bodyLines.join("\n");
}

/** Folds the editor's body text back into a structure, reusing the exact original lines when unchanged. */
function withEditorBody(structure: MermaidStructure, editorValue: string): MermaidStructure {
  if (editorValue === bodyText(structure)) return structure;
  return { ...structure, bodyLines: editorValue.split("\n") };
}

/**
 * Initial state for a block whose loaded body text is `originalText`:
 * Structured when it parses, otherwise Source with the reason.
 */
export function initMermaidSession(originalText: string): MermaidEditorUpdate {
  const parsed = parseMermaidStructure(originalText);
  if (!parsed.ok) {
    return {
      state: { view: "source", baseline: null, working: null, failure: parsed.reason, typeChangedNotice: false },
      editorValue: originalText,
    };
  }
  return {
    state: {
      view: "structured",
      baseline: parsed.structure,
      working: parsed.structure,
      failure: null,
      typeChangedNotice: false,
    },
    editorValue: bodyText(parsed.structure),
  };
}

/**
 * What currentDisplayText() should return (the "unchanged" editor value):
 * the loaded body in the Structured view, the loaded whole text otherwise.
 */
export function mermaidBaselineEditorText(state: MermaidSessionState, originalText: string): string {
  if (state.view === "structured" && state.baseline) return bodyText(state.baseline);
  return originalText;
}

/** The whole block body (fence lines excluded) the pane would Apply right now. */
export function mermaidFullText(state: MermaidSessionState, editorValue: string): string {
  if (state.view === "structured" && state.working) {
    return serializeMermaidStructure(withEditorBody(state.working, editorValue));
  }
  return editorValue;
}

/** Dirty exactly when the text that would be applied differs from the loaded text. */
export function isMermaidSessionDirty(state: MermaidSessionState, editorValue: string, originalText: string): boolean {
  return mermaidFullText(state, editorValue) !== originalText;
}

/** Structured → Source: the editor receives the whole serialized text; nothing is lost. */
export function switchMermaidToSource(state: MermaidSessionState, editorValue: string): MermaidEditorUpdate {
  if (state.view === "source") return { state, editorValue };
  return {
    state: { ...state, view: "source", working: null, typeChangedNotice: false },
    editorValue: mermaidFullText(state, editorValue),
  };
}

/**
 * Source → Structured: re-parses the editor's CURRENT text. On failure the
 * view stays Source, the editor text is kept as is, and `failure` says why.
 */
export function switchMermaidToStructured(
  state: MermaidSessionState,
  editorValue: string
): MermaidEditorUpdate & { ok: boolean } {
  if (state.view === "structured") return { ok: true, state, editorValue };
  const parsed = parseMermaidStructure(editorValue);
  if (!parsed.ok) {
    return { ok: false, state: { ...state, failure: parsed.reason }, editorValue };
  }
  return {
    ok: true,
    state: { ...state, view: "structured", working: parsed.structure, failure: null, typeChangedNotice: false },
    editorValue: bodyText(parsed.structure),
  };
}

/**
 * Re-picks the diagram type (Structured view only). Only the declaration
 * changes; the body is never converted. When the body is blank the type's
 * template is placed in the editor; otherwise the "body not converted"
 * notice is raised. Re-picking the LOADED type restores the loaded
 * declaration exactly (so "graph" survives a round trip through another
 * type and back).
 */
export function changeMermaidDiagramType(
  state: MermaidSessionState,
  editorValue: string,
  typeId: string
): MermaidEditorUpdate {
  if (state.view !== "structured" || !state.working) return { state, editorValue };
  const type = findMermaidDiagramType(typeId);
  if (!type) return { state, editorValue };
  const current = mermaidDiagramTypeOf(state.working);
  if (current && current.id === type.id) return { state, editorValue };

  const baselineType = state.baseline ? mermaidDiagramTypeOf(state.baseline) : undefined;
  const declaration =
    state.baseline && baselineType && baselineType.id === type.id
      ? state.baseline.declaration
      : setMermaidDiagramType(state.working, typeId).declaration;
  const working: MermaidStructure = { ...state.working, declaration };

  if (isMermaidBodyBlank(editorValue.split("\n"))) {
    return {
      state: { ...state, working, typeChangedNotice: false },
      editorValue: type.template.join("\n"),
    };
  }
  return { state: { ...state, working, typeChangedNotice: true }, editorValue };
}

/**
 * Sets the flowchart direction from the dropdown. The dropdown shows TB
 * and TD both as "top to bottom" (value "TD"); picking that while TB or TD
 * is already written changes nothing. Picking the LOADED direction again
 * restores the loaded suffix exactly.
 */
export function changeMermaidFlowchartDirection(
  state: MermaidSessionState,
  direction: MermaidFlowchartDirection | ""
): MermaidSessionState {
  if (state.view !== "structured" || !state.working) return state;
  const norm = (d: string | null): string | null => (d === "TB" ? "TD" : d);
  const current = getMermaidFlowchartDirection(state.working);
  if (current === null || norm(current) === norm(direction)) return state;
  const baselineDir = state.baseline ? getMermaidFlowchartDirection(state.baseline) : null;
  if (
    state.baseline &&
    baselineDir !== null &&
    norm(baselineDir) === norm(direction) &&
    state.baseline.declaration.keyword === state.working.declaration.keyword
  ) {
    return { ...state, working: { ...state.working, declaration: state.baseline.declaration } };
  }
  return { ...state, working: setMermaidFlowchartDirection(state.working, direction) };
}

/** The dropdown value for the current direction: "TD" for TB/TD, "" for none, null when not a flowchart. */
export function mermaidDirectionSelectValue(state: MermaidSessionState): string | null {
  if (!state.working) return null;
  const d = getMermaidFlowchartDirection(state.working);
  if (d === null) return null;
  return d === "TB" ? "TD" : d;
}

/** Sets a "raw"-policy suffix (pie / gitGraph) from the small text field; a line break is ignored. */
export function changeMermaidRawSuffix(state: MermaidSessionState, value: string): MermaidSessionState {
  if (state.view !== "structured" || !state.working) return state;
  if (/[\r\n]/.test(value)) return state;
  if (
    state.baseline &&
    state.baseline.declaration.keyword === state.working.declaration.keyword &&
    value.trim() === state.baseline.declaration.suffix.trim()
  ) {
    return { ...state, working: { ...state.working, declaration: state.baseline.declaration } };
  }
  const next = setMermaidRawSuffixText(state.working, value);
  if (!next) return state;
  return { ...state, working: next };
}
