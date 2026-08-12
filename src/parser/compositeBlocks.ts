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
 *     editability === "supported" — "ambiguous"/"unsupported"/"read-only"
 *     blocks (this always excludes "paragraph", which is never
 *     "supported" — see model/complexBlock.ts) are never composite-block
 *     candidates, matching this whole plugin's "never build on an
 *     uncertain boundary" policy.
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
import { isListNode, ParsedDocument } from "../model/block";
import { ComplexBlockScanResult } from "../model/complexBlock";
import { CompositeBlockInfo, CompositeBlockMember, CompositeBlockRule, CompositeMemberKind } from "../model/compositeBlock";

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
