/**
 * Issue #4 (1.0.8): keeps the Outline Tree from rebuilding its DOM while a
 * press that started inside the tree is still in progress.
 *
 * refresh() replaces every row. If it runs between a row's pointerdown and
 * pointerup (the 150 ms debounced refresh started by active-leaf-change /
 * editor-change / keyup / mouseup easily lands there), the pressed row is
 * detached before mouseup and the browser never fires its `click` — the
 * user's click is lost. While a tree press is active, refresh() asks this
 * gate first: the gate records that a refresh is owed and refresh() returns
 * without touching anything. When the press ends (pointerup, pointercancel,
 * lostpointercapture, drag start/end, window blur) the owed refresh runs
 * ONCE, on a later task via the injected scheduler — never synchronously
 * inside pointerup, so the same gesture's `click` (dispatched right after
 * pointerup/mouseup in the same task) still reaches the original row.
 *
 * Pure state machine: no window/document/Obsidian dependency, so it can be
 * unit-tested with a fake scheduler.
 */

export interface RefreshGateScheduler {
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

export class TreePointerRefreshGate {
  private readonly activePointerIds = new Set<number>();
  private pending = false;
  private flushHandle: number | null = null;
  private disposed = false;

  constructor(
    private readonly runRefresh: () => void,
    private readonly scheduler: RefreshGateScheduler
  ) {}

  /** True while a press that started inside the tree has not ended. */
  isPointerActive(): boolean {
    return this.activePointerIds.size > 0;
  }

  /** True while a refresh is owed (requested during a press, not yet run). */
  hasPendingRefresh(): boolean {
    return this.pending;
  }

  /**
   * A press started inside the tree. A primary pointer means no other
   * pointer of its type is down, so any id left over from a release we
   * never saw is dropped here instead of blocking refreshes forever.
   */
  pointerDown(pointerId: number, isPrimary: boolean): void {
    if (this.disposed) return;
    if (isPrimary) this.activePointerIds.clear();
    this.activePointerIds.add(pointerId);
    // A flush queued by an earlier release must not run under this press.
    this.cancelFlush();
  }

  /** pointerup / pointercancel / lostpointercapture for `pointerId`. */
  pointerReleased(pointerId: number): void {
    if (this.disposed || !this.activePointerIds.delete(pointerId)) return;
    if (this.activePointerIds.size === 0) this.scheduleFlush();
  }

  /** The press ended without per-pointer events (drag start/end, window blur). */
  releaseAll(): void {
    if (this.disposed || this.activePointerIds.size === 0) return;
    this.activePointerIds.clear();
    this.scheduleFlush();
  }

  /**
   * Called at the very top of refresh(). Returns true when refresh() must
   * return without doing anything (a press is active; the refresh is now
   * owed). Returns false when refresh() should proceed — and since that
   * refresh covers anything owed, the owed flag and any queued flush are
   * dropped so the same work never runs twice.
   */
  deferRefreshIfPointerActive(): boolean {
    if (this.disposed) return false;
    if (this.activePointerIds.size > 0) {
      this.pending = true;
      return true;
    }
    this.pending = false;
    this.cancelFlush();
    return false;
  }

  /** View close: forget everything and never call runRefresh again. */
  dispose(): void {
    this.disposed = true;
    this.activePointerIds.clear();
    this.pending = false;
    this.cancelFlush();
  }

  private scheduleFlush(): void {
    if (!this.pending || this.flushHandle !== null) return;
    this.flushHandle = this.scheduler.schedule(() => {
      this.flushHandle = null;
      if (this.disposed || !this.pending || this.activePointerIds.size > 0) return;
      this.pending = false;
      this.runRefresh();
    });
  }

  private cancelFlush(): void {
    if (this.flushHandle === null) return;
    this.scheduler.cancel(this.flushHandle);
    this.flushHandle = null;
  }
}
