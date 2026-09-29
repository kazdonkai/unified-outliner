/**
 * 2026-09-30 (Partial Edit Pane navigation -> body editor sync): the body
 * editor "reveal this line" behaviour shared by the Outline Tree row
 * click/keyboard jump (OutlineTreeView#jumpToLine) and the Partial Edit
 * Pane's user-initiated navigation (PartialEditView#revealTargetInEditor).
 * Moved here VERBATIM from OutlineTreeView (scrollLineToTop /
 * scrollOffscreenContentIntoView / stabilizeScrollToLine and the
 * getEditorCmView cast) so both panels get the exact same top-aligned
 * scroll, off-screen-Properties fallback and post-jump stabilizer instead
 * of two diverging implementations. Each panel owns ONE EditorLineRevealer
 * instance, so each keeps its own stabilizer window (a new jump cancels
 * only that panel's previous window) and cancels it in its own onClose.
 *
 * Deliberately does NOT decide which editor to use or whether to focus it
 * — callers pass the editor they already resolved through their own
 * ActiveMarkdownViewTracker (active-leaf-first policy) and handle focus
 * themselves.
 */
import type { Editor } from "obsidian";
import { EditorView } from "@codemirror/view";
import { computeOffscreenContentScrollTop } from "./offscreenContentScroll";

/**
 * Reaches into an Obsidian `Editor` to retrieve its underlying CM6
 * `EditorView`, via the `.cm` property Obsidian's Editor wrapper exposes —
 * an unofficial but extremely long-stable convention across the plugin
 * ecosystem, not part of obsidian.d.ts (see scrollLineToTop below for the
 * full rationale on why this is the sanctioned way to interoperate with
 * CM6). Centralized here (instead of repeating the cast at each call site)
 * so there is exactly one `unknown`-mediated cast to review; every caller
 * still gets `EditorView | undefined` and must handle the `undefined` case
 * explicitly (the private `.cm` field could in principle be
 * renamed/removed by a future Obsidian version).
 */
export function getEditorCmView(editor: Editor): EditorView | undefined {
  const withCm = editor as unknown as { cm?: EditorView };
  return withCm.cm;
}

export class EditorLineRevealer {
  /**
   * Teardown for the short "keep the jumped-to line at the top" window
   * started by scrollLineToTop (see stabilizeScrollToLine). Null when no
   * window is active.
   */
  private cancelScrollStabilize: (() => void) | null = null;

  /**
   * Moves `editor`'s cursor to the start of `line` and scrolls that line to
   * the top of the viewport (scrollLineToTop). Never focuses the editor —
   * the caller decides that.
   */
  revealLine(editor: Editor, line: number): void {
    editor.setCursor({ line, ch: 0 });
    this.scrollLineToTop(editor, line);
  }

  /** Ends any active post-jump stabilizer window (call from the owning view's onClose). */
  cancel(): void {
    this.cancelScrollStabilize?.();
  }

  /**
   * Scrolls the body editor so `line` lands at the TOP of the visible
   * viewport, rather than Obsidian's public `Editor.scrollIntoView`, whose
   * `center` boolean only offers "center it" or "minimal/nearest-edge
   * scroll" — neither of which reliably puts the target line at the top
   * (user report: after a tree jump, the target line could end up
   * anywhere in the viewport depending on where the previous scroll
   * position happened to be).
   *
   * `Editor.scrollIntoView` has no "align to start" option, so this reaches
   * into the underlying CM6 `EditorView` (via the `.cm` property that
   * Obsidian's Editor wrapper exposes — an unofficial but extremely
   * long-stable convention across the plugin ecosystem, not part of
   * obsidian.d.ts) and dispatches CM6's own `EditorView.scrollIntoView(pos,
   * { y: "start" })`, which is CM6's native, precise "top-align" primitive.
   * `@codemirror/view` is bundled by Obsidian itself and listed as an
   * esbuild `external` (see esbuild.config.mjs), so importing it here
   * resolves to the exact same module/prototypes Obsidian's own editor
   * uses — this is the standard, sanctioned way plugins interoperate with
   * CM6, not a bundling hack.
   *
   * Falls back to the previous `Editor.scrollIntoView(..., true)` (center)
   * behavior if `.cm` is ever absent — keeps this from throwing even if
   * that private property is renamed/removed in a future Obsidian version.
   */
  scrollLineToTop(editor: Editor, line: number): void {
    const cm = getEditorCmView(editor);
    if (!cm) {
      const lineLength = editor.getLine(line)?.length ?? 0;
      editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch: lineLength } },
        true
      );
      return;
    }
    // CM6's Text.line() is 1-indexed; Obsidian's Editor line numbers (and
    // this view's own `node.line`) are 0-indexed throughout.
    const clampedLine = Math.min(Math.max(line, 0), cm.state.doc.lines - 1);
    const pos = cm.state.doc.line(clampedLine + 1).from;
    // 2026-09-30: when the content DOM is entirely off screen (a Properties
    // block taller than the viewport, scrolled to the top), CM6 is not
    // measuring and drops the scrollIntoView effect below — scroll the
    // scroller directly first. See offscreenContentScroll.ts.
    this.scrollOffscreenContentIntoView(cm, pos);
    cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
    this.stabilizeScrollToLine(cm, pos);
  }

  /**
   * No-op while CM6 considers its content in view (the normal case, where
   * the dispatched scrollIntoView effect works on its own). Otherwise sets
   * scrollDOM.scrollTop directly to CM6's height-map estimate of `pos`, so
   * the content becomes visible, CM6 resumes measuring, and the regular
   * scroll + stabilizer can correct any estimate error. Returns whether a
   * direct scroll was issued.
   */
  private scrollOffscreenContentIntoView(cm: EditorView, pos: number): boolean {
    if (cm.inView) return false;
    const target = computeOffscreenContentScrollTop({
      scrollTop: cm.scrollDOM.scrollTop,
      scrollerTop: cm.scrollDOM.getBoundingClientRect().top,
      contentTop: cm.contentDOM.getBoundingClientRect().top,
      lineTop: cm.lineBlockAt(pos).top,
    });
    if (target === cm.scrollDOM.scrollTop) return false;
    cm.scrollDOM.scrollTop = target;
    return true;
  }

  /**
   * 2026-09-27 (List + Callout のリスト行クリック時のずれ): CM6 scrolls using
   * the heights it knows at dispatch time. When the lines around the target
   * contain block widgets whose real height is only known later — above
   * all image embeds (`- [ ] ![[scan.jpg]]` list rows of a List + Callout
   * group), which load asynchronously, and the target line itself switching
   * its embed to source view once the cursor lands on it — those heights
   * change AFTER the scroll, so the target drifts (the reported symptom:
   * the image's top cut off and the following callout shown instead,
   * landing somewhere different on every click). Callout rows were not
   * affected because a callout's rendered height is stable immediately.
   *
   * Fix: for a short window after the jump, re-issue the same top-aligned
   * scroll whenever the editor content's size changes (ResizeObserver on
   * contentDOM — covers image loads, widget re-measures and source/preview
   * toggles alike) and once after the next two frames. The window ends
   * early, and never fights the user, on any wheel / touch / pointer / key
   * input in the editor, on the next jump, or when this view closes.
   */
  private stabilizeScrollToLine(cm: EditorView, pos: number): void {
    this.cancelScrollStabilize?.();
    const STABILIZE_MS = 2000;
    // Hard cap on corrective scrolls per jump, so a note whose layout never
    // settles (e.g. a widget that keeps resizing) cannot keep the editor
    // pinned for the whole window.
    const MAX_REAPPLY = 8;
    // Tolerance, in px, between the target line's top and the scroller's
    // top before a corrective scroll is issued.
    const TOLERANCE_PX = 2;
    let active = true;
    let reapplyCount = 0;
    let rafId: number | null = null;

    // Runs in its own animation frame, never inside the ResizeObserver
    // callback itself (2026-09-27 follow-up): dispatching a scroll there
    // makes CM6 render/measure new lines in the same frame, which resizes
    // the very element being observed and triggers the browser's
    // "ResizeObserver loop completed with undelivered notifications" error
    // (surfaced as a notice by error-reporting plugins in some vaults).
    // It also scrolls ONLY when the target line is actually off the top,
    // so a settled layout produces no further scroll (and no feedback).
    const reapply = (): void => {
      rafId = null;
      if (!active) return;
      if (pos > cm.state.doc.length) return cancel();
      const coords = cm.coordsAtPos(pos);
      const scrollerTop = cm.scrollDOM.getBoundingClientRect().top;
      if (coords && Math.abs(coords.top - scrollerTop) <= TOLERANCE_PX) return;
      if (reapplyCount >= MAX_REAPPLY) return cancel();
      reapplyCount++;
      // Same off-screen-content fallback as scrollLineToTop: the content
      // may still (or again) be out of view, e.g. while the Properties
      // block above it is still growing.
      this.scrollOffscreenContentIntoView(cm, pos);
      cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
    };
    const scheduleReapply = (): void => {
      if (!active || rafId !== null) return;
      rafId = window.requestAnimationFrame(reapply);
    };

    // First check two frames after the initial jump.
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      scheduleReapply();
    });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleReapply());
    observer?.observe(cm.contentDOM);
    const userEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const onUserInput = (): void => cancel();
    for (const type of userEvents) {
      cm.scrollDOM.addEventListener(type, onUserInput, { passive: true, capture: true });
    }
    const timeoutId = window.setTimeout(() => cancel(), STABILIZE_MS);
    const cancel = (): void => {
      if (!active) return;
      active = false;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = null;
      window.clearTimeout(timeoutId);
      observer?.disconnect();
      for (const type of userEvents) {
        cm.scrollDOM.removeEventListener(type, onUserInput, { capture: true });
      }
      if (this.cancelScrollStabilize === cancel) this.cancelScrollStabilize = null;
    };
    this.cancelScrollStabilize = cancel;
  }
}

/**
 * Fail-safe wrapper used by the Partial Edit Pane: reveals `line` in
 * `editor` and reports whether it did. A missing editor/line, or ANY error
 * thrown by the editor/CM6 while revealing, is a silent no-op (false) —
 * never a Notice, never an exception into the caller, so the pane's own
 * target switch (which has already completed) is never affected.
 */
export function revealLineSafely(
  revealer: Pick<EditorLineRevealer, "revealLine">,
  editor: Editor | null | undefined,
  line: number | null | undefined
): boolean {
  if (!editor || line === null || line === undefined || line < 0) return false;
  try {
    revealer.revealLine(editor, line);
    return true;
  } catch {
    return false;
  }
}
