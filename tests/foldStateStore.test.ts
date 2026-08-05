import { describe, expect, it } from "vitest";
import {
  FoldStateData,
  getCollapsedIdentities,
  normalizeFoldStateData,
  withFileRenamed,
  withNodeCollapsed,
} from "../src/persistence/foldStateStore";

describe("normalizeFoldStateData", () => {
  it("passes through a well-formed blob unchanged", () => {
    const raw = { "Notes/A.md": ["section:A", "list:item1"] };
    expect(normalizeFoldStateData(raw)).toEqual(raw);
  });

  it("falls back to an empty store for null/undefined/non-object input (fresh install, or pre-Phase-4E data.json)", () => {
    expect(normalizeFoldStateData(undefined)).toEqual({});
    expect(normalizeFoldStateData(null)).toEqual({});
    expect(normalizeFoldStateData("not an object")).toEqual({});
    expect(normalizeFoldStateData(42)).toEqual({});
  });

  it("drops entries whose value isn't an array, and non-string elements within an array, without throwing", () => {
    const raw = {
      "Notes/A.md": ["section:A", 42, null, "list:item1"],
      "Notes/B.md": "not an array",
      "Notes/C.md": ["section:C"],
    };
    expect(normalizeFoldStateData(raw)).toEqual({
      "Notes/A.md": ["section:A", "list:item1"],
      "Notes/C.md": ["section:C"],
    });
  });

  it("drops a file entry entirely if it has no valid string identities left", () => {
    const raw = { "Notes/A.md": [42, null] };
    expect(normalizeFoldStateData(raw)).toEqual({});
  });
});

describe("getCollapsedIdentities", () => {
  it("returns the file's collapsed set", () => {
    const data: FoldStateData = { "Notes/A.md": ["section:A", "list:item1"] };
    expect(getCollapsedIdentities(data, "Notes/A.md")).toEqual(
      new Set(["section:A", "list:item1"])
    );
  });

  it("returns an empty set for a file with no entry", () => {
    expect(getCollapsedIdentities({}, "Notes/Unknown.md")).toEqual(new Set());
  });
});

describe("withNodeCollapsed", () => {
  it("adds an identity to a file with no prior entry", () => {
    const next = withNodeCollapsed({}, "Notes/A.md", "section:A", true);
    expect(next).toEqual({ "Notes/A.md": ["section:A"] });
  });

  it("adds an identity to a file's existing entry without disturbing other files", () => {
    const data: FoldStateData = { "Notes/A.md": ["section:A"], "Notes/B.md": ["section:B"] };
    const next = withNodeCollapsed(data, "Notes/A.md", "list:item1", true);
    expect(next).toEqual({
      "Notes/A.md": ["section:A", "list:item1"],
      "Notes/B.md": ["section:B"],
    });
    // original untouched (immutable-style)
    expect(data).toEqual({ "Notes/A.md": ["section:A"], "Notes/B.md": ["section:B"] });
  });

  it("removes an identity, and removes the file's entry entirely once its collapsed set becomes empty", () => {
    const data: FoldStateData = { "Notes/A.md": ["section:A"] };
    const next = withNodeCollapsed(data, "Notes/A.md", "section:A", false);
    expect(next).toEqual({});
  });

  it("removing an identity that leaves other identities behind keeps the file's entry", () => {
    const data: FoldStateData = { "Notes/A.md": ["section:A", "list:item1"] };
    const next = withNodeCollapsed(data, "Notes/A.md", "section:A", false);
    expect(next).toEqual({ "Notes/A.md": ["list:item1"] });
  });

  it("is a true no-op (same reference back) when the requested state already holds", () => {
    const data: FoldStateData = { "Notes/A.md": ["section:A"] };
    expect(withNodeCollapsed(data, "Notes/A.md", "section:A", true)).toBe(data);
    expect(withNodeCollapsed({}, "Notes/A.md", "section:A", false)).toEqual({});
  });
});

describe("withFileRenamed", () => {
  it("migrates a file's collapsed set to the new path", () => {
    const data: FoldStateData = { "Notes/Old.md": ["section:A"] };
    const next = withFileRenamed(data, "Notes/Old.md", "Notes/New.md");
    expect(next).toEqual({ "Notes/New.md": ["section:A"] });
  });

  it("is a no-op (same reference) when the old path has no entry", () => {
    const data: FoldStateData = { "Notes/Other.md": ["section:A"] };
    expect(withFileRenamed(data, "Notes/Old.md", "Notes/New.md")).toBe(data);
  });

  it("is a no-op (same reference) when old and new paths are identical", () => {
    const data: FoldStateData = { "Notes/A.md": ["section:A"] };
    expect(withFileRenamed(data, "Notes/A.md", "Notes/A.md")).toBe(data);
  });

  it("does not disturb other files' entries", () => {
    const data: FoldStateData = {
      "Notes/Old.md": ["section:A"],
      "Notes/Untouched.md": ["section:B"],
    };
    const next = withFileRenamed(data, "Notes/Old.md", "Notes/New.md");
    expect(next).toEqual({
      "Notes/New.md": ["section:A"],
      "Notes/Untouched.md": ["section:B"],
    });
  });
});
