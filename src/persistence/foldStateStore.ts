/**
 * Phase 4E: pure data model for persisted Outline Tree View fold state.
 * No Obsidian dependency — the actual disk I/O (loadData/saveData) and
 * debouncing live in persistence/foldStateManager.ts, which wraps these
 * functions. Keyed by vault-relative file path (TFile.path); the value is
 * the list of currently-collapsed node IDENTITIES for that file (see
 * tree/foldIdentity.ts — NOT the transient per-parse node.id).
 *
 * The default state for any node is "expanded" (matching every prior
 * phase's in-memory collapsedIds, which also started empty) — so a file
 * with everything expanded simply has no entry at all, rather than an
 * entry listing every node as "not collapsed". This keeps the persisted
 * blob small and means a brand-new note never needs an entry.
 */

export type FoldStateData = Record<string, string[]>;

/**
 * Defensively parse whatever the plugin's data.json handed back for the
 * `foldState` key. Obsidian's loadData() return type is `any`, and this
 * key may be missing entirely (fresh install / pre-Phase-4E data.json),
 * malformed (hand-edited data.json, a future format change), or otherwise
 * not what this phase expects — in every such case this falls back to an
 * empty store rather than throwing, consistent with this project's
 * established "safe fallback over crashing" policy (see
 * docs/mixed-structure-spec.md's known-limitation section for the same
 * philosophy applied elsewhere).
 */
export function normalizeFoldStateData(raw: unknown): FoldStateData {
  if (!raw || typeof raw !== "object") return {};
  const out: FoldStateData = {};
  for (const [filePath, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const identities = value.filter((v): v is string => typeof v === "string");
    if (identities.length > 0) out[filePath] = identities;
  }
  return out;
}

/** The set of collapsed node identities for `filePath` (empty if none). */
export function getCollapsedIdentities(
  data: FoldStateData,
  filePath: string
): Set<string> {
  return new Set(data[filePath] ?? []);
}

/**
 * Returns a NEW FoldStateData with `identity` added to (collapsed=true) or
 * removed from (collapsed=false) `filePath`'s collapsed set. Immutable-
 * style (never mutates `data`) so this is trivial to unit test and so a
 * caller can cheaply check `result !== data` to know whether anything
 * actually changed. A file whose collapsed set becomes empty is removed
 * from the map entirely (see module doc comment on why "no entry" is the
 * canonical "nothing collapsed" representation, not an empty array).
 */
export function withNodeCollapsed(
  data: FoldStateData,
  filePath: string,
  identity: string,
  collapsed: boolean
): FoldStateData {
  const current = new Set(data[filePath] ?? []);
  const hadIt = current.has(identity);
  if (collapsed === hadIt) return data; // no-op, same reference back
  if (collapsed) {
    current.add(identity);
  } else {
    current.delete(identity);
  }
  const next: FoldStateData = { ...data };
  if (current.size === 0) {
    delete next[filePath];
  } else {
    next[filePath] = Array.from(current);
  }
  return next;
}

/**
 * Migrates a file's collapsed set from `oldPath` to `newPath` (Obsidian's
 * vault "rename" event covers both renames and moves — both are just a
 * path change from this store's point of view). Returns `data` unchanged
 * (same reference) if there's nothing to migrate, so callers can skip a
 * save when nothing actually changed.
 */
export function withFileRenamed(
  data: FoldStateData,
  oldPath: string,
  newPath: string
): FoldStateData {
  if (oldPath === newPath) return data;
  const existing = data[oldPath];
  if (!existing) return data;
  const next: FoldStateData = { ...data };
  delete next[oldPath];
  next[newPath] = existing;
  return next;
}
