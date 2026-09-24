/**
 * Phase 5M-0: circular-reference detection for single-note mirrors.
 *
 * A mirror embed E "contains" another mirror embed F when F's own embed
 * line lies inside E's resolved target range (`source.lineRange`) — so
 * rendering E would also render F. A cycle (E contains ... contains E) —
 * including the one-step case of an embed that sits inside the very
 * section/block it references — would make a rendered mirror recurse.
 *
 * The input is MirrorNode[] rather than bare MirrorSource[] because the
 * containment edge needs each embed's own position (`embedLine`), which a
 * MirrorSource (the referenced side only) does not carry. Unresolved
 * sources (`lineRange === null`) have no outgoing edges.
 *
 * A single DFS pass (Tarjan's SCC algorithm, i.e. a visited set plus the
 * current DFS stack) — linear in embeds + edges, ample for the single-note
 * scope of 5M-0. Pure, Obsidian-free.
 */
import { MirrorNode } from "./mirrorTypes";

export interface MirrorCycleReport {
  /** Every MirrorNode id that lies on at least one cycle. */
  cyclicIds: Set<string>;
  /** Each group of mutually-reachable embeds (one per strongly-connected component), ids in input order. */
  cycles: string[][];
}

export function detectMirrorCycle(mirrors: readonly MirrorNode[]): MirrorCycleReport {
  const edges = new Map<string, string[]>();
  for (const from of mirrors) {
    const range = from.source.lineRange;
    const out: string[] = [];
    if (range) {
      for (const to of mirrors) {
        if (to.embedLine >= range.startLine && to.embedLine <= range.endLine) out.push(to.id);
      }
    }
    edges.set(from.id, out);
  }

  // Tarjan's strongly-connected components: an embed is cyclic exactly
  // when its SCC has more than one member, or it has an edge to itself. A
  // plain "back edge seen while on the DFS stack" check would find at least
  // one cycle per component but could leave some members of a component
  // unmarked when they are reached through an already-finished node.
  const cyclicIds = new Set<string>();
  const cycles: string[][] = [];
  const order = new Map(mirrors.map((m, i) => [m.id, i] as const));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let counter = 0;

  const strongConnect = (id: string): void => {
    index.set(id, counter);
    low.set(id, counter);
    counter++;
    stack.push(id);
    onStack.add(id);
    for (const next of edges.get(id) ?? []) {
      if (!index.has(next)) {
        strongConnect(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id)!, index.get(next)!));
      }
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== id);
      const selfLoop = component.length === 1 && (edges.get(id) ?? []).includes(id);
      if (component.length > 1 || selfLoop) {
        component.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        cycles.push(component);
        for (const c of component) cyclicIds.add(c);
      }
    }
  };

  for (const m of mirrors) {
    if (!index.has(m.id)) strongConnect(m.id);
  }
  return { cyclicIds, cycles };
}
