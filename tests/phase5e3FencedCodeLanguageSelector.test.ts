/**
 * Phase 5E-3 ("Fenced Code Block Partial Edit の UX 改善 — フェンス行の非
 * 表示化と種別選択 UI"): tests for the pure-logic (partialEdit.ts) half of
 * this phase — the UI layer (view/PartialEditView.ts) is exercised only
 * indirectly here, through the same extractSubtreeText/applySubtreeEdit
 * contract the pane itself calls.
 *
 * See docs/phase5e3_fenced-code-language-selector-design-memo.md for the
 * full design, including §1/§2's documentation of the reconstruction-
 * inside-applySubtreeEdit architecture choice and the now-structurally-
 * unreachable "fenced-code-invalid-close" reason code.
 *
 * Four categories, per this phase's own instruction:
 *   A. extraction — infoString/bodyText/fenceChar/fenceLength/
 *      openLineIndent separation, across mermaid/no-info-string/custom-
 *      string/tilde-fence/indented-fence/zero-content-lines shapes.
 *   B. Apply reconstruction — unchanged vs. UI-changed info string; the
 *      close line never carries an info string regardless.
 *   C. Apply validation — content edits and full-clear both still pass;
 *      an invalid info-string value (embedded newline) fails.
 *   D. regression — fenced-code Move/Delete untouched; callout/
 *      blockquote/table Partial Edit untouched.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import {
  buildStandaloneComplexBlockSnapshot,
  moveStandaloneComplexBlock,
} from "../src/edit/moveStandaloneComplexBlock";
import {
  buildStandaloneComplexBlockDeleteSnapshot,
  deleteStandaloneComplexBlock,
} from "../src/edit/deleteStandaloneComplexBlock";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";

/** Real pipeline: parse -> scan -> match, mirroring the other *StandaloneComplexBlock test files' own pipeline() helper. */
function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

/** Finds the fenced-code ComplexBlockInfo whose own range includes a line containing `needle`. */
function fencedCodeOf(complexScan: ComplexBlockScanResult, doc: ReturnType<typeof parseDocument>, needle: string): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => b.kind === "fenced-code" && doc.lines.slice(b.range.startLine, b.range.endLine + 1).some((l) => l.includes(needle))
  );
  if (!found) throw new Error(`no fenced-code block matching "${needle}"`);
  return found;
}

describe("Phase 5E-3 category A: extraction (infoString/bodyText/fenceChar/fenceLength/openLineIndent separation)", () => {
  it("with-mermaid: separates the mermaid info string from the body, no space normalization at extraction time", () => {
    const text = ["# H", "```mermaid", "graph TD", "A-->B", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.text).toBe(["graph TD", "A-->B"].join("\n"));
    expect(outcome.fencedCode).toEqual({
      infoString: "mermaid",
      bodyText: ["graph TD", "A-->B"].join("\n"),
      fenceChar: "`",
      fenceLength: 3,
      openLineIndent: "",
    });
  });

  it("no-info-string: a plain ``` open line with nothing after it extracts infoString \"\"", () => {
    const text = ["# H", "```", "plain code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.text).toBe("plain code");
    expect(outcome.fencedCode?.infoString).toBe("");
  });

  it("custom-string: an info string outside the UI's known dropdown values is captured verbatim (dropdown/custom-input classification is a UI-layer concern only)", () => {
    const text = ["# H", "```my-weird-lang-v2", "content", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fencedCode?.infoString).toBe("my-weird-lang-v2");
    expect(outcome.text).toBe("content");
  });

  it("tilde-fence: a ~~~ fence is separated the same way as a backtick fence, fenceChar reported as \"~\"", () => {
    const text = ["# H", "~~~python", "print(1)", "~~~"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fencedCode).toEqual({
      infoString: "python",
      bodyText: "print(1)",
      fenceChar: "~",
      fenceLength: 3,
      openLineIndent: "",
    });
  });

  it("indented-fence: leading whitespace on the opening line is captured as openLineIndent, not folded into fenceChar/infoString", () => {
    const text = ["# H", "  ```js", "  indented code", "  ```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code");
    expect(info).toBeDefined();
    if (!info) return;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fencedCode?.openLineIndent).toBe("  ");
    expect(outcome.fencedCode?.infoString).toBe("js");
    // Content lines are returned exactly as they sit in doc.lines — this
    // extraction step does not strip or renormalize per-line indentation,
    // only the fence lines themselves are removed.
    expect(outcome.text).toBe("  indented code");
  });

  it("zero-content-lines: an open line immediately followed by a close line yields bodyText \"\" (empty, not a single blank line)", () => {
    const text = ["# H", "```js", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const outcome = extractSubtreeText(doc, info.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.text).toBe("");
    expect(outcome.fencedCode?.bodyText).toBe("");
  });
});

describe("Phase 5E-3 category B: Apply reconstruction (open/close fence line rebuilding)", () => {
  it("an unchanged UI info string reproduces the original open line exactly, when the original already used the single-space form", () => {
    const text = ["# H", "``` js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    // No fencedCodeInfoString argument at all -> falls back to the
    // extraction-time value ("js"), i.e. "the UI never touched it".
    const outcome = applySubtreeEdit(doc, info.id, original.text, original.text);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "``` js", "code", "```"]);
  });

  it("a UI-changed info string produces a new open line carrying that new value, leaving fenceChar/fenceLength/indent untouched", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const outcome = applySubtreeEdit(doc, info.id, original.text, original.text, "python");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "``` python", "code", "```"]);
  });

  it("the close line NEVER carries an info string, regardless of what fencedCodeInfoString was passed", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const outcome = applySubtreeEdit(doc, info.id, original.text, "new body", "typescript");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "``` typescript", "new body", "```"]);
    expect(outcome.lines[outcome.lines.length - 1]).toBe("```");
  });

  it("an indented block's openLineIndent is reproduced on BOTH the rebuilt open and close lines", () => {
    const text = ["# H", "  ```js", "  code", "  ```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const outcome = applySubtreeEdit(doc, info.id, original.text, "  changed");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "  ``` js", "  changed", "  ```"]);
  });
});

describe("Phase 5E-3 category C: Apply validation", () => {
  it("editing content lines still passes validation (ordinary multi-line body edit)", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["line one", "line two", "line three"].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "``` js", "line one", "line two", "line three", "```"]);
  });

  it("fully clearing the content (newText === \"\") still passes validation — a zero-content code block is valid", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const outcome = applySubtreeEdit(doc, info.id, original.text, "");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "``` js", "```"]);
  });

  it("an invalid fencedCodeInfoString (embedded newline) corrupts the synthesized open line and causes Apply validation to fail", () => {
    const text = ["# H", "```js", "code", "```"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "fenced-code")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const outcome = applySubtreeEdit(doc, info.id, original.text, "code", "js\nmalicious");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("fenced-code-invalid-open");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

describe("Phase 5E-3 category D: regression (fenced-code Move/Delete, callout/blockquote/table Partial Edit)", () => {
  it("fenced-code Move (前後兄弟との入れ替え) is untouched by this phase — still swaps fence+body verbatim", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "```js", "console.log(1);", "```"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = fencedCodeOf(complexScan, doc, "console.log");
    const snapshot = buildStandaloneComplexBlockSnapshot(fenced)!;
    expect(snapshot.kind).toBe("fenced-code");

    const outcome = moveStandaloneComplexBlock(text, { snapshot, direction: "up" }, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "```js", "console.log(1);", "```", "", "> [!note] one", "> body a"]);
  });

  it("fenced-code Delete (ブロック全体の一括削除) is untouched by this phase — still removes open fence through close fence as one unit", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "```js", "console.log(1);", "```"].join("\n");
    const { doc, complexScan } = pipeline(text);
    const fenced = fencedCodeOf(complexScan, doc, "console.log");
    const snapshot = buildStandaloneComplexBlockDeleteSnapshot(fenced)!;
    expect(snapshot.kind).toBe("fenced-code");

    const outcome = deleteStandaloneComplexBlock(text, snapshot, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "> [!note] one", "> body a", ""]);
  });

  it("callout Partial Edit is byte-identical to before this phase — text/newText still include the whole raw callout, no fence-style separation applies", () => {
    const text = ["# A", "> [!note] Title", "> old body", "# B"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "callout")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(original.text).toBe(["> [!note] Title", "> old body"].join("\n"));
    expect(original.fencedCode).toBeUndefined();

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["> [!note] Title", "> new body"].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "> [!note] Title", "> new body", "# B"]);
  });

  it("blockquote Partial Edit is byte-identical to before this phase", () => {
    const text = ["# A", "> old line", "# B"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "blockquote")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(original.text).toBe("> old line");
    expect(original.fencedCode).toBeUndefined();

    const outcome = applySubtreeEdit(doc, info.id, original.text, "> new line");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "> new line", "# B"]);
  });

  it("table Partial Edit is byte-identical to before this phase — full header/delimiter/data rows still round-trip raw", () => {
    const text = ["# A", "| a | b |", "|---|---|", "| 1 | 2 |", "# B"].join("\n");
    const doc = parseDocument(text);
    const info = scanComplexBlocks(doc).blocks.find((b) => b.kind === "table")!;
    const original = extractSubtreeText(doc, info.id);
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(original.text).toBe(["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    expect(original.fencedCode).toBeUndefined();

    const outcome = applySubtreeEdit(doc, info.id, original.text, ["| a | b |", "|---|---|", "| 9 | 9 |"].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# A", "| a | b |", "|---|---|", "| 9 | 9 |", "# B"]);
  });
});
