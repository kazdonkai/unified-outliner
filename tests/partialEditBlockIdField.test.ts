import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  applySubtreeEdit,
  detectBlockIdLayout,
  extractBlockIdAfterRange,
  extractSubtreeText,
  joinInlineBlockId,
  normalizeBlockIdInput,
  stripInlineBlockId,
} from "../src/edit/partialEdit";
import { resolveParagraphAtCursor } from "../src/resolver/resolveParagraphAtCursor";
import {
  applyParagraphEdit,
  buildParagraphEditAnchor,
  resolveParagraphAnchorText,
} from "../src/edit/paragraphPartialEdit";
import { mirrorReferencesForTarget } from "../src/mirror/mirrorOps";
import { createTranslator } from "../src/i18n";

/**
 * Partial Edit Pane: the block id (`^id`) is separated from the body text
 * and edited in its own Block ID field (paragraph, callout, blockquote,
 * fenced-code, table). See docs/partial-edit-block-id-field-design-memo.md.
 */

const J = (...lines: string[]) => lines.join("\n");

function blockOf(text: string, kind: string) {
  const doc = parseDocument(text);
  const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === kind && b.editability === "supported");
  if (!info) throw new Error(`no ${kind}`);
  return { doc, info };
}

function paragraphAt(text: string, line: number) {
  const doc = parseDocument(text);
  const r = resolveParagraphAtCursor(doc, line);
  if (!r.paragraph) throw new Error("no paragraph");
  return { doc, paragraph: r.paragraph, anchor: buildParagraphEditAnchor(doc, r.paragraph) };
}

// ---------------------------------------------------------------------------
describe("stripInlineBlockId", () => {
  it("detects and removes an inline suffix (and the space before it)", () => {
    expect(stripInlineBlockId("Paragraph source text. ^src-para")).toEqual({
      body: "Paragraph source text.",
      blockId: "src-para",
    });
  });

  it("removes trailing whitespace after the id too", () => {
    expect(stripInlineBlockId("text ^abc-1   ")).toEqual({ body: "text", blockId: "abc-1" });
  });

  it("passes text without an id through unchanged", () => {
    expect(stripInlineBlockId("no id here")).toEqual({ body: "no id here", blockId: null });
    expect(stripInlineBlockId("price is 5^2")).toEqual({ body: "price is 5^2", blockId: null });
  });

  it("only looks at the LAST line of a multi-line text", () => {
    expect(stripInlineBlockId(J("first ^not-this", "second line ^uo-abcd1234"))).toEqual({
      body: J("first ^not-this", "second line"),
      blockId: "uo-abcd1234",
    });
    expect(stripInlineBlockId(J("first ^x", "second"))).toEqual({ body: J("first ^x", "second"), blockId: null });
  });

  it("works on a callout's last line", () => {
    expect(stripInlineBlockId(J("> [!note] T", "> body ^cid"))).toEqual({ body: J("> [!note] T", "> body"), blockId: "cid" });
  });
});

describe("joinInlineBlockId", () => {
  it("appends ' ^id' to the last line", () => {
    expect(joinInlineBlockId(J("a", "b"), "id-1")).toBe(J("a", "b ^id-1"));
  });

  it("returns the body unchanged for a null id", () => {
    expect(joinInlineBlockId("body", null)).toBe("body");
  });

  it("round-trips with stripInlineBlockId", () => {
    for (const [body, id] of [
      ["single", "x1"],
      [J("line 1", "line 2"), "uo-12345678"],
      ["> quote", "q"],
    ] as const) {
      expect(stripInlineBlockId(joinInlineBlockId(body, id))).toEqual({ body, blockId: id });
    }
    const text = "Paragraph ^p";
    const s = stripInlineBlockId(text);
    expect(joinInlineBlockId(s.body, s.blockId)).toBe(text);
  });
});

describe("extractBlockIdAfterRange", () => {
  const lines = ["> [!note] T", "> body", "^src-callout", "", "next"];

  it("detects a lone ^id line right after the range", () => {
    expect(extractBlockIdAfterRange(lines, 1)).toBe("src-callout");
  });

  it("returns null when the next line is not a lone id", () => {
    expect(extractBlockIdAfterRange(lines, 0)).toBeNull();
    expect(extractBlockIdAfterRange(["text", "text ^id"], 0)).toBeNull();
    expect(extractBlockIdAfterRange(["a", ""], 0)).toBeNull();
  });

  it("returns null past the end of the note", () => {
    expect(extractBlockIdAfterRange(["a"], 0)).toBeNull();
  });
});

describe("detectBlockIdLayout / normalizeBlockIdInput", () => {
  it("finds a standalone id after one blank line (the Create mirror layout)", () => {
    const lines = ["> body", "", "^uo-abc", "", "next"];
    expect(detectBlockIdLayout(lines, 0, 0, { inline: true })).toEqual({
      blockId: "uo-abc",
      standalone: true,
      bodyEndLine: 0,
      idLine: 2,
    });
  });

  it("a paragraph's own trailing lone id line", () => {
    expect(detectBlockIdLayout(["text", "^p1"], 0, 1, { inline: true })).toEqual({
      blockId: "p1",
      standalone: true,
      bodyEndLine: 0,
      idLine: 1,
    });
  });

  it("inline detection is skipped for fenced code (a ^x at the end of code is code)", () => {
    expect(detectBlockIdLayout(["```", "x ^notid", "```"], 0, 2, { inline: false }).blockId).toBeNull();
  });

  it("an id-only single line is not treated as a block with an id", () => {
    expect(detectBlockIdLayout(["^lonely"], 0, 0, { inline: true }).blockId).toBeNull();
  });

  it("normalizes the field value", () => {
    expect(normalizeBlockIdInput("  ^abc-1 ")).toEqual({ ok: true, blockId: "abc-1" });
    expect(normalizeBlockIdInput("")).toEqual({ ok: true, blockId: null });
    expect(normalizeBlockIdInput(null)).toEqual({ ok: true, blockId: null });
    expect(normalizeBlockIdInput("has space")).toEqual({ ok: false });
    expect(normalizeBlockIdInput("a_b")).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------
describe("extractSubtreeText: block id separated from text", () => {
  it("callout + standalone id after a blank line (Create mirror layout)", () => {
    const { doc, info } = blockOf(J("> [!note] Callout source", "> body", "", "^src-callout", "", "after"), "callout");
    const x = extractSubtreeText(doc, info.id);
    expect(x.text).toBe(J("> [!note] Callout source", "> body"));
    expect(x.endLine).toBe(1);
    expect(x.blockId).toBe("src-callout");
    expect(x.blockIdIsStandaloneLine).toBe(true);
  });

  it("callout + standalone id directly after (endLine + 1)", () => {
    const { doc, info } = blockOf(J("> [!note] T", "> body", "^cid"), "callout");
    const x = extractSubtreeText(doc, info.id);
    expect(x.text).toBe(J("> [!note] T", "> body"));
    expect(x.blockId).toBe("cid");
    expect(x.blockIdIsStandaloneLine).toBe(true);
  });

  it("blockquote + inline suffix: stripped from text", () => {
    const { doc, info } = blockOf(J("> quote line", "> last ^qid"), "blockquote");
    const x = extractSubtreeText(doc, info.id);
    expect(x.text).toBe(J("> quote line", "> last"));
    expect(x.blockId).toBe("qid");
    expect(x.blockIdIsStandaloneLine).toBe(false);
  });

  it("fenced code: text stays body-only, id from the line after the fence", () => {
    const { doc, info } = blockOf(J("```js", "code()", "```", "", "^code-id"), "fenced-code");
    const x = extractSubtreeText(doc, info.id);
    expect(x.text).toBe("code()");
    expect(x.blockId).toBe("code-id");
    expect(x.blockIdIsStandaloneLine).toBe(true);
  });

  it("table + standalone id", () => {
    const { doc, info } = blockOf(J("| a | b |", "| - | - |", "| 1 | 2 |", "", "^tid"), "table");
    const x = extractSubtreeText(doc, info.id);
    expect(x.text).toBe(J("| a | b |", "| - | - |", "| 1 | 2 |"));
    expect(x.blockId).toBe("tid");
  });

  it("no id -> null / false, text unchanged", () => {
    const { doc, info } = blockOf(J("> [!note] T", "> body", "", "after"), "callout");
    const x = extractSubtreeText(doc, info.id);
    expect(x.text).toBe(J("> [!note] T", "> body"));
    expect(x.blockId).toBeNull();
    expect(x.blockIdIsStandaloneLine).toBe(false);
  });

  it("sections and lists never report a block id", () => {
    const doc = parseDocument(J("## H", "- item ^lid"));
    for (const id of doc.nodes.keys()) {
      const x = extractSubtreeText(doc, id);
      expect(x.blockId).toBeNull();
      expect(x.blockIdIsStandaloneLine).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("applySubtreeEdit: callout with a standalone id", () => {
  const TEXT = J("> [!note] Callout source", "> body", "", "^src-callout", "", "after");
  const load = () => {
    const { doc, info } = blockOf(TEXT, "callout");
    return { doc, info, x: extractSubtreeText(doc, info.id) };
  };

  it("updates the id (keeps the blank line before it)", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "new-id", true, "src-callout");
    expect(o.changed).toBe(true);
    expect(o.lines).toEqual(["> [!note] Callout source", "> body", "", "^new-id", "", "after"]);
  });

  it("deletes the id (and the blank line before it)", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, x.text, undefined, null, true, "src-callout");
    expect(o.lines).toEqual(["> [!note] Callout source", "> body", "", "after"]);
  });

  it("edits the body and keeps the id unchanged byte-for-byte", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, J("> [!note] Callout source", "> new body"), undefined, "src-callout", true, "src-callout");
    expect(o.lines).toEqual(["> [!note] Callout source", "> new body", "", "^src-callout", "", "after"]);
  });

  it("omitting the id argument keeps the id (legacy callers)", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, J("> [!note] Callout source", "> v2"));
    expect(o.lines).toEqual(["> [!note] Callout source", "> v2", "", "^src-callout", "", "after"]);
  });

  it("adds an id to a callout that has none (standalone, after a blank line)", () => {
    const { doc, info } = blockOf(J("> [!note] T", "> body", "", "after"), "callout");
    const x = extractSubtreeText(doc, info.id);
    const o = applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "added", true, null);
    expect(o.lines).toEqual(["> [!note] T", "> body", "", "^added", "", "after"]);
    const re = extractSubtreeText(parseDocument(o.lines.join("\n")), info.id);
    expect(re.blockId).toBe("added");
  });

  it("adding before content that follows directly keeps a blank line after the id", () => {
    const { doc, info } = blockOf(J("> [!note] T", "> body"), "callout");
    const x = extractSubtreeText(doc, info.id);
    const o = applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "a1", true);
    expect(o.lines).toEqual(["> [!note] T", "> body", "", "^a1"]);
  });

  it("refuses an invalid id and a conflicting (externally changed) id", () => {
    const { doc, info, x } = load();
    expect(applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "bad id", true, "src-callout").reason).toBe(
      "invalid-block-id"
    );
    expect(applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "z", true, "old-loaded-id").reason).toBe(
      "conflict"
    );
  });

  it("the body conflict check compares bodies only", () => {
    const { doc, info } = load();
    expect(applySubtreeEdit(doc, info.id, "> stale", "> x", undefined, "src-callout", true).reason).toBe("conflict");
  });

  it("a callout with an inline suffix keeps the inline shape", () => {
    const { doc, info } = blockOf(J("> [!note] T", "> body ^inl"), "callout");
    const x = extractSubtreeText(doc, info.id);
    expect(x.text).toBe(J("> [!note] T", "> body"));
    const o = applySubtreeEdit(doc, info.id, x.text, J("> [!note] T", "> changed"), undefined, "inl2", false, "inl");
    expect(o.lines).toEqual(["> [!note] T", "> changed ^inl2"]);
  });
});

describe("applySubtreeEdit: fenced code with a standalone id", () => {
  const TEXT = J("```js", "a()", "```", "", "^code-id", "", "after");
  const load = () => {
    const { doc, info } = blockOf(TEXT, "fenced-code");
    return { doc, info, x: extractSubtreeText(doc, info.id) };
  };

  it("updates the id", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, "a()", undefined, "code-2", true, "code-id");
    // (the fence's info string is rebuilt as "``` js" — existing Phase 5E-3 normalization)
    expect(o.lines).toEqual(["``` js", "a()", "```", "", "^code-2", "", "after"]);
  });

  it("deletes the id", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, "a()", undefined, null, true, "code-id");
    expect(o.lines).toEqual(["``` js", "a()", "```", "", "after"]);
  });

  it("body + language change keep the id", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, "b()", "ts", "code-id", true, "code-id");
    expect(o.lines).toEqual(["``` ts", "b()", "```", "", "^code-id", "", "after"]);
  });

  it("adds an id as a standalone line even when an inline shape is requested", () => {
    const { doc, info } = blockOf(J("```", "x", "```"), "fenced-code");
    const x = extractSubtreeText(doc, info.id);
    const o = applySubtreeEdit(doc, info.id, x.text, "x", undefined, "fid", false, null);
    expect(o.lines).toEqual(["```", "x", "```", "", "^fid"]);
  });
});

describe("applySubtreeEdit: table with a standalone id", () => {
  const TEXT = J("| a | b |", "| - | - |", "| 1 | 2 |", "", "^tid", "", "after");
  const load = () => {
    const { doc, info } = blockOf(TEXT, "table");
    return { doc, info, x: extractSubtreeText(doc, info.id) };
  };

  it("updates the id", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "tid-2", true, "tid");
    expect(o.lines).toEqual(["| a | b |", "| - | - |", "| 1 | 2 |", "", "^tid-2", "", "after"]);
  });

  it("deletes the id", () => {
    const { doc, info, x } = load();
    const o = applySubtreeEdit(doc, info.id, x.text, x.text, undefined, null, true, "tid");
    expect(o.lines).toEqual(["| a | b |", "| - | - |", "| 1 | 2 |", "", "after"]);
  });

  it("adds an id to a table that has none", () => {
    const { doc, info } = blockOf(J("| a |", "| - |", "| 1 |", "", "after"), "table");
    const x = extractSubtreeText(doc, info.id);
    const o = applySubtreeEdit(doc, info.id, x.text, x.text, undefined, "new-t", true, null);
    expect(o.lines).toEqual(["| a |", "| - |", "| 1 |", "", "^new-t", "", "after"]);
  });

  it("table validation still runs on the body", () => {
    const { doc, info, x } = load();
    expect(applySubtreeEdit(doc, info.id, x.text, "| a |", undefined, "tid", true, "tid").reason).toBe(
      "table-too-few-lines"
    );
  });
});

// ---------------------------------------------------------------------------
describe("paragraphs: resolveParagraphAtCursor / applyParagraphEdit", () => {
  describe("inline suffix", () => {
    const TEXT = J("## Sources", "Paragraph source text. ^src-para", "", "next");

    it("resolves the body and the id separately", () => {
      const { paragraph, anchor } = paragraphAt(TEXT, 1);
      expect(paragraph.text).toBe("Paragraph source text.");
      expect(paragraph.blockId).toBe("src-para");
      expect(paragraph.blockIdIsStandaloneLine).toBe(false);
      expect(anchor.originalText).toBe("Paragraph source text.");
      expect(anchor.blockId).toBe("src-para");
    });

    it("body change keeps the id", () => {
      const { doc, anchor } = paragraphAt(TEXT, 1);
      const o = applyParagraphEdit(doc, anchor, "Edited text.", "src-para", false);
      expect(o.lines).toEqual(["## Sources", "Edited text. ^src-para", "", "next"]);
    });

    it("id change only", () => {
      const { doc, anchor } = paragraphAt(TEXT, 1);
      const o = applyParagraphEdit(doc, anchor, "Paragraph source text.", "renamed", false);
      expect(o.lines).toEqual(["## Sources", "Paragraph source text. ^renamed", "", "next"]);
    });

    it("both changed", () => {
      const { doc, anchor } = paragraphAt(TEXT, 1);
      const o = applyParagraphEdit(doc, anchor, "New.", "n2", false);
      expect(o.lines).toEqual(["## Sources", "New. ^n2", "", "next"]);
    });

    it("neither changed: Apply succeeds and the note is identical", () => {
      const { doc, anchor } = paragraphAt(TEXT, 1);
      const o = applyParagraphEdit(doc, anchor, "Paragraph source text.", "src-para", false);
      expect(o.changed).toBe(true);
      expect(o.lines.join("\n")).toBe(TEXT);
    });

    it("clearing the id removes it", () => {
      const { doc, anchor } = paragraphAt(TEXT, 1);
      const o = applyParagraphEdit(doc, anchor, "Paragraph source text.", null, false);
      expect(o.lines).toEqual(["## Sources", "Paragraph source text.", "", "next"]);
    });

    it("keeps unusual spacing before an unchanged id byte-for-byte", () => {
      const odd = J("text   ^odd  ", "", "x");
      const { doc, anchor } = paragraphAt(odd, 0);
      expect(anchor.originalText).toBe("text");
      expect(applyParagraphEdit(doc, anchor, "text", "odd", false).lines.join("\n")).toBe(odd);
    });
  });

  describe("standalone id line", () => {
    const TEXT = J("Paragraph body.", "", "^pid", "", "next");

    it("resolves the body and the id separately", () => {
      const { paragraph } = paragraphAt(TEXT, 0);
      expect(paragraph.text).toBe("Paragraph body.");
      expect(paragraph.blockId).toBe("pid");
      expect(paragraph.blockIdIsStandaloneLine).toBe(true);
    });

    it("body change keeps the id line", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      expect(applyParagraphEdit(doc, anchor, "Changed.", "pid", true).lines).toEqual([
        "Changed.",
        "",
        "^pid",
        "",
        "next",
      ]);
    });

    it("id change only", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      expect(applyParagraphEdit(doc, anchor, "Paragraph body.", "pid-2", true).lines).toEqual([
        "Paragraph body.",
        "",
        "^pid-2",
        "",
        "next",
      ]);
    });

    it("both changed", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      expect(applyParagraphEdit(doc, anchor, "B.", "q", true).lines).toEqual(["B.", "", "^q", "", "next"]);
    });

    it("neither changed: identical note", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      const o = applyParagraphEdit(doc, anchor, "Paragraph body.", "pid", true);
      expect(o.changed).toBe(true);
      expect(o.lines.join("\n")).toBe(TEXT);
    });

    it("clearing the id removes the id line and the blank line before it", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      expect(applyParagraphEdit(doc, anchor, "Paragraph body.", null, true).lines).toEqual([
        "Paragraph body.",
        "",
        "next",
      ]);
    });

    it("a paragraph's own trailing lone id line (no blank line)", () => {
      const own = J("line one", "^own", "", "next");
      const { doc, paragraph, anchor } = paragraphAt(own, 0);
      expect(paragraph.text).toBe("line one");
      expect(paragraph.blockId).toBe("own");
      expect(applyParagraphEdit(doc, anchor, "line one", "own", true).lines.join("\n")).toBe(own);
      expect(applyParagraphEdit(doc, anchor, "line 1", "own2", true).lines).toEqual(["line 1", "^own2", "", "next"]);
    });
  });

  describe("no id", () => {
    const TEXT = J("Plain paragraph.", "", "next");

    it("resolves with a null id", () => {
      const { paragraph, anchor } = paragraphAt(TEXT, 0);
      expect(paragraph.blockId).toBeNull();
      expect(paragraph.blockIdIsStandaloneLine).toBe(false);
      expect(anchor.blockId).toBeNull();
    });

    it("body change", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      expect(applyParagraphEdit(doc, anchor, "Changed.", null, false).lines).toEqual(["Changed.", "", "next"]);
    });

    it("adding an id (inline shape)", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      expect(applyParagraphEdit(doc, anchor, "Plain paragraph.", "added", false).lines).toEqual([
        "Plain paragraph. ^added",
        "",
        "next",
      ]);
    });

    it("both unchanged: identical note", () => {
      const { doc, anchor } = paragraphAt(TEXT, 0);
      const o = applyParagraphEdit(doc, anchor, "Plain paragraph.", null, false);
      expect(o.changed).toBe(true);
      expect(o.lines.join("\n")).toBe(TEXT);
    });
  });

  it("an id changed elsewhere is a conflict (content-changed), not a silent overwrite", () => {
    const { anchor } = paragraphAt(J("Text ^a1", "", "next"), 0);
    const changed = parseDocument(J("Text ^a2", "", "next"));
    expect(applyParagraphEdit(changed, anchor, "Text", "a1", false).changed).toBe(false);
    expect(resolveParagraphAnchorText(changed, anchor).ok).toBe(true); // Pass 3 finds it, with the new id
    expect(resolveParagraphAnchorText(changed, anchor).blockId).toBe("a2");
  });

  it("an invalid id is refused", () => {
    const { doc, anchor } = paragraphAt(J("Text ^a1"), 0);
    expect(applyParagraphEdit(doc, anchor, "Text", "no spaces", false).reason).toBe("invalid-block-id");
  });

  it("legacy anchors (no blockId field — the Outline Tree's inline rename) keep full-text behavior", () => {
    const doc = parseDocument(J("Text ^a1", "", "next"));
    const { anchor } = paragraphAt(J("Text ^a1", "", "next"), 0);
    const legacy = { ...anchor, originalText: "Text ^a1" };
    delete (legacy as { blockId?: string | null }).blockId;
    delete (legacy as { blockIdIsStandaloneLine?: boolean }).blockIdIsStandaloneLine;
    const o = applyParagraphEdit(doc, legacy, "Renamed ^a1");
    expect(o.lines).toEqual(["Renamed ^a1", "", "next"]);
  });

  it("the mirror-reference count still finds a paragraph whose pane text is the body only", () => {
    const text = J("Para ^src-para", "", "![[#^src-para]]");
    expect(
      mirrorReferencesForTarget(text, "n.md", { kind: "paragraph", parentId: null, originalText: "Para" })
    ).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
describe("i18n and view wiring", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
  const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

  it("labels and the invalid-id reason exist in English and Japanese", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("partialEdit.blockIdLabel")).toBe("Block ID:");
    expect(ja("partialEdit.blockIdPlaceholder")).toBe("なし");
    expect(en("reason.invalid-block-id")).toMatch(/^Unified Outliner: /);
    expect(ja("reason.invalid-block-id")).toMatch(/^Unified Outliner: /);
  });

  it("the Block ID row sits directly above the mirror-reference row and marks the pane dirty on input", () => {
    const row = viewTs.indexOf('this.blockIdRowEl = this.contentEl.createDiv({ cls: "unified-outliner-partial-edit-block-id-row" });');
    const refs = viewTs.indexOf('this.mirrorRefsEl = this.contentEl.createDiv({ cls: "unified-outliner-partial-edit-mirror-refs" });');
    expect(row).toBeGreaterThan(-1);
    expect(refs).toBeGreaterThan(row);
    expect(viewTs).toContain('this.blockIdInputEl.addEventListener("input", () => this.updateDirtyState());');
    expect(css).toContain(".unified-outliner-partial-edit-block-id-row");
  });

  it("the row is shown only for an eligible kind that has an id; sections/lists/composites are not eligible", () => {
    expect(viewTs).toContain("return this.blockIdFieldEligible && this.loadedBlockId !== null;");
    expect(viewTs).toMatch(/extracted\.kind === "callout" \|\|\s*extracted\.kind === "blockquote" \|\|\s*extracted\.kind === "fenced-code" \|\|\s*extracted\.kind === "table";/);
  });

  it("Apply passes the field value and the loaded shape to both write paths", () => {
    expect(viewTs).toContain(
      "applyParagraphEdit(doc, this.paragraphAnchor, this.textareaEl.value, paragraphBlockId, paragraphIdStandalone)"
    );
    expect(viewTs).toMatch(/this\.blockIdForApply\(\),\s*this\.loadedBlockIdIsStandaloneLine,\s*this\.blockIdFieldEligible \? this\.loadedBlockId : undefined/);
  });

  it("isDirty counts an edited id; Cancel resets it; stale detection sees an id changed elsewhere", () => {
    expect(viewTs).toContain("if (this.isBlockIdDirty()) return true;");
    expect(viewTs).toContain("const currentBlockId = this.resolveCurrentTargetBlockId(doc);");
  });
});
