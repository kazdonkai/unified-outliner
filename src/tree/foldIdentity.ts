/**
 * Phase 4E: stable, content-based node identity for fold-state
 * persistence. A DIFFERENT concept from a node's `id` field
 * (`sec-N`/`li-N`): that id is a fresh per-parseDocument() counter, only
 * meaningful within one parse (see parser/parseDocument.ts) — it cannot be
 * used as a key in data saved to disk, since the very next re-parse (or
 * the very next Obsidian session) will hand out different ids for the
 * exact same content, and two entirely different notes can coincidentally
 * produce the identical id (e.g. both notes' first heading is `sec-0`).
 *
 * Design (see the Phase 4E design report for the full comparison of
 * alternatives — line number, structural sibling-index path, content
 * hash): identity here is a PATH OF LABELS, where each segment is
 * `${kind}:${label}` (label = heading text for a section, item text for a
 * list node). This is deliberately NOT position-based (line number /
 * sibling index), because this plugin's entire purpose is repositioning
 * nodes (move/indent/drag) — a position-based identity would invalidate
 * itself on every single operation the plugin exists to perform.
 *
 * SECTIONS use the full ancestor path of enclosing sections (unchanged
 * across a plain reorder among sibling sections — move-up/down, drag
 * before/after — since none of those change which sections are its
 * ancestors). Indent/outdent that changes a HEADING's level can change
 * which section is its logical parent (that's what re-leveling a heading
 * means) — when that happens, the section's identity legitimately changes
 * and its fold state resets to the default (expanded). This is accepted
 * as a known, narrow limitation (heading indent/outdent is the safety-
 * gated, comparatively infrequent operation — see move/findIndentTarget.ts
 * — not the routine, high-frequency one).
 *
 * LIST NODES instead use the path of their NEAREST ENCLOSING SECTION
 * (not the chain of intermediate list-item ancestors) plus their own
 * label, and are disambiguated against every OTHER list node anywhere
 * under that same enclosing section (regardless of nesting depth), not
 * just their immediate siblings. This is the one deliberate departure
 * from "full ancestor path", and it's intentional: unlike heading
 * indent/outdent, re-nesting a list item under a different sibling item
 * (Tab/Shift-Tab-style indent/outdent) is the single most routine
 * structural edit this plugin exists to support, and a full ancestor-path
 * identity would invalidate a list item's fold state on nearly every
 * indent/outdent — including ones that don't cross a section boundary,
 * which is the overwhelming majority of them. Scoping identity to "which
 * section" rather than "which exact list-item parent" makes indent/
 * outdent WITHIN a section transparent to fold state, at the cost of a
 * list item's identity still changing if it's relocated to a DIFFERENT
 * section entirely (drag & drop "inside" a different section, or a
 * cross-section list move) — accepted as a known, narrower-than-ideal but
 * defensible limitation; a cross-section relocation is a much more
 * structurally significant edit than an ordinary re-nest, so losing fold
 * state there is far less surprising to a user than losing it on every
 * routine indent/outdent would be.
 *
 * In both cases, sibling label collisions (two nodes with the exact same
 * computed `kind:label` within the same disambiguation scope — e.g. two
 * list items that both literally say "TODO") are disambiguated by their
 * occurrence order within that scope, appended as a `#N` suffix. A
 * collapsed identity can therefore point at the "wrong" one of several
 * identically-labeled nodes in the same scope if one with the same label
 * is inserted/removed/reordered before them — a narrow, accepted edge
 * case, not a crash or data-loss risk (worst case: a still-valid sibling
 * in the same scope shows the fold state instead of the exact original
 * node).
 */
import { flattenOutlineTree, OutlineTreeNode } from "./buildOutlineTree";

/**
 * Phase 5D-0.3: CompositeBlock / complex-member identity policy (see
 * buildNodeIdentityMap's own doc comment for the full walk). Composite
 * nodes and their non-list members ("complex-member" — callout/blockquote)
 * are new OutlineTreeNode kinds (tree/buildOutlineTree.ts) on top of the
 * section/list design above; each gets its OWN identity segment
 * (`composite:...` / `complex-member:...`) and its own per-section
 * occurrence pool, scoped exactly like list nodes (nearest enclosing
 * section, not full ancestor path) — but a composite member that IS a list
 * item (the common "image + OCR" case) is deliberately identified as if it
 * were an ordinary top-level list item, NOT nested under its composite's
 * own path segment. This means a list item's fold identity is completely
 * unaffected by whether it currently happens to be grouped into a
 * composite — if the user edits the note so the composite's match
 * conditions no longer hold (e.g. inserts a blank line before the
 * callout), the CompositeBlock's own identity simply stops being produced
 * (its fold state, if any, is orphaned exactly like any other node whose
 * identity changes — see this file's section/list doc comment above), while
 * the underlying list item keeps its EXACT prior identity and fold state,
 * because that identity was never derived from the composite in the first
 * place.
 */
function nodeLabel(node: OutlineTreeNode): string {
  switch (node.kind) {
    case "section":
      return node.headingText;
    case "list":
      return node.text;
    case "composite":
    case "complex-member":
      return node.label;
  }
}

/** Appends an occurrence-disambiguated `kind:label` segment onto `basePath`,
 * tracking collisions via `occurrenceCount` (keyed by the caller — see call
 * sites for what scope `occurrenceCount` is shared across). */
function appendSegment(
  basePath: string,
  node: OutlineTreeNode,
  occurrenceCount: Map<string, number>
): string {
  const ownSegment = `${node.kind}:${nodeLabel(node)}`;
  const occurrence = occurrenceCount.get(ownSegment) ?? 0;
  occurrenceCount.set(ownSegment, occurrence + 1);
  const segment = occurrence === 0 ? ownSegment : `${ownSegment}#${occurrence}`;
  return basePath.length === 0 ? segment : `${basePath}/${segment}`;
}

/**
 * node.id -> identity path string, for every node in `tree` (regardless of
 * fold state — this must be computed from the FULL tree, not the visible
 * subset, since a node that's currently hidden under a collapsed ancestor
 * still needs a resolvable identity for when it's revealed again).
 *
 * Single recursive pass over the tree (an earlier version did two separate
 * full-tree traversals — one for sections, one for lists — which doubled
 * this function's cost for no semantic benefit; this refresh() runs on
 * essentially every keystroke/cursor-move via the existing debounced
 * refresh cycle, so that extra pass was a measurable, unnecessary
 * contributor to per-refresh cost on larger notes). `sectionPath` tracks
 * the nearest enclosing section's already-assigned identity as the walk
 * descends; `listOccurrence` is the SAME Map instance threaded through an
 * entire section's list nodes regardless of nesting depth (only replaced
 * with a fresh Map when a new section scope begins), which is what gives
 * list nodes their "scoped to the enclosing section, not the immediate
 * list-item parent" disambiguation pool (see module doc comment).
 */
/** One occurrence-disambiguation pool per node kind, all scoped to the nearest enclosing section (see this file's class doc comment). */
interface OccurrencePools {
  section: Map<string, number>;
  list: Map<string, number>;
  composite: Map<string, number>;
  complexMember: Map<string, number>;
}

function freshPools(): OccurrencePools {
  return { section: new Map(), list: new Map(), composite: new Map(), complexMember: new Map() };
}

export function buildNodeIdentityMap(tree: OutlineTreeNode[]): Map<string, string> {
  const map = new Map<string, string>();

  const walk = (
    nodes: OutlineTreeNode[],
    sectionPath: string,
    pools: OccurrencePools
  ): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case "section": {
          const path = appendSegment(sectionPath, node, pools.section);
          map.set(node.id, path);
          // A new section scope: fresh occurrence pools for its own child
          // sections and every kind of descendant reachable without
          // crossing into a nested section (list, composite, complex-member).
          walk(node.children, path, freshPools());
          break;
        }
        case "list": {
          const path = appendSegment(sectionPath, node, pools.list);
          map.set(node.id, path);
          // Nested list items (and any composite one of them happens to be
          // the first member of — see buildOutlineTree.ts's buildListNode)
          // stay in the SAME enclosing-section scope and the SAME pools
          // (passed through, not reset) — a list item's children are
          // always other list items or composites, never a section.
          walk(node.children, sectionPath, pools);
          break;
        }
        case "composite": {
          const path = appendSegment(sectionPath, node, pools.composite);
          map.set(node.id, path);
          // Members are identified in the composite's OWN enclosing-section
          // scope, NOT nested under this composite's `path` — see this
          // file's class doc comment for why a member's identity must stay
          // independent of its (possibly transient) composite membership.
          walk(node.children, sectionPath, pools);
          break;
        }
        case "complex-member": {
          const path = appendSegment(sectionPath, node, pools.complexMember);
          map.set(node.id, path);
          // No children (OutlineTreeComplexMemberNode.children is always []).
          break;
        }
      }
    }
  };
  walk(tree, "", freshPools());

  return map;
}

/**
 * Phase 3D stage 3: given a document line (0-indexed, matching every other
 * line number in this codebase — e.g. ParsedDocument's LineRange), returns
 * the id of the OutlineTreeNode whose own first line is EXACTLY that
 * line, or undefined if none matches.
 *
 * Deliberately EXACT match only, with no "previous line" fallback. Real-device
 * investigation confirmed that a CM6 fold/unfold effect's
 * `from` position was confirmed to always resolve — for both headings and
 * list items, in both Live Preview and Source Mode — to the end of the
 * folded node's own first line, never the line before or after. So the
 * caller (view/OutlineTreeView.ts's CM6 -> Outline Tree sync) only ever
 * needs to ask "which node starts exactly here", and a line with no exact
 * match should safely resolve to "no candidate" rather than guessing at a
 * neighboring node — consistent with this module's own occurrence-based
 * disambiguation and this codebase's "no-op over wrong result" philosophy
 * elsewhere (see docs/mixed-structure-spec.md's known-limitation section
 * for the same principle applied to a different feature).
 */
export function findNodeIdAtStartLine(
  tree: OutlineTreeNode[],
  zeroIndexedLine: number
): string | undefined {
  return flattenOutlineTree(tree).find((n) => n.line === zeroIndexedLine)?.id;
}
