import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"):
 * OutlineTreeView.ts's renderNode is a method of an Obsidian ItemView
 * subclass — "obsidian" is a types-only package in this repo, so
 * OutlineTreeView cannot be constructed in vitest and renderNode cannot be
 * called directly. Same static-source-text approach as
 * tests/commandTable.test.ts / tests/outlineTreeSidebarPlacementUiWiring.test.ts
 * for this same constraint. The actual prefix VALUE logic
 * (listPrefixText) is unit-tested with real assertions in
 * tests/buildOutlineTree.test.ts — this file only confirms
 * OutlineTreeView.ts's own rendering call site wires that value in
 * correctly and doesn't disturb the composite/complex-member/heading
 * prefix rendering it sits alongside.
 */
describe("OutlineTreeView.ts list prefix rendering (static source check, UXP-04)", () => {
  const viewTs = readFileSync(
    path.resolve(__dirname, "../src/view/OutlineTreeView.ts"),
    "utf-8"
  );

  function getRenderNodeBody(): string {
    const start = viewTs.indexOf(
      "private renderNode(node: OutlineTreeNode, parentEl: HTMLElement): void {"
    );
    const end = viewTs.indexOf("private toggleCollapse(id: string): void {", start);
    if (start === -1) {
      throw new Error(
        "renderNode() not found in src/view/OutlineTreeView.ts — has it been renamed or removed?"
      );
    }
    if (end === -1 || end <= start) {
      throw new Error(
        "Could not find the method following renderNode() (toggleCollapse) — has the class's method order changed? Update this test's bounding logic."
      );
    }
    return viewTs.slice(start, end);
  }

  /**
   * Phase 5D-4D (2026-09, "CompositeBlock 親行へのモバイル六点ハンドル追加")
   * landmark update. The contract this helper protects is UNCHANGED from
   * UXP-04: "the list row's own rendering code, up to the next
   * `} else if (isComposite) {` composite-block LABEL-rendering branch,
   * never calls innerEl.setText". Only the END landmark had to change —
   * the bare substring "isComposite) {" stopped being safe once Phase
   * 5D-4D introduced `if (!readOnly || isComposite) {` (dragHandleEl's own
   * generation gate), which sits BEFORE the list row branch and also
   * contains that bare substring, so `body.indexOf("isComposite) {")`
   * would resolve to THAT occurrence — well before the list branch even
   * starts — rather than the intended composite-block label branch. The
   * fix uses the fuller, structural `"} else if (isComposite) {"` token
   * (which the dragHandleEl gate's plain `if (...)` statement, having no
   * preceding `} else if (`, can never match), plus explicit landmark
   * presence/uniqueness/ordering/non-empty guards instead of a bare,
   * implicit substring search.
   */
  function listRowBranchBody(): string {
    const body = getRenderNodeBody();

    // This bare landmark recurs 3 times within renderNode's own body (the
    // render branch targeted here, the desktop contextmenu chain's own
    // list branch, and the mobile long-press-layer's own list branch) —
    // deliberately taking the FIRST occurrence is correct because it is
    // renderNode's OWN list-row rendering branch, which textually precedes
    // every other list-related branch in the method. Asserted explicitly
    // (rather than assumed) so a future addition/removal of any of the
    // three is caught here.
    const startLandmark = "isOutlineListNode(node)) {";
    const startOccurrences = body.split(startLandmark).length - 1;
    if (startOccurrences === 0) {
      throw new Error(
        `list row branch start landmark ${JSON.stringify(startLandmark)} not found in renderNode() — has the list row branch been renamed or removed? Update this test's bounding logic.`
      );
    }
    expect(startOccurrences).toBe(3);
    const listBranchStart = body.indexOf(startLandmark);
    expect(listBranchStart).toBeGreaterThan(-1);

    // Similarly, this fuller landmark recurs 2 times within renderNode's
    // own body (the composite-block LABEL-rendering branch targeted here,
    // and the desktop contextmenu chain's own composite branch, in that
    // order; v1.0.4: the drag-wiring chain's branch is now gated by
    // `isOperableComposite` instead) — searching
    // from listBranchStart onward and taking the nearest one is the
    // deliberate, correct choice (it is renderNode's own next sibling
    // branch immediately after the list branch). Asserted explicitly for
    // the same reason as above.
    const endLandmark = "} else if (isComposite) {";
    const endOccurrences = body.split(endLandmark).length - 1;
    if (endOccurrences === 0) {
      throw new Error(
        `composite-block label-rendering branch landmark ${JSON.stringify(endLandmark)} not found in renderNode() — has it been renamed, removed, or reordered? Update this test's bounding logic.`
      );
    }
    expect(endOccurrences).toBe(2);
    const compositeBranchStart = body.indexOf(endLandmark, listBranchStart);
    if (compositeBranchStart === -1) {
      throw new Error(
        `composite-block label-rendering branch landmark ${JSON.stringify(endLandmark)} not found after the list row branch — has branch ordering changed? Update this test's bounding logic.`
      );
    }
    if (compositeBranchStart <= listBranchStart) {
      throw new Error(
        "composite-block label-rendering branch landmark resolved at or before the list row branch's own start — bounding logic is broken."
      );
    }

    const listBranchBody = body.slice(listBranchStart, compositeBranchStart);
    if (listBranchBody.trim().length === 0) {
      throw new Error("list row branch body extracted as empty — bounding logic is broken.");
    }
    return listBranchBody;
  }

  it("renderNode() exists in src/view/OutlineTreeView.ts", () => {
    expect(viewTs).toContain(
      "private renderNode(node: OutlineTreeNode, parentEl: HTMLElement): void {"
    );
  });

  it("creates a dedicated unified-outliner-list-prefix span, only when node.prefix is present", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("unified-outliner-list-prefix");
    // Guarded by an `if (node.prefix)` check, the same "skip entirely when
    // absent" pattern the composite/complex-member prefix spans use —
    // located specifically within the isOutlineListNode branch (checked via
    // the ordering assertion below, not by string-matching the guard
    // itself, since `if (node.prefix)` alone isn't a unique-enough string).
    const listBranchStart = body.indexOf("isOutlineListNode(node)) {");
    const prefixSpanIndex = body.indexOf("unified-outliner-list-prefix");
    expect(listBranchStart).toBeGreaterThan(-1);
    expect(prefixSpanIndex).toBeGreaterThan(listBranchStart);
  });

  it("the prefix span is created BEFORE the list label span, within the list branch", () => {
    const body = getRenderNodeBody();
    const prefixSpanIndex = body.indexOf("unified-outliner-list-prefix");
    const labelSpanIndex = body.indexOf("unified-outliner-list-label");
    expect(prefixSpanIndex).toBeGreaterThan(-1);
    expect(labelSpanIndex).toBeGreaterThan(-1);
    expect(prefixSpanIndex).toBeLessThan(labelSpanIndex);
  });

  it("no longer calls innerEl.setText for the list row (would wipe out a sibling prefix span)", () => {
    const listBranchBody = listRowBranchBody();
    expect(listBranchBody).not.toContain("innerEl.setText");
  });

  it("(Phase 5D-4D landmark update) the list row branch's extracted body never leaks into the CompositeBlock label-rendering branch or beyond — contains none of handleCompositeDragStart/handleCompositeDragOverNode/handleCompositeDropNode/compositeDragSession, confirming the new mobile CompositeBlock drag handle work did not widen or leak into the list row's own DOM-construction contract", () => {
    const listBranchBody = listRowBranchBody();
    expect(listBranchBody).not.toContain("handleCompositeDragStart");
    expect(listBranchBody).not.toContain("handleCompositeDragOverNode");
    expect(listBranchBody).not.toContain("handleCompositeDropNode");
    expect(listBranchBody).not.toContain("compositeDragSession");
  });

  it("the list row still uses the unified-outliner-list-text ellipsis class on its own row container", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("tree-item-inner unified-outliner-list-text");
  });

  it("does not disturb the existing composite/complex-member/heading prefix rendering", () => {
    const body = getRenderNodeBody();
    expect(body).toContain("unified-outliner-composite-prefix");
    expect(body).toContain("unified-outliner-complex-member-prefix");
    expect(body).toContain("unified-outliner-heading-prefix");
  });
});
