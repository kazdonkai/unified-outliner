import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  TREE_ROW_SELECTED_CLASSES,
  syncTreeSelectionDom,
  treeRowDomId,
  type SelectionRootElement,
  type SelectionRowElement,
} from "../src/view/treeSelectionDom";
import { TreePointerRefreshGate, type RefreshGateScheduler } from "../src/view/treePointerRefreshGate";

/**
 * Issue #4 (1.0.8): the first click on an unfocused Outline Tree was
 * swallowed because the tree DOM was rebuilt between pointerdown and click
 * (focus handler's renderTree(), or a debounced refresh() landing mid-press).
 * OutlineTreeView cannot be constructed in vitest ("obsidian" is types-only
 * here), so — like rowDoubleClickDetector / mobileCompositeDragHandle — the
 * logic lives in two pure modules tested directly, plus static source checks
 * on how OutlineTreeView wires them.
 */

class FakeRow implements SelectionRowElement {
  readonly classes = new Set<string>();
  readonly attrs = new Map<string, string>();
  constructor(public id: string) {}
  classList = {
    add: (...tokens: string[]) => tokens.forEach((t) => this.classes.add(t)),
    remove: (...tokens: string[]) => tokens.forEach((t) => this.classes.delete(t)),
  };
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
}

class FakeRoot implements SelectionRootElement {
  readonly attrs = new Map<string, string>();
  selectorsSeen: string[] = [];
  constructor(public rows: FakeRow[]) {}
  querySelectorAll(selectors: string): ArrayLike<SelectionRowElement> {
    this.selectorsSeen.push(selectors);
    return this.rows;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
}

/** Rows as renderNode leaves them: aria-selected on every row, selected classes on at most one. */
function renderedTree(ids: string[], selected: string | null): FakeRoot {
  const rows = ids.map((id) => {
    const row = new FakeRow(treeRowDomId(id));
    row.classes.add("tree-item-self");
    const isSel = id === selected;
    if (isSel) TREE_ROW_SELECTED_CLASSES.forEach((c) => row.classes.add(c));
    row.setAttribute("aria-selected", isSel ? "true" : "false");
    return row;
  });
  const root = new FakeRoot(rows);
  if (selected !== null) root.setAttribute("aria-activedescendant", treeRowDomId(selected));
  return root;
}

function selectedState(root: FakeRoot): { classed: string[]; ariaTrue: string[]; active: string | undefined } {
  return {
    classed: root.rows.filter((r) => TREE_ROW_SELECTED_CLASSES.every((c) => r.classes.has(c))).map((r) => r.id),
    ariaTrue: root.rows.filter((r) => r.attrs.get("aria-selected") === "true").map((r) => r.id),
    active: root.attrs.get("aria-activedescendant"),
  };
}

describe("Issue #4: syncTreeSelectionDom (in-place selection highlight)", () => {
  it("marks the selected row exactly like renderNode: both classes, aria-selected=true, root aria-activedescendant", () => {
    const root = renderedTree(["0", "1", "2"], null);
    expect(syncTreeSelectionDom(root, "1")).toBe(true);
    expect(selectedState(root)).toEqual({ classed: [treeRowDomId("1")], ariaTrue: [treeRowDomId("1")], active: treeRowDomId("1") });
    expect(root.rows[0].attrs.get("aria-selected")).toBe("false");
    expect(root.rows[2].attrs.get("aria-selected")).toBe("false");
    expect(root.selectorsSeen).toEqual(['[role="treeitem"]']);
  });

  it("moves the selection: the previously selected row loses its classes and goes back to aria-selected=false", () => {
    const root = renderedTree(["0", "1", "2"], "0");
    expect(syncTreeSelectionDom(root, "2")).toBe(true);
    expect(selectedState(root)).toEqual({ classed: [treeRowDomId("2")], ariaTrue: [treeRowDomId("2")], active: treeRowDomId("2") });
    expect(root.rows[0].classes.has("tree-item-self")).toBe(true);
  });

  it("null (blur) clears every selected mark and removes aria-activedescendant", () => {
    const root = renderedTree(["0", "1"], "1");
    expect(syncTreeSelectionDom(root, null)).toBe(true);
    expect(selectedState(root)).toEqual({ classed: [], ariaTrue: [], active: undefined });
    expect(root.rows.every((r) => r.attrs.get("aria-selected") === "false")).toBe(true);
  });

  it("null on an empty tree (empty-state message, no rows) is a safe no-op", () => {
    const root = new FakeRoot([]);
    root.setAttribute("aria-activedescendant", "stale");
    expect(syncTreeSelectionDom(root, null)).toBe(true);
    expect(root.attrs.has("aria-activedescendant")).toBe(false);
  });

  it("returns false and changes nothing when the selected row is not rendered (caller falls back to renderTree)", () => {
    const root = renderedTree(["0", "1"], "0");
    const before = JSON.stringify(selectedState(root));
    expect(syncTreeSelectionDom(root, "9")).toBe(false);
    expect(JSON.stringify(selectedState(root))).toBe(before);
  });

  it("is idempotent: syncing the already-shown selection leaves the same state", () => {
    const root = renderedTree(["0", "1"], "1");
    expect(syncTreeSelectionDom(root, "1")).toBe(true);
    expect(selectedState(root)).toEqual({ classed: [treeRowDomId("1")], ariaTrue: [treeRowDomId("1")], active: treeRowDomId("1") });
  });
});

class FakeScheduler implements RefreshGateScheduler {
  private next = 1;
  readonly queued = new Map<number, () => void>();
  schedule(callback: () => void): number {
    const handle = this.next++;
    this.queued.set(handle, callback);
    return handle;
  }
  cancel(handle: number): void {
    this.queued.delete(handle);
  }
  runAll(): void {
    const callbacks = [...this.queued.values()];
    this.queued.clear();
    callbacks.forEach((cb) => cb());
  }
}

/** A refresh() stand-in that, like the real one, asks the gate first. */
function setup() {
  const scheduler = new FakeScheduler();
  let rebuilds = 0;
  let disposedViewTouched = false;
  let closed = false;
  // eslint-disable-next-line prefer-const
  let gate: TreePointerRefreshGate;
  const refresh = (): void => {
    if (gate.deferRefreshIfPointerActive()) return;
    if (closed) disposedViewTouched = true;
    rebuilds++;
  };
  gate = new TreePointerRefreshGate(refresh, scheduler);
  return {
    scheduler,
    gate,
    refresh,
    rebuilds: () => rebuilds,
    close: () => {
      gate.dispose();
      closed = true;
    },
    disposedViewTouched: () => disposedViewTouched,
  };
}

describe("Issue #4: TreePointerRefreshGate (no rebuild while a tree press is down)", () => {
  it("refresh runs normally when no press is active", () => {
    const t = setup();
    t.refresh();
    expect(t.rebuilds()).toBe(1);
    expect(t.gate.hasPendingRefresh()).toBe(false);
  });

  it("refresh during a press is deferred: no rebuild, a refresh is owed", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.refresh();
    expect(t.rebuilds()).toBe(0);
    expect(t.gate.hasPendingRefresh()).toBe(true);
    expect(t.scheduler.queued.size).toBe(0);
  });

  it("after pointerup the owed refresh runs exactly once — on a later task, never inside pointerup", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.refresh();
    t.refresh();
    t.refresh();
    t.gate.pointerReleased(1);
    expect(t.rebuilds()).toBe(0); // same task as pointerup/click
    expect(t.scheduler.queued.size).toBe(1);
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
    expect(t.gate.hasPendingRefresh()).toBe(false);
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
  });

  it("pointercancel (same release path) also flushes once", () => {
    const t = setup();
    t.gate.pointerDown(7, true);
    t.refresh();
    t.gate.pointerReleased(7);
    t.gate.pointerReleased(7); // a later lostpointercapture for the same id is a no-op
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
  });

  it("a release with nothing owed schedules nothing", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.gate.pointerReleased(1);
    expect(t.scheduler.queued.size).toBe(0);
    expect(t.rebuilds()).toBe(0);
  });

  it("a new press before the flush runs cancels it; the refresh stays owed until that press ends", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.refresh();
    t.gate.pointerReleased(1);
    t.gate.pointerDown(1, true);
    expect(t.scheduler.queued.size).toBe(0);
    expect(t.gate.hasPendingRefresh()).toBe(true);
    t.gate.pointerReleased(1);
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
  });

  it("a normal refresh that runs after the press covers what was owed (no second rebuild)", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.refresh();
    t.gate.pointerReleased(1);
    t.refresh(); // e.g. the click's own jump, or the debounced refresh
    expect(t.rebuilds()).toBe(1);
    expect(t.scheduler.queued.size).toBe(0);
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
  });

  it("multi-touch: stays deferred until the last pointer is released", () => {
    const t = setup();
    t.gate.pointerDown(10, true);
    t.gate.pointerDown(11, false);
    t.refresh();
    t.gate.pointerReleased(10);
    expect(t.gate.isPointerActive()).toBe(true);
    expect(t.scheduler.queued.size).toBe(0);
    t.gate.pointerReleased(11);
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
  });

  it("a new primary press drops pointer ids whose release was never seen (state cannot stick)", () => {
    const t = setup();
    t.gate.pointerDown(20, true); // release lost
    t.gate.pointerDown(21, true);
    t.gate.pointerReleased(21);
    expect(t.gate.isPointerActive()).toBe(false);
  });

  it("drag start / drag end / window blur (releaseAll) end the press and flush once", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.refresh();
    t.gate.releaseAll(); // dragstart
    t.gate.releaseAll(); // dragend — nothing active any more, no second flush
    expect(t.scheduler.queued.size).toBe(1);
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
    expect(t.gate.isPointerActive()).toBe(false);
  });

  it("close/unload: owed refresh and queued flush are dropped and the closed view is never touched", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.refresh();
    t.gate.pointerReleased(1);
    expect(t.scheduler.queued.size).toBe(1);
    t.close();
    expect(t.scheduler.queued.size).toBe(0);
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(0);
    expect(t.disposedViewTouched()).toBe(false);
    expect(t.gate.hasPendingRefresh()).toBe(false);
    // Events after close are ignored and never defer.
    t.gate.pointerDown(2, true);
    expect(t.gate.isPointerActive()).toBe(false);
    expect(t.gate.deferRefreshIfPointerActive()).toBe(false);
  });

  it("a flush that is already running cannot loop: the refresh it triggers is not deferred again", () => {
    const t = setup();
    t.gate.pointerDown(1, true);
    t.refresh();
    t.gate.pointerReleased(1);
    t.scheduler.runAll();
    t.scheduler.runAll();
    expect(t.rebuilds()).toBe(1);
    expect(t.scheduler.queued.size).toBe(0);
  });
});

describe("Issue #4: OutlineTreeView wiring (static source checks)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function slice(startMarker: string, endMarker: string): string {
    const start = viewTs.indexOf(startMarker);
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf(endMarker, start + startMarker.length);
    expect(end).toBeGreaterThan(start);
    return viewTs.slice(start, end);
  }

  it("focus handler: rename guard kept, ensureSelection then in-place sync — no renderTree()", () => {
    const body = slice('this.registerDomEvent(this.treeRootEl, "focus", () => {', "\n    });");
    expect(body).toContain("if (this.renameState) return;");
    expect(body).toContain("this.hasFocus = true;");
    expect(body.indexOf("this.ensureSelection();")).toBeLessThan(body.indexOf("this.syncSelectionHighlight();"));
    expect(body).not.toContain("this.renderTree()");
  });

  it("blur handler: rename guard kept, hasFocus=false then in-place sync — no renderTree()", () => {
    const body = slice('this.registerDomEvent(this.treeRootEl, "blur", () => {', "\n    });");
    expect(body).toContain("if (this.renameState) return;");
    expect(body).toContain("this.hasFocus = false;");
    expect(body).toContain("this.syncSelectionHighlight();");
    expect(body).not.toContain("this.renderTree()");
  });

  it("syncSelectionHighlight shows the selection only while focused and falls back to renderTree() only when sync fails", () => {
    const body = slice("private syncSelectionHighlight(): void {", "\n  }");
    expect(body).toContain("syncTreeSelectionDom(this.treeRootEl, this.hasFocus ? this.selectedId : null)");
    expect(body).toContain("this.renderTree();");
  });

  it("renderNode uses the shared selected-row classes and row id (single source of truth)", () => {
    expect(viewTs).toContain('(isSelected ? ` ${TREE_ROW_SELECTED_CLASSES.join(" ")}` : "")');
    expect(viewTs).toContain("selfEl.id = treeRowDomId(node.id);");
    expect(viewTs).not.toContain('" is-selected unified-outliner-selected"');
    expect(viewTs).toContain('selfEl.setAttribute("aria-selected", isSelected ? "true" : "false");');
    expect(TREE_ROW_SELECTED_CLASSES).toEqual(["is-selected", "unified-outliner-selected"]);
    expect(treeRowDomId("3")).toBe("unified-outliner-row-3");
  });

  it("refresh() asks the gate before anything else (before drag-session cancels and the rename guard)", () => {
    const body = slice("  refresh(): void {", "\n  }\n");
    const gateIdx = body.indexOf("if (this.pointerRefreshGate.deferRefreshIfPointerActive()) return;");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(body.indexOf("this.cancelParagraphDrag();"));
    expect(gateIdx).toBeLessThan(body.indexOf("if (this.renameState) return;"));
  });

  it("onOpen tracks tree presses and every way a press ends, all via registerDomEvent", () => {
    const body = slice("async onOpen(): Promise<void> {", "\n  async onClose(");
    expect(body).toMatch(/registerDomEvent\(\s*this\.treeRootEl,\s*"pointerdown"/);
    expect(body).toContain("this.pointerRefreshGate.pointerDown(evt.pointerId, evt.isPrimary);");
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      expect(body).toContain(`this.registerDomEvent(treeDoc, "${type}", releasePointer, { capture: true });`);
    }
    expect(body).toContain('this.registerDomEvent(this.treeRootEl, "dragstart", () => this.pointerRefreshGate.releaseAll(), { capture: true });');
    expect(body).toContain('this.registerDomEvent(this.treeRootEl, "dragend", () => this.pointerRefreshGate.releaseAll(), { capture: true });');
    expect(body).toContain('this.registerDomEvent(this.treeRootEl.win, "blur", () => this.pointerRefreshGate.releaseAll());');
  });

  it("the owed refresh is scheduled on a later task (setTimeout 0 of the tree's window), not run synchronously", () => {
    expect(viewTs).toContain("schedule: (callback) => this.treeRootEl.win.setTimeout(callback, 0),");
    expect(viewTs).toContain("cancel: (handle) => this.treeRootEl.win.clearTimeout(handle),");
  });

  it("onClose disposes the gate first", () => {
    const body = slice("async onClose(): Promise<void> {", "\n  }\n");
    const disposeIdx = body.indexOf("this.pointerRefreshGate.dispose();");
    expect(disposeIdx).toBeGreaterThan(-1);
    expect(disposeIdx).toBeLessThan(body.indexOf("if (this.renameState) this.cancelRename();"));
  });

  it("the scheduleRefresh debounce and its triggers are unchanged", () => {
    expect(viewTs).toContain("private readonly scheduleRefresh = debounce(\n    () => this.refresh(),\n    150,\n    true\n  );");
    expect(viewTs).toContain('this.registerDomEvent(document, "keyup", this.scheduleRefresh);');
    expect(viewTs).toContain('this.registerDomEvent(document, "mouseup", this.scheduleRefresh);');
  });

  it("toggleCollapse (chevron click) still rebuilds via renderTree — the click itself is the action", () => {
    const body = slice("private toggleCollapse(id: string): void {", "\n  }");
    expect(body).toContain("this.renderTree();");
  });
});
