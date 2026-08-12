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
 *   A FUTURE phase (5D onward) may treat this as an operable unit. Phase 5C
 *   itself performs no operations regardless of this value.
 * - "read-only": the boundary is confidently determined, but this KIND is a
 *   permanent, deliberate non-goal for structural operations — not a
 *   "not yet implemented" placeholder. Only "paragraph" ever gets this
 *   value in Phase 5C, matching docs/mixed-structure-spec.md §6's existing
 *   decision ("段落専用ノードの追加...(段落を独立したdrag&drop/Partial Edit
 *   Pane対象にはしない)").
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
