/**
 * 2026-09-30 (image-ocr Previous/Next): real-assertion tests for the pure
 * tree/imageOcrNavigation.ts helpers behind the Partial Edit Pane's
 * image-ocr-only Previous/Next buttons (static wiring is covered in
 * tests/compositeBlockPartialEditUiWiring.test.ts). Fixtures mirror the
 * real "image + OCR transcript" note: task-list image embeds each followed
 * by an [!OCR] callout, mixed with an image-quote pair and plain lists.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockInfo, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { buildCompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import { extractCompositeBlockText } from "../src/edit/compositeBlockPartialEdit";
import {
  compositeMatchesAnchor,
  findCompositeSiblingTargets,
  IMAGE_OCR_NAVIGATION_RULE_IDS,
  listNavigableComposites,
} from "../src/tree/imageOcrNavigation";

function matchAll(text: string): CompositeBlockInfo[] {
  const doc = parseDocument(text);
  return matchCompositeBlocks(doc, scanComplexBlocks(doc), DEFAULT_COMPOSITE_BLOCK_RULES);
}

function ocr(name: string, body: string): string[] {
  return [`- [ ] ![[files/${name}.jpg]]`, "> [!OCR]", `> ${body}`, ""];
}

const NOTE = [
  "# 70000001_0018_裁判書 村境争論ノ控訴0",
  "",
  "## 記録",
  "",
  "- 保管裁判所 : (7000)札幌高等裁判所",
  "- 事件名 : 村境争論ノ控訴",
  "",
  ...ocr("p13", "不動長根境森ヨリ北兼平村領"),
  ...ocr("p07", "リ又被告第四號証ノ宝暦度絵図面"),
  "- ![[files/quote.jpg]]",
  "> 引用ブロック（image-quote）",
  "",
  ...ocr("p06", "スルヲ得ス又其弟貳項ハ"),
  "## 別節",
  "",
  ...ocr("p01", "十一日 明治十五年民弟拾六号"),
].join("\n");

const embedOf = (text: string, c: CompositeBlockInfo | null): string | null =>
  c ? text.split("\n")[c.range.startLine] : null;

describe("image-ocr navigation (tree/imageOcrNavigation.ts)", () => {
  it("is fixed to image-ocr only", () => {
    expect([...IMAGE_OCR_NAVIGATION_RULE_IDS]).toEqual(["image-ocr"]);
  });

  it("lists only image-ocr composites, in note order, across sections (image-quote and plain lists excluded)", () => {
    const all = matchAll(NOTE);
    expect(all.some((c) => c.ruleId === "image-quote")).toBe(true);
    const list = listNavigableComposites(all);
    expect(list.map((c) => c.ruleId)).toEqual(["image-ocr", "image-ocr", "image-ocr", "image-ocr"]);
    expect(list.map((c) => embedOf(NOTE, c))).toEqual([
      "- [ ] ![[files/p13.jpg]]",
      "- [ ] ![[files/p07.jpg]]",
      "- [ ] ![[files/p06.jpg]]",
      "- [ ] ![[files/p01.jpg]]",
    ]);
    // Order is by position, regardless of input order.
    expect(listNavigableComposites([...all].reverse()).map((c) => c.range.startLine)).toEqual(
      list.map((c) => c.range.startLine)
    );
  });

  it("first: previous null, next = second; middle: both neighbours (skipping the image-quote in between); last: next null", () => {
    const all = matchAll(NOTE);
    const [a, b, c, d] = listNavigableComposites(all);
    const first = findCompositeSiblingTargets(buildCompositeBlockSnapshot(a), all);
    expect(first.previous).toBeNull();
    expect(embedOf(NOTE, first.next)).toBe("- [ ] ![[files/p07.jpg]]");

    const middle = findCompositeSiblingTargets(buildCompositeBlockSnapshot(b), all);
    expect(embedOf(NOTE, middle.previous)).toBe("- [ ] ![[files/p13.jpg]]");
    expect(embedOf(NOTE, middle.next)).toBe("- [ ] ![[files/p06.jpg]]");

    // Crosses the section boundary (whole-note scope).
    const third = findCompositeSiblingTargets(buildCompositeBlockSnapshot(c), all);
    expect(embedOf(NOTE, third.next)).toBe("- [ ] ![[files/p01.jpg]]");

    const last = findCompositeSiblingTargets(buildCompositeBlockSnapshot(d), all);
    expect(embedOf(NOTE, last.previous)).toBe("- [ ] ![[files/p06.jpg]]");
    expect(last.next).toBeNull();
  });

  it("targets are whole image-ocr CompositeBlocks (never a member)", () => {
    const all = matchAll(NOTE);
    const [, b] = listNavigableComposites(all);
    const t = findCompositeSiblingTargets(buildCompositeBlockSnapshot(b), all);
    for (const target of [t.previous, t.next]) {
      expect(target?.ruleId).toBe("image-ocr");
      expect(target?.members.map((m) => m.kind)).toEqual(["single-line-list", "callout"]);
    }
  });

  it("empty for null/undefined current, an image-quote current, or a current that matches nothing", () => {
    const all = matchAll(NOTE);
    const quote = all.find((c) => c.ruleId === "image-quote")!;
    const empty = { previous: null, next: null };
    expect(findCompositeSiblingTargets(null, all)).toEqual(empty);
    expect(findCompositeSiblingTargets(undefined, all)).toEqual(empty);
    expect(findCompositeSiblingTargets(buildCompositeBlockSnapshot(quote), all)).toEqual(empty);
    const [a] = listNavigableComposites(all);
    const shifted = buildCompositeBlockSnapshot(a);
    shifted.range = { startLine: a.range.startLine + 1, endLine: a.range.endLine + 1 };
    expect(findCompositeSiblingTargets(shifted, all)).toEqual(empty);
    const badMember = buildCompositeBlockSnapshot(a);
    badMember.members[0] = { ...badMember.members[0], id: "no-such-id" };
    expect(findCompositeSiblingTargets(badMember, all)).toEqual(empty);
  });

  it("compositeMatchesAnchor requires every field, not just the positional id", () => {
    const all = matchAll(NOTE);
    const [a, b] = listNavigableComposites(all);
    expect(compositeMatchesAnchor(buildCompositeBlockSnapshot(a), a)).toBe(true);
    expect(compositeMatchesAnchor(buildCompositeBlockSnapshot(a), b)).toBe(false);
    expect(compositeMatchesAnchor({ ...buildCompositeBlockSnapshot(a), ruleId: "image-quote" }, a)).toBe(false);
  });

  it("post-Apply (image-ocr kept, body grew by a line): re-resolved anchor still finds recomputed neighbours at their shifted positions", () => {
    const all = matchAll(NOTE);
    const [, b] = listNavigableComposites(all);
    const edited = NOTE.replace("> リ又被告第四號証ノ宝暦度絵図面", "> リ又被告第四號証ノ宝暦度絵図面\n> （追記行）");
    const doc = parseDocument(edited);
    const extracted = extractCompositeBlockText(
      doc,
      { ...buildCompositeBlockSnapshot(b), range: { startLine: b.range.startLine, endLine: b.range.endLine + 1 }, members: [
        buildCompositeBlockSnapshot(b).members[0],
        { ...buildCompositeBlockSnapshot(b).members[1], range: { startLine: b.members[1].range.startLine, endLine: b.members[1].range.endLine + 1 } },
      ] },
      DEFAULT_COMPOSITE_BLOCK_RULES
    );
    expect(extracted.ok).toBe(true);
    const fresh = matchCompositeBlocks(doc, scanComplexBlocks(doc), DEFAULT_COMPOSITE_BLOCK_RULES);
    const t = findCompositeSiblingTargets(extracted.resolvedSnapshot, fresh);
    expect(embedOf(edited, t.previous)).toBe("- [ ] ![[files/p13.jpg]]");
    expect(embedOf(edited, t.next)).toBe("- [ ] ![[files/p06.jpg]]");
    // The next target's range moved by one line relative to the pre-edit parse.
    const oldNext = findCompositeSiblingTargets(buildCompositeBlockSnapshot(b), all).next!;
    expect(t.next!.range.startLine).toBe(oldNext.range.startLine + 1);
  });

  it("external change (heading inserted above): a fresh parse rebuilds the order and neighbours", () => {
    const changed = NOTE.replace("## 記録", "## 新しい節\n\n本文\n\n## 記録");
    const all = matchAll(changed);
    const list = listNavigableComposites(all);
    expect(list).toHaveLength(4);
    const t = findCompositeSiblingTargets(buildCompositeBlockSnapshot(list[1]), all);
    expect(embedOf(changed, t.previous)).toBe("- [ ] ![[files/p13.jpg]]");
    expect(embedOf(changed, t.next)).toBe("- [ ] ![[files/p06.jpg]]");
  });

  it("current composite disappears (callout removed, so it is no longer image-ocr): the old anchor matches nothing -> empty", () => {
    const all = matchAll(NOTE);
    const [, b] = listNavigableComposites(all);
    const broken = NOTE.replace("> [!OCR]\n> リ又被告第四號証ノ宝暦度絵図面\n", "");
    const fresh = matchAll(broken);
    expect(listNavigableComposites(fresh)).toHaveLength(3);
    expect(findCompositeSiblingTargets(buildCompositeBlockSnapshot(b), fresh)).toEqual({ previous: null, next: null });
  });

  it("a single image-ocr in the note has no neighbours in either direction", () => {
    const text = ["# A", "", ...ocr("only", "x")].join("\n");
    const all = matchAll(text);
    expect(findCompositeSiblingTargets(buildCompositeBlockSnapshot(all[0]), all)).toEqual({ previous: null, next: null });
  });
});
