import { describe, expect, it } from "vitest";
import { computeOffscreenContentScrollTop } from "../src/view/offscreenContentScroll";

describe("computeOffscreenContentScrollTop", () => {
  it("scrolls past a Properties block taller than the viewport (reported note)", () => {
    // scroller at y=144, contentDOM starts 1615px lower (Properties + title),
    // target line 386px into the content.
    expect(
      computeOffscreenContentScrollTop({ scrollTop: 0, scrollerTop: 144, contentTop: 1759, lineTop: 386 })
    ).toBe(1615 + 386);
  });

  it("accounts for the current scroll offset", () => {
    expect(
      computeOffscreenContentScrollTop({ scrollTop: 400, scrollerTop: 144, contentTop: 1359, lineTop: 386 })
    ).toBe(1615 + 386);
  });

  it("handles content scrolled above the viewport", () => {
    expect(
      computeOffscreenContentScrollTop({ scrollTop: 20000, scrollerTop: 144, contentTop: -18241, lineTop: 100 })
    ).toBe(1615 + 100);
  });

  it("never returns a negative scrollTop", () => {
    expect(
      computeOffscreenContentScrollTop({ scrollTop: 0, scrollerTop: 100, contentTop: 50, lineTop: 0 })
    ).toBe(0);
  });

  it("falls back to the current scrollTop for non-finite input", () => {
    expect(
      computeOffscreenContentScrollTop({ scrollTop: 300, scrollerTop: 0, contentTop: 0, lineTop: Number.NaN })
    ).toBe(300);
  });
});
