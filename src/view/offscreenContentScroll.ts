/**
 * 2026-09-30 (Tree jump does nothing in a note with very tall Properties):
 * CM6 only runs its measure cycle — the place where a pending
 * `EditorView.scrollIntoView` effect is actually applied — while the
 * editor's content DOM is at least partly on screen (`EditorView.inView`).
 * Obsidian renders the inline title and the Properties (metadata)
 * container ABOVE CM6's contentDOM inside the same scroller, so a note
 * whose Properties block is taller than the editor viewport (observed:
 * 33 properties, 1557px, in a 801px-tall scroller) leaves contentDOM
 * entirely below the visible area while scrolled to the top. In that state
 * `inView` is false, the scroll effect is silently dropped, and a Tree row
 * click only moves the cursor — the body never scrolls.
 *
 * The fix sets the scroller's scrollTop directly (which does not depend on
 * CM6's measure cycle) to an estimate of where the target line sits, so
 * that the content comes into view; the regular top-aligned
 * `scrollIntoView` dispatch and the post-jump stabilizer then refine it
 * once CM6 is measuring again. This module holds the pure arithmetic so it
 * can be unit-tested without a DOM.
 */
export interface OffscreenContentScrollInput {
  /** Current `scrollDOM.scrollTop`. */
  scrollTop: number;
  /** `scrollDOM.getBoundingClientRect().top`. */
  scrollerTop: number;
  /** `contentDOM.getBoundingClientRect().top`. */
  contentTop: number;
  /** CM6's (possibly estimated) `lineBlockAt(pos).top`, relative to contentDOM's top. */
  lineTop: number;
}

/**
 * The scrollTop that would place a line whose top is `lineTop` px below
 * contentDOM's top at the top edge of the scroller. Never negative.
 */
export function computeOffscreenContentScrollTop(input: OffscreenContentScrollInput): number {
  const { scrollTop, scrollerTop, contentTop, lineTop } = input;
  const contentOffsetInScroller = scrollTop + (contentTop - scrollerTop);
  const target = contentOffsetInScroller + lineTop;
  return Number.isFinite(target) ? Math.max(0, Math.round(target)) : Math.max(0, scrollTop);
}
