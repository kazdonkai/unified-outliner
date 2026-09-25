/**
 * Partial Edit Pane — Block ID field follow-up ("Block ID 変更時のミラー参照の
 * 自動更新と他ファイル参照の警告"): pure, Obsidian-free helpers used when
 * the Block ID field renames or removes a block's id.
 *
 *   - renameBlockIdInText: rewrites the SAME-note mirror embed lines
 *     `![[#^old]]` (alias kept: `![[#^old|alias]]`) to the new id. The
 *     block's own id (inline suffix / standalone line) is NOT touched here —
 *     applySubtreeEdit / applyParagraphEdit already rewrite it. Removing an
 *     id (newId null) rewrites nothing.
 *   - countSameFileBlockIdMirrors: how many same-note mirror embeds refer to
 *     an id (for the "references are now broken" warning after a delete).
 *   - findCrossFileBlockIdReferences: whether a link or embed in ANOTHER
 *     note points at `<this note>#^id`.
 *
 * Why findCrossFileBlockIdReferences takes the other notes' links instead
 * of this note's text: references FROM other notes live in those notes, not
 * in this one (and parseMirrorEmbed deliberately returns null for any
 * `![[Other#…]]` target), so scanning this note's own text can never find
 * them. The view collects the candidate links from Obsidian's metadata
 * cache and passes a link-path resolver; this function only decides.
 */
import { parseDocument } from "../parser/parseDocument";
import { scanComplexBlocks } from "../parser/complexBlocks";
import { scanMirrorEmbeds } from "../mirror/scanMirrorEmbeds";

/** A whole-line same-note block embed: `![[#^id]]` or `![[#^id|alias]]` (checked on the trimmed line). */
export const BLOCK_ID_EMBED_RE = /^!\[\[#\^([A-Za-z0-9-]+)(\|[^\]]*)?]]$/;

export interface BlockIdRenameResult {
  text: string;
  /** 0-based line numbers of the embed lines that were rewritten. */
  replacedLines: number[];
}

/**
 * Rewrites every same-note mirror embed line `![[#^oldId]]` (alias kept) to
 * `![[#^newId]]`. Lines inside frontmatter or fenced code are never
 * touched, nor is anything that is not a whole-line embed. `newId === null`
 * (the id is being removed) rewrites nothing.
 */
export function renameBlockIdInText(text: string, oldId: string, newId: string | null): BlockIdRenameResult {
  if (newId === null || newId === oldId) return { text, replacedLines: [] };
  const doc = parseDocument(text);
  const lines = text.split("\n");
  const replacedLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (doc.frontmatterLines[i] || doc.codeBlockLines[i]) continue;
    const line = lines[i];
    const trimmed = line.trim();
    const m = BLOCK_ID_EMBED_RE.exec(trimmed);
    if (!m || m[1] !== oldId) continue;
    const start = line.indexOf(trimmed);
    lines[i] = line.slice(0, start) + `![[#^${newId}${m[2] ?? ""}]]` + line.slice(start + trimmed.length);
    replacedLines.push(i);
  }
  return replacedLines.length === 0 ? { text, replacedLines } : { text: lines.join("\n"), replacedLines };
}

/** How many same-note mirror embeds (as scanMirrorEmbeds recognizes them) refer to `^blockId`, resolved or not. */
export function countSameFileBlockIdMirrors(text: string, notePath: string, blockId: string): number {
  const doc = parseDocument(text);
  return scanMirrorEmbeds(doc, scanComplexBlocks(doc).blocks, notePath).filter(
    (p) => p.node.source.kind === "block-id" && p.node.source.blockId === blockId
  ).length;
}

/** One link or embed found in some note (Obsidian's LinkCache `link`, e.g. "Note#^id" or "#^id"). */
export interface NoteLinkReference {
  /** The note the link is written in. */
  sourcePath: string;
  /** The link text without alias / display text. */
  link: string;
}

/**
 * True when a link or embed written in a note OTHER than `notePath` points
 * at `notePath#^blockId`. `resolveLinkpath(linkpath, sourcePath)` returns
 * the path of the note a link path resolves to (null when unresolved); an
 * empty link path ("#^id") refers to the link's own note.
 */
export function findCrossFileBlockIdReferences(
  links: readonly NoteLinkReference[],
  notePath: string,
  blockId: string,
  resolveLinkpath: (linkpath: string, sourcePath: string) => string | null
): boolean {
  return links.some((ref) => {
    if (ref.sourcePath === notePath) return false;
    const hash = ref.link.indexOf("#");
    if (hash === -1) return false;
    const subpath = ref.link.slice(hash + 1).trim();
    if (subpath !== `^${blockId}`) return false;
    const linkpath = ref.link.slice(0, hash).trim();
    const target = linkpath === "" ? ref.sourcePath : resolveLinkpath(linkpath, ref.sourcePath);
    return target === notePath;
  });
}
