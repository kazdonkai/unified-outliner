/**
 * Phase 5C: SCANNER-ONLY read-only recognition model for "complex" Markdown
 * blocks — callout, blockquote, fenced-code (including Mermaid), table, and
 * paragraph — living ALONGSIDE (never inside) the existing BlockNode union
 * in model/block.ts.
 *
 * Naming note (important, read before adding a new kind or a "unified
 * model" elsewhere): every type in this file is scoped to
 * parser/complexBlocks.ts's scanners and nothing else. `ComplexBlockKind`
 * is deliberately NOT named `BlockKind` — a name that broad would invite
 * confusion with a possible FUTURE unified block model that also covers
 * "section" and "list" (BlockNode's domain). If such a unified model is
 * ever introduced, it must be a distinct type in its own right (e.g.
 * spanning `BlockNode | ComplexBlockInfo` or similar), not a rename or
 * silent broadening of the types in this file. Until then:
 *
 *   - "section" and "list" are ALWAYS BlockNode's exclusive domain (see
 *     model/block.ts). They never appear in ComplexBlockKind.
 *   - ComplexBlockInfo values are NEVER inserted into ParsedDocument.nodes.
 *   - They never appear in any BlockNode's childIds or topLevelIds.
 *   - They are not consumed by any existing Obsidian-facing view as of this
 *     revision (OutlineTreeView, PartialEditView, main.ts's projection
 *     entry point, move/*, and parser/parseDocument.ts's own boundary
 *     logic all remain untouched by Phase 5C).
 *
 * Phase 5C's job is recognition and boundary/editability classification
 * only — see parser/complexBlocks.ts for the scanners that produce these
 * values. Tree display, icons, displayLabel wiring, move, indent/outdent,
 * drag & drop, hoist, and Partial Edit Pane integration for any of these
 * kinds are explicitly OUT OF SCOPE for Phase 5C and deferred to Phase 5D
 * onward — see docs/phase5c_block-model-and-tree-display-spec.md.
 */
import { LineRange } from "./block";

/**
 * The complex block kinds Phase 5C's scanners recognize. Intentionally
 * excludes "section" and "list" (BlockNode's exclusive domain — see this
 * file's own doc comment above) and excludes "frontmatter" (frontmatter is
 * handled as a pre-pass exclusion region inside parser/complexBlocks.ts,
 * exactly like ParsedDocument.frontmatterLines already is for the existing
 * parser — it is never surfaced as a ComplexBlockInfo).
 *
 * "callout" and "blockquote" are DISJOINT by construction, not merely by
 * convention: parser/complexBlocks.ts's internal quote-run scanner
 * classifies every contiguous quote-prefixed run as EXACTLY ONE of the two
 * (callout if its first line matches Obsidian's `> [!type]` syntax,
 * blockquote otherwise) before either scanCalloutBlocks or
 * scanBlockquoteBlocks ever sees it — so no line range can ever be reported
 * under both kinds. See that module's doc comment for the full rationale.
 *
 * Mermaid is not a distinct kind: a fenced code block whose info string is
 * "mermaid" is still reported as kind "fenced-code", with the info string
 * available via ComplexBlockInfo.infoString for a future phase that wants
 * to special-case it. Phase 5C does not parse or validate Mermaid syntax.
 *
 * Phase 5D-0 (2026-08-12) adds "thematic-break": a single line of 3+ of the
 * same character (`-`, `*`, or `_`, optionally space-separated, up to 3
 * leading spaces — the standard CommonMark thematic-break shape). See
 * parser/complexBlocks.ts's scanThematicBreakBlocks doc comment for why a
 * `-`-only run immediately below a plain text line is deliberately NOT
 * reported here (Setext heading underline ambiguity) even though
 * parser/parseDocument.ts itself still does not parse Setext headings at
 * all — see docs/phase5d0_basic-block-extension-and-composite-block-spec.md
 * §2.2.
 */
export type ComplexBlockKind =
  | "callout"
  | "blockquote"
  | "fenced-code"
  | "table"
  | "paragraph"
  | "thematic-break";

/**
 * Editability classification for a recognized (or attempted) complex block.
 * See parser/complexBlocks.ts's doc comment for the full operational
 * policy; summarized here — the "unsupported" vs "ambiguous" distinction in
 * particular is deliberate and must not be blurred:
 *
 * - "supported": the block's boundary is confidently determined AND it does
 *   not conflict with any existing section/list boundary, AND (for callout/
 *   blockquote) its internal content is fully accounted for by this phase's
 *   model (no embedded/nested callout-like structure it doesn't decompose).
 *   A FUTURE phase (5D onward for callout/blockquote/fenced-code/table; 5P-2
 *   onward for paragraph) MAY treat this as an operable unit, but "supported"
 *   BY ITSELF never authorizes anything — Phase 5C/5D/5P all perform no
 *   operation on a block merely because it is "supported"; each individual
 *   command/projection (Move block, CompositeBlock matching, Partial Edit
 *   resolution, the Phase 5P-2 paragraph resolver, ...) explicitly
 *   allow-lists which kinds and which additional conditions (e.g. "not owned
 *   by a list item") it accepts, and re-derives that allow-list check itself
 *   rather than trusting this field alone. Phase 5P-1R (2026-08-17)
 *   established this explicitly for paragraph specifically — see
 *   parser/complexBlocks.ts's scanParagraphBlocks doc comment — after a
 *   review found that Phase 5P-1's original choice to keep paragraph
 *   permanently "read-only" (below) contradicted this very definition once
 *   a paragraph's boundary/parent/depth were confidently resolved.
 * - "read-only": the boundary is confidently determined, but this SPECIFIC
 *   instance is not being offered as a candidate at all — e.g. it lost a
 *   mergeBlockRangesSafely priority conflict in a way that still leaves its
 *   OWN boundary certain (rare; most such conflicts downgrade to
 *   "ambiguous" instead — see that function's doc comment), or a future
 *   scanner wants to report "boundary known, but I am intentionally not
 *   offering this as a candidate for any purpose". As of Phase 5P-1R,
 *   parser/complexBlocks.ts's scanParagraphBlocks no longer assigns this
 *   value to any paragraph it recognizes (it assigns "supported" or
 *   "ambiguous" only — see that function's doc comment for why); this value
 *   remains part of the type for other future uses.
 * - "unsupported": the block's OWN boundary (start/end line range) IS
 *   confidently known, but its INTERNAL content contains structure this
 *   phase does not decompose or model — e.g. a callout containing a nested
 *   callout, or a blockquote whose body contains callout-like syntax mid-
 *   stream. This is "I know exactly where it starts and ends, but I am not
 *   claiming to understand everything inside it." Always paired with a
 *   diagnostic explaining which structure was found.
 * - "ambiguous": the boundary ITSELF (which lines belong to this block, or
 *   how it relates to enclosing section/list structure) could not be safely
 *   determined — cross-boundary span, unterminated fence, malformed table,
 *   or conflict with another recognized block via merge. This is "I am not
 *   confident which lines this block even covers." Never treat an
 *   "ambiguous" block as an edit/move candidate, same as "unsupported" —
 *   the distinction exists for diagnostic clarity (what kind of problem was
 *   found), not to imply "ambiguous" blocks are somehow safer than
 *   "unsupported" ones.
 */
export type BlockEditability = "supported" | "read-only" | "unsupported" | "ambiguous";

/**
 * Reuses model/block.ts's LineRange verbatim: 0-based, BOTH ENDS INCLUSIVE
 * (see that file's own doc comment, and edit/partialEdit.ts's
 * `doc.lines.slice(startLine, endLine + 1)` usage, which is the existing,
 * sole convention this whole plugin already relies on). Phase 5C
 * deliberately introduces no second range shape (e.g. character offsets):
 * parser/parseDocument.ts is explicitly a line-scanning parser with no
 * offset tracking, so a `from`/`to` character-offset pair would have no
 * consumer today. A future phase that needs offsets (e.g. for CM6
 * Decoration-based rendering) can add an optional field alongside this one
 * without revisiting this decision.
 */
export type ComplexBlockRange = LineRange;

export interface ComplexBlockInfo {
  /** Stable only within a single scanComplexBlocks() call — same convention as BlockNode's `sec-N`/`li-N` ids (see tree/treeBlockCommand.ts's doc comment). */
  id: string;
  kind: ComplexBlockKind;
  range: ComplexBlockRange;
  /**
   * The enclosing existing BlockNode's id (a section or list id), or null
   * when no single existing node's range fully contains this block —
   * including the legitimate case where the block sits entirely before any
   * heading/list (top-level, no enclosing node). Resolved by
   * parser/complexBlocks.ts's internal resolveParentId helper, which checks
   * that EVERY line in the block's range shares the same owner AND that
   * owner's own range fully contains the block — never just the block's
   * first line. See that function's doc comment for why startLine-only
   * resolution is unsafe. This applies uniformly whether the owner is a
   * section OR a list item (e.g. a blockquote nested inside a list item's
   * continuation resolves parentId to that list item).
   */
  parentId: string | null;
  /**
   * Reserved for a future phase (nesting among complex blocks, e.g. a list
   * inside a callout). ALWAYS [] in Phase 5C — this phase does not compute
   * complex-block-to-complex-block nesting; callout and blockquote
   * contents, in particular, are deliberately not decomposed into child
   * blocks here.
   */
  childIds: string[];
  editability: BlockEditability;
  /** Present whenever editability !== "supported"; may also be present for "supported" blocks as extra context. */
  reason?: string;
  /** Fenced-code only: the opening fence's info string, trimmed (e.g. "mermaid", "ts", ""). Undefined for every other kind. */
  infoString?: string;
}

export type BlockDiagnosticKind =
  | "unsupported"
  | "ambiguous"
  | "unterminated-fence"
  | "malformed-table"
  | "unsupported-callout-nesting"
  | "overlapping-range";

export interface BlockDiagnostic {
  kind: BlockDiagnosticKind;
  fromLine: number;
  toLine: number;
  message: string;
}

export interface ComplexBlockScanResult {
  blocks: ComplexBlockInfo[];
  diagnostics: BlockDiagnostic[];
}

/** Result of describeComplexBlockRejection — see parser/complexBlocks.ts. */
export type ComplexBlockRejection =
  | { blocked: true; kind: ComplexBlockKind; editability: BlockEditability; reason: string }
  | { blocked: false };

// ---- Phase 5C-3: standalone (non-composite-member) callout/blockquote
// move-eligibility ------------------------------------------------------
//
// A DIFFERENT, narrower question than anything above this line: everything
// above is about RECOGNITION (is this a callout/blockquote, and what is its
// boundary/editability). The types below classify whether one SPECIFIC,
// already-recognized, standalone ComplexBlockInfo (never a CompositeBlock's
// own member — see model/compositeBlock.ts's own top doc comment for why
// composite membership is tracked separately) may be safely swapped with
// the adjacent block in a given up/down direction. See
// parser/compositeBlocks.ts's evaluateStandaloneComplexBlockMovability for
// the exact, independently-re-derived condition list.
//
// Deliberately mirrors CompositeBlockMoveRejectionReason /
// CompositeBlockMovability (model/compositeBlock.ts) in shape, but is its
// own, separate type: a standalone complex block has no `depth`/
// `indentColumns` concept at all (it is never nested — Phase 5C-3 approval
// explicitly excludes any block sitting under a list item's continuation),
// so there is no "unsafe-indent" or "different-parent-or-depth" reason here
// — only the narrower set below applies.

/**
 * Every way a standalone callout/blockquote's move (in one specific
 * direction) may be refused:
 *   - "not-supported": the target itself is not kind "callout"/"blockquote",
 *     or its own `editability !== "supported"`. Defense-in-depth — a real
 *     caller should never reach this function with an ineligible target in
 *     the first place (see tree/buildOutlineTree.ts's own
 *     isStandaloneComplexBlockEligible, which already filters to exactly
 *     this condition before a row is ever shown), but this function
 *     re-verifies its own input rather than trusting it.
 *   - "composite-member": the target IS currently a matched CompositeBlock's
 *     own member (re-checked fresh against `allComposites`, never trusted
 *     from Tree-render time) — Phase 5C-3 approval §1 originally excluded
 *     composite members from this feature entirely. Phase 5D-3B
 *     ("Composite Member Move Menu Parity") added an explicit, opt-in
 *     `allowComposedMember` parameter to
 *     parser/compositeBlocks.ts#evaluateStandaloneComplexBlockMovability
 *     that a caller may set to bypass ONLY this one check for the MOVING
 *     target — default `false`, so every pre-5D-3B caller (the standalone
 *     Tree menu, the cursor-based body-editor path) is byte-for-byte
 *     unchanged and this reason remains fully reachable there. It also
 *     still serves as this feature's own race-condition safety net: a
 *     block that was standalone when a Tree menu snapshot was captured but
 *     became a composite member by the time the move actually runs is
 *     still correctly rejected via this same reason on that (non-opted-in)
 *     path. The adjacent CANDIDATE side (whatever the target would swap
 *     with) is never affected by this parameter — a composite member is
 *     never an eligible swap partner, opted in or not.
 *   - "nested-in-list": the target's own `parentId` resolves to a
 *     list-typed node — i.e. it sits inside a list item's continuation
 *     rather than directly under its enclosing section (or under no
 *     section at all). Phase 5C-3 approval §3 explicitly excludes this
 *     case.
 *   - "no-adjacent-compatible-unit": no eligible standalone callout/
 *     blockquote exists immediately in the requested direction (the
 *     document's own edge, a section heading, a composite's own boundary,
 *     a composite MEMBER's own boundary, or any other ComplexBlockKind —
 *     table/thematic-break — all collapse to this one reason, mirroring
 *     CompositeBlockMoveRejectionReason's own equivalent value).
 *
 *     ADDENDUM (2026-09-24, fix/standalone-complex-move-adjacent-parity):
 *     Phase 5C-3's original "A案のみ" decision above excluded a plain list
 *     item and a paragraph from ever being an eligible adjacent partner —
 *     this made Move strictly narrower than D&D's own
 *     move/findStandaloneComplexBlockDropTarget.ts, which already accepts
 *     a standalone paragraph or a top-level/section-level list item as a
 *     drop target. That asymmetry was user-visible (drag handle present,
 *     Move menu item hidden) and is now closed: a standalone paragraph
 *     (ComplexBlockKind "paragraph", editability "supported") and a
 *     standalone list item (a ListBlockNode whose own `parentId` is NOT
 *     list-typed, i.e. top-level-of-document or directly under a section)
 *     are now ALSO valid adjacent partners — see
 *     parser/compositeBlocks.ts#findAdjacentStandaloneMoveNeighbor. A list
 *     item OR paragraph that is itself a composite member is still
 *     excluded, exactly like a composite-member callout/blockquote always
 *     was. table remains out of scope (still read-only, unchanged).
 *   - "different-section": an eligible adjacent standalone callout/
 *     blockquote WAS found, but its own `parentId` differs from the
 *     target's — i.e. the two sit in different sections (or one is
 *     top-of-document and the other isn't). Move in this revision never
 *     crosses a section boundary, exactly like composite move's own
 *     swap-only-never-cross-section design.
 */
export type StandaloneComplexBlockMoveRejectionReason =
  | "not-supported"
  | "composite-member"
  | "nested-in-list"
  | "no-adjacent-compatible-unit"
  | "different-section";

export type StandaloneComplexBlockMovability =
  | { eligible: true }
  | { eligible: false; reason: StandaloneComplexBlockMoveRejectionReason };

// ---- Phase 5D-3C: standalone / composite-member callout/blockquote
// Drag and Drop drop-target rejection reasons ----------------------------
//
// A related but DELIBERATELY SEPARATE type from
// StandaloneComplexBlockMoveRejectionReason above. Move (Phase 5C-3/5D-3B)
// only ever resolves ONE candidate position per direction (the immediately
// adjacent standalone callout/blockquote), so its reason set is entirely
// about WHETHER an eligible adjacent unit exists. D&D (Phase 5D-3C,
// approved design: "案A") lets the user choose an arbitrary before/after
// position (within the same section scope, never "inside" — see
// move/findStandaloneComplexBlockDropTarget.ts's own top doc comment for
// the full v1 scope), so its reason set is instead about whether that
// CHOSEN position is safe — a different question, hence its own type
// rather than reusing or widening StandaloneComplexBlockMoveRejectionReason.
//
// Per the Phase 5D-3C approval, this reason set is used internally (the
// resolver/executor return it, and it is asserted on directly by tests) but
// is NEVER surfaced to the user via a translated Notice — no new i18n key
// was added for it. Rejection is communicated purely by the drop indicator
// never appearing (dragover) / the note staying byte-identical (drop),
// mirroring the existing, pre-5D-3C convention that section/list D&D's own
// NoRelocateReason already follows (grepped and confirmed to have zero
// i18n bindings before this ticket).
//
// Deliberately NOT included: a "composite-member" value for the SOURCE.
// Unlike Move, D&D (案A) never rejects a source for currently being a
// matched CompositeBlock's own member — composite membership is
// irrelevant to D&D source eligibility by design (see this ticket's own
// approval: "CompositeBlock member を単独で Drag and Drop した結果...
// CompositeBlock matching が失われることは許可する"). The absence of that
// value here is intentional, not an oversight.
export type StandaloneComplexBlockDropRejectReason =
  /** Source kind isn't callout/blockquote, or its own `editability !== "supported"`. Same meaning as StandaloneComplexBlockMoveRejectionReason's own "not-supported". */
  | "not-supported"
  /** Source's own `parentId` resolves to a list-typed node (sits inside a list item's continuation). Same meaning as Move's own "nested-in-list". */
  | "nested-in-list"
  /**
   * The resolved drop position sits at, or immediately adjacent to (i.e.
   * would be a true no-op after move/moveBlock.ts#insertBlockAt's own
   * position-adjustment math), the source's OWN current range — dropping a
   * block onto itself, or immediately before/after its own current
   * position, changes nothing.
   */
  | "self-drop"
  /**
   * [2026-09-24 追記, feat/standalone-complex-dnd-cross-section] This
   * value is NO LONGER PRODUCED by
   * move/findStandaloneComplexBlockDropTarget.ts#resolveStandaloneComplexBlockDropTarget
   * — that resolver's own `target.parentId !== source.parentId` check was
   * removed so that standalone callout/blockquote/fenced-code/table D&D
   * can cross a section boundary, mirroring how list items already cross
   * sections via move/findMoveTarget.ts's own `{ kind: "insert" }` path.
   * The literal is kept in this union purely for history/back-compat (any
   * external code still narrowing on it keeps compiling) — see that
   * resolver's own top doc comment for the full addendum. The original
   * doc text below describes the RETIRED behavior verbatim.
   *
   * [ORIGINAL, retired 2026-09-24] The resolved drop target's own
   * `parentId` differed from the source's own `parentId` — D&D v1 never
   * crossed a section boundary, exactly like Move's own
   * "different-section". Incidentally, this single check ALSO
   * structurally prevented "drop as a list item's new child": a source
   * that passed its own eligibility check always has `parentId` equal to
   * a section id or null (never a list id — nested-in-list sources are
   * already rejected), so a target nested inside ANY list item's
   * continuation (whose own `parentId` is necessarily that list item's
   * id) could never equal the source's own `parentId` either, and was
   * therefore always caught here even without a separate, dedicated
   * "target is nested in a list" reason value.
   */
  | "not-same-section"
  /**
   * The resolved insertion point sits STRICTLY inside some existing
   * CompositeBlock's own aggregate `range` (i.e. strictly after that
   * composite's own first line and at or before its own last line) — this
   * would insert unrelated content between that composite's own anchor
   * list item and its own member(s) (or, for a future multi-member rule,
   * between two of that composite's own members), corrupting a THIRD
   * PARTY's structure regardless of whether the DRAGGED block's own
   * membership is separately, and independently, allowed to be affected
   * (see this type's own top doc comment). See
   * move/findStandaloneComplexBlockDropTarget.ts's own doc comment for the
   * exact boundary arithmetic and why checking self-drop FIRST already
   * excludes the source's own immediately-adjacent position from ever
   * reaching this check.
   */
  | "composite-internal-boundary"
  /**
   * Drop-time-only (never returned by the pure resolver itself, only by
   * edit/dropStandaloneComplexBlock.ts's own re-verification wrapper): the
   * document changed between drag-start and drop such that no complex
   * block currently matches the caller's source snapshot (kind/range/
   * parentId) — the D&D analogue of Move's own
   * "standalone-boundary-changed". Reported as a safe no-op, per this
   * ticket's approval: "stale drag source に対して古い range を使って書き
   * 換えてはならない".
   */
  | "source-boundary-changed"
  /**
   * Drop-time-only, same rationale as "source-boundary-changed" above but
   * for the TARGET side: the document changed such that the target hint
   * captured at dragover no longer matches anything current.
   */
  | "target-boundary-changed"
  /** The source snapshot itself is not self-consistent against the current document's own line count — checked before any parse/scan/match attempt, mirroring Move's own "range-invalid". */
  | "range-invalid";

export type StandaloneComplexBlockDropResolution =
  | { allowed: true; insertBeforeLine: number }
  | { allowed: false; reason: StandaloneComplexBlockDropRejectReason };
