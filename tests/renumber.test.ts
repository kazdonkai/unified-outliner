import { describe, expect, it } from "vitest";
import { normalizeOrderedMarkers } from "../src/move/renumber";
import { expandToListRegion } from "../src/move/moveBlock";

describe("normalizeOrderedMarkers", () => {
  it("rewrites ordered markers (including \")\" style) to \"1.\"", () => {
    const lines = ["2. a", "10) b", "  3. c", "- d", "text"];
    const out = normalizeOrderedMarkers(lines, [
      { startLine: 0, endLine: 4 },
    ]);
    expect(out).toEqual(["1. a", "1. b", "  1. c", "- d", "text"]);
  });

  it("only touches the given ranges", () => {
    const lines = ["2. a", "2. b"];
    const out = normalizeOrderedMarkers(lines, [
      { startLine: 0, endLine: 0 },
    ]);
    expect(out).toEqual(["1. a", "2. b"]);
  });

  it("skips lines when a skip mask is provided", () => {
    const lines = ["2. a", "2. code"];
    const out = normalizeOrderedMarkers(
      lines,
      [{ startLine: 0, endLine: 1 }],
      [false, true]
    );
    expect(out).toEqual(["1. a", "2. code"]);
  });

  it("does not modify the input array", () => {
    const lines = ["2. a"];
    normalizeOrderedMarkers(lines, [{ startLine: 0, endLine: 0 }]);
    expect(lines).toEqual(["2. a"]);
  });
});

describe("expandToListRegion", () => {
  it("expands over adjacent list-marker lines and stops at blanks", () => {
    const lines = ["text", "1. a", "2. b", "3. c", "", "4. other"];
    expect(
      expandToListRegion(lines, { startLine: 2, endLine: 2 })
    ).toEqual({ startLine: 1, endLine: 3 });
  });
});
