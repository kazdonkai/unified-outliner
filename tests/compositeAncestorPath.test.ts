/**
 * 2026-09-30 (List+Callout breadcrumb): real-assertion tests for the pure
 * tree/compositeAncestorPath.ts#findCompositeBreadcrumbAncestors helper
 * that PartialEditView's loadCompositeInternal / performAutoReload /
 * applyEdit composite branch all share (see
 * tests/compositeBlockPartialEditUiWiring.test.ts for the static wiring
 * checks). Fixtures mirror the real "image + OCR transcript" note shape: a
 * task list item embedding an image, immediately followed by an [!OCR]
 * callout, under "# title" > "## 記録".
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockInfo, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ParsedDocument } from "../src/model/block";
import {
  BREADCRUMB_ENABLED_COMPOSITE_RULE_IDS,
  findCompositeBreadcrumbAncestors,
} from "../src/tree/compositeAncestorPath";
import { findAncestorPath } from "../src/tree/ancestorPath";

function composites(text: string): { doc: ParsedDocument; infos: CompositeBlockInfo[] } {
  const doc = parseDocument(text);
  const infos = matchCompositeBlocks(doc, scanComplexBlocks(doc), DEFAULT_COMPOSITE_BLOCK_RULES);
  return { doc, infos };
}

const OCR_NOTE = [
  "# 70000001_0018_裁判書 村境争論ノ控訴0",
  "",
  "## 記録",
  "",
  "- 保管裁判所 : (7000)札幌高等裁判所",
  "",
  "- [ ] ![[files/p13.jpg]]",
  "> [!OCR]",
  "> 不動長根境森ヨリ北兼平村領",
  "> 所は前第七條ノ如ク原告村内ナルヿ判然ナレ",
  "",
  "- [ ] ![[files/p07.jpg]]",
  "> [!OCR]",
  "> リ又被告第四號証ノ宝暦度絵図面ニ原被両村",
  "",
].join("\n");

describe("findCompositeBreadcrumbAncestors", () => {
  it("is fixed to image-ocr only", () => {
    expect([...BREADCRUMB_ENABLED_COMPOSITE_RULE_IDS]).toEqual(["image-ocr"]);
  });

  it("returns the two section ancestors for a task-list + callout (image-ocr) pair under a heading, anchored on the list member", () => {
    const { doc, infos } = composites(OCR_NOTE);
    const ocr = infos.filter((c) => c.ruleId === "image-ocr");
    expect(ocr).toHaveLength(2);
    for (const c of ocr) {
      const path = findCompositeBreadcrumbAncestors(doc, c);
      expect(path.map((a) => ({ kind: a.kind, label: a.label }))).toEqual([
        { kind: "section", label: "70000001_0018_裁判書 村境争論ノ控訴0" },
        { kind: "section", label: "記録" },
      ]);
      // Exactly findAncestorPath of the LIST member — no other anchor.
      expect(path).toEqual(findAncestorPath(doc, c.members[0].id));
    }
  });

  it("never includes the composite's own members, so every segment targets a section/parent list, never a CompositeBlock member", () => {
    const { doc, infos } = composites(OCR_NOTE);
    for (const c of infos) {
      const ids = findCompositeBreadcrumbAncestors(doc, c).map((a) => a.id);
      for (const m of c.members) expect(ids).not.toContain(m.id);
      for (const id of ids) expect(["section", "list"]).toContain(doc.nodes.get(id)?.type);
    }
  });

  it("returns [] for an image-quote (List + Quote) composite", () => {
    const { doc, infos } = composites(["# A", "", "## B", "", "- ![[x.jpg]]", "> quoted text", ""].join("\n"));
    const quote = infos.find((c) => c.ruleId === "image-quote");
    expect(quote).toBeDefined();
    expect(findCompositeBreadcrumbAncestors(doc, quote)).toEqual([]);
  });

  it("returns [] for a null/undefined anchor (e.g. after a structure-breaking Apply)", () => {
    const { doc } = composites(OCR_NOTE);
    expect(findCompositeBreadcrumbAncestors(doc, null)).toEqual([]);
    expect(findCompositeBreadcrumbAncestors(doc, undefined)).toEqual([]);
  });

  it("returns [] when the list member no longer resolves, or the first member is not a list", () => {
    const { doc, infos } = composites(OCR_NOTE);
    const c = infos[0];
    expect(
      findCompositeBreadcrumbAncestors(doc, { ruleId: "image-ocr", members: [{ kind: "single-line-list", id: "no-such-id" }] })
    ).toEqual([]);
    expect(
      findCompositeBreadcrumbAncestors(doc, { ruleId: "image-ocr", members: [{ kind: "callout", id: c.members[0].id }] })
    ).toEqual([]);
    expect(findCompositeBreadcrumbAncestors(doc, { ruleId: "image-ocr", members: [] })).toEqual([]);
    // A section id in the list slot is refused too (not a list node).
    const sectionId = findAncestorPath(doc, c.members[0].id)[0].id;
    expect(
      findCompositeBreadcrumbAncestors(doc, { ruleId: "image-ocr", members: [{ kind: "single-line-list", id: sectionId }] })
    ).toEqual([]);
  });

  it("post-Apply, resolvedSnapshot kept: re-matching the edited note yields the same ancestors", () => {
    const edited = OCR_NOTE.replace("> 不動長根境森ヨリ北兼平村領", "> 不動長根境森ヨリ北兼平村領（修正）");
    const { doc, infos } = composites(edited);
    expect(findCompositeBreadcrumbAncestors(doc, infos[0]).map((a) => a.label)).toEqual([
      "70000001_0018_裁判書 村境争論ノ控訴0",
      "記録",
    ]);
  });

  it("post-Apply, rule no longer matches (anchor null): the callout was removed, no image-ocr composite remains there and a null anchor clears the path", () => {
    const broken = OCR_NOTE.replace("> [!OCR]\n> 不動長根境森ヨリ北兼平村領\n> 所は前第七條ノ如ク原告村内ナルヿ判然ナレ\n", "");
    const { doc, infos } = composites(broken);
    expect(infos.filter((c) => c.ruleId === "image-ocr")).toHaveLength(1);
    expect(findCompositeBreadcrumbAncestors(doc, null)).toEqual([]);
  });

  it("auto-reload: an external heading rename above is picked up on re-derivation from the fresh doc", () => {
    const renamed = OCR_NOTE.replace("## 記録", "## 記録（改）");
    const { doc, infos } = composites(renamed);
    expect(findCompositeBreadcrumbAncestors(doc, infos[0]).map((a) => a.label)).toEqual([
      "70000001_0018_裁判書 村境争論ノ控訴0",
      "記録（改）",
    ]);
  });
});
