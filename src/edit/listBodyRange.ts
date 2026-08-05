/**
 * Phase 4B: Multiline List Body Tooltip Design & Implementation.
 *
 * Pure, Obsidian-free logic that extracts "the list item's own body" for
 * the Outline Tree View's tooltip (view/OutlineTreeView.ts) — the text that
 * actually moves as one unit when this item is dragged (see
 * move/relocateListSubtree.ts), MINUS its nested child list items, so the
 * tooltip communicates "what belongs to just this row" rather than
 * duplicating the whole subtree a user could already see as child rows in
 * the tree.
 *
 * "Own body" is defined as: the item's own first line (the `- foo` /
 * `1. bar` marker line) plus every CONTINUATION line directly under it —
 * i.e. every line in the item's range that parseDocument.ts's ownership
 * pass (`lineToOwningNodeId`) still attributes to this item's own id.
 * Nested child list items overwrite their own sub-range with their OWN id
 * during that same pass (parseDocument.ts: "nested items overwrite their
 * parent's lines afterwards (deepest wins)"), so a plain
 * `lineToOwningNodeId[line] === itemId` check is already exactly "this
 * line belongs to me, not one of my children" — no re-derivation of indent
 * thresholds is needed here. Code-fence and frontmatter lines are excluded
 * defensively even though normal parsing already keeps them out of list
 * ranges in the ordinary case (a fenced block *nested inside* a list item's
 * own continuation lines is representable and would otherwise leak
 * raw fence markers into the tooltip).
 *
 * Two-step shape, mirroring the phase spec's task split:
 *   1. collectListItemBodyLines — resolve + extract, returns RAW lines
 *      (whitespace and blank lines untouched) plus a structural failure
 *      reason when the id doesn't resolve to a list item.
 *   2. formatListItemBodyLines — pure text formatting: strip the list
 *      marker from the first line, trim each continuation line's leading
 *      (nesting-only) indentation and prefix it with CONTINUATION_INDENT
 *      instead, and delete blank lines entirely rather than preserving
 *      runs of empty tooltip lines — "連続する空行は…削除してもよい（読みやす
 *      さ優先）" per the phase spec. This keeps the two concerns
 *      (structural extraction vs. display formatting) independently
 *      testable, and lets a future caller reuse step 1 with different
 *      formatting rules without touching resolution logic.
 *
 * extractListItemBodyText composes both for the common case (what
 * OutlineTreeView actually calls).
 *
 * Phase 4B follow-up (tooltip alignment): Obsidian's own tooltip element
 * (`setTooltip`) center-aligns text by default, which reads fine for a
 * single short line but looks disconnected from the source Markdown once
 * the tooltip spans multiple lines — a centered block doesn't read like a
 * "title line + body text" the way the note itself does. OutlineTreeView
 * passes `{ classes: ["unified-outliner-list-tooltip"] }` to setTooltip so
 * styles.css can left-align *only* list-item tooltips, without touching
 * Obsidian's tooltip styling anywhere else. On the text side,
 * CONTINUATION_INDENT prefixes every continuation line with a single
 * EM SPACE (U+2003), producing a "title line + indented body" reading once
 * left-aligned, regardless of the note's language.
 *
 * A pure-CSS alternative (`text-indent: <len> hanging` / `each-line`,
 * which indents every line of a block except the first without touching
 * the text content at all) was considered and rejected: as of this
 * writing those keywords are still behind an experimental flag in Chrome/
 * Chromium (the engine Obsidian's Electron shell embeds) despite being
 * supported in Safari 15+ and Firefox 121+, so relying on them would
 * silently degrade to "no indent, just left-aligned" for most users.
 * Embedding the indent in the text itself, as done here, works
 * unconditionally.
 *
 * Two space characters were tried and rejected before EM SPACE:
 *   - an ordinary half-width ASCII space: CSS whitespace-collapsing rules
 *     can silently eat a single leading space depending on the tooltip's
 *     `white-space` mode, and even when preserved it is far narrower than
 *     one character's width, barely registering as an indent;
 *   - U+3000 IDEOGRAPHIC SPACE (used in the first cut of this feature):
 *     immune to collapsing and exactly one full-width-character wide, but
 *     that width is specifically calibrated to match a CJK ideograph — in
 *     a note written in English or any other non-CJK language it renders
 *     as an oversized, out-of-place gap rather than a normal indent.
 * EM SPACE (U+2003) keeps the "immune to CSS whitespace collapsing"
 * property (it is a Unicode Zs "other space separator", not one of the
 * collapsible characters the CSS Text spec defines — collapsing only
 * applies to U+0020 and U+00A0) while being sized and intended for
 * general/Latin-script indentation rather than CJK typography
 * specifically, so it reads correctly for any note's language.
 *
 * Explicitly NOT handled here (out of Phase 4B's scope — see README):
 *   - the list item's nested children's own text (list subtree tooltip);
 *   - wrapping/breaking the Outline's one-line LABEL itself;
 *   - anything Partial-Edit-Pane-shaped (extraction here is read-only and
 *     never round-trips back into the document).
 */
import { isListNode, ParsedDocument } from "../model/block";
import { isBlankLine } from "../parser/parseDocument";

export type NoListBodyReason = "resolve-failed" | "not-a-list-item";

export interface ListItemBodyLinesOutcome {
  ok: boolean;
  /** Raw lines belonging to the item's own body, document whitespace intact. Empty when !ok. */
  lines: string[];
  reason?: NoListBodyReason;
}

export interface ListItemBodyOutcome {
  ok: boolean;
  /** Tooltip-ready body text (see class doc comment for formatting rules). Empty when !ok. */
  text: string;
  reason?: NoListBodyReason;
}

const LIST_MARKER_RE = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+(.*))?$/;

/**
 * Prefix for every continuation line in the tooltip text — U+2003 EM SPACE
 * (see class doc comment's "Phase 4B follow-up (tooltip alignment)"
 * section for why this character and not an ordinary space or the
 * CJK-specific U+3000 IDEOGRAPHIC SPACE). Exported so tests can assert
 * against the exact character rather than an opaque literal.
 */
export const CONTINUATION_INDENT = "\u2003"; // EM SPACE

/** Strip the leading indent + list marker from an item's own first line. */
function stripMarker(line: string): string {
  const m = line.match(LIST_MARKER_RE);
  return (m?.[1] ?? line).trim();
}

/**
 * Task 1: collect the RAW lines that belong to `itemId`'s own body (see
 * class doc comment for the exact definition). Lines are returned exactly
 * as they appear in the document — no marker-stripping, trimming, or
 * blank-line handling happens here; that's formatListItemBodyLines's job.
 */
export function collectListItemBodyLines(
  doc: ParsedDocument,
  itemId: string
): ListItemBodyLinesOutcome {
  const node = doc.nodes.get(itemId);
  if (!node) {
    return { ok: false, lines: [], reason: "resolve-failed" };
  }
  if (!isListNode(node)) {
    return { ok: false, lines: [], reason: "not-a-list-item" };
  }

  const lines: string[] = [];
  for (let line = node.range.startLine; line <= node.range.endLine; line++) {
    if (doc.lineToOwningNodeId[line] !== itemId) continue; // belongs to a nested child item instead
    if (doc.codeBlockLines[line] || doc.frontmatterLines[line]) continue;
    lines.push(doc.lines[line]);
  }
  return { ok: true, lines };
}

/**
 * Task 2: turn collectListItemBodyLines's raw lines into tooltip display
 * text. The first raw line is always the item's own marker line (guaranteed
 * by construction — parseDocument.ts never lets a list item's own start
 * line be a code-fence or frontmatter line), so it alone gets
 * marker-stripping; every subsequent line is a continuation line, trimmed
 * of its (nesting-only) leading indentation and re-prefixed with
 * CONTINUATION_INDENT so it visually reads as "body" under the item's
 * "title" line once the tooltip is left-aligned (see class doc comment).
 * Blank lines are dropped rather than preserved, so runs of blank lines
 * collapse to nothing instead of producing stretches of empty tooltip rows.
 */
export function formatListItemBodyLines(rawLines: string[]): string {
  const out: string[] = [];
  rawLines.forEach((raw, idx) => {
    if (isBlankLine(raw)) return;
    out.push(idx === 0 ? stripMarker(raw) : CONTINUATION_INDENT + raw.trim());
  });
  return out.join("\n");
}

/**
 * Convenience wrapper combining both tasks — the single entry point
 * OutlineTreeView calls to build a list node's tooltip text.
 */
export function extractListItemBodyText(
  doc: ParsedDocument,
  itemId: string
): ListItemBodyOutcome {
  const collected = collectListItemBodyLines(doc, itemId);
  if (!collected.ok) {
    return { ok: false, text: "", reason: collected.reason };
  }
  return { ok: true, text: formatListItemBodyLines(collected.lines) };
}
