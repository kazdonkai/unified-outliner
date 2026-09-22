/**
 * Phase 5D-2B ("CompositeBlock Structured Partial Edit Projection — structured member
 * reuse"): pure, Obsidian-free helpers that split a CompositeBlock's
 * already-extracted raw text into its two members' own independent
 * raw-text slices, and recompose them back into one CompositeBlock-range
 * string.
 *
 * ---- Why this module exists ----
 *
 * Phase 5D-2A (edit/compositeBlockPartialEdit.ts) already gives the
 * Partial Edit Pane a fully safe, atomic "extract the WHOLE CompositeBlock
 * range as one string / splice the whole range back as one string" pair
 * (extractCompositeBlockText/applyCompositeBlockEdit). That pair is NOT
 * changed by this module at all — it still owns the one and only
 * "re-parse, re-scan, re-match, compare snapshot, splice" contract. This
 * module's only job is upstream of applyCompositeBlockEdit's `newText`
 * argument: given the CompositeBlock's own resolved snapshot (which
 * already carries each member's own line range) and the note's current
 * lines, produce the list member's own raw line and the trailing
 * callout/blockquote member's own raw text SEPARATELY, so the Partial Edit
 * Pane can show each member in its own already-existing, already-tested
 * editor surface (a plain raw line for the list member, the exact same
 * edit/quotePrefixProjection.ts projection already used for a STANDALONE
 * callout/blockquote for the trailing member) instead of one undifferentiated
 * blob of raw Markdown. composeCompositeBlockMemberText is the exact
 * inverse: it re-joins the two pieces with a single newline (never a blank
 * line), so a caller can feed the result straight into
 * applyCompositeBlockEdit's existing `newText` parameter unchanged.
 *
 * ---- Why line-slicing, not a new parser ----
 *
 * A CompositeBlockMemberSnapshot's own `range` (model/compositeBlock.ts)
 * already gives the exact, independently-scanned start/end line of each
 * member — that is precisely what matchCompositeBlocks (parser/
 * compositeBlocks.ts) computed when it recognized this CompositeBlock in
 * the first place, and precisely what buildCompositeBlockSnapshot (edit/
 * deleteCompositeBlock.ts) copied onto the snapshot this module receives.
 * No new boundary detection, no new Markdown parsing, and no duplication
 * of parser/complexBlocks.ts's or parser/compositeBlocks.ts's own logic is
 * needed or written here — this module only ever slices/joins `lines`
 * using ranges it did not compute itself. In particular, the trailing
 * member's own sliced text (`lines.slice(start, end+1).join("\n")`) is
 * BYTE-IDENTICAL to what edit/partialEdit.ts's extractSubtreeText already
 * returns for that same callout/blockquote if it were opened as a
 * standalone block — that identity is what lets the caller feed it
 * straight into the UNMODIFIED edit/quotePrefixProjection.ts#
 * buildQuotePrefixProjection/invertQuotePrefixProjection pair with zero
 * new parser/serializer code of its own.
 *
 * ---- Invariant ----
 *
 * For any `lines`/`snapshot` this module accepts (ok: true), the following
 * always holds:
 *
 *   composeCompositeBlockMemberText(split.listLineText, split.trailingRawText)
 *     === lines.slice(snapshot.range.startLine, snapshot.range.endLine + 1).join("\n")
 *
 * i.e. splitting and immediately recomposing, with no edits in between,
 * reproduces the CompositeBlock's own whole-range text byte-for-byte. This
 * is what guarantees an unedited round-trip through the Partial Edit
 * Pane's new structured composite UI is indistinguishable from the
 * existing raw-textarea round-trip it replaces for eligible CompositeBlocks.
 *
 * ---- What this module refuses, and why every refusal is safe ----
 *
 * splitCompositeBlockMembers only ever succeeds for the shape every
 * shipped CompositeBlockRule currently produces (model/compositeBlock.ts's
 * DEFAULT_COMPOSITE_BLOCK_RULES — a single-line list item immediately
 * followed by exactly one callout or blockquote member). Any other shape
 * (a future rule with more than two members, a list member that is not
 * `single-line-list`/`list`, a `list` member whose OWN range unexpectedly
 * spans more than one line, or a trailing member that is not
 * callout/blockquote) is refused with `ok: false` — never guessed or
 * best-effort split. A caller MUST fall back to the existing, unmodified
 * whole-range raw-textarea editing (exactly Phase 5D-2A's own pre-existing
 * behavior) whenever this returns `ok: false`; this module never mutates
 * anything, so that fallback is always safe.
 */
import { CompositeBlockSnapshot } from "./deleteCompositeBlock";
import { QuotePrefixProjectionKind } from "./quotePrefixProjection";
import { CompositeMemberKind } from "../model/compositeBlock";

/** Every way splitCompositeBlockMembers refuses to split a CompositeBlock into its two members. */
export type CompositeMemberSplitRejectionReason =
  | "member-count"
  | "list-member-kind"
  | "list-member-not-single-line"
  | "trailing-member-kind";

/**
 * `listLineText` is the list member's own single raw line, byte-for-byte
 * (marker, indentation, and content all included — this module never
 * strips or reformats it). `trailingRawText` is the trailing callout/
 * blockquote member's own raw text, byte-for-byte identical to what
 * edit/partialEdit.ts's extractSubtreeText would return for that same
 * block if it were standalone — see this module's own top doc comment for
 * why that identity is what lets a caller feed it straight into
 * edit/quotePrefixProjection.ts unmodified.
 */
export interface CompositeMemberSplit {
  listLineText: string;
  trailingKind: QuotePrefixProjectionKind;
  trailingRawText: string;
}

export type CompositeMemberSplitOutcome =
  | { ok: true; split: CompositeMemberSplit }
  | { ok: false; reason: CompositeMemberSplitRejectionReason };

/**
 * Splits a CompositeBlock's two members into their own independent raw
 * text slices, purely by reading `snapshot.members`' own already-resolved
 * ranges against `lines` — see this module's own top doc comment for the
 * full rationale and the round-trip invariant this must uphold whenever it
 * returns `ok: true`.
 *
 * `lines` must be the CURRENT document's lines (the same array a fresh
 * `extractCompositeBlockText` call's caller already has to hand — see
 * edit/compositeBlockPartialEdit.ts), and `snapshot` must be that same
 * call's own `resolvedSnapshot` (never a stale, pre-re-resolution
 * snapshot) — this module does not itself re-verify range validity or
 * content drift; that is entirely extractCompositeBlockText's own job,
 * already done before this function is ever called.
 */
export function splitCompositeBlockMembers(
  lines: string[],
  snapshot: CompositeBlockSnapshot
): CompositeMemberSplitOutcome {
  if (snapshot.members.length !== 2) {
    return { ok: false, reason: "member-count" };
  }

  const [listMember, trailingMember] = snapshot.members;

  if (listMember.kind !== "single-line-list" && listMember.kind !== "list") {
    return { ok: false, reason: "list-member-kind" };
  }
  if (listMember.range.startLine !== listMember.range.endLine) {
    // Defensive: every shipped rule uses "single-line-list", which
    // matchCompositeBlocks itself already guarantees is exactly one line
    // (model/compositeBlock.ts's own CompositeMemberKind doc comment) — this
    // can only fire for a hypothetical future "list" (unrestricted) rule.
    return { ok: false, reason: "list-member-not-single-line" };
  }

  if (trailingMember.kind !== "callout" && trailingMember.kind !== "blockquote") {
    return { ok: false, reason: "trailing-member-kind" };
  }

  const listLineText = lines[listMember.range.startLine] ?? "";
  const trailingRawText = lines
    .slice(trailingMember.range.startLine, trailingMember.range.endLine + 1)
    .join("\n");

  return {
    ok: true,
    split: {
      listLineText,
      trailingKind: trailingMember.kind,
      trailingRawText,
    },
  };
}

/**
 * The exact inverse of splitCompositeBlockMembers' own slicing: joins the
 * list member's raw line and the trailing member's raw text with exactly
 * one newline — never a blank line, matching the "no blank line between
 * adjacent members" precondition matchCompositeBlocks itself already
 * requires for any CompositeBlock to exist at all. The result is meant to
 * be passed directly as edit/compositeBlockPartialEdit.ts#
 * applyCompositeBlockEdit's own `newText` argument — that function (never
 * modified by this module) performs the actual conflict check and splice.
 */
export function composeCompositeBlockMemberText(listLineText: string, trailingRawText: string): string {
  return `${listLineText}\n${trailingRawText}`;
}

/**
 * Phase 5D-2C ("CompositeBlock single-line-list member marker-free
 * projection"): the one gating decision that decides whether a
 * CompositeBlock's list member is even ELIGIBLE to attempt
 * edit/listMarkerProjection.ts#buildListMarkerProjection at all — kept
 * here (CompositeBlock-aware glue), never inside listMarkerProjection.ts
 * itself (deliberately CompositeBlock-agnostic — see that module's own
 * top doc comment on why it must stay reusable by a future standalone
 * single-line-list Partial Edit with no CompositeBlock concept at all).
 *
 * Only "single-line-list" is eligible — NEVER the defensive "list" kind,
 * even when (as this module's own splitCompositeBlockMembers already
 * tolerates for a hypothetical future rule) a "list"-kind member's own
 * range happens to span exactly one line. "list" is the kind
 * parser/compositeBlocks.ts assigns whenever a list item DOES have
 * continuation lines or a nested child list (see that module's own top
 * doc comment) — the exact structures edit/listMarkerProjection.ts's pure
 * one-raw-line model cannot safely represent, even on the rare occasion
 * its own anchor line alone happens to fit in one line. This function
 * exists as its own small, independently testable unit specifically so
 * that gate can be verified in isolation, without needing to construct a
 * real multi-line "list"-kind CompositeBlock fixture (which no shipped
 * CompositeBlockRule can currently even produce — see this module's own
 * splitCompositeBlockMembers doc comment on "list" being reachable only
 * via a hypothetical future rule).
 */
export function isListMemberEligibleForMarkerFreeProjection(
  kind: CompositeMemberKind
): boolean {
  return kind === "single-line-list";
}
