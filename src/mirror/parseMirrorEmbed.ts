/**
 * Phase 5M-0: pure parser for a SINGLE-NOTE mirror embed line.
 *
 * Accepts exactly one Obsidian embed occupying the whole line (surrounding
 * whitespace allowed), whose target starts with `#` — i.e. refers to the
 * note it is written in:
 *
 *   ![[#Heading]]            -> { kind: "heading",  headingText: "Heading" }
 *   ![[#Parent#Child]]       -> { kind: "heading",  headingPath: ["Parent","Child"], headingText: "Child" }
 *   ![[#^block-id]]          -> { kind: "block-id", blockId: "block-id" }
 *   ![[#Heading|alias]]      -> alias is accepted and ignored
 *
 * Returns null for everything else, including: another note's heading or
 * block (`![[Note#H]]`, `![[Note#^id]]`), a whole-file embed (`![[Note]]`),
 * a plain link (`[[#H]]`), an empty target (`![[#]]`, `![[#^]]`), an
 * invalid block id, an empty path segment (`![[#A##B]]`), a heading path
 * that ends in a block id (`![[#A#^id]]`), more than one embed or any other
 * text on the line, and anything spanning brackets. Never throws, no
 * Obsidian dependency.
 */
import { MirrorSource } from "./mirrorTypes";

const WHOLE_LINE_EMBED_RE = /^!\[\[([^[\]\n]*)\]\]$/;
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/;

export function parseMirrorEmbed(line: string, notePath: string): MirrorSource | null {
  const m = WHOLE_LINE_EMBED_RE.exec(line.trim());
  if (!m) return null;
  const pipe = m[1].indexOf("|");
  const target = (pipe === -1 ? m[1] : m[1].slice(0, pipe)).trim();
  // Anything before the first "#" is a note name — another note (or the
  // whole file when there is no "#" at all). Out of scope for 5M-0.
  if (!target.startsWith("#")) return null;
  const rest = target.slice(1);

  if (rest.startsWith("^")) {
    const blockId = rest.slice(1);
    if (!BLOCK_ID_RE.test(blockId)) return null;
    return { notePath, kind: "block-id", blockId, lineRange: null };
  }

  const segments = rest.split("#").map((s) => s.trim());
  if (segments.length === 0 || segments.some((s) => s.length === 0 || s.startsWith("^"))) return null;
  return {
    notePath,
    kind: "heading",
    headingText: segments[segments.length - 1],
    headingPath: segments,
    lineRange: null,
  };
}
