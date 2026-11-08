/**
 * Cursor position -> the target of the body-editor "Open partial edit
 * pane" command (fix/heading-adjacent-fenced-code, 2026-11-07).
 *
 * Before this fix the command resolved the cursor only via
 * resolveCurrentBlock, which (correctly, for move/indent/etc.) refuses
 * every line inside a fenced code block with reason "code-block". That
 * meant a cursor inside a fence — including a Mermaid fence placed
 * directly under a heading — could never reach the fenced-code Partial
 * Edit that Phase 5E-1/5E-3 already implement for the Outline Tree's
 * standalone fenced-code row, and the user only saw the move-specific
 * "cannot move inside a code block" Notice.
 *
 * Resolution rules:
 *   - a line inside a fenced code block → that fenced-code block, by its
 *     scan-local ComplexBlockInfo id, ONLY when scanComplexBlocks reports
 *     it with editability "supported" (closed fence, boundary confidently
 *     resolved). An unterminated or boundary-ambiguous fence fails with
 *     "code-block-unresolved" — never falls back to the enclosing section.
 *   - any other line → resolveCurrentBlock's existing result, unchanged:
 *     a heading/body line resolves to its owning section; a list line is
 *     refused with "not-a-heading" exactly as before.
 *
 * Scope note: only fenced-code is resolved specially. A cursor inside a
 * callout/blockquote/table keeps its pre-existing "owning section"
 * behavior, since those lines are ordinary section-body lines to
 * resolveCurrentBlock and changing that would alter an existing contract.
 *
 * Pure and Obsidian-free; it never mutates `doc` and never persists an id.
 * The returned id is the same scan-local id the Outline Tree row uses, so
 * PartialEditView re-resolves it through edit/partialEdit.ts's
 * extractSubtreeText exactly as for a Tree-initiated load.
 */
import { LineRange, ParsedDocument } from "../model/block";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { resolveCurrentBlock, ResolveFailureReason } from "./resolveCurrentBlock";

export type PartialEditCursorTarget =
  | { kind: "section"; nodeId: string }
  | { kind: "fenced-code"; nodeId: string; range: LineRange; infoString: string };

export type PartialEditCursorFailureReason =
  | Exclude<ResolveFailureReason, "code-block">
  | "code-block-unresolved"
  | "not-a-heading";

export interface PartialEditCursorResolution {
  target: PartialEditCursorTarget | null;
  reason?: PartialEditCursorFailureReason;
}

export function resolvePartialEditTargetAtCursor(
  doc: ParsedDocument,
  cursorLine: number
): PartialEditCursorResolution {
  if (cursorLine < 0 || cursorLine >= doc.lines.length) {
    return { target: null, reason: "out-of-range" };
  }

  if (doc.codeBlockLines[cursorLine]) {
    const fenced = scanComplexBlocks(doc).blocks.find(
      (b) =>
        b.kind === "fenced-code" &&
        b.range.startLine <= cursorLine &&
        cursorLine <= b.range.endLine
    );
    if (!fenced || fenced.editability !== "supported") {
      return { target: null, reason: "code-block-unresolved" };
    }
    return {
      target: {
        kind: "fenced-code",
        nodeId: fenced.id,
        range: { ...fenced.range },
        infoString: fenced.infoString ?? "",
      },
    };
  }

  const resolved = resolveCurrentBlock(doc, cursorLine);
  if (!resolved.node) {
    const reason = resolved.reason ?? "no-block";
    // "code-block" is unreachable here (handled above); map defensively.
    return { target: null, reason: reason === "code-block" ? "code-block-unresolved" : reason };
  }
  if (resolved.node.type !== "section") {
    return { target: null, reason: "not-a-heading" };
  }
  return { target: { kind: "section", nodeId: resolved.node.id } };
}
