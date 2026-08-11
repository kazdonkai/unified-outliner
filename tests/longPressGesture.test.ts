import { describe, expect, it } from "vitest";
import {
  exceedsLongPressMoveThreshold,
  LONG_PRESS_DURATION_MS,
  LONG_PRESS_MOVE_CANCEL_PX,
} from "../src/tree/longPressGesture";

describe("exceedsLongPressMoveThreshold", () => {
  it("is false for no movement at all", () => {
    expect(exceedsLongPressMoveThreshold(100, 100, 100, 100)).toBe(false);
  });

  it("is false for movement strictly within the default threshold", () => {
    // 3-4-5 triangle: distance 5, well under LONG_PRESS_MOVE_CANCEL_PX (10).
    expect(exceedsLongPressMoveThreshold(0, 0, 3, 4)).toBe(false);
  });

  it("is false exactly AT the default threshold (strictly-greater-than semantics)", () => {
    expect(exceedsLongPressMoveThreshold(0, 0, LONG_PRESS_MOVE_CANCEL_PX, 0)).toBe(
      false
    );
  });

  it("is true just past the default threshold", () => {
    expect(
      exceedsLongPressMoveThreshold(0, 0, LONG_PRESS_MOVE_CANCEL_PX + 0.01, 0)
    ).toBe(true);
  });

  it("measures Euclidean distance, not axis-limited (diagonal movement)", () => {
    // 6-8-10 triangle: distance 10 — at the default threshold, so NOT
    // exceeded (matches the "just past" test above using a pure axis
    // movement); a naive per-axis check might have incorrectly reported
    // this as under-threshold on each axis alone (6 < 10, 8 < 10) while
    // missing that the combined distance already reaches the limit.
    expect(exceedsLongPressMoveThreshold(0, 0, 6, 8)).toBe(false);
    expect(exceedsLongPressMoveThreshold(0, 0, 6.01, 8)).toBe(true);
  });

  it("is true for purely vertical movement past the threshold", () => {
    expect(exceedsLongPressMoveThreshold(50, 50, 50, 50 + LONG_PRESS_MOVE_CANCEL_PX + 1)).toBe(
      true
    );
  });

  it("treats movement in either direction along an axis identically", () => {
    expect(exceedsLongPressMoveThreshold(0, 0, -20, 0)).toBe(true);
    expect(exceedsLongPressMoveThreshold(0, 0, 20, 0)).toBe(true);
  });

  it("respects an explicit custom threshold override", () => {
    expect(exceedsLongPressMoveThreshold(0, 0, 2, 0, 1)).toBe(true);
    expect(exceedsLongPressMoveThreshold(0, 0, 2, 0, 5)).toBe(false);
  });
});

describe("long-press tuning constants", () => {
  it("duration sits within the spec's suggested 400-500ms range", () => {
    expect(LONG_PRESS_DURATION_MS).toBeGreaterThanOrEqual(400);
    expect(LONG_PRESS_DURATION_MS).toBeLessThanOrEqual(500);
  });

  it("move-cancel threshold is a small, positive pixel slop value", () => {
    expect(LONG_PRESS_MOVE_CANCEL_PX).toBeGreaterThan(0);
    expect(LONG_PRESS_MOVE_CANCEL_PX).toBeLessThanOrEqual(20);
  });
});
