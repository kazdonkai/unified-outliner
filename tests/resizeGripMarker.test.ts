/**
 * Resize-grip marker (1.0.7): two short parallel diagonal strokes at the
 * bottom-right corner of the Partial Edit pane's edit boxes, and the grip's
 * diagonal resize cursor. No other box becomes resizable.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { RESIZE_GRIP_STROKES, RESIZE_GRIP_VIEWBOX, resizeGripMarkerSvg } from "../src/view/resizeGripMarker";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("resize grip marker", () => {
  it("is two parallel diagonal strokes towards the bottom-right corner", () => {
    expect(RESIZE_GRIP_STROKES).toHaveLength(2);
    for (const s of RESIZE_GRIP_STROKES) {
      // slope -1 (parallel, "/" direction) and ending on the bottom / right edges
      expect((s.y2 - s.y1) / (s.x2 - s.x1)).toBe(-1);
      expect(Math.max(s.x1, s.x2)).toBe(RESIZE_GRIP_VIEWBOX - 1);
      expect(Math.max(s.y1, s.y2)).toBe(RESIZE_GRIP_VIEWBOX - 1);
    }
    const len = (s: (typeof RESIZE_GRIP_STROKES)[number]) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    expect(len(RESIZE_GRIP_STROKES[0])).toBeGreaterThan(len(RESIZE_GRIP_STROKES[1]));
  });

  it("the standalone SVG has exactly the two strokes and no arrow", () => {
    const svg = resizeGripMarkerSvg("#8a8a8a");
    expect(svg.match(/<line /g)).toHaveLength(2);
    expect(svg).not.toMatch(/<path|<polyline|<polygon|marker/);
  });

  it("Partial Edit draws the shared marker instead of the diagonal-arrow icon (handler unchanged)", () => {
    const src = read("src/view/PartialEditView.ts");
    expect(src).not.toContain("move-diagonal-2");
    expect(src).toContain("drawResizeGripMarker(grip)");
    // the drag handler is still there; it now resizes height and width (resizeGripSizing)
    expect(src).toMatch(/grip\.addEventListener\("pointerdown"/);
    expect(src).toContain("resizeGripNextSize(start, e.clientX - startX, e.clientY - startY, widthEngaged)");
    // both grips (list row and body textarea) use it, and a new block drops the user width
    expect(src.match(/attachResizeGrip\(\n\s+this\.(compositeListGripEl|textareaGripEl)/g)).toHaveLength(2);
    expect(src).toContain("clearResizeGripWidth(this.textareaGripEl, this.textareaEl, BODY_TEXTAREA_GRIP_PLACEMENT)");
  });

  it("the Partial Edit grip shows the same diagonal resize cursor as the native resize: both box", () => {
    const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.unified-outliner-partial-edit-resize-grip\s*\{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/cursor:\s*nwse-resize/);
    expect(rule).toMatch(/touch-action:\s*none/);
    expect(css).not.toMatch(/cursor:\s*ns-resize/);
  });

  it("no edit box gets the native resizer (the plugin grip is the only one)", () => {
    const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/resize:\s*(both|vertical|horizontal)/);
  });
});
