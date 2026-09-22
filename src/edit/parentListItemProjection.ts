/**
 * Phase 5L-6 ("Parent List Item Structured Partial Edit"): lets the
 * Partial Edit Pane structurally project a STANDALONE list item that OWNS
 * one or more nested child list items (`node.childIds.length > 0` — every
 * Phase 5L-1〜5L-5 projection in this family explicitly EXCLUDES this case
 * and falls back to raw editing for the whole subtree instead; see each of
 * those modules' own top doc comments' "child-list-free" scope language).
 *
 * ---- The one governing idea: two SEPARATE line ranges, never one ----
 *
 * A parent list item's own `ListBlockNode.range` (model/block.ts) spans its
 * ENTIRE subtree — its own first line, its own continuation/blank lines
 * (if any), AND every descendant line of every child list item, recursively
 * (see parser/parseDocument.ts's own line-ownership-fill pass). This
 * module's entire purpose is splitting that one range into two, and never
 * letting them blur back together:
 *
 *   - the parent's OWN-TEXT range: its own first line, plus any
 *     continuation paragraph/blank lines that are structurally its own
 *     (never a child's) — exactly what
 *     edit/multiLineListItemProjection.ts already knows how to project
 *     marker-free/checkbox-separated/number-separated for a CHILD-LIST-FREE
 *     leaf item. This module reuses that machinery UNCHANGED against just
 *     this substring — see "Reuse, never re-implementation" below.
 *   - the CHILD SUBTREE range: the first child's own first line through the
 *     parent's own last line — shown to the user as a READ-ONLY preview
 *     (view/PartialEditView.ts's own renderParentChildPreview), NEVER
 *     editable here, NEVER re-serialized, NEVER touched by Apply.
 *
 * Apply (applyParentListItemOwnTextEdit below) only ever splices the
 * OWN-TEXT range — one single replacement, exactly like every other Partial
 * Edit kind's own single-splice Apply, just scoped to a strict SUBSET of
 * the node's own full range instead of all of it. The child subtree's raw
 * Markdown is never read into, or written back out of, an editable control
 * at all.
 *
 * ---- Reuse, never re-implementation ----
 *
 * This module does NOT re-implement marker/checkbox/number/continuation-
 * indentation splitting. The parent's own-text substring is, once isolated,
 * structurally IDENTICAL to what a plain child-list-free leaf item's own
 * raw text already looks like to edit/multiLineListItemProjection.ts (a
 * single line, or a first line plus continuation/blank lines) — so once
 * resolveParentListItemOwnTextRange below has cut out exactly that
 * substring, building/inverting it is delegated entirely:
 *
 *   - own-text spanning 2+ lines: edit/multiLineListItemProjection.ts's own
 *     buildMultiLineListItemProjection/invertMultiLineListItemProjection,
 *     completely UNMODIFIED. That module's own
 *     validateMultiLineListItemCandidate already refuses any candidate
 *     whose own re-parse would carry `childIds.length !== 0` — exactly the
 *     safety net this module needs to guarantee the OWN-TEXT candidate,
 *     read in isolation, never itself manufactures a new nested list item;
 *     this module adds nothing to that check, it only happens to also be
 *     exactly what this ticket needs.
 *   - own-text that is exactly ONE line (own body IS the first line, no
 *     continuation at all — the common case for a short parent line
 *     immediately followed by its children): this module's own small
 *     3-priority dispatch (buildSingleLineParentFirstLineSlot below),
 *     deliberately a duplicate of the identical dispatch
 *     edit/multiLineListItemProjection.ts's own buildMultiLineListItemProjection
 *     already performs on ITS first line — never imported/shared, per this
 *     whole family's own "each projection module keeps its own copy of
 *     logic it structurally shares with a sibling" convention (see that
 *     module's own top doc comment). edit/listMarkerProjection.ts,
 *     edit/taskListProjection.ts, and edit/orderedListProjection.ts
 *     themselves are reused completely unmodified either way.
 *
 * ---- The one NEW risk this module's own safety net exists for ----
 *
 * Validating the own-text candidate IN ISOLATION (as every sibling
 * projection module already does) is not, by itself, enough here: this
 * module's own candidate is deliberately going to sit immediately in front
 * of a REAL child subtree once spliced back into the note, and nothing
 * about an isolated re-parse can prove that splice stays safe — e.g. an
 * edited own-text body that, when isolated, closes cleanly on its own last
 * line could still, once followed by the child subtree's first (deeper-
 * indented) line, interact with it in some unanticipated way. So
 * invertParentListItemProjection below adds exactly ONE more check beyond
 * what invertMultiLineListItemProjection/the three single-line inverts
 * already give it: it re-parses the candidate own-text text SPLICED
 * TOGETHER WITH THE ORIGINAL, UNEDITED child-subtree snapshot (never the
 * live document's current child content — see that function's own doc
 * comment for why that distinction matters) as one throwaway mini-document,
 * and confirms the parent-child relationship survives exactly as it should:
 * one list item at line 0, of the same kind, owning exactly the same NUMBER
 * of direct children, whose own combined raw text is still BYTE-IDENTICAL
 * to the original child-subtree snapshot. Any failure there refuses the
 * whole Apply — this is an APPLY-REJECTION (the structured editor opened
 * safely, but this particular edit result would break the parent-child
 * structure), never conflated with a raw-fallback (own-text/child-range
 * could not even be safely determined at LOAD time — see
 * resolveParentListItemOwnTextRange's own doc comment for that separate,
 * earlier gate).
 *
 * ---- Apply-time write-back: own-text range only, own conflict check ----
 *
 * applyParentListItemOwnTextEdit below is deliberately NOT a call to
 * edit/partialEdit.ts's own applySubtreeEdit — that function's conflict
 * check re-extracts and compares the node's ENTIRE subtree range, which
 * would spuriously refuse this Apply the moment the child subtree changes
 * for ANY reason while this pane is open (a Tree drag-drop, a direct edit
 * inside a child's own Partial Edit session, ...) — behavior this ticket's
 * own approved scope explicitly forbids ("child subtree が外部編集で変化
 * した場合、親 own-text の snapshot が変化していなければ Apply を拒否しな
 * いこと"). This module's own applyParentListItemOwnTextEdit instead
 * re-resolves the own-text range FRESH from the current document, compares
 * ONLY that freshly re-extracted own-text substring against the pane's own
 * "before editing" own-text snapshot, and — if they still match — splices
 * ONLY that range, leaving every byte outside it (the child subtree
 * included, however it currently reads) completely untouched. This is safe
 * precisely because the own-text candidate's own structural safety (built
 * above) never depended on the LIVE child subtree's current content at
 * all — only on its own isolated shape, plus the ORIGINAL snapshot purely
 * as a safety-net comparison target — so splicing it in front of whatever
 * the child subtree currently is remains correct regardless of whether that
 * child content has since changed.
 *
 * ---- What this module explicitly does NOT do ----
 *
 * No child add/delete/move/reorder/indent-outdent. No editable child
 * preview. No CompositeBlock involvement (a CompositeBlock member is never
 * even resolvable through this module — see
 * standaloneParentListItemProjection.ts's own doc comment for how that
 * exclusion is structurally guaranteed upstream, the exact same way every
 * sibling standalone-* eligibility gate in this family already relies on
 * it). No marker-type change, no task-checkbox-status-range expansion
 * beyond what edit/taskListProjection.ts already supports, no ordered-
 * delimiter change, no sibling renumbering. See this ticket's own design
 * doc (docs/phase5l6_parent-list-item-structured-partial-edit.md) for the
 * complete list of deferred/out-of-scope candidates.
 */
import { isListNode, ListBlockNode, LineRange, ParsedDocument } from "../model/block";
import { parseDocument } from "../parser/parseDocument";
import {
  buildListMarkerProjection,
  invertListMarkerProjection,
} from "./listMarkerProjection";
import {
  buildTaskListProjection,
  invertTaskListProjection,
} from "./taskListProjection";
import {
  buildOrderedListProjection,
  invertOrderedListProjection,
} from "./orderedListProjection";
import {
  buildMultiLineListItemProjection,
  invertMultiLineListItemProjection,
  MultiLineFirstLineSlot,
  MultiLineListItemProjection,
} from "./multiLineListItemProjection";

// ---------------------------------------------------------------------
// Own-text range resolution
// ---------------------------------------------------------------------

/**
 * Every way resolveParentListItemOwnTextRange below refuses to separate a
 * node's own-text range from its child subtree:
 *
 *   - "no-children": `node.childIds.length === 0` — this function (and this
 *     whole module) is for a PARENT item only; a child-list-free leaf item
 *     is already fully covered by edit/multiLineListItemProjection.ts and
 *     its own standalone single-line siblings.
 *   - "unsafe-indent": `node.unsafeIndent` — mirrors every sibling
 *     eligibility gate in this family's own identical defensive check (a
 *     node this true for is already refused upstream by
 *     edit/partialEdit.ts#extractSubtreeText's own "unsafe-indent" gate).
 *   - "child-not-found": `node.childIds[0]`/`node.childIds[node.childIds.length
 *     - 1]` does not resolve to a list node in `doc.nodes` — defensive
 *     only; should be unreachable given `doc` is the same parse `node`
 *     itself came from.
 *   - "interleaved-content": the LAST direct child's own `range.endLine`
 *     does not reach `node.range.endLine` — i.e. `node`'s own subtree range
 *     extends PAST its own last child. Empirically confirmed (disposable
 *     probe tests, since deleted, against the real parser) this is
 *     REACHABLE: a plain, non-list-marker continuation-looking line placed
 *     immediately after a closed child, at the SAME indent as that child's
 *     own marker column, gets silently reattached to the PARENT's own
 *     range by parser/parseDocument.ts's own line-ownership-fill (later/
 *     deeper items only overwrite the lines their own range actually
 *     covers — a line past the last child's own range still resolves to
 *     the nearest enclosing ancestor, the parent, even though it reads,
 *     positionally, as if it came "after" the children). This module
 *     refuses to guess which "own-text" interpretation (a phantom
 *     trailing-continuation-after-children, structurally alien to every
 *     worked example in this ticket's own approved scope) is intended, and
 *     falls back to raw editing for the whole item instead — this is
 *     exactly the "own-text と子サブツリーが明確に分離可能であること"
 *     eligibility condition this ticket's own design doc requires.
 *   - "empty-own-text": defensive only (`ownTextEndLine < node.range.startLine`
 *     can only happen if the first child somehow starts at or before the
 *     node's own first line, which parser/parseDocument.ts's own nesting
 *     rules make structurally impossible — a child is always MORE deeply
 *     indented than its parent's own marker, so it can never occupy the
 *     parent's own first line).
 */
export type ParentOwnTextRangeResolveReason =
  | "no-children"
  | "unsafe-indent"
  | "child-not-found"
  | "interleaved-content"
  | "empty-own-text";

export interface ParentOwnTextRangeResolution {
  /** The parent's own first line through the line immediately before the child subtree begins — see this module's own top doc comment. */
  ownTextRange: LineRange;
  /** The first child's own first line through `node.range.endLine` — the READ-ONLY child-subtree preview range; never touched by this module's own Apply path. */
  childSubtreeRange: LineRange;
}

export type ParentOwnTextRangeResolveResult =
  | { ok: true; resolution: ParentOwnTextRangeResolution }
  | { ok: false; reason: ParentOwnTextRangeResolveReason };

/**
 * Pure range resolver: NEVER touches raw text, NEVER re-implements list
 * hierarchy via regex — uses only `node`'s own `childIds`/`range` and
 * `doc.nodes`, the exact same primitives every other tree/move/* module in
 * this codebase already resolves list structure through. See this
 * function's own reason type doc comment above for the full, exhaustive
 * refusal list and rationale, and this module's own top doc comment for
 * why the two resulting ranges (own-text vs. child-subtree) are the single
 * governing idea of this entire ticket.
 */
export function resolveParentListItemOwnTextRange(
  doc: ParsedDocument,
  node: ListBlockNode
): ParentOwnTextRangeResolveResult {
  if (node.childIds.length === 0) {
    return { ok: false, reason: "no-children" };
  }
  if (node.unsafeIndent) {
    return { ok: false, reason: "unsafe-indent" };
  }
  const firstChild = doc.nodes.get(node.childIds[0]);
  const lastChild = doc.nodes.get(node.childIds[node.childIds.length - 1]);
  if (!firstChild || !isListNode(firstChild) || !lastChild || !isListNode(lastChild)) {
    return { ok: false, reason: "child-not-found" };
  }
  if (lastChild.range.endLine !== node.range.endLine) {
    return { ok: false, reason: "interleaved-content" };
  }
  const ownTextEndLine = firstChild.range.startLine - 1;
  if (ownTextEndLine < node.range.startLine) {
    // Defensive only — see this function's own reason type doc comment.
    return { ok: false, reason: "empty-own-text" };
  }
  return {
    ok: true,
    resolution: {
      ownTextRange: { startLine: node.range.startLine, endLine: ownTextEndLine },
      childSubtreeRange: { startLine: firstChild.range.startLine, endLine: node.range.endLine },
    },
  };
}

// ---------------------------------------------------------------------
// Projection build
// ---------------------------------------------------------------------

/**
 * Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): a stable-
 * enough-to-attempt identity for one child-preview row's navigation
 * target, captured at projection build/reload time. `nodeId` is the
 * descendant list item's id AS OF THAT PARSE — per this codebase's
 * standing "a node id is only ever valid within the parse it came from"
 * rule (see e.g. applyParentListItemOwnTextEdit's own doc comment), never
 * assumed to still resolve to the same logical item once the pane has sat
 * open for a while. `firstLineRawText` is that item's own first raw line
 * at the same moment — carried purely as a click-time content sanity
 * check (resolveParentChildPreviewNavigationTarget below), never rendered
 * or otherwise used for display; the preview row's own visible text
 * already comes from `childSubtreeText`, not from this field.
 */
export interface ParentChildPreviewNavigationTarget {
  nodeId: string;
  firstLineRawText: string;
}

export type ParentListItemKind = "unordered" | "task" | "ordered";

/**
 * `nodeId` is carried alongside the two ranges/child snapshot for caller
 * convenience (view/PartialEditView.ts never needs to separately track
 * which node this projection came from). `ownText` is the parent's own
 * first line (+ continuation/blank lines, if any) split via
 * edit/multiLineListItemProjection.ts's own MultiLineListItemProjection
 * shape — reused verbatim for BOTH the single-line and multi-line own-text
 * case (see buildParentListItemProjection's own doc comment for why a
 * single-line own-text still produces this exact same shape, with
 * `continuationIndent: ""` and a `body` containing no `"\n"`). `ownTextRange`/
 * `childSubtreeRange` are resolveParentListItemOwnTextRange's own output,
 * captured once at build/load time. `childSubtreeText` is the child
 * subtree's raw Markdown, byte-for-byte, as it read at load time — this
 * module's own "before editing" snapshot for the read-only preview AND the
 * one and only text invertParentListItemProjection ever splices an edited
 * own-text candidate against for its own final safety check (see this
 * module's own top doc comment). `expectedChildCount` is `node.childIds.length`
 * at load time — the count invertParentListItemProjection's own final
 * candidate re-parse must still match.
 */
export interface ParentListItemProjection {
  nodeId: string;
  ownText: MultiLineListItemProjection;
  ownTextRange: LineRange;
  childSubtreeRange: LineRange;
  childSubtreeText: string;
  expectedChildCount: number;
  /**
   * Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): one entry
   * per line of `childSubtreeText` (same length, same order — index i here
   * describes `childSubtreeText.split("\n")[i]`), identifying which
   * descendant list item that preview ROW should navigate to when
   * activated, or `null` for a row that isn't a safe navigation target
   * (defensive only — every line inside childSubtreeRange is expected to
   * be owned by some descendant of `nodeId`, per
   * resolveParentListItemOwnTextRange's own "interleaved-content" gate
   * already refusing the one case that could make this untrue). Computed
   * once at build time from `doc.lineToOwningNodeId` — the SAME
   * authoritative per-line ownership data every other tree/move module in
   * this codebase already resolves list structure through, never a
   * re-implemented line-scanning heuristic of this module's own. A
   * multi-line child item's continuation lines share their own item's
   * navigation target with its own first line (lineToOwningNodeId already
   * returns that item's id for every line it owns, continuation included),
   * satisfying this ticket's own "続きの text は同じ navigation target に
   *属する" requirement for free. See
   * resolveParentChildPreviewNavigationTarget below for how
   * view/PartialEditView.ts re-verifies one of these targets against the
   * CURRENT document immediately before ever actually navigating to it —
   * this field alone is only ever a "as of the last build/reload" snapshot,
   * never trusted blindly at click time.
   */
  childPreviewRowTargets: (ParentChildPreviewNavigationTarget | null)[];
}

/**
 * Every way buildParentListItemProjection refuses to project a parent list
 * item — the first five reasons are resolveParentListItemOwnTextRange's own
 * (re-exposed verbatim; see that function's own reason type doc comment),
 * reached whenever the own-text/child-subtree ranges themselves cannot be
 * safely separated at all. "first-line-not-projectable" and
 * "malformed-continuation-indent" are reached only once that range
 * separation already succeeded, but the own-text SUBSTRING itself then
 * fails edit/multiLineListItemProjection.ts's own build (a continuation
 * line whose own indent is shallower than the canonical continuation-indent
 * length) or this module's own single-line dispatch (none of
 * buildListMarkerProjection/buildTaskListProjection/buildOrderedListProjection
 * accepted the own-text's first line — e.g. an unsupported task-checkbox
 * status character) — mirroring
 * edit/multiLineListItemProjection.ts#MultiLineListItemProjectionBuildReason's
 * own identically-named reasons exactly, for the identical rationale.
 *
 * A caller MUST fall back to raw Partial Edit for the WHOLE item whenever
 * this returns `ok: false` — this module never mutates anything, so that
 * fallback is always safe, mirroring every sibling projection module's own
 * identical contract.
 */
export type ParentListItemProjectionBuildReason =
  | ParentOwnTextRangeResolveReason
  | "first-line-not-projectable"
  | "malformed-continuation-indent"
  // Defensive only — edit/multiLineListItemProjection.ts's own
  // buildMultiLineListItemProjection can return "single-line" ONLY when its
  // own input has fewer than 2 lines, which can never happen on this
  // module's own `ownTextLineCount >= 2` call path below (TypeScript
  // cannot itself narrow that guarantee away from the callee's own return
  // type, so this reason is included here purely so that branch remains
  // total).
  | "single-line";

export type ParentListItemProjectionBuildResult =
  | { ok: true; projection: ParentListItemProjection }
  | { ok: false; reason: ParentListItemProjectionBuildReason };

/**
 * The parent-specific counterpart of
 * edit/multiLineListItemProjection.ts#buildMultiLineListItemProjection's
 * own internal first-line dispatch — a deliberate, independent DUPLICATE
 * (never imported/shared; see this module's own top doc comment's "Reuse,
 * never re-implementation" section for why), used only when the parent's
 * own-text substring is exactly ONE line (so that module's own
 * buildMultiLineListItemProjection, which always refuses `lines.length < 2`
 * with reason "single-line", is never even attempted).
 */
function buildSingleLineParentFirstLineSlot(
  rawLine: string
): { ok: true; slot: MultiLineFirstLineSlot } | { ok: false } {
  const listBuilt = buildListMarkerProjection(rawLine);
  if (listBuilt.ok) {
    return { ok: true, slot: { kind: "unordered", projection: listBuilt.projection } };
  }
  if (listBuilt.reason === "task-list-marker") {
    const taskBuilt = buildTaskListProjection(rawLine);
    if (taskBuilt.ok) {
      return { ok: true, slot: { kind: "task", projection: taskBuilt.projection } };
    }
  } else if (listBuilt.reason === "ordered-marker") {
    const orderedBuilt = buildOrderedListProjection(rawLine);
    if (orderedBuilt.ok) {
      return { ok: true, slot: { kind: "ordered", projection: orderedBuilt.projection } };
    }
  }
  return { ok: false };
}

/**
 * Build a ParentListItemProjection for `node` against `doc` — the ONE
 * entry point view/PartialEditView.ts's own loadNodeInternal/
 * performAutoReload call (mirroring buildStandaloneMultiLineListProjection's
 * own single-call-site convention). Resolves the own-text/child-subtree
 * ranges via resolveParentListItemOwnTextRange first; on success, extracts
 * the own-text substring and builds it EITHER via
 * edit/multiLineListItemProjection.ts's own buildMultiLineListItemProjection
 * (own-text spans 2+ lines — reused completely unmodified) OR this module's
 * own buildSingleLineParentFirstLineSlot immediately above (own-text is
 * exactly 1 line) — see this module's own top doc comment for why both
 * paths converge on the exact same MultiLineListItemProjection shape
 * either way (`continuationIndent: ""` and a single-line `body` for the
 * single-line path, since there is no continuation to normalize/indent at
 * all).
 */
export function buildParentListItemProjection(
  doc: ParsedDocument,
  node: ListBlockNode
): ParentListItemProjectionBuildResult {
  const resolved = resolveParentListItemOwnTextRange(doc, node);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  const { ownTextRange, childSubtreeRange } = resolved.resolution;
  const ownTextRaw = doc.lines.slice(ownTextRange.startLine, ownTextRange.endLine + 1).join("\n");
  const ownTextLineCount = ownTextRaw.split("\n").length;

  let ownText: MultiLineListItemProjection;
  if (ownTextLineCount >= 2) {
    const built = buildMultiLineListItemProjection(ownTextRaw);
    if (!built.ok) {
      return { ok: false, reason: built.reason };
    }
    ownText = built.projection;
  } else {
    const singleBuilt = buildSingleLineParentFirstLineSlot(ownTextRaw);
    if (!singleBuilt.ok) {
      return { ok: false, reason: "first-line-not-projectable" };
    }
    ownText = {
      rawText: ownTextRaw,
      listKind: singleBuilt.slot.kind,
      firstLine: singleBuilt.slot,
      continuationIndent: "",
      body: singleBuilt.slot.projection.body,
    };
  }

  const childSubtreeText = doc.lines
    .slice(childSubtreeRange.startLine, childSubtreeRange.endLine + 1)
    .join("\n");
  const childPreviewRowTargets = buildChildPreviewRowTargets(doc, node, childSubtreeRange);

  return {
    ok: true,
    projection: {
      nodeId: node.id,
      ownText,
      ownTextRange,
      childSubtreeRange,
      childSubtreeText,
      expectedChildCount: node.childIds.length,
      childPreviewRowTargets,
    },
  };
}

/**
 * Phase 5L-7: one `ParentChildPreviewNavigationTarget | null` per line of
 * `childSubtreeRange`, via `doc.lineToOwningNodeId` — see
 * `ParentListItemProjection#childPreviewRowTargets`'s own field doc
 * comment for the full rationale. `owningId === node.id` is excluded
 * defensively (should be unreachable inside childSubtreeRange, since
 * resolveParentListItemOwnTextRange's own "interleaved-content" gate
 * already refuses the one case that could make a line in this range
 * resolve back up to the PARENT's own id instead of a descendant's), so
 * this function never accidentally offers "open the parent itself" as one
 * of its own child preview row targets.
 */
function buildChildPreviewRowTargets(
  doc: ParsedDocument,
  node: ListBlockNode,
  childSubtreeRange: LineRange
): (ParentChildPreviewNavigationTarget | null)[] {
  const targets: (ParentChildPreviewNavigationTarget | null)[] = [];
  for (let line = childSubtreeRange.startLine; line <= childSubtreeRange.endLine; line++) {
    const owningId = doc.lineToOwningNodeId[line];
    const owningNode = owningId ? doc.nodes.get(owningId) : undefined;
    if (owningId && owningId !== node.id && owningNode && isListNode(owningNode)) {
      targets.push({ nodeId: owningId, firstLineRawText: doc.lines[owningNode.range.startLine] });
    } else {
      targets.push(null);
    }
  }
  return targets;
}

/** The shared textarea's display value for a built projection — just `projection.ownText.body`. Named for the same "callers reference the CONCEPT, not the field name" reason every sibling projection module's own identically-shaped accessor already is. */
export function projectedParentBodyText(projection: ParentListItemProjection): string {
  return projection.ownText.body;
}

/** The task checkbox control's own `.checked` value for a built projection — mirrors edit/multiLineListItemProjection.ts#projectedMultiLineChecked's own identical "always-readable default" contract exactly. */
export function projectedParentChecked(projection: ParentListItemProjection): boolean {
  return projection.ownText.firstLine.kind === "task" ? projection.ownText.firstLine.projection.checked : false;
}

/** The ordered-number control's own display value for a built projection — mirrors edit/multiLineListItemProjection.ts#projectedMultiLineNumberText's own identical "always-readable default" contract exactly. */
export function projectedParentNumberText(projection: ParentListItemProjection): string {
  return projection.ownText.firstLine.kind === "ordered" ? projection.ownText.firstLine.projection.number : "";
}

// ---------------------------------------------------------------------
// Invert (Apply-time candidate reconstruction + structural safety net)
// ---------------------------------------------------------------------

/**
 * Every way invertParentListItemProjection refuses to reconstruct a safe
 * own-text candidate — an APPLY-TIME-ONLY refusal, never conflated with a
 * raw-fallback build-time refusal (see this module's own top doc comment
 * for the exact distinction this ticket's own design doc requires). A
 * caller must reject Apply outright and preserve every draft field
 * (checkbox/number control AND the body textarea) exactly as the user had
 * it, the same contract every sibling projection module's own Apply-time
 * refusal already carries:
 *
 *   - "invalid-number": mirrors edit/orderedListProjection.ts's own
 *     identical refusal, reached only when `projection.ownText.listKind
 *     === "ordered"`.
 *   - "own-text-unsafe-structure": the own-text candidate, re-parsed in
 *     ISOLATION, no longer resolves to the safe shape
 *     edit/multiLineListItemProjection.ts's own
 *     validateMultiLineListItemCandidate (multi-line own-text path) or this
 *     module's own single-line invert (single-line own-text path) already
 *     requires — e.g. edited continuation content that would itself
 *     manufacture a nested child list item, or a callout/blockquote/
 *     fenced-code/table/thematic-break block.
 *   - "child-subtree-detached": the own-text candidate, re-parsed TOGETHER
 *     WITH the original child-subtree snapshot as one mini-document, no
 *     longer resolves to exactly one list item at line 0, of the same
 *     kind, owning exactly `projection.expectedChildCount` direct children,
 *     spanning the mini-document's entire own text — see this module's own
 *     top doc comment's "The one NEW risk this module's own safety net
 *     exists for" section.
 *   - "child-subtree-changed": defensive only (given the checks
 *     "child-subtree-detached" above already performs, this should be
 *     unreachable in practice) — the re-parsed candidate's own child-
 *     subtree slice no longer matches `projection.childSubtreeText`
 *     byte-for-byte. Kept and checked anyway, per this codebase's standing
 *     "never guess, always verify" convention.
 */
export type ParentListItemApplyRejectReason =
  | "invalid-number"
  | "own-text-unsafe-structure"
  | "child-subtree-detached"
  | "child-subtree-changed";

export type ParentListItemProjectionInvertResult =
  | { ok: true; ownTextRawText: string }
  | { ok: false; reason: ParentListItemApplyRejectReason };

/**
 * Reconstruct the parent's own-text raw Markdown from `projection` (the
 * ORIGINAL, load-time split — never mutated), `editedChecked`/
 * `editedNumberText` (the shared checkbox/number controls' CURRENT values —
 * used only when `projection.ownText.listKind` is "task"/"ordered"
 * respectively, ignored otherwise, mirroring every sibling projection
 * module's own identical contract), and `editedBody` (the shared textarea's
 * CURRENT value, edited or not). See this module's own top doc comment for
 * the full two-stage safety design (own-text-alone re-parse, THEN
 * own-text-spliced-with-original-child-subtree re-parse) and this
 * function's own reason type doc comment for the exhaustive refusal list.
 */
export function invertParentListItemProjection(
  projection: ParentListItemProjection,
  editedChecked: boolean,
  editedNumberText: string,
  editedBody: string
): ParentListItemProjectionInvertResult {
  const ownTextLineCount = projection.ownText.rawText.split("\n").length;

  let ownTextCandidate: string;
  if (ownTextLineCount >= 2) {
    const inverted = invertMultiLineListItemProjection(
      projection.ownText,
      editedChecked,
      editedNumberText,
      editedBody
    );
    if (!inverted.ok) {
      if (inverted.reason === "invalid-number") {
        return { ok: false, reason: "invalid-number" };
      }
      return { ok: false, reason: "own-text-unsafe-structure" };
    }
    ownTextCandidate = inverted.rawText;
  } else {
    const slot = projection.ownText.firstLine;
    if (slot.kind === "unordered") {
      const inverted = invertListMarkerProjection(slot.projection, editedBody);
      if (!inverted.ok) {
        // "multiline-body" — reachable: the user typed a line break into
        // what was originally a single-line own-text body. This ticket
        // does not extend the own-text's own SHAPE (single-line <->
        // multi-line) via editing — see this module's own top doc
        // comment's "What this module explicitly does NOT do" section —
        // so this is refused exactly like every other unsafe-structure
        // case, not silently upgraded to a multi-line own-text.
        return { ok: false, reason: "own-text-unsafe-structure" };
      }
      ownTextCandidate = inverted.rawLine;
    } else if (slot.kind === "task") {
      const inverted = invertTaskListProjection(slot.projection, editedChecked, editedBody);
      if (!inverted.ok) {
        return { ok: false, reason: "own-text-unsafe-structure" };
      }
      ownTextCandidate = inverted.rawLine;
    } else {
      const inverted = invertOrderedListProjection(slot.projection, editedNumberText, editedBody);
      if (!inverted.ok) {
        if (inverted.reason === "invalid-number") {
          return { ok: false, reason: "invalid-number" };
        }
        return { ok: false, reason: "own-text-unsafe-structure" };
      }
      ownTextCandidate = inverted.rawLine;
    }
  }

  // Final safety net: splice the reconstructed own-text candidate together
  // with the ORIGINAL, unedited child-subtree snapshot (never the live
  // document's current child content — see this module's own top doc
  // comment for why that distinction is what keeps an external child edit
  // from ever blocking this Apply) and re-parse the result as one
  // throwaway mini-document.
  const fullCandidateText = ownTextCandidate + "\n" + projection.childSubtreeText;
  const fullCandidateLines = fullCandidateText.split("\n");
  const candidateDoc = parseDocument(fullCandidateText);
  const candidateNode = candidateDoc.nodes.get("li-0");
  if (
    !candidateNode ||
    !isListNode(candidateNode) ||
    candidateNode.range.startLine !== 0 ||
    candidateNode.ordered !== (projection.ownText.listKind === "ordered") ||
    candidateNode.unsafeIndent ||
    candidateNode.childIds.length !== projection.expectedChildCount ||
    candidateNode.range.endLine !== fullCandidateLines.length - 1
  ) {
    return { ok: false, reason: "child-subtree-detached" };
  }
  const firstCandidateChild = candidateDoc.nodes.get(candidateNode.childIds[0]);
  if (!firstCandidateChild || !isListNode(firstCandidateChild)) {
    return { ok: false, reason: "child-subtree-detached" };
  }
  const candidateChildSubtreeText = fullCandidateLines
    .slice(firstCandidateChild.range.startLine, candidateNode.range.endLine + 1)
    .join("\n");
  if (candidateChildSubtreeText !== projection.childSubtreeText) {
    // Defensive only — see this function's own reason type doc comment.
    return { ok: false, reason: "child-subtree-changed" };
  }

  return { ok: true, ownTextRawText: ownTextCandidate };
}

// ---------------------------------------------------------------------
// Apply-time write-back: own-text range ONLY, own conflict check
// ---------------------------------------------------------------------

// "resolve-failed"/"unsafe-indent" reuse view/PartialEditView.ts's own
// generic "reason." + reason lookup against the pre-existing, already-shared
// reason.resolve-failed/reason.unsafe-indent i18n keys (operation-neutral
// wording, safe to share — same reasoning applySubtreeEdit's own identically
// named reasons already rely on). "parent-own-text-range-unresolvable" and
// "parent-own-text-conflict" are deliberately NOT named "range-unresolvable"/
// "conflict" bare: a grep across src/i18n.ts confirms there is no
// pre-existing generic "reason.conflict" key this module could safely reuse
// (edit/compositeBlockPartialEdit.ts's own top doc comment independently
// notes the exact same gap for its own compositePartialEditConflict key), so
// this module mirrors that established precedent and adds its own uniquely-
// named, dedicated i18n keys instead (src/i18n.ts's own
// "reason.parent-own-text-range-unresolvable"/"reason.parent-own-text-conflict").
export type ParentListItemApplyOwnTextReason =
  | "resolve-failed"
  | "unsafe-indent"
  | "parent-own-text-range-unresolvable"
  | "parent-own-text-conflict";

export interface ApplyParentListItemOwnTextOutcome {
  changed: boolean;
  lines: string[];
  /** New start line of the replaced own-text range (valid when changed). */
  newStartLine: number;
  reason?: ParentListItemApplyOwnTextReason;
}

/**
 * Replace ONLY the parent's own-text range (never the child subtree, never
 * anything else) with `newOwnTextRawText`, against the CURRENT `doc` (a
 * fresh parse of the note as it stands right now). `originalOwnTextRawText`
 * must be exactly `projection.ownText.rawText` from when the Partial Edit
 * Pane first loaded/last-rebuilt this projection.
 *
 * Deliberately NOT a call to edit/partialEdit.ts's own applySubtreeEdit —
 * see this module's own top doc comment's "Apply-time write-back" section
 * for the full rationale. `nodeId` is re-resolved and its own-text range
 * re-derived FRESH from `doc` (never trusting a caller-held node/range from
 * an earlier parse — line numbers are only ever valid within the parse they
 * came from), and the conflict check compares ONLY that freshly re-derived
 * own-text substring against `originalOwnTextRawText` — an external change
 * to the child subtree alone can never trigger "conflict" here, by
 * construction (the comparison never even looks at that range).
 */
export function applyParentListItemOwnTextEdit(
  doc: ParsedDocument,
  nodeId: string,
  originalOwnTextRawText: string,
  newOwnTextRawText: string
): ApplyParentListItemOwnTextOutcome {
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "resolve-failed" };
  }
  if (node.unsafeIndent) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "unsafe-indent" };
  }
  const resolved = resolveParentListItemOwnTextRange(doc, node);
  if (!resolved.ok) {
    return {
      changed: false,
      lines: doc.lines,
      newStartLine: -1,
      reason: "parent-own-text-range-unresolvable",
    };
  }
  const { ownTextRange } = resolved.resolution;
  const currentOwnTextRaw = doc.lines.slice(ownTextRange.startLine, ownTextRange.endLine + 1).join("\n");
  if (currentOwnTextRaw !== originalOwnTextRawText) {
    return { changed: false, lines: doc.lines, newStartLine: -1, reason: "parent-own-text-conflict" };
  }

  const newLines = newOwnTextRawText.split("\n");
  const lines = [
    ...doc.lines.slice(0, ownTextRange.startLine),
    ...newLines,
    ...doc.lines.slice(ownTextRange.endLine + 1),
  ];
  return { changed: true, lines, newStartLine: ownTextRange.startLine };
}

// ---------------------------------------------------------------------
// Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): click-time
// target identity re-resolution
// ---------------------------------------------------------------------

/**
 * Every way resolveParentChildPreviewNavigationTarget below refuses to
 * navigate to a child preview row's target — always a SAFE REFUSAL
 * (Notice, no navigation, parent draft untouched — see
 * view/PartialEditView.ts's own handleChildPreviewRowActivate), never a
 * best-effort guess at "probably still the same item":
 *
 *   - "parent-unresolvable": the pane's own parent node id no longer
 *     resolves to a list node in the CURRENT document, or that node is no
 *     longer itself eligible for own-text/child-subtree separation at all
 *     (resolveParentListItemOwnTextRange itself now refuses it) — the
 *     parent structure changed too much to safely re-locate ANY child
 *     under it.
 *   - "target-not-found": the target's own `nodeId` (captured at the last
 *     preview build/reload) no longer resolves to a list node at all.
 *   - "target-not-descendant": the target's `nodeId` DOES still resolve to
 *     some list node, but that node's own first line no longer falls
 *     inside the CURRENT parent's own child-subtree range — i.e. the id
 *     got reassigned elsewhere in the document (list item ids are
 *     sequence-based within one parse — see this module's own top doc
 *     comment's "Apply-time write-back" section for the same "a node id
 *     is only ever valid within the parse it came from" principle) and
 *     now points at an unrelated node. Refused rather than opening that
 *     unrelated node.
 *   - "target-content-changed": the resolved node's own first line no
 *     longer matches `target.firstLineRawText` byte-for-byte — a content
 *     sanity check on top of the position check above, catching the case
 *     where the id/position still line up by coincidence (e.g. a sibling
 *     reordering that shifted ids without changing count) but the actual
 *     item content did change.
 */
export type ParentChildPreviewNavigationResolveReason =
  | "parent-unresolvable"
  | "target-not-found"
  | "target-not-descendant"
  | "target-content-changed";

export type ParentChildPreviewNavigationResolveResult =
  | { ok: true; nodeId: string }
  | { ok: false; reason: ParentChildPreviewNavigationResolveReason };

/**
 * Re-resolve one `ParentChildPreviewNavigationTarget` (captured at the
 * pane's last projection build/reload — see
 * `ParentListItemProjection#childPreviewRowTargets`) against a FRESH parse
 * of the CURRENT document, immediately before ever actually navigating to
 * it. Deliberately re-derives the parent's own current child-subtree range
 * from scratch (via resolveParentListItemOwnTextRange) rather than trusting
 * any range cached on the pane — mirrors applyParentListItemOwnTextEdit's
 * own "never trust a caller-held range from an earlier parse" principle,
 * just applied to a navigation READ instead of an Apply WRITE. Returns
 * `ok: true` with the target's own (still-current) nodeId only once BOTH
 * the position check (still inside the parent's own child-subtree range)
 * AND the content check (first line unchanged) pass — see this function's
 * own reason type doc comment for the full, exhaustive refusal list.
 */
export function resolveParentChildPreviewNavigationTarget(
  doc: ParsedDocument,
  parentNodeId: string,
  target: ParentChildPreviewNavigationTarget
): ParentChildPreviewNavigationResolveResult {
  const parentNode = doc.nodes.get(parentNodeId);
  if (!parentNode || !isListNode(parentNode)) {
    return { ok: false, reason: "parent-unresolvable" };
  }
  const resolved = resolveParentListItemOwnTextRange(doc, parentNode);
  if (!resolved.ok) {
    return { ok: false, reason: "parent-unresolvable" };
  }
  const targetNode = doc.nodes.get(target.nodeId);
  if (!targetNode || !isListNode(targetNode)) {
    return { ok: false, reason: "target-not-found" };
  }
  const { childSubtreeRange } = resolved.resolution;
  if (
    targetNode.range.startLine < childSubtreeRange.startLine ||
    targetNode.range.startLine > childSubtreeRange.endLine
  ) {
    return { ok: false, reason: "target-not-descendant" };
  }
  if (doc.lines[targetNode.range.startLine] !== target.firstLineRawText) {
    return { ok: false, reason: "target-content-changed" };
  }
  return { ok: true, nodeId: target.nodeId };
}
