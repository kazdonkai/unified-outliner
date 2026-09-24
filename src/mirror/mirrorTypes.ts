/**
 * Phase 5M-0 ("ミラーの基盤型定義と読み取り専用 Outline Tree 投影"): the
 * shared, Obsidian-free type layer for single-note mirrors.
 *
 * A mirror's single source of truth is the note body's own Obsidian embed
 * syntax — `![[#Heading]]` / `![[#^block-id]]` on a line of its own. This
 * plugin keeps NO separate mirror database: every type below is derived
 * from the current text on every parse, exactly like section/list nodes
 * and complex blocks already are.
 *
 * Deliberately OUT of this phase's types: mirrors of another note
 * (`![[Other note#Heading]]`) and whole-file embeds (`![[Other note]]`).
 * `notePath` exists on MirrorSource only so a later phase can widen the
 * scope without reshaping the type; in 5M-0 it is always the note the
 * embed itself lives in.
 *
 * This is a DIFFERENT concept from Phase 5E-Copy's copy (an independent
 * duplicate). A mirror is a reference/projection: nothing here writes to
 * the note, and nothing here shares state with the copy-pending state
 * (the plugin's own `pendingBlockCopy` field).
 */
import { LineRange } from "../model/block";

/** What a mirror embed points at: a heading's section, or a `^block-id` block. */
export type MirrorKind = "heading" | "block-id";

/**
 * The referenced ("source") side of a mirror.
 *
 * - `kind: "heading"`: `headingText` is the heading the embed names (the
 *   LAST segment of a nested `#A#B` path); `headingPath` holds every
 *   segment in order (length 1 for a plain `#A`).
 * - `kind: "block-id"`: `blockId` is the id without its `^`.
 *
 * `lineRange` is the referenced block's current range in the note (the
 * whole section subtree for a heading; the block carrying the id for a
 * block-id), or `null` when not (yet) resolved — parseMirrorEmbed always
 * returns `null` here; resolution fills it in.
 */
export interface MirrorSource {
  notePath: string;
  kind: MirrorKind;
  headingText?: string;
  headingPath?: string[];
  blockId?: string;
  lineRange: LineRange | null;
}

/**
 * One mirror embed as projected into the Outline Tree: a stable-per-parse
 * `id`, its kind, its (possibly resolved) source, and `embedLine` — the
 * 0-based line of the `![[#...]]` embed itself.
 */
export interface MirrorNode {
  id: string;
  kind: MirrorKind;
  source: MirrorSource;
  embedLine: number;
}

/** Why a mirror embed could not be resolved to a block in the note. */
export type MirrorUnresolvedReason = "not-found";

/**
 * Outcome of resolving one mirror embed against the current note:
 *
 * - `resolved`: the referenced block exists; `source.lineRange` is set.
 * - `unresolved`: no heading / block id matches (a dangling embed).
 * - `cycle`: the embed is part of a circular reference — its target
 *   (directly or via other mirrors) contains the embed itself, so
 *   rendering it would recurse. `cycle` lists the MirrorNode ids on the
 *   loop, starting from this one.
 */
export type MirrorResolutionResult =
  | { status: "resolved"; source: MirrorSource & { lineRange: LineRange } }
  | { status: "unresolved"; reason: MirrorUnresolvedReason; source: MirrorSource }
  | { status: "cycle"; cycle: string[]; source: MirrorSource };
