/**
 * v1.0.4 (Tree + Partial Edit phase): static source checks for the
 * "List + Paragraph" wiring in OutlineTreeView / PartialEditView /
 * settings — the read-only contract (no drag handle, no drag & drop, no
 * structural menu, no rename) and the single "Open in Partial Edit" entry.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const treeTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
const paneTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
const settingsTs = readFileSync(path.resolve(__dirname, "../src/settings.ts"), "utf-8");

function methodBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n  }\n", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("OutlineTreeView: tree-read-only composite rows", () => {
  const render = methodBody(treeTs, "  private renderNode(");

  it("no drag handle and no drag & drop wiring for a tree-read-only composite (gated by isOperableComposite)", () => {
    expect(render).toContain("const isOperableComposite = isComposite && node.allowsStructuralOps;");
    expect(render).toContain("if (!readOnly || isOperableComposite || isEligibleStandaloneComplexMember || isParagraph) {");
    expect(render).toContain("} else if (isOperableComposite) {");
    const dragChainCompositeBranches = render.split("handleCompositeDragStart(").length - 1;
    expect(dragChainCompositeBranches).toBe(1);
  });

  it("the parent row and its member rows get ONLY the read-only composite menu, checked before every other menu branch", () => {
    const idx = render.indexOf("if (readOnlyCompositeId !== null) {");
    const sectionIdx = render.indexOf("} else if (!readOnly && isOutlineSectionNode(node)) {");
    expect(idx).toBeGreaterThan(-1);
    expect(sectionIdx).toBeGreaterThan(idx);
    expect(render.slice(idx, sectionIdx)).toContain("this.showReadOnlyCompositeMenu(evt, readOnlyCompositeId);");
    expect(render).toContain(
      "isComposite && !node.allowsStructuralOps ? node.id : this.readOnlyCompositeIdByMemberId.get(node.id) ?? null;"
    );
  });

  it("mobile long-press on a tree-read-only composite row opens the read-only menu, never the structural one", () => {
    expect(render).toContain(
      "if (readOnlyCompositeId !== null) this.showReadOnlyCompositeMenu(menuEvt, readOnlyCompositeId);\n          else this.showCompositeCommandMenu(menuEvt, node.id);"
    );
  });

  it("showReadOnlyCompositeMenu offers exactly one item — Open in Partial Edit — and nothing structural", () => {
    const body = methodBody(treeTs, "  private showReadOnlyCompositeMenu(");
    expect(body.split("menu.addItem(").length - 1).toBe(1);
    expect(body).toContain('this.plugin.t("tree.menu.openCompositeInPartialEdit")');
    expect(body).toContain("node.allowsStructuralOps) return;");
    for (const banned of ["Move", "Delete", "delete", "Copy", "Rename", "addBlockCopyMenuItems", "dispatchAndApply"]) {
      expect(body).not.toContain(banned);
    }
  });

  it("move / delete / drag / copy logic keeps seeing only the operable composites", () => {
    expect(treeTs).toContain("this.currentComposites = infos.filter((c) => operableRuleIds.has(c.ruleId));");
    expect(treeTs).toContain("const enabledRules = getEnabledTreeCompositeBlockRules(this.plugin.settings.compositeBlocks);");
  });

  it("rename (double-click / F2 / menu / auto-rename) stays refused for composite rows and read-only rows", () => {
    const body = methodBody(treeTs, "  private beginRenameForNode(");
    expect(body).toContain('if (node.kind !== "section" && node.kind !== "list") return;');
    expect(body).toContain("if (this.readOnlyNodeIds.has(nodeId)) return;");
  });
});

describe("PartialEditView: List + Paragraph session", () => {
  it("composite sessions resolve against the Tree rule set everywhere", () => {
    expect(paneTs).not.toContain("getEnabledCompositeBlockRules(");
    expect(paneTs.split("getEnabledTreeCompositeBlockRules(this.plugin.settings.compositeBlocks)").length - 1).toBe(5);
  });

  it("the textarea shows the paragraph body and the paragraph's block id is edited in the ordinary Block ID field (1.0.6)", () => {
    expect(paneTs).toContain("if (this.listParagraphProjection) return this.listParagraphProjection.body;");
    const install = methodBody(paneTs, "  private installListParagraphProjection(");
    expect(install).toContain("this.blockIdFieldEligible = projection !== null;");
    expect(install).toContain("this.loadedBlockId = projection ? projection.blockId : null;");
    const row = methodBody(paneTs, "  private renderBlockIdRow(");
    expect(row).not.toContain("readOnly = true");
    const apply = paneTs.slice(paneTs.indexOf("if (this.listParagraphProjection && this.compositeListOriginalText !== null) {"));
    expect(apply).toContain("const requestedId = this.blockIdForApply();");
    expect(apply).toContain('new Notice(this.plugin.t("reason.invalid-block-id"));');
    expect(apply).toContain("composeListParagraphText(this.listParagraphProjection, rawListLine, this.textareaEl.value, newBlockId)");
  });

  it("a renamed id also rewrites same-note mirror embeds: the composite Apply diffs against the live lines and notifies", () => {
    const branch = paneTs.slice(paneTs.indexOf("const outcome = applyCompositeBlockEdit("));
    const upto = branch.slice(0, branch.indexOf("// Phase 5D-2A: re-anchor from outcome.resolvedSnapshot"));
    expect(upto).toContain("this.notifyBlockIdRename(blockIdRename);");
    expect(upto).toContain("liveLines,");
  });

  it("the list row is shown marker-free via buildCompositeListMemberProjection and inverted back on Apply", () => {
    const body = methodBody(paneTs, "  private installListParagraphProjection(");
    expect(body).toContain("buildCompositeListMemberProjection(projection.listLine)");
    expect(body).toContain("this.listMarkerProjection ? this.listMarkerProjection.body : projection.listLine");
    const apply = paneTs.slice(paneTs.indexOf("if (this.listParagraphProjection && this.compositeListOriginalText !== null) {"));
    const invert = apply.indexOf("invertListMarkerProjection(this.listMarkerProjection, this.compositeListInputEl.value)");
    const compose = apply.indexOf("composeListParagraphText(this.listParagraphProjection, rawListLine, this.textareaEl.value, newBlockId)");
    expect(invert).toBeGreaterThan(-1);
    expect(compose).toBeGreaterThan(invert);
  });

  it("Apply composes, then refuses before writing when the id would leave the paragraph", () => {
    const apply = paneTs.slice(paneTs.indexOf("const composed = composeListParagraphText("));
    expect(apply.length).toBeLessThan(paneTs.length);
    const guard = apply.indexOf("verifyBlockIdStaysInParagraph(candidateLines");
    const write = apply.indexOf("const outcome = applyCompositeBlockEdit(");
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(guard);
    expect(apply.slice(0, write)).toContain('this.plugin.t("partialEdit.listParagraphBlockIdWouldMove"');
  });
});

describe("settings: List + Paragraph toggle", () => {
  it("refreshes open Outline Trees, like the two other rule toggles", () => {
    const start = settingsTs.indexOf('this.plugin.t("settings.compositeBlockListParagraph.name")');
    expect(start).toBeGreaterThan(-1);
    const block = settingsTs.slice(start, settingsTs.indexOf(");\n", settingsTs.indexOf("refreshOutlineTreeViews", start)));
    expect(block).toContain("this.plugin.settings.compositeBlocks.listParagraph = v;");
    expect(block).toContain("this.plugin.refreshOutlineTreeViews(");
  });
});
