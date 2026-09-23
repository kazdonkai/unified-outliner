/**
 * Phase 5D-0: Obsidian-free, pure-function matching of CompositeBlockRule
 * against an already-parsed ParsedDocument (parser/parseDocument.ts) and an
 * already-computed ComplexBlockScanResult (parser/complexBlocks.ts).
 *
 * Like parser/complexBlocks.ts, this module ONLY recognizes and groups. It
 * does not move, edit, render, or fold anything, and it introduces no new
 * IDs into ParsedDocument.nodes or ComplexBlockScanResult.blocks — a
 * CompositeBlockInfo is a read-only VIEW over ids that already exist in one
 * of those two structures. See model/compositeBlock.ts's doc comment for
 * why this is a third, separate model rather than an extension of either
 * existing one.
 *
 * ---- Candidate collection ----
 *
 * Two independent candidate pools, both restricted to blocks whose
 * boundary is confidently known:
 *   - every ListBlockNode in doc.nodes (any depth) — kind
 *     "single-line-list" when it has no continuation lines and no nested
 *     child list (range.startLine === range.endLine proves both at once),
 *     otherwise plain "list". A rule's kindSequence encodes the
 *     single-line requirement directly via which of the two kinds it asks
 *     for (Phase 5D-0.3; replaces the earlier requireSingleLineList flag).
 *   - every ComplexBlockInfo in complexScan.blocks with
 *     editability === "supported" AND kind !== "paragraph" —
 *     "ambiguous"/"unsupported" blocks are excluded by the editability
 *     check, matching this whole plugin's "never build on an uncertain
 *     boundary" policy. Phase 5P-1R (2026-08-17): confidently-bounded
 *     paragraph blocks now also report editability === "supported" (see
 *     parser/complexBlocks.ts's scanParagraphBlocks doc comment) —
 *     "supported" alone no longer implies "eligible for CompositeBlock
 *     membership" for every kind, so paragraph is excluded here by an
 *     EXPLICIT kind check rather than relying on editability to do that
 *     job. Paragraph/CompositeBlock integration remains out of scope until
 *     a future phase explicitly designs it.
 * The two pools are merged and sorted by range.startLine into one
 * document-order candidate list.
 *
 * ---- Matching algorithm ----
 *
 * A single left-to-right pass over the sorted candidate list. At each
 * unconsumed candidate index i, try every rule in the CALLER-SUPPLIED order
 * (which doubles as priority order — see this function's own doc comment
 * below) and accept the FIRST one whose kindSequence matches starting at i,
 * subject to every one of the required conditions below. On a match, every
 * consumed candidate index is marked used (so it can never join a second
 * CompositeBlock) and the scan resumes just past the match; on no match,
 * the scan simply advances to i + 1.
 *
 * Required conditions (see
 * docs/phase5d0_basic-block-extension-and-composite-block-spec.md §3.4):
 *   1. Every member is already a confirmed candidate (see above) — no
 *      re-parsing happens here.
 *   2. The candidate kinds starting at i equal rule.kindSequence exactly,
 *      in document order.
 *   3. No blank line — in fact no gap at all — between consecutive
 *      members: member[k+1].range.startLine must equal
 *      member[k].range.endLine + 1. A rule never matches across a blank
 *      line, matching the ticket's "空行を挟む block 列は複合化しない".
 *   4. Every member resolves (via resolveMemberSectionId, below) to the
 *      SAME enclosing section id (both being null — no enclosing heading —
 *      also counts as "the same").
 *   5. Member ranges never overlap — guaranteed by construction here since
 *      a matched candidate index is immediately marked consumed and a
 *      strict start-line ordering + zero-gap-adjacency check (condition 3)
 *      already rules out overlap between the members of ONE match; across
 *      different matches, the shared `consumed` set prevents any candidate
 *      index — and therefore its range — from being reused.
 *   6. No candidate participates in more than one CompositeBlock — the
 *      `consumed` set enforces this directly.
 *   7. When multiple rules could match at the same starting candidate, only
 *      the highest-priority one (first in the caller's `rules` array) is
 *      used — enforced by trying rules in array order and stopping at the
 *      first full match.
 */
import { isListNode, LineRange, ListBlockNode, ParsedDocument } from "../model/block";
import { isBlankLine } from "./parseDocument";
import {
  BlockDiagnostic,
  ComplexBlockInfo,
  ComplexBlockScanResult,
  StandaloneComplexBlockMovability,
} from "../model/complexBlock";
import {
  CompositeBlockDeletability,
  CompositeBlockDeleteRejectionReason,
  CompositeBlockInfo,
  CompositeBlockMember,
  CompositeBlockMovability,
  CompositeBlockRejection,
  CompositeBlockRule,
  CompositeMemberKind,
} from "../model/compositeBlock";

interface Candidate {
  kind: CompositeMemberKind;
  id: string;
  startLine: number;
  endLine: number;
}

/**
 * Nearest enclosing SECTION id for a line, walking BlockNode.parentId from
 * that line's immediate owner (doc.lineToOwningNodeId — the same ground
 * truth every other scanner in this codebase already trusts, see
 * parser/complexBlocks.ts's own top doc comment) up until a "section"-typed
 * node is reached, or the chain runs out (null — legitimately "no
 * enclosing heading", e.g. content before the document's first heading).
 * Deliberately reimplemented here (rather than importing
 * move/resolveMoveTarget.ts's equivalent) to keep parser/* free of any
 * dependency on the move/ layer, which itself already depends on parser/*
 * — importing the other way would invert that layering.
 */
function resolveMemberSectionId(doc: ParsedDocument, startLine: number): string | null {
  let id: string | null = doc.lineToOwningNodeId[startLine] ?? null;
  const visited = new Set<string>();
  while (id) {
    if (visited.has(id)) return null; // defensive: never trust a cycle
    visited.add(id);
    const node = doc.nodes.get(id);
    if (!node) return null;
    if (node.type === "section") return node.id;
    id = node.parentId;
  }
  return null;
}

function collectCandidates(doc: ParsedDocument, complexScan: ComplexBlockScanResult): Candidate[] {
  const candidates: Candidate[] = [];
  for (const node of doc.nodes.values()) {
    if (isListNode(node)) {
      // Phase 5D-0.3: every ListBlockNode is classified as EITHER
      // "single-line-list" (no continuation lines, no nested child list —
      // range.startLine === range.endLine proves both at once, same as the
      // former requireSingleLineList check) OR plain "list". A rule now
      // encodes the single-line constraint directly in its kindSequence
      // (e.g. ["single-line-list", "callout"]) instead of a separate
      // boolean flag, so each list candidate can only ever match ONE of
      // the two kinds — never both.
      const kind: CompositeMemberKind =
        node.range.startLine === node.range.endLine ? "single-line-list" : "list";
      candidates.push({ kind, id: node.id, startLine: node.range.startLine, endLine: node.range.endLine });
    }
  }
  for (const block of complexScan.blocks) {
    if (block.editability !== "supported") continue;
    // Phase 5P-1R: paragraph blocks can now report "supported" (a
    // confidently-resolved boundary), but CompositeBlock membership is a
    // SEPARATE, not-yet-designed capability for paragraph — this explicit
    // guard is required (see this file's top doc comment) now that
    // editability alone no longer rules paragraph out.
    if (block.kind === "paragraph") continue;
    candidates.push({ kind: block.kind, id: block.id, startLine: block.range.startLine, endLine: block.range.endLine });
  }
  candidates.sort((a, b) => a.startLine - b.startLine);
  return candidates;
}

/**
 * Matches `rules` (tried in array order = priority order — pass only the
 * rules that should currently be considered, e.g. via
 * settingsDefaults.ts's getEnabledCompositeBlockRules) against `doc` and
 * `complexScan`. See this module's top doc comment for the full algorithm
 * and required conditions.
 */
export function matchCompositeBlocks(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  rules: CompositeBlockRule[]
): CompositeBlockInfo[] {
  const candidates = collectCandidates(doc, complexScan);
  const consumed = new Set<number>();
  const results: CompositeBlockInfo[] = [];
  let seq = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (consumed.has(i)) continue;

    let matched: { rule: CompositeBlockRule; indices: number[] } | null = null;

    for (const rule of rules) {
      const len = rule.kindSequence.length;
      if (len < 2 || i + len > candidates.length) continue;

      const indices: number[] = [];
      let ok = true;
      for (let k = 0; k < len; k++) {
        const idx = i + k;
        if (consumed.has(idx)) {
          ok = false;
          break;
        }
        const cand = candidates[idx];
        if (cand.kind !== rule.kindSequence[k]) {
          ok = false;
          break;
        }
        indices.push(idx);
      }
      if (!ok) continue;

      // Condition 3: zero-gap adjacency between consecutive members.
      for (let k = 1; k < indices.length; k++) {
        const prev = candidates[indices[k - 1]];
        const curr = candidates[indices[k]];
        if (curr.startLine !== prev.endLine + 1) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Condition 4: every member shares one enclosing section.
      const sectionIds = indices.map((idx) => resolveMemberSectionId(doc, candidates[idx].startLine));
      if (!sectionIds.every((s) => s === sectionIds[0])) continue;

      matched = { rule, indices };
      break; // highest-priority matching rule wins (condition 7).
    }

    if (!matched) continue;

    for (const idx of matched.indices) consumed.add(idx);
    const members: CompositeBlockMember[] = matched.indices.map((idx) => {
      const c = candidates[idx];
      return { kind: c.kind, id: c.id, range: { startLine: c.startLine, endLine: c.endLine } };
    });
    results.push({
      id: `composite-${seq++}`,
      ruleId: matched.rule.id,
      range: { startLine: members[0].range.startLine, endLine: members[members.length - 1].range.endLine },
      members,
      sectionId: resolveMemberSectionId(doc, members[0].range.startLine),
    });
  }

  return results;
}

// ---- Phase 5C-1 ticket 1: CompositeBlock delete-eligibility ---------------
//
// The functions below answer a DIFFERENT question than everything above
// this line: matchCompositeBlocks only ever asks "is this a
// CompositeBlock" (recognition). evaluateCompositeBlockDeletability asks
// "may this SPECIFIC, already-recognized CompositeBlock be safely deleted
// as one unit" — a strictly narrower, independently re-checked question.
// See model/compositeBlock.ts's CompositeBlockDeletability doc comment for
// why this is a third concern (alongside "recognized" and "renderable",
// the latter being tree/buildOutlineTree.ts's isCompositeSafelyProjectable)
// that must not be blurred with either of the other two.
//
// This ticket adds NO delete implementation (no edit/deleteCompositeBlock.ts,
// no doc.lines mutation of any kind) and is not called from
// view/OutlineTreeView.ts, any context menu, or any command — it exists so
// a LATER ticket has a single, already-vetted, independently-testable
// safety gate to consult before ever touching the note's text.

/**
 * True when any diagnostic in `diagnostics` overlaps `range` AND that
 * diagnostic is about THIS block's own boundary, not merely a lower-priority
 * candidate that lost to it. Deliberately EXCLUDES `kind === "overlapping-range"`:
 * that diagnostic kind is emitted by parser/complexBlocks.ts's own
 * mergeBlockRangesSafely against the LOSING (lower-priority, downgraded)
 * candidate's range, not the winning "supported" block's — and because
 * scanParagraphBlocks is a catch-all that "does NOT exclude quote-prefixed
 * or pipe-table-row-shaped lines" (see that function's own doc comment), a
 * perfectly healthy, still-`"supported"` callout/blockquote/table has an
 * "overlapping-range" diagnostic recorded against its own range EVERY TIME
 * the paragraph scanner also produced a (losing) candidate over the same
 * lines — which is the ordinary, expected case for these three kinds, not
 * an edge case. Treating that diagnostic as disqualifying would reject
 * nearly every real callout/blockquote/table composite member, which is
 * not what "diagnosticsを持つblockを拒否する" was asking for.
 *
 * Every OTHER diagnostic kind ("unterminated-fence", "unsupported-callout-nesting",
 * "malformed-table", the boundary-crossing "ambiguous") is, by construction,
 * always pushed in the exact same branch that also downgrades THAT block's
 * own `editability` away from `"supported"` (see parser/complexBlocks.ts's
 * scanners) — so for a block that already passed the `editability ===
 * "supported"` check above, none of these should ever be found overlapping
 * it either. This function still checks independently (rather than
 * skipping the check entirely) as defense-in-depth against a future
 * scanner change that adds a new diagnostic-producing path without also
 * downgrading editability in the same step.
 */
function hasOverlappingDiagnostic(diagnostics: BlockDiagnostic[], range: LineRange): boolean {
  return diagnostics.some(
    (d) => d.kind !== "overlapping-range" && d.fromLine <= range.endLine && range.startLine <= d.toLine
  );
}

/**
 * Evaluates whether `composite` (an already-matched CompositeBlockInfo, as
 * produced by matchCompositeBlocks over the SAME `doc`/`complexScan`) may
 * be safely deleted as one unit, per Phase 5C-1 ticket 1's approved
 * condition set. Every condition below is re-derived independently from
 * `doc`/`complexScan` — this function does NOT simply trust that
 * `composite` was produced by matchCompositeBlocks (a future caller could
 * pass a stale or hand-built CompositeBlockInfo), matching this whole
 * codebase's "never guess, always re-verify against the current ground
 * truth" policy (see e.g. tree/buildOutlineTree.ts's
 * isCompositeSafelyProjectable, edit/partialEdit.ts's re-extract-and-compare
 * conflict check).
 *
 * A composite is deletable only when EVERY member independently satisfies
 * ALL of the following (checked in the order below; the FIRST failing
 * member/condition determines the single reported reason — this function
 * does not attempt to collect every violation at once, matching every
 * other rejection-reporting function in this codebase, e.g.
 * parser/complexBlocks.ts's resolveParentId):
 *
 *   1. The member itself resolves: a "list"/"single-line-list" member must
 *      resolve in `doc.nodes` to an actual ListBlockNode; a
 *      "callout"/"blockquote"/"fenced-code"/"table" member must resolve in
 *      `complexScan.blocks` to an actual ComplexBlockInfo. Otherwise:
 *      "member-resolve-failed".
 *   2. The member's KIND is one Phase 5C-1 ticket 1 supports deleting:
 *      "list"/"single-line-list" (the anchor list item itself, always
 *      deleted along with the rest of the composite) or one of "callout" /
 *      "blockquote" / "fenced-code" (including Mermaid — a fenced-code
 *      block's `infoString` never changes this evaluation) / "table".
 *      "paragraph" (always editability "read-only", never a genuine delete
 *      candidate per docs/mixed-structure-spec.md §6) and any other kind
 *      (e.g. a future "section"/"thematic-break" composite member) are
 *      rejected as "unsupported-member-kind" — deliberately explicit here
 *      rather than merely falling out of the editability check below, so a
 *      future new ComplexBlockKind is rejected by default until this
 *      function is revisited, not silently accepted.
 *   3. For a "list"/"single-line-list" member: `unsafeIndent` must be
 *      false. Not explicitly requested by this ticket's own condition
 *      list, but added as defense-in-depth for consistency with every
 *      other list-mutating module in this codebase (move/relocateListSubtree.ts,
 *      edit/partialEdit.ts's extractSubtreeText, edit/insertBlock.ts's
 *      insertChildListItem all refuse mixed tab/space indentation the same
 *      way) — flagged explicitly in this ticket's completion report as an
 *      addition beyond the literal request, not a silent scope change.
 *      Otherwise: "member-unsafe-indent".
 *   4. For a "callout"/"blockquote"/"fenced-code"/"table" member:
 *      `editability === "supported"` (excludes nested callout, unterminated
 *      fence, malformed table, boundary-ambiguous, and overlapping-range
 *      downgrades in one check — see parser/complexBlocks.ts's own
 *      editability assignment). Otherwise: "member-not-supported".
 *   5. For the same complex-kind members: no diagnostic in
 *      `complexScan.diagnostics` overlaps the member's own range (see
 *      hasOverlappingDiagnostic's doc comment for why this is checked
 *      independently of step 4 rather than assumed to be implied by it).
 *      Otherwise: "member-has-diagnostic".
 *   6. The member's resolved owner (a "list"/"single-line-list" member's
 *      BlockNode.parentId; a complex-kind member's ComplexBlockInfo.parentId)
 *      must NOT itself be a "list"-typed node — i.e. the member must sit
 *      directly under its enclosing SECTION (or under no section at all,
 *      top-of-document), never nested inside another list item's
 *      continuation. This is what "単一 section 内・トップレベル相当" means
 *      operationally, and is what excludes a CompositeBlock whose anchor
 *      list item (or a complex-kind member) is itself a nested list child —
 *      see this ticket's completion report for why this narrower first
 *      deletable set was chosen over also supporting nested-in-list
 *      composites immediately. Otherwise: "nested-in-list".
 *
 * After every member individually passes 1–6, one FINAL composite-level
 * check: every member's resolved owner (section id, or null for
 * top-of-document) must be the SAME across all members — re-deriving
 * matchCompositeBlocks's own "same enclosing section" requirement
 * independently, rather than trusting `composite.sectionId` (which was
 * computed by a different code path, at match time, potentially against a
 * stale `doc`/`complexScan` if the caller didn't pass the matching pair).
 * A disagreement here is reported as "ambiguous-section" and — unlike every
 * per-member reason above — is NOT attributed to any single
 * `offendingMemberId`, since the fault is the disagreement itself, not any
 * one member.
 */
export function evaluateCompositeBlockDeletability(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  composite: CompositeBlockInfo
): CompositeBlockDeletability {
  const ownerIds = new Set<string | null>();

  for (const member of composite.members) {
    let ownerId: string | null;

    if (member.kind === "list" || member.kind === "single-line-list") {
      const node = doc.nodes.get(member.id);
      if (!node || !isListNode(node)) {
        return { deletable: false, reason: "member-resolve-failed", offendingMemberId: member.id };
      }
      if (node.unsafeIndent) {
        return { deletable: false, reason: "member-unsafe-indent", offendingMemberId: member.id };
      }
      ownerId = node.parentId;
    } else if (
      member.kind === "callout" ||
      member.kind === "blockquote" ||
      member.kind === "fenced-code" ||
      member.kind === "table"
    ) {
      const info = complexScan.blocks.find((b) => b.id === member.id);
      if (!info) {
        return { deletable: false, reason: "member-resolve-failed", offendingMemberId: member.id };
      }
      if (info.editability !== "supported") {
        return { deletable: false, reason: "member-not-supported", offendingMemberId: member.id };
      }
      if (hasOverlappingDiagnostic(complexScan.diagnostics, info.range)) {
        return { deletable: false, reason: "member-has-diagnostic", offendingMemberId: member.id };
      }
      ownerId = info.parentId;
    } else {
      // "paragraph", "thematic-break", "section", or any future kind not
      // explicitly handled above — see condition 2's doc comment.
      return { deletable: false, reason: "unsupported-member-kind", offendingMemberId: member.id };
    }

    const ownerNode = ownerId ? doc.nodes.get(ownerId) : null;
    if (ownerNode && ownerNode.type === "list") {
      return { deletable: false, reason: "nested-in-list", offendingMemberId: member.id };
    }

    ownerIds.add(ownerId ?? null);
  }

  if (ownerIds.size !== 1) {
    return { deletable: false, reason: "ambiguous-section" };
  }

  return { deletable: true };
}

// ---- Phase 5C-1 ticket 4-1 (2026-08-14, revised): CompositeBlock move-
// eligibility ----------------------------------------------------------
//
// DESIGN MEMO (superseding this ticket's original sibling-pointer-based
// draft — see this ticket's completion report for the full history of why
// that draft was abandoned before ever shipping):
//
// The ORIGINAL design tried to answer "does an adjacent sibling exist in
// `direction`" by reading `members[0].prevSiblingId`/`nextSiblingId`
// directly off the anchor ListBlockNode. Empirically verified (via a real
// parseDocument() call) to be WRONG: parser/parseDocument.ts's own
// root-item sibling linking (`lastRootItem`, see its pass-2 loop) is reset
// to null the moment ANY non-blank, non-list, non-heading line is
// encountered at or above the current indent — and a CompositeBlock's own
// SECOND member (its callout/blockquote) is EXACTLY such a line. So
// `members[0].nextSiblingId` is null for essentially every real composite
// regardless of what follows it, and the PREVIOUS composite's own trailing
// callout/blockquote equally severs the NEXT composite's
// `members[0].prevSiblingId`. Two composites sitting back-to-back —
// arguably the single most common composite-adjacency shape — could never
// be found eligible under that design. This is a general, pre-existing
// property of this codebase's list-sibling model (not a composite-specific
// bug): the existing plain-list-item move/findMoveTarget.ts already has a
// dedicated NoMoveReason ("blocked-by-paragraph") for the same underlying
// phenomenon.
//
// The REVISED design below never reads BlockNode sibling pointers for this
// purpose. Instead it scans the raw document, starting just outside
// `composite.range`, for the next/previous BLOCK BOUNDARY in the requested
// direction — mirroring move/findMoveTarget.ts's own up/down scanning
// style (skip blank lines, inspect what's found) but adapted to recognize
// both plain list items and other CompositeBlocks as valid adjacency
// targets. Blank lines encountered while scanning are only ever used to
// decide WHERE the next real content starts — they are never deleted,
// merged, or otherwise touched; a future move (ticket 4-3, reusing
// move/moveBlock.ts's existing swapBlocks primitive) preserves whatever
// blank-line gap sat between the two swapped ranges automatically, purely
// because swapBlocks already slices out `lines[a.endLine+1 .. b.startLine)`
// as one unit and re-emits it unchanged between the swapped blocks — no
// new "separator range" data structure is needed as long as this
// resolution step correctly reports the two exact LineRanges to swap.
//
// `allComposites` (needed for the "up" direction only — see
// findAdjacentAnchorNode's own doc comment) and `complexScan` (accepted for
// signature symmetry with evaluateCompositeBlockDeletability but not
// currently needed by this revised algorithm, since a composite boundary
// is already fully described by `allComposites` without re-deriving it
// from complexScan.blocks) are both parameters of this function.

/**
 * True when `node`'s own `parentId` resolves (in `doc.nodes`) to a node of
 * type "list" — i.e. `node` sits nested inside another list item's
 * continuation, rather than directly under its enclosing section (or under
 * no section at all, top-of-document). Mirrors
 * evaluateCompositeBlockDeletability's own `ownerNode.type === "list"`
 * check exactly (see that function's condition 6) — deliberately NOT a
 * null-check on `parentId`: a ROOT list item's own `parentId` is the
 * owning SECTION's id (non-null) per ListBlockNode's own doc comment in
 * model/block.ts, so a null-check alone would misclassify every ordinary,
 * non-nested composite as "nested".
 */
function isNestedInList(doc: ParsedDocument, node: { parentId: string | null }): boolean {
  if (!node.parentId) return false;
  const owner = doc.nodes.get(node.parentId);
  return !!owner && owner.type === "list";
}

/**
 * Scans from `boundaryLine` in `direction`, skipping ONLY blank lines
 * (never interpreting or consuming anything else), and returns the first
 * non-blank line found — or `null` when the document's own edge (or
 * frontmatter) is reached first. Deliberately mirrors
 * move/findMoveTarget.ts's own up/down blank-skipping loops in style, kept
 * as an independent re-implementation here rather than an import, matching
 * this module's established "parser/* stays free of any dependency on the
 * move/* layer" policy (see resolveMemberSectionId's own doc comment,
 * above).
 *
 * Exported (ticket 4-2, 2026-08-14) SOLELY so
 * move/findCompositeMoveTarget.ts can perform the exact same composite-
 * range-relative adjacency scan evaluateCompositeBlockMovability (ticket
 * 4-1) already performs, with zero risk of the two drifting apart — this is
 * NOT a general-purpose blank-line utility; it is scoped to the composite
 * adjacency algorithm the two tickets share. Exporting introduces no
 * behavior change: every one of ticket 4-1's existing 16
 * evaluateCompositeBlockMovability test cases continues to pass unchanged
 * (see tests/compositeBlockMovability.test.ts).
 */
export function skipBlankLines(doc: ParsedDocument, boundaryLine: number, direction: "up" | "down"): number | null {
  const n = doc.lines.length;
  let k = boundaryLine;
  if (direction === "down") {
    while (k < n && isBlankLine(doc.lines[k])) k++;
    if (k >= n || doc.frontmatterLines[k]) return null;
  } else {
    while (k >= 0 && isBlankLine(doc.lines[k])) k--;
    if (k < 0 || doc.frontmatterLines[k]) return null;
  }
  return k;
}

/**
 * Resolves the ListBlockNode that anchors whatever real block sits exactly
 * at `line` — the boundary found by skipBlankLines, above — in `direction`.
 * Deliberately does NOT consult `doc.lineToOwningNodeId`: that index
 * answers "which node's CONTENT does this line belong to" (its deepest
 * owning section/list, walking into nested continuations), a different
 * question than "which node's own range genuinely STARTS or ENDS exactly
 * here" — trusting the former could, in principle, resolve a line that
 * merely happens to fall inside some unrelated multi-line list item's
 * continuation (which might itself embed unrelated callout/blockquote
 * content) as if it were a fresh block boundary. This function instead
 * does an explicit, unambiguous range-boundary scan over `doc.nodes`.
 *
 *   - direction "down": returns the ListBlockNode whose OWN
 *     `range.startLine === line`, if any. A CompositeBlock's own first
 *     member (`members[0]`) is ALWAYS such a node by construction — its
 *     `range.startLine` is literally `composite.range.startLine` (see
 *     model/compositeBlock.ts's CompositeBlockInfo doc comment) — so this
 *     single check already finds the start of a plain list item OR the
 *     start of another CompositeBlock, with no separate composite-aware
 *     branch needed for this direction.
 *   - direction "up": first tries the same direct check, using
 *     `range.endLine === line`. This finds a plain list item (or a
 *     multi-line list subtree) ending exactly at `line`. If that fails,
 *     falls back to `allComposites`: a CompositeBlock's OWN aggregate
 *     `range.endLine` is usually its LAST member's endLine (typically a
 *     callout/blockquote — a ComplexBlockInfo, which owns no line in
 *     `doc.nodes` at all and therefore can never itself satisfy the direct
 *     ListBlockNode check above). Without this fallback, "up" could never
 *     find a CompositeBlock sitting immediately before another one — the
 *     exact real-pipeline regression this ticket's redesign exists to fix
 *     (two composites back-to-back; see this ticket's completion report).
 *     When a matching composite is found this way, its own `members[0]`
 *     anchor node is returned (never the complex-block member itself),
 *     keeping this function's return type uniformly a ListBlockNode.
 *
 * Exported (ticket 4-2, 2026-08-14) for the same reason as skipBlankLines,
 * above — a shared, single-source-of-truth adjacency primitive for ticket
 * 4-1 (evaluateCompositeBlockMovability) and ticket 4-2
 * (move/findCompositeMoveTarget.ts), not a general-purpose utility.
 * Resolving WHICH composite (if any) the returned node anchors is
 * deliberately left to each caller — this function's own contract stops at
 * "here is the adjacent list node", exactly as before export.
 */
export function findAdjacentAnchorNode(
  doc: ParsedDocument,
  allComposites: CompositeBlockInfo[],
  line: number,
  direction: "up" | "down"
): ListBlockNode | null {
  for (const node of doc.nodes.values()) {
    if (!isListNode(node)) continue;
    if (direction === "down" && node.range.startLine === line) return node;
    if (direction === "up" && node.range.endLine === line) return node;
  }
  if (direction === "up") {
    const owningComposite = allComposites.find((c) => c.range.endLine === line);
    if (owningComposite) {
      const anchorNode = doc.nodes.get(owningComposite.members[0].id);
      if (anchorNode && isListNode(anchorNode)) return anchorNode;
    }
  }
  return null;
}

/**
 * Evaluates whether `composite` may be safely swapped with whatever
 * adjacent block sits immediately in `direction`, per Phase 5C-1 ticket
 * 4-1's (revised) approved condition set — checked in the order below; the
 * first failing condition determines the single reported reason, matching
 * every other rejection-reporting function in this codebase:
 *
 *   1. `composite.members[0]` (the anchor list item — always the first
 *      member for every rule in DEFAULT_COMPOSITE_BLOCK_RULES) must resolve
 *      in `doc.nodes` to an actual ListBlockNode, and that node must NOT be
 *      nested inside another list item (isNestedInList, above). Otherwise:
 *      "nested-in-list". (An unresolvable member[0] — only possible when
 *      `composite` is stale relative to `doc`, since matchCompositeBlocks
 *      itself never emits a member[0] that fails to resolve — is also
 *      reported as "nested-in-list": no adjacent unit can be safely
 *      resolved either way once the anchor itself is unknown, and
 *      CompositeBlockMoveRejectionReason has no dedicated
 *      "member-resolve-failed" value, unlike
 *      CompositeBlockDeleteRejectionReason.)
 *   2. EVERY member that is a "list"/"single-line-list" kind must have
 *      `unsafeIndent === false`. Otherwise: "unsafe-indent". (Only
 *      member[0] is ever list-kind under today's
 *      DEFAULT_COMPOSITE_BLOCK_RULES, but this loops over every member for
 *      forward-compatibility with a future rule that includes more than one
 *      list-kind member — mirrors evaluateCompositeBlockDeletability's own
 *      per-member iteration style.)
 *   3. A real block boundary must be found in `direction`: scan from just
 *      outside `composite.range` (skipBlankLines), then resolve it
 *      (findAdjacentAnchorNode). Reaching the document edge/frontmatter, OR
 *      landing on a line that resolves to neither a ListBlockNode boundary
 *      nor a CompositeBlock's own trailing boundary (a section heading, a
 *      composite-less complex block, a plain paragraph, or a
 *      boundary-uncertain block never even collected as a match candidate —
 *      see parser/compositeBlocks.ts's own collectCandidates) — is reported
 *      as "no-adjacent-compatible-unit". This intentionally does NOT hop
 *      across a section heading the way plain-list-item
 *      move/findMoveTarget.ts's cross-section "insert" mode does — composite
 *      move in this ticket is swap-only, never cross-section.
 *   4. The resolved adjacent anchor node's `parentId`, `depth`, AND
 *      `indentColumns` must all equal the moving composite's own anchor's
 *      corresponding fields. Otherwise: "different-parent-or-depth".
 *      `parentId` equality alone is not trusted as a proxy for "same visual
 *      level": a root list item's `depth` is always 0 regardless of its own
 *      `indentColumns` (see the parser's own pass-2 loop — a root item is
 *      simply whatever remains on the list stack after closing, independent
 *      of its exact column), so two root items sharing one section can
 *      legitimately have DIFFERING `indentColumns` (e.g. one at column 0,
 *      another at column 2 after an intervening callout closed the first
 *      list) even though both pass a `parentId`+`depth` check alone —
 *      `indentColumns` is compared as well specifically to catch this and
 *      avoid leaving the moved composite at a visually inconsistent
 *      indentation relative to its new neighbors. (`depth` is, in a
 *      correctly-parsed real document, always fully determined by
 *      `parentId` — checked anyway as defense-in-depth against a hand-built
 *      or otherwise inconsistent ParsedDocument, exactly like
 *      evaluateCompositeBlockDeletability's own comparable checks.) Once
 *      `parentId` matches, the adjacent anchor is —by construction—
 *      guaranteed not itself nested-in-list either (it shares the exact
 *      same, already-verified-non-list parent as this composite's own
 *      anchor), so no separate "sibling-is-nested-in-list"-style check is
 *      needed here.
 */
/**
 * Phase 5D-4C: extracted from evaluateCompositeBlockMovability's own
 * condition 4 (see that function's doc comment for the full rationale —
 * why indentColumns is compared in addition to parentId/depth) so
 * move/findCompositeBlockDropTarget.ts#resolveCompositeBlockDropTarget
 * (the non-adjacent CompositeBlock D&D resolver) can share the EXACT same
 * "same structural level" judgment for its own drop-target check, rather
 * than independently re-deriving an equivalent comparison that could drift
 * out of sync with this one over time. Pure field comparison only — no
 * behavior change to evaluateCompositeBlockMovability itself, which now
 * calls this function instead of the same three-field check inline.
 */
export function sameCompositeAnchorLevel(
  a: { parentId: string | null; depth: number; indentColumns: number },
  b: { parentId: string | null; depth: number; indentColumns: number }
): boolean {
  return a.parentId === b.parentId && a.depth === b.depth && a.indentColumns === b.indentColumns;
}

export function evaluateCompositeBlockMovability(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  composite: CompositeBlockInfo,
  direction: "up" | "down",
  allComposites: CompositeBlockInfo[]
): CompositeBlockMovability {
  // Unused by this revised algorithm — kept for signature symmetry with
  // evaluateCompositeBlockDeletability. See this section's top doc comment.
  void complexScan;

  const anchor = composite.members[0];
  const anchorNode = doc.nodes.get(anchor.id);
  if (!anchorNode || !isListNode(anchorNode) || isNestedInList(doc, anchorNode)) {
    return { eligible: false, reason: "nested-in-list" };
  }

  for (const member of composite.members) {
    if (member.kind !== "list" && member.kind !== "single-line-list") continue;
    const node = doc.nodes.get(member.id);
    if (node && isListNode(node) && node.unsafeIndent) {
      return { eligible: false, reason: "unsafe-indent" };
    }
  }

  const boundaryLine = direction === "up" ? composite.range.startLine - 1 : composite.range.endLine + 1;
  const k = skipBlankLines(doc, boundaryLine, direction);
  if (k === null) {
    return { eligible: false, reason: "no-adjacent-compatible-unit" };
  }

  const candidate = findAdjacentAnchorNode(doc, allComposites, k, direction);
  if (!candidate) {
    return { eligible: false, reason: "no-adjacent-compatible-unit" };
  }

  if (!sameCompositeAnchorLevel(candidate, anchorNode)) {
    return { eligible: false, reason: "different-parent-or-depth" };
  }

  return { eligible: true };
}

/** Human-readable (English) explanation for one CompositeBlockDeleteRejectionReason, used by describeCompositeBlockRejection below. Mirrors parser/complexBlocks.ts's inline reason strings in style (short, developer/Notice-facing, not yet localized — same as every other pre-i18n `reason` string this codebase already carries, e.g. edit/deleteBlock.ts's NoDeleteReason consumers). */
function describeDeleteRejectionReason(
  reason: CompositeBlockDeleteRejectionReason,
  offendingMemberId: string | undefined
): string {
  const member = offendingMemberId ?? "?";
  switch (reason) {
    case "member-resolve-failed":
      return `composite block member ${member} could not be resolved in the current document`;
    case "member-not-supported":
      return `composite block member ${member} is not a safely-bounded ("supported") block`;
    case "member-has-diagnostic":
      return `composite block member ${member} has an unresolved diagnostic`;
    case "member-unsafe-indent":
      return `composite block member ${member} has mixed tab/space indentation`;
    case "unsupported-member-kind":
      return `composite block member ${member} is a kind Phase 5C-1 does not support deleting (e.g. paragraph)`;
    case "nested-in-list":
      return `composite block member ${member} is nested inside another list item; deletion is limited to top-level/single-section composites in this phase`;
    case "ambiguous-section":
      return "composite block members do not agree on a single enclosing section";
  }
}

/**
 * Phase 5C-1 ticket 1 safety helper for a FUTURE caller (e.g. a Tree
 * context menu that might one day gate a "Delete extended block" item),
 * mirroring parser/complexBlocks.ts's describeComplexBlockRejection exactly
 * — same `{blocked:false}` for "this id isn't a recognized CompositeBlock
 * at all" vs. `{blocked:true, ...}` for "this id IS a recognized
 * CompositeBlock, but evaluateCompositeBlockDeletability rejects it"
 * convention. This function adds NO new runtime path into any editing
 * module (nothing in view/OutlineTreeView.ts or edit/* calls it yet); it
 * exists purely so a later ticket can distinguish the two cases above
 * before attempting any deletion.
 *
 * `composites` is typically whatever matchCompositeBlocks(doc, complexScan,
 * enabledRules) already returned for this exact `doc`/`complexScan` pair
 * (the same value view/OutlineTreeView.ts#refresh() already computes) —
 * this function does no matching of its own.
 */
export function describeCompositeBlockRejection(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  compositeId: string
): CompositeBlockRejection {
  const composite = composites.find((c) => c.id === compositeId);
  if (!composite) return { blocked: false };

  const result = evaluateCompositeBlockDeletability(doc, complexScan, composite);
  if (result.deletable) return { blocked: false };

  return {
    blocked: true,
    ruleId: composite.ruleId,
    reason: describeDeleteRejectionReason(result.reason as CompositeBlockDeleteRejectionReason, result.offendingMemberId),
  };
}

// ---- Phase 5C-3 (2026-08-14): standalone (non-composite-member)
// callout/blockquote move-eligibility ------------------------------------
//
// A THIRD swap-move feature, alongside CompositeBlock move (ticket 4-1
// above). Target here is one standalone ComplexBlockInfo (never a
// CompositeBlock's own member) — see model/complexBlock.ts's own
// StandaloneComplexBlockMovability doc comment for the full reason
// taxonomy and why this is a separate type from CompositeBlockMovability.
//
// Approved scope (Phase 5C-3): adjacency candidates are limited to OTHER
// standalone complex blocks only ("A案") — never a list item, section,
// composite, composite member, or any other ComplexBlockKind. Originally
// callout/blockquote only; Phase 5E-1 widened the eligible kind set to
// also include fenced-code, and Phase 5E-3d widened it again to also
// include table (see isStandaloneComplexBlockShapeEligible's own updated
// doc comment for the current full kind set). paragraph/thematic-break
// remain out of scope. This is intentionally narrower than CompositeBlock
// move's own adjacency scan (findAdjacentAnchorNode, above), which also
// recognizes plain list items and other composites as valid partners —
// that breadth exists because a composite's own anchor IS a ListBlockNode
// with real list-sibling semantics; a standalone complex block has none of
// that, and Phase 5C-3's own approval explicitly rejects widening the
// candidate set to list/section/paragraph/Mermaid.

/**
 * True when `info` qualifies as a move candidate ON ITS OWN — kind
 * "callout"/"blockquote", `editability === "supported"`, and NOT nested
 * inside a list item's continuation (its own `parentId`, if non-null, must
 * resolve to a "section"-typed node, never a "list"-typed one — mirroring
 * isNestedInList's own check above, reimplemented locally since that
 * function's parameter shape (`{ parentId }`) happens to already fit a
 * ComplexBlockInfo too, but keeping this as its own small function avoids
 * implying a false coupling between the two feature areas). Does NOT check
 * composite membership — see isStandaloneComplexBlockMoveCandidate's own
 * doc comment below for why that is a separate, `allComposites`-dependent
 * check.
 *
 * Exported (Phase 5D-3C, "Callout and Blockquote Drag and Drop") so
 * move/findStandaloneComplexBlockDropTarget.ts can reuse this EXACT same
 * source-shape check for D&D — D&D (案A) deliberately does NOT also check
 * composite membership the way isStandaloneComplexBlockMoveCandidate below
 * does, since a composite-member source is always D&D-eligible by design
 * (see model/complexBlock.ts's StandaloneComplexBlockDropRejectReason top
 * doc comment) — so D&D calls this function directly, never
 * isStandaloneComplexBlockMoveCandidate.
 */
export function isStandaloneComplexBlockShapeEligible(doc: ParsedDocument, info: ComplexBlockInfo): boolean {
  // Phase 5E-1 ("fenced code block の raw Partial Edit・移動・削除"): widened
  // to also accept kind "fenced-code" — reusing this exact same shape-
  // eligibility gate (editability/nested-in-list checks unchanged) rather
  // than writing a parallel fenced-code-specific eligibility function. A
  // standalone fenced-code block nested inside a list item is therefore
  // excluded from Move for the identical reason a nested callout/
  // blockquote already was (see the "nested-in-list" check just below) —
  // deliberately NOT special-cased for fenced-code, per this ticket's own
  // "既存の callout/blockquote の操作経路を最大限再利用する" instruction.
  // Phase 5E-3d ("Table Move/Delete/DnD Parity") widens this again to also
  // accept "table" — table already has Tree projection and a working
  // Partial Edit session (Phase 5E-2A/5E-2B); it is folded into this exact
  // same gate rather than a parallel table-specific eligibility function,
  // for the identical reason fenced-code was before it.
  if (
    info.kind !== "callout" &&
    info.kind !== "blockquote" &&
    info.kind !== "fenced-code" &&
    info.kind !== "table"
  )
    return false;
  if (info.editability !== "supported") return false;
  if (info.parentId) {
    const owner = doc.nodes.get(info.parentId);
    if (owner && owner.type === "list") return false;
  }
  return true;
}

/**
 * True when `id` is currently some CompositeBlockInfo's own member id (list
 * or complex-kind alike) — i.e. this block is presently part of a matched
 * composite and therefore excluded from standalone-move candidacy (Phase
 * 5C-3 approval §1). Always re-checked fresh against `allComposites`
 * (the caller's own current matchCompositeBlocks result), never assumed
 * from any earlier Tree-render-time computation.
 */
export function isComposedMember(allComposites: CompositeBlockInfo[], id: string): boolean {
  return allComposites.some((c) => c.members.some((m) => m.id === id));
}

/** `isStandaloneComplexBlockShapeEligible` AND not currently a composite member — the full standalone-move-candidate eligibility gate, applied identically to both the move TARGET and any ADJACENT candidate. */
function isStandaloneComplexBlockMoveCandidate(
  doc: ParsedDocument,
  allComposites: CompositeBlockInfo[],
  info: ComplexBlockInfo
): boolean {
  return isStandaloneComplexBlockShapeEligible(doc, info) && !isComposedMember(allComposites, info.id);
}

/**
 * Scans `complexScan.blocks` for the standalone-move-eligible callout/
 * blockquote whose own range boundary sits exactly at `line`, in
 * `direction` — the complex-block counterpart to findAdjacentAnchorNode
 * above, scoped to Phase 5C-3's narrower "A案" candidate set (callout/
 * blockquote only — see this section's own top doc comment). Returns
 * `null` when no such block exists at that exact boundary: the document's
 * own edge/frontmatter, a section heading, a list item, a composite's own
 * boundary, a composite MEMBER's own boundary, an unsupported/ambiguous/
 * read-only complex block, or any non-callout/blockquote ComplexBlockKind
 * all fall through to `null` here.
 *
 * direction "down": the returned block's own `range.startLine === line`.
 * direction "up": the returned block's own `range.endLine === line`.
 *
 * Exported (Phase 5C-3) SOLELY so move/findStandaloneComplexBlockMoveTarget.ts
 * can perform the exact same adjacency scan
 * evaluateStandaloneComplexBlockMovability (below) already performs, with
 * zero risk of the two drifting apart — mirrors skipBlankLines/
 * findAdjacentAnchorNode's own export rationale (ticket 4-2) exactly.
 */
export function findAdjacentStandaloneComplexBlock(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  allComposites: CompositeBlockInfo[],
  line: number,
  direction: "up" | "down"
): ComplexBlockInfo | null {
  for (const info of complexScan.blocks) {
    const boundary = direction === "down" ? info.range.startLine : info.range.endLine;
    if (boundary !== line) continue;
    if (!isStandaloneComplexBlockMoveCandidate(doc, allComposites, info)) continue;
    return info;
  }
  return null;
}

/**
 * Evaluates whether `target` (a standalone, non-composite-member
 * ComplexBlockInfo) may be safely swapped with whatever adjacent standalone
 * callout/blockquote sits immediately in `direction`, per Phase 5C-3's
 * approved condition set — checked in the order below; the first failing
 * condition determines the single reported reason, matching every other
 * rejection-reporting function in this codebase:
 *
 *   1. `target` itself must pass isStandaloneComplexBlockShapeEligible
 *      (kind callout/blockquote, `editability === "supported"`, not nested
 *      in a list) — otherwise "not-supported" (wrong kind or editability)
 *      or "nested-in-list" (nested-in-list check specifically), checked in
 *      that order. Defense-in-depth: a real caller should never reach this
 *      function with an ineligible `target` (see
 *      tree/buildOutlineTree.ts's own isStandaloneComplexBlockEligible,
 *      which already filters to this exact condition before a Tree row is
 *      ever shown), but this function re-verifies its own input rather
 *      than trusting it, same policy as evaluateCompositeBlockMovability's
 *      own anchor re-check above.
 *   2. `target.id` must NOT currently be some CompositeBlockInfo's own
 *      member (re-checked fresh against `allComposites`) — otherwise
 *      "composite-member". Phase 5D-3B ("Composite Member Move Menu
 *      Parity"): this ONE check is skipped when the caller passes
 *      `allowComposedMember: true` (default `false`) — see this
 *      function's own `allowComposedMember` parameter doc below. Every
 *      other condition in this list (including the CANDIDATE side's own
 *      standalone-only restriction in step 3) is completely unaffected by
 *      this flag.
 *   3. A real adjacent boundary must be found in `direction`: scan from
 *      just outside `target.range` (skipBlankLines, reused unchanged from
 *      ticket 4-1/4-2), then resolve it
 *      (findAdjacentStandaloneComplexBlock, above). Reaching the document
 *      edge/frontmatter, or landing on anything that isn't itself an
 *      eligible standalone callout/blockquote (a list item, a section
 *      heading, a composite, a composite member, an unsupported/ambiguous/
 *      read-only block, or any other ComplexBlockKind) is reported as
 *      "no-adjacent-compatible-unit" — this never hops across a section
 *      heading, exactly like CompositeBlock move's own swap-only-never-
 *      cross-section design.
 *   4. The resolved adjacent block's own `parentId` must equal `target`'s
 *      own `parentId` (both null — top-of-document — also counts as
 *      equal, mirroring matchCompositeBlocks's own resolveMemberSectionId
 *      convention). Otherwise: "different-section".
 *
 * `allowComposedMember` (Phase 5D-3B, default `false`): when `true`, step 2
 * above is skipped, so `target` MAY currently be a matched CompositeBlock's
 * own member. This is the ONLY behavioral difference the parameter makes —
 * every other condition (kind/editability/nested-in-list eligibility on
 * `target`, and the CANDIDATE side's own standalone-only restriction, which
 * `findAdjacentStandaloneComplexBlock` always applies regardless of this
 * flag) is identical either way. Every pre-5D-3B caller either omits this
 * parameter or passes `false` explicitly, so this function's behavior for
 * every existing caller (the standalone Tree menu, and
 * edit/moveStandaloneComplexBlock.ts's own re-verification of a standalone
 * move) is byte-for-byte unchanged. Only the NEW composite-member Tree menu
 * (Phase 5D-3B) passes `true`, and only for the block being moved — it
 * never widens the adjacent-candidate search to include other composite
 * members (see step 3's own doc comment above).
 */
export function evaluateStandaloneComplexBlockMovability(
  doc: ParsedDocument,
  complexScan: ComplexBlockScanResult,
  target: ComplexBlockInfo,
  direction: "up" | "down",
  allComposites: CompositeBlockInfo[],
  allowComposedMember = false
): StandaloneComplexBlockMovability {
  // Phase 5E-1: widened alongside isStandaloneComplexBlockShapeEligible
  // above to also accept "fenced-code"; Phase 5E-3d widened again to also
  // accept "table" — see that function's own updated doc comment for the
  // full rationale.
  if (
    target.kind !== "callout" &&
    target.kind !== "blockquote" &&
    target.kind !== "fenced-code" &&
    target.kind !== "table"
  ) {
    return { eligible: false, reason: "not-supported" };
  }
  if (target.editability !== "supported") {
    return { eligible: false, reason: "not-supported" };
  }
  if (target.parentId) {
    const owner = doc.nodes.get(target.parentId);
    if (owner && owner.type === "list") {
      return { eligible: false, reason: "nested-in-list" };
    }
  }
  if (!allowComposedMember && isComposedMember(allComposites, target.id)) {
    return { eligible: false, reason: "composite-member" };
  }

  const boundaryLine = direction === "up" ? target.range.startLine - 1 : target.range.endLine + 1;
  const k = skipBlankLines(doc, boundaryLine, direction);
  if (k === null) {
    return { eligible: false, reason: "no-adjacent-compatible-unit" };
  }

  const adjacent = findAdjacentStandaloneComplexBlock(doc, complexScan, allComposites, k, direction);
  if (!adjacent) {
    return { eligible: false, reason: "no-adjacent-compatible-unit" };
  }

  if (adjacent.parentId !== target.parentId) {
    return { eligible: false, reason: "different-section" };
  }

  return { eligible: true };
}
