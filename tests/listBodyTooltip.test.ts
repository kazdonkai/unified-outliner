import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  collectListItemBodyLines,
  CONTINUATION_INDENT,
  extractListItemBodyText,
  formatListItemBodyLines,
} from "../src/edit/listBodyRange";

/** Finds the id of the list item whose own first line contains `needle`. */
function listIdOf(doc: ReturnType<typeof parseDocument>, needle: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "list" && doc.lines[n.range.startLine].includes(needle)) return n.id;
  }
  throw new Error(`no list item matching "${needle}"`);
}

function sectionIdOf(doc: ReturnType<typeof parseDocument>, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (n.type === "section" && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

describe("extractListItemBodyText", () => {
  it("single-line item: tooltip text is just the marker-stripped first line", () => {
    const text = ["# A", "- one", "- two"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractListItemBodyText(doc, listIdOf(doc, "one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe("one");
  });

  it("multi-line item: continuation lines are included, trimmed of nesting indent", () => {
    const text = [
      "# A",
      "- one",
      "  continuation line 1",
      "  continuation line 2",
      "- two",
    ].join("\n");
    const doc = parseDocument(text);

    const outcome = extractListItemBodyText(doc, listIdOf(doc, "one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(
      `one\n${CONTINUATION_INDENT}continuation line 1\n${CONTINUATION_INDENT}continuation line 2`
    );
  });

  it("an item with nested children: tooltip stops at the parent's own body, excluding child list text", () => {
    const text = [
      "# A",
      "- one",
      "  own continuation",
      "  - child one",
      "  - child two",
      "- two",
    ].join("\n");
    const doc = parseDocument(text);

    const outcome = extractListItemBodyText(doc, listIdOf(doc, "- one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(`one\n${CONTINUATION_INDENT}own continuation`);
    expect(outcome.text).not.toContain("child one");
    expect(outcome.text).not.toContain("child two");
  });

  it("a child item's own tooltip is unaffected by its parent/siblings", () => {
    const text = ["# A", "- one", "  - child one", "  - child two"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractListItemBodyText(doc, listIdOf(doc, "child one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe("child one");
  });

  it("excludes fenced code content nested inside the item's own continuation lines", () => {
    const text = [
      "# A",
      "- one",
      "  ```",
      "  not part of the tooltip",
      "  ```",
      "  after fence",
      "- two",
    ].join("\n");
    const doc = parseDocument(text);

    const outcome = extractListItemBodyText(doc, listIdOf(doc, "one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(`one\n${CONTINUATION_INDENT}after fence`);
    expect(outcome.text).not.toContain("not part of the tooltip");
    expect(outcome.text).not.toContain("```");
  });

  it("frontmatter never becomes part of any item's body (list items can't start inside it)", () => {
    const text = ["---", "title: x", "---", "# A", "- real item"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractListItemBodyText(doc, listIdOf(doc, "real item"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe("real item");
  });

  it("collapses runs of blank continuation lines rather than preserving empty tooltip rows", () => {
    const text = [
      "# A",
      "- one",
      "  line 1",
      "",
      "",
      "  line 2",
      "- two",
    ].join("\n");
    const doc = parseDocument(text);

    const outcome = extractListItemBodyText(doc, listIdOf(doc, "one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toBe(`one\n${CONTINUATION_INDENT}line 1\n${CONTINUATION_INDENT}line 2`);
  });

  it("no-ops safely when the id does not resolve", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const outcome = extractListItemBodyText(doc, "li-not-real");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
    expect(outcome.text).toBe("");
  });

  it("no-ops when the id resolves to a section, not a list item", () => {
    const doc = parseDocument(["# A", "- one"].join("\n"));
    const outcome = extractListItemBodyText(doc, sectionIdOf(doc, "A"));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("not-a-list-item");
  });
});

describe("collectListItemBodyLines (raw, pre-formatting)", () => {
  it("returns raw lines with whitespace and blank lines intact", () => {
    const text = ["# A", "- one", "  line 1", "", "  line 2"].join("\n");
    const doc = parseDocument(text);

    const outcome = collectListItemBodyLines(doc, listIdOf(doc, "one"));
    expect(outcome.ok).toBe(true);
    expect(outcome.lines).toEqual(["- one", "  line 1", "", "  line 2"]);
  });
});

describe("formatListItemBodyLines", () => {
  it("strips the marker from the first line only, trims + indents the rest, and drops blank lines", () => {
    const formatted = formatListItemBodyLines([
      "- one",
      "  continuation",
      "",
      "",
      "  more",
    ]);
    expect(formatted).toBe(
      `one\n${CONTINUATION_INDENT}continuation\n${CONTINUATION_INDENT}more`
    );
  });

  it("handles an ordered-list marker on the first line", () => {
    const formatted = formatListItemBodyLines(["1. first", "   second"]);
    expect(formatted).toBe(`first\n${CONTINUATION_INDENT}second`);
  });

  it("returns an empty string for an all-blank input", () => {
    expect(formatListItemBodyLines(["", "  "])).toBe("");
  });

  it("uses a single EM SPACE (U+2003) as the indent — immune to CSS whitespace collapsing, and sized/intended for general (not CJK-specific) indentation", () => {
    expect(CONTINUATION_INDENT).toBe(" ");
  });
});
