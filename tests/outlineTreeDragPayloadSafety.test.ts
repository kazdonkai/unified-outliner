import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-2R ("Tree D&D の外部 drop 安全化"): static-source-text checks for
 * view/OutlineTreeView.ts's DataTransfer payload policy.
 *
 * Background: a real-device pass during Phase 5T-2 proved that dropping ANY
 * Tree row (section, list, or paragraph) outside the Tree — most notably
 * onto Obsidian's body editor — is never intercepted by any Tree-side
 * dragover/drop listener (those are only attached to Tree row DOM
 * elements), so evt.preventDefault() is never called for that drop, and the
 * browser/Electron/CodeMirror's own default text/plain drop-handling runs
 * instead, inserting whatever string was written via
 * dataTransfer.setData("text/plain", ...) at dragstart as literal text into
 * the Markdown body. Before this phase both drag sources wrote the REAL
 * internal id (sectionId, or node.id such as "tree-paragraph:2") into that
 * payload, so an external drop corrupted the document with that id string.
 * This file locks in the fix: both dragstart sites now write an
 * intentionally empty "" sentinel instead, and — as this file also proves —
 * no Tree-internal decision logic has ever depended on reading the
 * DataTransfer payload back (it already used only private instance state:
 * this.dragSourceId for section/list, this.paragraphDragSession for
 * paragraph), so this is a pure payload-content change with zero behavioral
 * change to any valid Tree-internal drag/drop path.
 *
 * Phase 5D-3C ("Callout and Blockquote Drag and Drop") ADDED a THIRD
 * dragstart call site, handleCalloutDragStart — a standalone or
 * CompositeBlock-member callout/blockquote row becoming a D&D source for
 * the first time. It follows the exact same empty-string-sentinel policy
 * this file already locks in for the other two sources (see
 * getHandleCalloutDragStartBody's own tests below) — this ticket's own
 * pre-commit report explains why (dropping a callout/blockquote row
 * outside the Tree must not leak an internal id into the body as literal
 * text either).
 *
 * Phase 5D-4C ("CompositeBlock Atomic Drag-and-Drop 最小実装") ADDS a
 * FOURTH dragstart call site, handleCompositeDragStart — a CompositeBlock
 * PARENT row (the Tree row representing a whole List+Callout / List+Quote
 * composite as one atomic unit) becoming a D&D source for the first time.
 * It follows the exact same empty-string-sentinel policy as every prior
 * source (see getHandleCompositeDragStartBody's own tests below). This
 * update to the present file is itself the required "追随更新"
 * (follow-up update) that Phase 5D-4C's own approval mandates: the two
 * hard-coded call-site/listener counts below (previously 3 and 4) are
 * updated to 4 and 5 to reflect this new, legitimate fourth source, and
 * new assertions are added — not merely the count bump — proving
 * handleCompositeDragStart actually satisfies this file's own payload
 * safety contract, that it is wired ONLY to the CompositeBlock parent-row
 * branch (never to a member row, a complex-member row, a paragraph row, a
 * section row, or a plain list row), and that every CompositeBlock D&D
 * termination path (dragend, drop, cancel) still reaches endDrag() and
 * clears all four session fields. No existing assertion for the
 * section/list, paragraph, or callout/blockquote sources is weakened,
 * removed, or narrowed by this update.
 *
 * Same architectural constraint as tests/paragraphOutlineTreeUiWiring.test.ts
 * and tests/listPrefixUiWiring.test.ts: OutlineTreeView extends Obsidian's
 * ItemView, which cannot be constructed in vitest ("obsidian" is a
 * types-only package here), so this file inspects the raw source text of
 * OutlineTreeView.ts rather than instantiating the view and dispatching
 * real DragEvents. Within that constraint, the checks below go beyond a
 * loose substring "contains" match: they extract the exact bounded body of
 * each relevant method and assert the literal setData(...) call argument,
 * so a regression that reintroduces `sectionId` or `node.id` as the payload
 * — even if surrounded by different comments — fails the test.
 */
describe("OutlineTreeView.ts drag payload safety (static source check, Phase 5T-2R)", () => {
  const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");

  function getMethodBody(signature: string, label: string): string {
    const start = viewTs.indexOf(signature);
    if (start === -1) {
      throw new Error(`${signature} not found in src/view/OutlineTreeView.ts — has ${label} been renamed or removed?`);
    }
    // Bound the body at the next top-level "  private " or "  }" that closes
    // the method — simplest robust bound here is the next blank-line-preceded
    // closing brace at 2-space indent, but to stay resilient to reformatting
    // we instead search for the next occurrence of "\n  }\n" after start,
    // which closes the enclosing method body at the class's method
    // indentation level.
    const closeIdx = viewTs.indexOf("\n  }\n", start);
    if (closeIdx === -1) {
      throw new Error(`Could not find the closing brace for ${label} — update this test's bounding logic.`);
    }
    return viewTs.slice(start, closeIdx);
  }

  function getHandleDragStartBody(): string {
    return getMethodBody(
      "private handleDragStart(evt: DragEvent, sectionId: string, itemEl: HTMLElement): void {",
      "handleDragStart"
    );
  }

  function getHandleParagraphDragStartBody(): string {
    // handleParagraphDragStart's signature spans multiple lines in source;
    // anchor on the unique statement that assigns paragraphDragSession,
    // which only appears once and only inside this method.
    const start = viewTs.indexOf("this.paragraphDragSession = {");
    if (start === -1) {
      throw new Error(
        "this.paragraphDragSession assignment not found — has handleParagraphDragStart been restructured?"
      );
    }
    const closeIdx = viewTs.indexOf("\n  }\n", start);
    if (closeIdx === -1) {
      throw new Error("Could not find the closing brace for handleParagraphDragStart — update this test's bounding logic.");
    }
    return viewTs.slice(start, closeIdx);
  }

  function getHandleCalloutDragStartBody(): string {
    // handleCalloutDragStart's signature spans multiple lines in source;
    // anchor on the unique statement that assigns calloutDragSession,
    // which only appears once and only inside this method.
    const start = viewTs.indexOf("this.calloutDragSession = {");
    if (start === -1) {
      throw new Error(
        "this.calloutDragSession assignment not found — has handleCalloutDragStart been restructured?"
      );
    }
    const closeIdx = viewTs.indexOf("\n  }\n", start);
    if (closeIdx === -1) {
      throw new Error("Could not find the closing brace for handleCalloutDragStart — update this test's bounding logic.");
    }
    return viewTs.slice(start, closeIdx);
  }

  function getHandleCompositeDragStartBody(): string {
    // Phase 5D-4C: handleCompositeDragStart's signature spans multiple
    // lines in source; anchor on the unique statement that assigns
    // compositeDragSession, which only appears once and only inside this
    // method — mirrors getHandleCalloutDragStartBody's own anchoring
    // strategy exactly.
    const start = viewTs.indexOf("this.compositeDragSession = {");
    if (start === -1) {
      throw new Error(
        "this.compositeDragSession assignment not found — has handleCompositeDragStart been restructured?"
      );
    }
    const closeIdx = viewTs.indexOf("\n  }\n", start);
    if (closeIdx === -1) {
      throw new Error("Could not find the closing brace for handleCompositeDragStart — update this test's bounding logic.");
    }
    return viewTs.slice(start, closeIdx);
  }

  /**
   * Phase 5D-4C: bounds the entire renderNode drag-wiring if/else-if chain
   * (section/list through the new CompositeBlock parent-row branch) as one
   * text range, so that the CompositeBlock wiring-exclusion tests below can
   * make positional assertions ("this wiring call falls strictly inside
   * the isComposite branch, which is the LAST branch in the chain — so it
   * cannot be inside any earlier branch") without needing a separate,
   * fragile bounding helper for each of the four earlier branches
   * individually. The start anchor ("if (!readOnly) {\n      if
   * (Platform.isMobile) {") is not unique to this chain by itself — the
   * bare condition text appears elsewhere in renderNode for unrelated
   * read-only checks — but this exact two-line combination only occurs at
   * the drag-wiring chain's own start.
   */
  function getDragWiringChainRange(): { start: number; end: number } {
    const start = viewTs.indexOf("if (!readOnly) {\n      if (Platform.isMobile) {");
    if (start === -1) {
      throw new Error("Drag-wiring if/else-if chain start not found — has renderNode been restructured?");
    }
    const end = viewTs.indexOf("\n    if (hasChildren && !isCollapsed) {", start);
    if (end === -1) {
      throw new Error("Could not find the end of the drag-wiring chain — update this test's bounding logic.");
    }
    return { start, end };
  }

  function getCompositeDragWiringBranchBody(): string {
    const { start: chainStart, end: chainEnd } = getDragWiringChainRange();
    // Phase 5D-4D: the branch's own gate condition widened from
    // `isComposite && !Platform.isMobile` to plain `isComposite` (mobile is
    // no longer excluded — see docs/phase5d4d_mobile_composite_block_drag_handle_design.md).
    // The bare string "} else if (isComposite) {" is NOT globally unique in
    // this file (an unrelated label-rendering branch and an unrelated
    // desktop contextmenu branch, both earlier in renderNode, also match
    // it) — so the search is scoped to [chainStart, chainEnd), the drag-
    // wiring chain's own range, where it IS unique.
    const wholeChain = viewTs.slice(chainStart, chainEnd);
    const branchStartInChain = wholeChain.indexOf("} else if (isOperableComposite) {");
    if (branchStartInChain === -1) {
      throw new Error("isComposite drag-wiring branch not found — has renderNode's branch chain changed?");
    }
    const branchStart = chainStart + branchStartInChain;
    return viewTs.slice(branchStart, chainEnd);
  }

  it("has exactly four dataTransfer.setData(...) call sites in the whole file (section/list dragstart, paragraph dragstart, callout/blockquote dragstart, CompositeBlock dragstart) — no new drag source was added without updating this test", () => {
    const matches = viewTs.match(/\.setData\(/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it("handleDragStart (section/list) writes the empty-string sentinel, never the real sectionId, as the text/plain payload", () => {
    const body = getHandleDragStartBody();
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).not.toContain('setData("text/plain", sectionId)');
    // Defense in depth: the literal identifier `sectionId` must not appear
    // anywhere inside a setData(...) call in this body.
    const setDataCalls = body.match(/\.setData\([^)]*\)/g) ?? [];
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/sectionId/);
    }
  });

  it("handleDragStart (section/list) still sets effectAllowed = \"move\" unchanged", () => {
    const body = getHandleDragStartBody();
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
  });

  it("handleParagraphDragStart writes the empty-string sentinel, never the real node.id, as the text/plain payload", () => {
    const body = getHandleParagraphDragStartBody();
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).not.toContain('setData("text/plain", node.id)');
    const setDataCalls = body.match(/\.setData\([^)]*\)/g) ?? [];
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/node\.id/);
    }
  });

  it("handleParagraphDragStart still sets effectAllowed = \"move\" unchanged", () => {
    const body = getHandleParagraphDragStartBody();
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
  });

  it("handleCalloutDragStart writes the empty-string sentinel, never the real node.id, as the text/plain payload (Phase 5D-3C)", () => {
    const body = getHandleCalloutDragStartBody();
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).not.toContain('setData("text/plain", node.id)');
    const setDataCalls = body.match(/\.setData\([^)]*\)/g) ?? [];
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/node\.id/);
    }
  });

  it("handleCalloutDragStart still sets effectAllowed = \"move\" unchanged (Phase 5D-3C)", () => {
    const body = getHandleCalloutDragStartBody();
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
  });

  it("handleCompositeDragStart writes the empty-string sentinel, never the real compositeId/node.id, as the text/plain payload (Phase 5D-4C)", () => {
    const body = getHandleCompositeDragStartBody();
    expect(body).toContain('evt.dataTransfer.setData("text/plain", "");');
    expect(body).not.toContain('setData("text/plain", compositeId)');
    expect(body).not.toContain('setData("text/plain", node.id)');
    const setDataCalls = body.match(/\.setData\([^)]*\)/g) ?? [];
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/compositeId/);
      expect(call).not.toMatch(/node\.id/);
    }
  });

  it("handleCompositeDragStart still sets effectAllowed = \"move\" unchanged (Phase 5D-4C)", () => {
    const body = getHandleCompositeDragStartBody();
    expect(body).toContain('evt.dataTransfer.effectAllowed = "move";');
  });

  it("handleCompositeDragStart uses the identical empty-string sentinel statement as handleCalloutDragStart — same cross-browser HTML5 drag-start compatibility contract, not merely an equivalent-looking one (Phase 5D-4C)", () => {
    const sentinel = 'evt.dataTransfer.setData("text/plain", "");';
    expect(getHandleCompositeDragStartBody()).toContain(sentinel);
    expect(getHandleCalloutDragStartBody()).toContain(sentinel);
  });

  it("no setData(...) call anywhere in the file embeds a node-id-shaped or body-text-shaped literal (sec-, li-, tree-paragraph:, paragraph-, or a template/concat expression)", () => {
    const setDataCalls = viewTs.match(/\.setData\([^)]*\)/g) ?? [];
    expect(setDataCalls.length).toBeGreaterThan(0);
    for (const call of setDataCalls) {
      expect(call).not.toMatch(/sec-|li-|tree-paragraph:|paragraph-/);
      // Only a bare empty-string literal is permitted as the payload
      // argument — reject any interpolation, concatenation, or variable
      // reference, which would reintroduce a path for real content to leak.
      expect(call).toMatch(/\.setData\("text\/plain",\s*""\)/);
    }
  });

  it("never reads dataTransfer payload back anywhere in the file (no getData(...) call exists) — proves no Tree-internal decision can be driven by DataTransfer content", () => {
    expect(viewTs).not.toContain("getData");
  });

  it("handleDrop (section/list) still makes its allow/deny and source decisions from this.dragSourceId (private instance state), not from the DragEvent's DataTransfer", () => {
    const start = viewTs.indexOf("private handleDrop(evt: DragEvent, targetId: string, selfEl: HTMLElement): void {");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("const sourceId = this.dragSourceId;");
    expect(body).toContain("this.canDropAny(doc, sourceId, targetId)");
    expect(body).not.toContain("dataTransfer");
  });

  it("handleParagraphDrop still makes its allow/deny and source decisions from this.paragraphDragSession (private instance state), not from the DragEvent's DataTransfer", () => {
    const start = viewTs.indexOf("private handleParagraphDrop(");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("if (!session) return;");
    expect(body).not.toContain("dataTransfer");
  });

  it("endDrag() still unconditionally clears dragSourceId, paragraphDragSession, calloutDragSession, AND compositeDragSession (dragend/invalid-drop/refresh/onClose cleanup contract unchanged, Phase 5D-4C extends it rather than replacing it, exactly as Phase 5D-3C did before it)", () => {
    const start = viewTs.indexOf("private endDrag(): void {");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("this.dragSourceId = null;");
    expect(body).toContain("this.paragraphDragSession = null;");
    expect(body).toContain("this.calloutDragSession = null;");
    expect(body).toContain("this.compositeDragSession = null;");
  });

  it("cancelParagraphDrag() is still wired into both refresh() (Tree refresh) and onClose() (view close) cleanup paths", () => {
    // Two call sites are documented and expected: refresh()'s own guard and
    // onClose(). A third occurrence is the method's own definition line.
    const occurrences = viewTs.match(/this\.cancelParagraphDrag\(\);/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(viewTs).toContain("private cancelParagraphDrag(): void {");
  });

  it("cancelCalloutDrag() is wired into both refresh() and onClose() cleanup paths, mirroring cancelParagraphDrag() (Phase 5D-3C)", () => {
    const occurrences = viewTs.match(/this\.cancelCalloutDrag\(\);/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(viewTs).toContain("private cancelCalloutDrag(): void {");
  });

  it("cancelCompositeDrag() is wired into both refresh() and onClose() cleanup paths, mirroring cancelParagraphDrag()/cancelCalloutDrag() (Phase 5D-4C)", () => {
    const occurrences = viewTs.match(/this\.cancelCompositeDrag\(\);/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(viewTs).toContain("private cancelCompositeDrag(): void {");
  });

  it("cancelCompositeDrag() itself calls endDrag() (and clearDropIndicator()) so a CompositeBlock drag session can never survive a refresh()/onClose()-triggered cancel — mirrors cancelParagraphDrag()/cancelCalloutDrag()'s identical body shape exactly (Phase 5D-4C)", () => {
    const start = viewTs.indexOf("private cancelCompositeDrag(): void {");
    const end = viewTs.indexOf("\n  }\n", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("if (!this.compositeDragSession) return;");
    expect(body).toContain("this.endDrag();");
    expect(body).toContain("this.clearDropIndicator();");
  });

  it("the CompositeBlock parent-row branch's own drop handler calls endDrag() before delegating to handleCompositeDropNode (Phase 5D-4C) — mirrors the callout/blockquote and paragraph branches' own drop-then-endDrag ordering, so a completed drop clears the session synchronously rather than relying solely on the later dragend", () => {
    const body = getCompositeDragWiringBranchBody();
    expect(body).toContain("this.endDrag();");
    expect(body).toContain("this.handleCompositeDropNode(session, evt, node, selfEl);");
  });

  it("every drag-source row kind (section/list, paragraph, standalone callout/blockquote, CompositeBlock-member callout/blockquote, CompositeBlock parent row) still binds a dragend listener to handleDragEnd on the source element itself (native HTML5 dragend fires on the drag source regardless of where — or whether — the drop landed, so this is what guarantees cleanup even for an external drop that no Tree listener ever saw)", () => {
    // Phase 5D-3C added two MORE dragend bindings alongside the original
    // two (section/list, paragraph): one for the standalone callout/
    // blockquote row (which is now ALSO a drag source, not just a drop
    // target — see that branch's own updated doc comment in renderNode),
    // and one for the brand-new CompositeBlock-member callout/blockquote
    // branch — bringing the total to four. Phase 5D-4C adds ONE more, for
    // the new CompositeBlock parent-row branch (isComposite) — five is the
    // correct, current total.
    const occurrences = viewTs.match(/addEventListener\("dragend", \(\) => this\.handleDragEnd\(\)\);/g) ?? [];
    expect(occurrences.length).toBe(5);
  });

  it("this.handleCompositeDragStart(...) wiring appears exactly once in the whole file, strictly inside the isComposite (CompositeBlock parent row) branch — never inside the earlier section/list, paragraph, standalone callout/blockquote, or CompositeBlock-member callout/blockquote branches, i.e. CompositeBlock dragstart is never wired to a member row, a complex-member row, a paragraph row, a section row, or a plain list row (Phase 5D-4C; Phase 5D-4D widens the branch's own gate to admit mobile too, without moving this wiring)", () => {
    const wiringCalls = viewTs.match(/this\.handleCompositeDragStart\(/g) ?? [];
    expect(wiringCalls.length).toBe(1);

    const { start: chainStart, end: chainEnd } = getDragWiringChainRange();
    // Phase 5D-4D: "} else if (isComposite) {" is not globally unique (see
    // getCompositeDragWiringBranchBody's own comment), so this is scoped
    // to the chain's own range exactly like that helper.
    const wholeChain = viewTs.slice(chainStart, chainEnd);
    const branchStart = chainStart + wholeChain.indexOf("} else if (isOperableComposite) {");
    expect(branchStart).toBeGreaterThan(chainStart);
    expect(branchStart).toBeLessThan(chainEnd);

    const wiringIdx = viewTs.indexOf("this.handleCompositeDragStart(");
    // The isComposite branch is the LAST branch in the if/else-if chain
    // (chainEnd is the landmark that closes the whole chain), so proving
    // the one-and-only wiring call falls between branchStart and chainEnd
    // proves it cannot be inside any of the four earlier branches, which
    // all occupy the range [chainStart, branchStart).
    expect(wiringIdx).toBeGreaterThan(branchStart);
    expect(wiringIdx).toBeLessThan(chainEnd);
  });

  it("section/list, paragraph, and callout/blockquote drag sources each still wire dragstart the exact same number of times as before Phase 5D-4C — proves CompositeBlock D&D was purely additive to renderNode's branch chain, not a restructuring of any existing branch (Phase 5D-4C non-regression)", () => {
    expect((viewTs.match(/this\.handleDragStart\(/g) ?? []).length).toBe(1);
    expect((viewTs.match(/this\.handleParagraphDragStart\(/g) ?? []).length).toBe(1);
    // Two call sites: the standalone callout/blockquote branch and the
    // CompositeBlock-member callout/blockquote branch (Phase 5D-3C) — both
    // unchanged by Phase 5D-4C.
    expect((viewTs.match(/this\.handleCalloutDragStart\(/g) ?? []).length).toBe(2);
  });

});
