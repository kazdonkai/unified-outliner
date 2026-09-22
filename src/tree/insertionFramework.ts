/**
 * Phase 5E-0.5 ("挿入フレームワークの共通基盤"): type definitions and a
 * PURE, STUB resolver for inserting a new fenced-code / table / heading /
 * list-item block adjacent to an existing standalone fenced-code or table
 * Outline Tree row.
 *
 * Scope note (read before extending this file): this phase defines the
 * SHAPE of an insertion request/result and documents the placement/safety
 * rules a future phase must implement — it does NOT implement the actual
 * line-splicing logic. `resolveInsertion` below is an intentional stub
 * (throws) until Phase 5E-1 replaces its body. No UI wiring (context menu,
 * command palette), no Vault write, and no Editor update exist yet or are
 * added by this phase — see this file's own design memo,
 * docs/phase5e0_5_insert-framework-design-memo.md, for the full rule set
 * this stub's future implementation must follow, including:
 *
 *   - where the insertion point resolves to for each InsertableBlockKind
 *     and each `position` (§1 of the design memo);
 *   - the boundary/blank-line/indent safety rules an implementation must
 *     preserve (§3);
 *   - why "heading" and "list-item" are listed here as InsertableBlockKind
 *     values but are explicitly deferred to the EXISTING section/list
 *     insertion code paths rather than reimplemented in this framework
 *     (§2).
 *
 * `targetNodeId` below is always a Tree row id as
 * tree/buildOutlineTree.ts's OutlineTreeComplexMemberNode.id exposes it —
 * which is always the underlying ComplexBlockInfo.id verbatim (see that
 * node type's own doc comment, and buildStandaloneComplexNode's `id:
 * info.id`). This framework does not introduce any new id namespace.
 *
 * This module must not be imported by, or change the behavior of, any
 * Phase 5E-0 code path (tree/buildOutlineTree.ts's fenced-code/table
 * projection, view/OutlineTreeView.ts's read-only guard,
 * tree/resolveCurrentPositionNodeId.ts's cursor-sync branch, or the
 * showFencedCodeInOutline/showTablesInOutline settings) — it is purely
 * additive, unused scaffolding until a future phase wires it in.
 *
 * Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除") update:
 * `resolveInsertion` below is no longer a bare throwing stub for every
 * kind — it now has a real implementation for "fenced-code"/
 * "fenced-code-mermaid" (both `position` values), per the design memo's
 * §1/§3 rules. "table"/"heading"/"list-item" remain unimplemented and
 * still throw, unchanged from the Phase 5E-0.5 stub — this module still
 * has NO UI wiring of its own (no context menu/command palette entry
 * point exists yet; see view/OutlineTreeView.ts for where a future ticket
 * would add one) and still performs no Vault write or Editor update — see
 * this file's own InsertionResult doc comment for why that split of
 * responsibility is deliberate.
 */
import { isListNode } from "../model/block";
import { parseDocument, isBlankLine, leadingWhitespace, TAB_WIDTH } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { listItemContentColumn } from "../parser/listContentColumn";

/**
 * The kinds of block this framework can be asked to insert.
 *
 * "fenced-code" and "fenced-code-mermaid" are both fenced-code blocks in
 * the underlying model (model/complexBlock.ts's ComplexBlockKind has no
 * separate "mermaid" kind — see that file's own doc comment); they are
 * listed separately here only because they produce different DEFAULT
 * inserted text (an empty fence vs. a fence whose info string is
 * "mermaid") — see the design memo §2.
 *
 * "heading" and "list-item" are included so a future UI layer can express
 * "insert a heading/list item adjacent to this fenced-code/table row"
 * through the same InsertionRequest shape, but resolving them is
 * explicitly delegated to the EXISTING section/list insertion code paths
 * (see the design memo §2) — this framework does not reimplement heading
 * or list-item insertion.
 */
export type InsertableBlockKind =
  | "fenced-code"
  | "fenced-code-mermaid"
  | "table"
  | "heading"
  | "list-item";

/**
 * Whether the new block is inserted immediately before or immediately
 * after the target Tree row's own block range. See the design memo §1 for
 * the exact line each combination of (target kind, position, parent kind)
 * resolves to.
 */
export type InsertionPosition = "before" | "after";

/**
 * A request to insert a new InsertableBlockKind block adjacent to an
 * existing Outline Tree row.
 */
export interface InsertionRequest {
  /** The existing fenced-code/table Tree row's id (verbatim ComplexBlockInfo.id — see this file's top doc comment). */
  targetNodeId: string;
  /** The kind of block to insert. */
  kind: InsertableBlockKind;
  /** Insert immediately before or immediately after the target's own range. */
  position: InsertionPosition;
}

/**
 * The result of resolving an InsertionRequest against a document.
 *
 * On success, `insertAtLine` is the 0-based line number the new text
 * should be spliced in at (i.e. `lines.splice(insertAtLine, 0,
 * ...insertText.split("\n"))`-style insertion before the line currently
 * at that index — never an in-place replacement of an existing line), and
 * `insertText` is the complete Markdown text to insert, including its own
 * trailing newline and any blank-line padding the design memo's §3 safety
 * rules require. Applying the Vault write and updating the Editor from
 * this result is the caller's responsibility (see this file's top doc
 * comment) — this framework only computes WHERE and WHAT, never performs
 * the write itself.
 *
 * On failure, `reason` is a short, stable, machine-checkable string
 * describing why insertion was refused (e.g. an unclosed fence or
 * unresolvable boundary at or adjacent to the target) — never a
 * best-effort guess at a line number. Mirrors the existing
 * ComplexBlockInfo.reason / StandaloneComplexBlockMoveRejectionReason
 * convention of preserving a concrete reason rather than silently
 * defaulting to root or to a nearby line.
 */
export type InsertionResult =
  | { ok: true; insertAtLine: number; insertText: string }
  | { ok: false; reason: string };

/**
 * The column at which `line`'s own text content begins after a leading
 * fence/list-marker style prefix — duplicated, file-local implementation
 * of the same tabs-vs-spaces-preserving prefix builder
 * edit/insertBlock.ts and edit/insertParagraph.ts already each keep their
 * own copy of (this codebase's established "duplicated, not imported"
 * convention for a small, file-local formatting helper — see
 * edit/insertParagraph.ts's own buildColumnPrefix doc comment for the
 * identical precedent this one follows).
 */
function buildColumnPrefix(referenceLine: string, targetColumns: number): string {
  const useTabs = leadingWhitespace(referenceLine).includes("\t");
  return useTabs
    ? "\t".repeat(Math.max(Math.round(targetColumns / TAB_WIDTH), 1))
    : " ".repeat(targetColumns);
}

/**
 * Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除"): resolves
 * an InsertionRequest against a document's CURRENT text — implemented ONLY
 * for `kind` "fenced-code"/"fenced-code-mermaid", both `position` values.
 * Every other kind ("table"/"heading"/"list-item") still throws exactly
 * like the Phase 5E-0.5 stub did — see this file's own top doc comment and
 * the design memo's §2 for why those three remain deferred.
 *
 * `outlineTree` is intentionally UNUSED for this implementation: every
 * fact this resolver needs (the target's own range/parentId/editability,
 * and — when the parent is a list item — that item's own content column)
 * is re-derived directly from `documentText` via a fresh parseDocument +
 * scanComplexBlocks pass, exactly like every other edit/*StandaloneComplexBlock.ts
 * module in this codebase re-derives its own ground truth rather than
 * trusting a caller-supplied Tree snapshot. The parameter itself is kept
 * (rather than removed) so this signature does not need to change again
 * once a future kind (e.g. "list-item") genuinely needs it.
 *
 * Steps (design memo §1):
 *   1. Re-resolve `request.targetNodeId` via a fresh scanComplexBlocks —
 *      "target-not-found" if no block has that id in the CURRENT document
 *      (covers both a stale id and the empty-document case).
 *   2. The resolved block's own `editability` must be "supported" —
 *      otherwise its own `reason` (e.g. "unterminated fence: ...") is
 *      passed straight through, never re-worded or guessed at.
 *   3. `insertAtLine` = the target's own `range.startLine` ("before") or
 *      `range.endLine + 1` ("after") — never widened or adjusted for
 *      blank-line padding (see step 5).
 *   4. Indentation (design memo §1's "親がlist itemの場合"): when the
 *      target's `parentId` resolves to a `"list"` BlockNode, every line of
 *      the new block is prefixed to that item's own
 *      `listItemContentColumn` (parser/listContentColumn.ts — the same
 *      shared authority edit/insertParagraph.ts's own Phase 5P-5 update
 *      already uses for this exact purpose). A `parentId` resolving to
 *      `"section"`, or `null` (root/headingless), uses column 0. An
 *      `unsafeIndent` list parent is refused as "unsafe-indent" — its
 *      content column cannot be trusted (mirrors
 *      edit/insertParagraph.ts's own identical refusal).
 *   5. Blank-line boundary safety (design memo §3): a blank line is added
 *      at each of the new block's own two boundaries ONLY when the
 *      immediately-adjacent existing line is not itself already blank —
 *      the boundary touching the pre-existing target (its first line for
 *      "before", nothing — the target's own last line always precedes the
 *      insert for "after") always needs one (there is no gap there by
 *      construction, since the new text is spliced directly against it);
 *      the FAR boundary (what used to precede the insertion point for
 *      "before", or what used to follow it for "after") is checked against
 *      the current document and only gets a blank line if that neighbor
 *      isn't already blank — never over-padding an existing gap.
 */
export function resolveInsertion(
  request: InsertionRequest,
  documentText: string,
  outlineTree: unknown
): InsertionResult {
  void outlineTree;

  if (request.kind !== "fenced-code" && request.kind !== "fenced-code-mermaid") {
    throw new Error(
      `resolveInsertion for kind "${request.kind}" is not implemented yet (Phase 5E-0.5 stub) — see docs/phase5e0_5_insert-framework-design-memo.md`
    );
  }

  const doc = parseDocument(documentText);
  const complexScan = scanComplexBlocks(doc);
  const target = complexScan.blocks.find((b) => b.id === request.targetNodeId);
  if (!target) {
    return { ok: false, reason: "target-not-found" };
  }
  if (target.editability !== "supported") {
    return { ok: false, reason: target.reason ?? "target-not-supported" };
  }

  let contentColumn = 0;
  let referenceLine = doc.lines[target.range.startLine] ?? "";
  if (target.parentId !== null) {
    const parentNode = doc.nodes.get(target.parentId);
    if (parentNode && isListNode(parentNode)) {
      if (parentNode.unsafeIndent) {
        return { ok: false, reason: "unsafe-indent" };
      }
      contentColumn = listItemContentColumn(doc, parentNode);
      referenceLine = doc.lines[parentNode.range.startLine] ?? referenceLine;
    }
  }
  const prefix = contentColumn > 0 ? buildColumnPrefix(referenceLine, contentColumn) : "";

  const infoString = request.kind === "fenced-code-mermaid" ? "mermaid" : "";
  const openLine = `${prefix}\`\`\`${infoString}`;
  const closeLine = `${prefix}\`\`\``;

  const insertAtLine = request.position === "before" ? target.range.startLine : target.range.endLine + 1;

  const blockLines = [openLine, closeLine];
  if (request.position === "before") {
    // Near boundary: the target's own first line always immediately
    // follows the insert (no gap by construction) — always separate.
    blockLines.push("");
    // Far boundary: whatever currently sits just before insertAtLine.
    const beforeLine = insertAtLine > 0 ? doc.lines[insertAtLine - 1] : undefined;
    if (beforeLine !== undefined && !isBlankLine(beforeLine)) {
      blockLines.unshift("");
    }
  } else {
    // Near boundary: the target's own last line always immediately
    // precedes the insert (no gap by construction) — always separate.
    blockLines.unshift("");
    // Far boundary: whatever currently sits at insertAtLine (i.e. just
    // after the target, before this insert pushes it down).
    const afterLine = insertAtLine < doc.lines.length ? doc.lines[insertAtLine] : undefined;
    if (afterLine !== undefined && !isBlankLine(afterLine)) {
      blockLines.push("");
    }
  }

  return { ok: true, insertAtLine, insertText: blockLines.join("\n") + "\n" };
}
