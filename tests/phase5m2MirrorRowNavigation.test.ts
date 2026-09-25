import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { buildOutlineTree, flattenOutlineTree, isOutlineMirrorNode, OutlineTreeMirrorNode } from "../src/tree/buildOutlineTree";
import {
  MIRROR_SOURCE_JUMP_CLICK_SUPPRESS_MS,
  mirrorRowClickAction,
  mirrorRowClickLine,
  mirrorSourceJumpTarget,
  shouldSuppressMirrorRowClick,
} from "../src/view/mirrorRowNavigation";
import { LONG_PRESS_DURATION_MS } from "../src/tree/longPressGesture";
import { createTranslator } from "../src/i18n";

/**
 * Phase 5M-2 follow-up ("ミラー行のクリック先の変更", 案 C): a click / Enter
 * on a mirror row goes to its own embed line; the referenced block is
 * reached by "Go to mirror source" (context menu), a desktop double click,
 * or — on mobile — tapping the already-selected mirror row again.
 */

const J = (...lines: string[]) => lines.join("\n");
const NOTE = "Notes/test.md";

function mirrorRows(text: string): OutlineTreeMirrorNode[] {
  const doc = parseDocument(text);
  const blocks = scanComplexBlocks(doc).blocks;
  const tree = buildOutlineTree(doc, { includeLists: true, paragraphs: { blocks }, mirrors: { blocks, notePath: NOTE } });
  return flattenOutlineTree(tree).filter(isOutlineMirrorNode);
}

const FIXTURE = J(
  "## Source A", // 0
  "Source A body.", // 1
  "", // 2
  "## Sources", // 3
  "Paragraph source text. ^src-para", // 4
  "", // 5
  "> [!note] Callout source", // 6
  "> body", // 7
  "", // 8
  "^src-callout", // 9
  "", // 10
  "## Mirrors", // 11
  "![[#Source A]]", // 12
  "", // 13
  "![[#^src-para]]", // 14
  "", // 15
  "![[#^src-callout]]", // 16
  "", // 17
  "![[#^missing]]" // 18
);

describe("click / Enter target: the mirror's own embed line", () => {
  const rows = mirrorRows(FIXTURE);

  it("the fixture yields the four mirror rows in order", () => {
    expect(rows.map((r) => r.line)).toEqual([12, 14, 16, 18]);
  });

  it("a heading mirror's click line is its embed line, not the heading", () => {
    expect(mirrorRowClickLine(rows[0])).toBe(12);
    expect(rows[0].targetLine).toBe(0);
  });

  it("a block-id mirror (inline id) clicks to its embed line", () => {
    expect(mirrorRowClickLine(rows[1])).toBe(14);
  });

  it("a block-id mirror of a callout (standalone id line) clicks to its embed line — the real-device report", () => {
    expect(mirrorRowClickLine(rows[2])).toBe(16);
    expect(rows[2].targetLine).toBe(6);
  });

  it("an unresolved mirror clicks to its embed line too", () => {
    expect(mirrorRowClickLine(rows[3])).toBe(18);
  });
});

describe("Go to mirror source: the referenced block", () => {
  const rows = mirrorRows(FIXTURE);

  it("heading mirror -> the heading line", () => {
    expect(mirrorSourceJumpTarget(rows[0])).toEqual({ ok: true, line: 0 });
  });

  it("inline block-id mirror -> the paragraph carrying the id", () => {
    expect(mirrorSourceJumpTarget(rows[1])).toEqual({ ok: true, line: 4 });
  });

  it("standalone block-id line mirror -> the callout's first line (not the ^id line)", () => {
    expect(mirrorSourceJumpTarget(rows[2])).toEqual({ ok: true, line: 6 });
  });

  it("unresolved mirror -> refused with reason 'unresolved'", () => {
    expect(mirrorSourceJumpTarget(rows[3])).toEqual({ ok: false, reason: "unresolved" });
  });

  it("circular mirror -> refused with reason 'cycle'", () => {
    const cyc = mirrorRows(J("## A", "![[#A]]"));
    expect(cyc).toHaveLength(1);
    expect(cyc[0].status).toBe("cycle");
    expect(mirrorSourceJumpTarget(cyc[0])).toEqual({ ok: false, reason: "cycle" });
    expect(mirrorRowClickLine(cyc[0])).toBe(1);
  });
});

describe("mobile: tapping the already-selected mirror row again", () => {
  const base = { isMobile: true, treeHasFocus: true, alreadySelected: true, pressDurationMs: 80, longPressMs: LONG_PRESS_DURATION_MS };

  it("a short tap on the selected row jumps to the source", () => {
    expect(mirrorRowClickAction(base)).toBe("jump-to-source");
  });

  it("the first tap (row not yet selected) goes to the embed line", () => {
    expect(mirrorRowClickAction({ ...base, alreadySelected: false })).toBe("jump-to-embed");
  });

  it("a tap while the tree is not focused goes to the embed line", () => {
    expect(mirrorRowClickAction({ ...base, treeHasFocus: false })).toBe("jump-to-embed");
  });

  it("the release of a long press (context menu) never jumps to the source", () => {
    expect(mirrorRowClickAction({ ...base, pressDurationMs: LONG_PRESS_DURATION_MS })).toBe("jump-to-embed");
    expect(mirrorRowClickAction({ ...base, pressDurationMs: 2000 })).toBe("jump-to-embed");
  });

  it("an unknown press duration counts as a tap", () => {
    expect(mirrorRowClickAction({ ...base, pressDurationMs: null })).toBe("jump-to-source");
  });

  it("desktop: a click on the selected row still goes to the embed line (desktop uses double click)", () => {
    expect(mirrorRowClickAction({ ...base, isMobile: false })).toBe("jump-to-embed");
  });
});

describe("desktop double click: the trailing click is swallowed once", () => {
  const rec = { nodeId: "tree-mirror:2", time: 1000 };

  it("the click completing the double click on the same row is suppressed", () => {
    expect(shouldSuppressMirrorRowClick(rec, "tree-mirror:2", 1080)).toBe(true);
  });

  it("no record -> never suppressed", () => {
    expect(shouldSuppressMirrorRowClick(null, "tree-mirror:2", 1080)).toBe(false);
  });

  it("a click on a different row is not suppressed", () => {
    expect(shouldSuppressMirrorRowClick(rec, "tree-mirror:3", 1080)).toBe(false);
  });

  it("a click long after the double click is an ordinary click", () => {
    expect(shouldSuppressMirrorRowClick(rec, "tree-mirror:2", 1000 + MIRROR_SOURCE_JUMP_CLICK_SUPPRESS_MS + 1)).toBe(false);
  });

  it("a click timestamped before the recognizing press is not suppressed", () => {
    expect(shouldSuppressMirrorRowClick(rec, "tree-mirror:2", 999)).toBe(false);
  });
});

describe("i18n", () => {
  it("menu item and refusal notices exist in English and Japanese", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.goToMirrorSource")).toBe("Go to mirror source");
    expect(ja("tree.menu.goToMirrorSource")).toBe("参照先へ移動");
    for (const k of ["notice.mirrorSourceUnavailable.unresolved", "notice.mirrorSourceUnavailable.cycle"] as const) {
      expect(en(k)).toMatch(/^Unified Outliner: /);
      expect(ja(k)).toMatch(/^Unified Outliner: /);
    }
  });

  it("the setting description no longer says a click jumps to the referenced block", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("settings.showMirrorEmbedsInOutline.desc")).toContain("Go to mirror source");
    expect(en("settings.showMirrorEmbedsInOutline.desc")).not.toContain("Clicking the row jumps to the referenced");
    expect(ja("settings.showMirrorEmbedsInOutline.desc")).toContain("埋め込み行そのものへ移動");
  });
});

describe("view wiring (static source checks)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function body(signature: string): string {
    const start = viewTs.indexOf(signature);
    expect(start, signature).toBeGreaterThan(-1);
    return viewTs.slice(start, viewTs.indexOf("\n  }\n", start));
  }

  it("the menu's Go to mirror source item calls jumpToMirrorSource and is shown unavailable when there is no source", () => {
    const menu = body("private showMirrorMenu(");
    expect(menu).toContain("mirrorSourceJumpTarget(node)");
    expect(menu).toContain(".onClick(() => this.jumpToMirrorSource(nodeId))");
    expect(menu).toContain('this.plugin.t("tree.menu.unavailableSuffix")');
  });

  it("jumpToMirrorSource only moves the cursor (no write path) and keeps the tree focused", () => {
    const j = body("private jumpToMirrorSource(");
    expect(j).toContain("this.jumpToLine(node.id, target.line, { focusEditor: false });");
    expect(j).toMatch(/notice\.mirrorSourceUnavailable\.cycle/);
    expect(j).not.toMatch(/applyLineEditOutcome|replaceRange|setValue|pendingBlockCopy/);
  });

  it("desktop double click on a mirror row uses the shared pointerdown detector and jumps to the source", () => {
    expect(viewTs).toContain("const onDoubleClick = (): void => this.jumpToMirrorSource(node.id, pressTime);");
    expect(viewTs).toContain("this.handleRowPointerDownForDoubleClick(evt, node.id, collapseEl, dragHandleEl, onDoubleClick);");
  });

  it("the click handler checks double-click suppression and the mobile re-tap before the embed-line jump", () => {
    const i = viewTs.indexOf('selfEl.addEventListener("click", (evt) => {');
    expect(i).toBeGreaterThan(-1);
    const handler = viewTs.slice(i, viewTs.indexOf("\n    });\n", i));
    const suppress = handler.indexOf("shouldSuppressMirrorRowClick(");
    const retap = handler.indexOf("mirrorRowClickAction(");
    const jump = handler.indexOf("mirrorRowClickLine(node)");
    expect(suppress).toBeGreaterThan(-1);
    expect(retap).toBeGreaterThan(suppress);
    expect(jump).toBeGreaterThan(retap);
    expect(handler).toContain("longPressMs: LONG_PRESS_DURATION_MS");
  });

  it("mirror rows still get no rename or drag wiring", () => {
    expect(viewTs).not.toMatch(/isOutlineMirrorNode\(node\)[^\n]*(dragstart|draggable|beginRename)/);
  });
});
