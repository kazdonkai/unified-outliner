import { describe, expect, it } from "vitest";
import {
  RESIZE_GRIP_MIN_HEIGHT,
  RESIZE_GRIP_MIN_WIDTH,
  RESIZE_GRIP_WIDTH_THRESHOLD,
  resizeGripNextSize,
  resizeGripOffset,
} from "../src/view/resizeGripSizing";

const start = { width: 400, height: 300, maxWidth: 400 }; // box fills its container

describe("Partial Edit grip: height and width", () => {
  it("vertical drag: height follows, width untouched (box keeps filling the pane)", () => {
    expect(resizeGripNextSize(start, 0, -100, false)).toEqual({ height: 200, width: null, widthEngaged: false });
    expect(resizeGripNextSize(start, RESIZE_GRIP_WIDTH_THRESHOLD - 1, 50, false)).toEqual({ height: 350, width: null, widthEngaged: false });
  });

  it("horizontal drag: width follows once past the threshold, and keeps following", () => {
    expect(resizeGripNextSize(start, -150, 0, false)).toEqual({ height: 300, width: 250, widthEngaged: true });
    expect(resizeGripNextSize(start, -1, 0, true)).toEqual({ height: 300, width: 399, widthEngaged: true });
  });

  it("diagonal drag changes both", () => {
    expect(resizeGripNextSize(start, -100, 80, false)).toEqual({ height: 380, width: 300, widthEngaged: true });
  });

  it("limits: no wider than the container's room, no smaller than the minimums", () => {
    expect(resizeGripNextSize(start, 200, 0, true).width).toBe(400);
    expect(resizeGripNextSize({ ...start, width: 250 }, 500, 0, true).width).toBe(400);
    expect(resizeGripNextSize(start, -1000, -1000, true)).toEqual({ height: RESIZE_GRIP_MIN_HEIGHT, width: RESIZE_GRIP_MIN_WIDTH, widthEngaged: true });
    // a box already narrower than the minimum is not widened by a shrinking drag
    expect(resizeGripNextSize({ width: 90, height: 40, maxWidth: 90 }, -20, 0, true).width).toBe(90);
  });

  it("the grip stays on the box's corner", () => {
    expect(resizeGripOffset(3, 500, 500)).toBe(3);
    expect(resizeGripOffset(3, 500, 380)).toBe(123);
    expect(resizeGripOffset(2, 500, 520)).toBe(2);
  });
});
