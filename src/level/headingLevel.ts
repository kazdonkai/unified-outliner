/**
 * Change a single heading line's `#` count by exactly one level. This is
 * the shared low-level primitive behind two different commands:
 *
 *   - the block-scoped heading-indent/outdent in ../move/indentBlock.ts,
 *     which layers its own section-safety checks (no subsections, needs a
 *     previous sibling to indent — see ../move/findIndentTarget.ts) before
 *     calling this;
 *   - the node-only heading level commands in this directory, which apply
 *     it unconditionally (within the 1–6 level bounds).
 *
 * Kept as a single one-line primitive so a future outline-pane command
 * (promote-node-only / demote-node-only, docs/別ペイン実装計画と当面の実装指示.md
 * §4.1) can reuse it too, instead of re-deriving the `#` edit.
 */
import { IndentDirection } from "./direction";

export function changeHeadingLevel(
  lines: string[],
  lineIndex: number,
  direction: IndentDirection
): string[] {
  const out = lines.slice();
  out[lineIndex] =
    direction === "indent"
      ? "#" + out[lineIndex]
      : out[lineIndex].replace(/^#/, "");
  return out;
}

/**
 * Rewrite a heading line to an explicit `#` count (1–6), in one step,
 * rather than changeHeadingLevel's single ±1 step. Added for Phase 3A
 * drag & drop (move/relocateSection.ts): dropping a subtree "inside" a
 * target can require an arbitrary level jump (e.g. a level-1 section
 * dropped inside a level-5 target needs +5 in one go), where looping
 * changeHeadingLevel would be both slower and less obviously correct than
 * a direct rewrite. `newLevel` is the caller's responsibility to keep
 * within 1–6 — this function does not clamp or validate it.
 */
export function setHeadingLevel(
  lines: string[],
  lineIndex: number,
  newLevel: number
): string[] {
  const out = lines.slice();
  const match = out[lineIndex].match(/^#{1,6}([ \t].*)$/);
  if (!match) return out;
  out[lineIndex] = "#".repeat(newLevel) + match[1];
  return out;
}
