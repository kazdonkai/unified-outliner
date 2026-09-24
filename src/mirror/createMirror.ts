/**
 * Phase 5M-1 ("ミラーの作成 UI と参照先解決"): pure, Obsidian-free creation
 * of a single-note mirror — inserting an Obsidian embed line
 * (`![[#Heading]]` / `![[#^block-id]]`) next to the block it mirrors, and,
 * for a block that has no `^block-id` yet, giving it one.
 *
 * The note's own embed syntax stays the mirror's only source of truth: no
 * mirror database, no hidden state. The whole change — the block id (when
 * one is added) plus the embed line plus any blank separator lines — is ONE
 * LineEditOutcome, applied by the caller through the existing
 * applyLineEditOutcome path: one `replaceRange`, one Undo step.
 *
 * ---- Where the embed goes ----
 *
 *   - section (heading): directly ABOVE the heading line. A heading embed
 *     can never go below its own section in the same note: every line
 *     after a heading up to the next heading of the same or a higher level
 *     belongs to that section, so an embed placed anywhere "below" it
 *     would sit inside the very section it embeds — a self-reference
 *     (Obsidian would render the section inside itself). Directly above the
 *     heading is the nearest position outside the section. No block id is
 *     ever added to a heading.
 *   - paragraph, callout, blockquote, fenced-code, table: directly after
 *     the block (after its `^id` line, when it has a separate one).
 *   - list item: directly after the whole root-level list the item belongs
 *     to. Anywhere inside the list would either split it into two lists or
 *     be swallowed as the item's own continuation text (a self-reference).
 *
 * Blank-line separation around the embed reuses Phase 5E-Copy's
 * ensureCopySeparation (edit/copyBlock.ts), i.e. exactly the D&D executor's
 * ensureBlankSeparation plus a blank line next to a list line — without
 * which an embed right after a list would become the list item's lazy
 * continuation text.
 *
 * ---- Block ids ----
 *
 * Only added when the block has none. Format `^uo-<8 lowercase
 * alphanumerics>`. Placement follows Obsidian's own convention: appended to
 * the end of a paragraph's last line / a list item's own last text line
 * (`text ^uo-xxxxxxxx`); on a separate line after a blank line for a
 * callout, blockquote, table or fenced code block. After building the new
 * text the id must occur exactly once (checked on the re-parsed result);
 * otherwise a new id is generated (up to `maxIdAttempts` times).
 *
 * ---- Safety ----
 *
 * The result is re-parsed and refused unless (a) every pre-existing
 * section/list node, complex block and CompositeBlock survives unchanged
 * apart from the line shift (the same structure-preservation idea as
 * edit/insertStructuredBlock.ts and edit/copyBlock.ts), (b) the embed line
 * is recognized as a mirror (mirror/scanMirrorEmbeds.ts) exactly where it
 * was put, and (c) no mirror — the new one or any existing one — is on a
 * cycle that was not there before (mirror/detectMirrorCycle.ts via
 * resolveMirrorSource.ts#applyMirrorCycles). An unresolved new mirror
 * (should not normally happen) is NOT refused; it is reported as a
 * warning, as are ambiguous references (duplicate heading text / id).
 */
import { isListNode, isSectionNode, LineRange, ListBlockNode, ParsedDocument } from "../model/block";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../model/complexBlock";
import { CompositeBlockInfo, CompositeBlockRule } from "../model/compositeBlock";
import { isBlankLine, parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { matchCompositeBlocks } from "../parser/compositeBlocks";
import { LineEditOutcome } from "../commands/applyLineEditOutcome";
import { ensureCopySeparation } from "../edit/copyBlock";
import { MirrorResolutionResult } from "./mirrorTypes";
import { parseMirrorEmbed } from "./parseMirrorEmbed";
import { findBlockIdLines, normalizeMirrorHeading } from "./resolveMirrorSource";
import { scanMirrorEmbeds } from "./scanMirrorEmbeds";

// ---- Types ------------------------------------------------------------------

export const MIRROR_CREATE_BLOCK_KINDS = ["callout", "blockquote", "fenced-code", "table", "paragraph"] as const;
export type MirrorCreateBlockKind = (typeof MIRROR_CREATE_BLOCK_KINDS)[number];
export type MirrorCreateKind = "section" | "list" | MirrorCreateBlockKind;

/** What to mirror: a block kind plus its CURRENT range (from a Tree row or resolveMoveUnit). */
export interface MirrorCreateRef {
  kind: string;
  range: LineRange;
}

export type MirrorCreateRejectReason =
  | "mirror-unsupported-kind"
  | "mirror-target-changed"
  | "mirror-nested-in-list"
  | "mirror-composite-member"
  | "mirror-of-mirror"
  | "mirror-empty-heading"
  | "mirror-unsafe-position"
  | "mirror-id-collision"
  | "mirror-cycle"
  | "mirror-structure-changed";

export const MIRROR_CREATE_REJECT_REASONS: readonly MirrorCreateRejectReason[] = [
  "mirror-unsupported-kind",
  "mirror-target-changed",
  "mirror-nested-in-list",
  "mirror-composite-member",
  "mirror-of-mirror",
  "mirror-empty-heading",
  "mirror-unsafe-position",
  "mirror-id-collision",
  "mirror-cycle",
  "mirror-structure-changed",
];

/** Non-fatal findings after a successful insert (the insert is kept). */
export type MirrorCreateWarning = "not-found" | "duplicate-heading" | "duplicate-block-id";

export interface MirrorCreateOutcome extends LineEditOutcome {
  reason?: MirrorCreateRejectReason;
  /** On success: the embed line's index in the NEW document. */
  embedLine?: number;
  /** On success: the inserted embed text, e.g. `![[#^uo-1a2b3c4d]]`. */
  embedText?: string;
  /** On success: where the embed went relative to the block. */
  placement?: "above" | "below";
  /** On success, block-id mirrors: the id used. */
  blockId?: string;
  /** On success: true when `blockId` was newly added by this operation. */
  blockIdAdded?: boolean;
  /** On success: the new mirror's own resolution against the new document. */
  resolution?: MirrorResolutionResult;
  warnings?: MirrorCreateWarning[];
}

export interface MirrorCreateOptions {
  /** Produces a candidate id WITHOUT the leading `^`. Defaults to generateMirrorBlockId. */
  generateBlockId?: () => string;
  /** How many fresh ids to try before giving up with "mirror-id-collision". Default 10. */
  maxIdAttempts?: number;
  /** The note's own path (MirrorSource.notePath). */
  notePath?: string;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `uo-` + 8 random lowercase alphanumerics (no `^`). */
export function generateMirrorBlockId(random: () => number = Math.random): string {
  let s = "uo-";
  for (let i = 0; i < 8; i++) s += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length) % ID_ALPHABET.length];
  return s;
}

export const MIRROR_BLOCK_ID_RE = /^uo-[a-z0-9]{8}$/;

// ---- Target resolution --------------------------------------------------------

const BLOCK_ID_AT_END_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const LONE_BLOCK_ID_RE = /^\s*\^([A-Za-z0-9-]+)\s*$/;

type Target =
  | { kind: "section"; range: LineRange; headingText: string }
  | { kind: "list"; range: LineRange; node: ListBlockNode }
  | { kind: MirrorCreateBlockKind; range: LineRange; block: ComplexBlockInfo };

type Result<T> = { ok: true; value: T } | { ok: false; reason: MirrorCreateRejectReason };
const fail = <T>(reason: MirrorCreateRejectReason): Result<T> => ({ ok: false, reason });

function sameRange(a: LineRange, b: LineRange): boolean {
  return a.startLine === b.startLine && a.endLine === b.endLine;
}

function isOwnedByList(doc: ParsedDocument, parentId: string | null): boolean {
  if (!parentId) return false;
  const owner = doc.nodes.get(parentId);
  return !!owner && isListNode(owner);
}

export function isMirrorCreateKind(kind: string): kind is MirrorCreateKind {
  return kind === "section" || kind === "list" || (MIRROR_CREATE_BLOCK_KINDS as readonly string[]).includes(kind);
}

function resolveTarget(
  doc: ParsedDocument,
  scan: ComplexBlockScanResult,
  composites: CompositeBlockInfo[],
  ref: MirrorCreateRef
): Result<Target> {
  if (!isMirrorCreateKind(ref.kind)) return fail("mirror-unsupported-kind");
  if (composites.some((c) => c.members.some((m) => sameRange(m.range, ref.range)))) {
    return fail("mirror-composite-member");
  }
  if (ref.kind === "section" || ref.kind === "list") {
    for (const node of doc.nodes.values()) {
      if (!sameRange(node.range, ref.range)) continue;
      if (ref.kind === "section" && isSectionNode(node)) {
        if (normalizeMirrorHeading(node.headingText) === "") return fail("mirror-empty-heading");
        return { ok: true, value: { kind: "section", range: node.range, headingText: node.headingText } };
      }
      if (ref.kind === "list" && isListNode(node)) {
        // A list item that is some composite's anchor is covered by the
        // member check above only when its range IS the member range.
        return { ok: true, value: { kind: "list", range: node.range, node } };
      }
    }
    return fail("mirror-target-changed");
  }
  const block = scan.blocks.find((b) => b.kind === ref.kind && sameRange(b.range, ref.range));
  if (!block) return fail("mirror-target-changed");
  if (block.editability !== "supported") return fail("mirror-unsupported-kind");
  if (isOwnedByList(doc, block.parentId)) return fail("mirror-nested-in-list");
  if (block.kind === "paragraph") {
    const only = block.range.startLine === block.range.endLine ? doc.lines[block.range.startLine] : null;
    if (only !== null && parseMirrorEmbed(only, "") !== null) return fail("mirror-of-mirror");
    if (only !== null && LONE_BLOCK_ID_RE.test(only)) return fail("mirror-unsupported-kind");
  }
  return { ok: true, value: { kind: ref.kind, range: block.range, block } };
}

// ---- Building ---------------------------------------------------------------

/** `out` with `origin[i]` = the ORIGINAL line index out[i] came from, or null for an inserted line. */
interface Draft {
  out: string[];
  origin: (number | null)[];
}

function insertAt(d: Draft, at: number, lines: string[]): void {
  d.out.splice(at, 0, ...lines);
  d.origin.splice(at, 0, ...lines.map(() => null));
}

function newIndexOf(d: Draft, originalLine: number): number {
  return d.origin.indexOf(originalLine);
}

/** The last line of a list item's own text (before its first child, trailing blanks skipped). */
function listOwnTextLastLine(doc: ParsedDocument, item: ListBlockNode): number {
  let end = item.range.endLine;
  for (const id of item.childIds) {
    const child = doc.nodes.get(id);
    if (child && child.range.startLine - 1 < end) end = child.range.startLine - 1;
  }
  while (end > item.range.startLine && isBlankLine(doc.lines[end])) end--;
  return end;
}

/** One past the last line of the root-level list `item` belongs to (the run of blank-separated root siblings). */
function endOfRootList(doc: ParsedDocument, item: ListBlockNode): number {
  let root = item;
  while (root.parentId) {
    const parent = doc.nodes.get(root.parentId);
    if (!parent || !isListNode(parent)) break;
    root = parent;
  }
  let end = root.range.endLine;
  let next = root.nextSiblingId ? doc.nodes.get(root.nextSiblingId) : undefined;
  while (next && isListNode(next)) {
    let onlyBlanks = true;
    for (let i = end + 1; i < next.range.startLine; i++) {
      if (!isBlankLine(doc.lines[i])) onlyBlanks = false;
    }
    if (!onlyBlanks) break;
    end = next.range.endLine;
    next = next.nextSiblingId ? doc.nodes.get(next.nextSiblingId) : undefined;
  }
  // Trailing blank lines at the end of the list stay where they are.
  while (end > root.range.startLine && isBlankLine(doc.lines[end])) end--;
  return end + 1;
}

interface Plan {
  draft: Draft;
  embedText: string;
  embedLine: number;
  placement: "above" | "below";
  blockId?: string;
  blockIdAdded: boolean;
}

function buildPlan(doc: ParsedDocument, target: Target, newId: string): Result<Plan> {
  const draft: Draft = { out: [...doc.lines], origin: doc.lines.map((_, i) => i) };
  let embedText: string;
  let insertBefore: number; // ORIGINAL line index the embed goes before (may be lines.length)
  let placement: "above" | "below" = "below";
  let blockId: string | undefined;
  let blockIdAdded = false;
  let separateIdLineAfter: number | null = null; // ORIGINAL line index after which "", "^id" is inserted

  if (target.kind === "section") {
    embedText = `![[#${normalizeMirrorHeading(target.headingText)}]]`;
    insertBefore = target.range.startLine;
    placement = "above";
  } else if (target.kind === "paragraph" || target.kind === "list") {
    const listNode = "node" in target ? target.node : null;
    const idLine = listNode ? listOwnTextLastLine(doc, listNode) : target.range.endLine;
    if (doc.codeBlockLines[idLine] || doc.frontmatterLines[idLine]) return fail("mirror-unsafe-position");
    const existing = BLOCK_ID_AT_END_RE.exec(doc.lines[idLine]);
    if (existing) {
      blockId = existing[1];
    } else {
      blockId = newId;
      blockIdAdded = true;
      const at = newIndexOf(draft, idLine);
      draft.out[at] = draft.out[at].replace(/\s+$/, "") + ` ^${newId}`;
    }
    embedText = `![[#^${blockId}]]`;
    insertBefore = listNode ? endOfRootList(doc, listNode) : target.range.endLine + 1;
  } else {
    // callout / blockquote / fenced-code / table: `^id` on its own line after the block.
    let k = target.range.endLine + 1;
    while (k < doc.lines.length && isBlankLine(doc.lines[k])) k++;
    const lone = k < doc.lines.length ? LONE_BLOCK_ID_RE.exec(doc.lines[k]) : null;
    if (lone) {
      blockId = lone[1];
      insertBefore = k + 1;
    } else {
      blockId = newId;
      blockIdAdded = true;
      separateIdLineAfter = target.range.endLine;
      insertBefore = target.range.endLine + 1;
    }
    embedText = `![[#^${blockId}]]`;
  }

  // Splice: [optional "", "^id"] then the embed, before ORIGINAL line `insertBefore`.
  let at = insertBefore >= doc.lines.length ? draft.out.length : newIndexOf(draft, insertBefore);
  if (separateIdLineAfter !== null) {
    insertAt(draft, at, ["", `^${newId}`]);
    at += 2;
  }
  insertAt(draft, at, [embedText]);
  const sep = ensureCopySeparation(draft.out, at, 1, "paragraph");
  // ensureCopySeparation only ever inserts blank lines: one right after the
  // embed and/or one right before it — mirror those into `origin`.
  const addedBefore = sep.newStart - at;
  const addedAfter = sep.lines.length - draft.out.length - addedBefore;
  if (addedAfter > 0) draft.origin.splice(at + 1, 0, ...Array<null>(addedAfter).fill(null));
  if (addedBefore > 0) draft.origin.splice(at, 0, ...Array<null>(addedBefore).fill(null));
  draft.out = sep.lines;
  if (draft.out.length !== draft.origin.length) return fail("mirror-structure-changed");

  return { ok: true, value: { draft, embedText, embedLine: sep.newStart, placement, blockId, blockIdAdded } };
}

// ---- Verification -----------------------------------------------------------

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const k of a) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const k of b) {
    const c = counts.get(k);
    if (!c) return false;
    counts.set(k, c - 1);
  }
  return true;
}

/** Every pre-existing node / complex block / composite survives, line-shifted only; new structure only inside inserted lines. */
function structurePreserved(
  before: { doc: ParsedDocument; scan: ComplexBlockScanResult; composites: CompositeBlockInfo[] },
  after: { doc: ParsedDocument; scan: ComplexBlockScanResult; composites: CompositeBlockInfo[] },
  draft: Draft
): boolean {
  const map = new Map<number, number>();
  draft.origin.forEach((o, i) => {
    if (o !== null) map.set(o, i);
  });
  const shift = (l: number) => map.get(l) ?? -1;
  const isNew = (l: number) => draft.origin[l] === null;
  const allNew = (r: LineRange) => {
    for (let l = r.startLine; l <= r.endLine; l++) if (!isNew(l)) return false;
    return true;
  };

  const nodeKey = (type: string, start: number, depth: number) => `${type}:${start}:${depth}`;
  if (
    !sameMultiset(
      [...before.doc.nodes.values()].map((n) => nodeKey(n.type, shift(n.range.startLine), n.depth)),
      [...after.doc.nodes.values()].map((n) => nodeKey(n.type, n.range.startLine, n.depth))
    )
  ) {
    return false;
  }

  const blockKey = (b: ComplexBlockInfo, s: (l: number) => number) =>
    `${b.kind}:${s(b.range.startLine)}:${s(b.range.endLine)}:${b.editability}`;
  if (
    !sameMultiset(
      before.scan.blocks.map((b) => blockKey(b, shift)),
      after.scan.blocks.filter((b) => !allNew(b.range)).map((b) => blockKey(b, (l) => l))
    )
  ) {
    return false;
  }

  const compositeKey = (c: CompositeBlockInfo, s: (l: number) => number) =>
    c.ruleId + "|" + c.members.map((m) => `${m.kind}:${s(m.range.startLine)}:${s(m.range.endLine)}`).join(",");
  return sameMultiset(
    before.composites.map((c) => compositeKey(c, shift)),
    after.composites.map((c) => compositeKey(c, (l) => l))
  );
}

function rejected(lines: string[], reason: MirrorCreateRejectReason): MirrorCreateOutcome {
  return { changed: false, lines, newStartLine: -1, reason };
}

// ---- Entry point ------------------------------------------------------------

/**
 * Creates a mirror of the block described by `ref` in `text` — see this
 * module's top doc comment. `rules` is the caller's currently-enabled
 * CompositeBlockRule set.
 */
export function createMirrorBelow(
  text: string,
  ref: MirrorCreateRef,
  rules: CompositeBlockRule[],
  options: MirrorCreateOptions = {}
): MirrorCreateOutcome {
  const doc = parseDocument(text);
  const scan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, scan, rules);
  const notePath = options.notePath ?? "";

  const target = resolveTarget(doc, scan, composites, ref);
  if (!target.ok) return rejected(doc.lines, target.reason);

  const before = { doc, scan, composites };
  const beforeCyclic = new Set(
    scanMirrorEmbeds(doc, scan.blocks, notePath)
      .filter((p) => p.resolution.status === "cycle")
      .map((p) => p.node.embedLine)
  );

  const generate = options.generateBlockId ?? (() => generateMirrorBlockId());
  const attempts = Math.max(1, options.maxIdAttempts ?? 10);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = generate();
    if (!/^[A-Za-z0-9-]+$/.test(candidate)) continue;
    const planned = buildPlan(doc, target.value, candidate);
    if (!planned.ok) return rejected(doc.lines, planned.reason);
    const plan = planned.value;

    const afterDoc = parseDocument(plan.draft.out.join("\n"));
    // A NEW id must be unique in the re-parsed result; otherwise try another.
    if (plan.blockIdAdded && plan.blockId) {
      const occurrences = findBlockIdLines(afterDoc, plan.blockId).length;
      // Also a plain text search (so an id-like token anywhere else — even
      // inside code — counts as a collision), ignoring the embed line itself.
      const raw = plan.draft.out.filter((l, i) => i !== plan.embedLine && l.includes(`^${plan.blockId}`)).length;
      if (occurrences !== 1 || raw !== 1) continue;
    }

    const afterScan = scanComplexBlocks(afterDoc);
    const afterComposites = matchCompositeBlocks(afterDoc, afterScan, rules);
    if (!structurePreserved(before, { doc: afterDoc, scan: afterScan, composites: afterComposites }, plan.draft)) {
      return rejected(doc.lines, "mirror-structure-changed");
    }

    const mirrors = scanMirrorEmbeds(afterDoc, afterScan.blocks, notePath);
    const mine = mirrors.find((m) => m.node.embedLine === plan.embedLine);
    if (!mine) return rejected(doc.lines, "mirror-structure-changed");
    // Refuse the new mirror being circular, or it closing a loop through
    // existing mirrors that were not circular before.
    const shiftOf = new Map<number, number>();
    plan.draft.origin.forEach((o, i) => {
      if (o !== null) shiftOf.set(o, i);
    });
    const previouslyCyclic = new Set([...beforeCyclic].map((l) => shiftOf.get(l)));
    for (const m of mirrors) {
      if (m.resolution.status === "cycle" && !previouslyCyclic.has(m.node.embedLine)) {
        return rejected(doc.lines, "mirror-cycle");
      }
    }

    const warnings: MirrorCreateWarning[] = [];
    if (mine.resolution.status === "unresolved") warnings.push("not-found");
    if (mine.resolution.status === "resolved" && (mine.resolution.matchCount ?? 1) > 1) {
      warnings.push(target.value.kind === "section" ? "duplicate-heading" : "duplicate-block-id");
    }

    return {
      changed: true,
      lines: plan.draft.out,
      newStartLine: plan.embedLine,
      newCursorCh: 0,
      embedLine: plan.embedLine,
      embedText: plan.embedText,
      placement: plan.placement,
      blockId: plan.blockId,
      blockIdAdded: plan.blockIdAdded,
      resolution: mine.resolution,
      warnings,
    };
  }
  return rejected(doc.lines, "mirror-id-collision");
}
