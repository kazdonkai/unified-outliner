/**
 * Phase 5E-0.5 ("挿入フレームワークの共通基盤"): tests for the type
 * definitions and stub resolver in src/tree/insertionFramework.ts. See
 * docs/phase5e0_5_insert-framework-design-memo.md for the full design this
 * module documents but does not yet implement.
 *
 * Category A: confirms the exported union types have exactly the expected
 * literal members (an exhaustiveness-mapping pattern that fails to
 * TYPE-CHECK — not just fails at runtime — if a member is added, removed,
 * or renamed without updating this test; see each test's own comment).
 * Category B: confirms resolveInsertion is callable with a correctly
 * shaped InsertionRequest and currently always throws (Phase 5E-0.5 stub
 * behavior, not yet implemented).
 * Category C: documents (via `it.todo`) the boundary-case behavior a
 * future Phase 5E-1 implementation of resolveInsertion must satisfy, per
 * the design memo's §1/§3 — left unimplemented (not `.skip`, which would
 * still require a runnable body) since resolveInsertion itself does not
 * exist yet beyond the throwing stub.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import {
  resolveInsertion,
  type InsertableBlockKind,
  type InsertionPosition,
  type InsertionRequest,
  type InsertionResult,
} from "../src/tree/insertionFramework";

describe("Phase 5E-0.5 insertionFramework: category A (type definitions)", () => {
  it("InsertableBlockKind is exactly the 5-member union the design memo §2 defines", () => {
    // Exhaustiveness map: this object literal only type-checks if EVERY
    // InsertableBlockKind member is present as a key AND no extra key is
    // present — TypeScript rejects both a missing member (via the
    // Record<InsertableBlockKind, true> constraint) and an extra one (via
    // excess property checking on an object literal assigned directly to
    // that type). A future rename/addition/removal of a member therefore
    // fails `npx tsc --noEmit` on this line, not just this test.
    const exhaustive: Record<InsertableBlockKind, true> = {
      "fenced-code": true,
      "fenced-code-mermaid": true,
      table: true,
      heading: true,
      "list-item": true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual(
      ["fenced-code", "fenced-code-mermaid", "heading", "list-item", "table"].sort()
    );
  });

  it("InsertionPosition is exactly the 2-member union \"before\" | \"after\"", () => {
    const exhaustive: Record<InsertionPosition, true> = {
      before: true,
      after: true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual(["after", "before"]);
  });

  it("InsertionResult is a discriminated union on `ok`: true branch carries insertAtLine/insertText, false branch carries reason", () => {
    const success: InsertionResult = { ok: true, insertAtLine: 3, insertText: "```\n\n" };
    const failure: InsertionResult = { ok: false, reason: "unterminated-fence" };

    function describeResult(result: InsertionResult): string {
      // Exercises the discriminant at runtime: TypeScript narrows
      // `result` to the `ok: true` branch inside this block, so
      // `result.insertAtLine` and `result.insertText` are accessible
      // without a cast, and the `false` branch's `result.reason` is
      // accessible in the same way below — this would fail to
      // type-check if InsertionResult weren't a proper discriminated
      // union on `ok`.
      if (result.ok) {
        return `insert at ${result.insertAtLine} (len ${result.insertText.length})`;
      }
      return `refused: ${result.reason}`;
    }

    expect(describeResult(success)).toBe("insert at 3 (len 5)");
    expect(describeResult(failure)).toBe("refused: unterminated-fence");
  });

  it("InsertionRequest requires exactly targetNodeId/kind/position, matching the design memo's field list", () => {
    const request: InsertionRequest = {
      targetNodeId: "complex-3",
      kind: "table",
      position: "after",
    };
    expect(request).toEqual({ targetNodeId: "complex-3", kind: "table", position: "after" });
  });
});

describe("Phase 5E-0.5 insertionFramework: category B (resolveInsertion stub behavior)", () => {
  it("is callable with the documented (request, documentText, outlineTree) signature", () => {
    // Phase 5E-1 update: kind "table" is used here (rather than
    // "fenced-code", this test's original Phase 5E-0.5 choice) because
    // "fenced-code" is no longer a bare throwing stub as of Phase 5E-1
    // (see tests/phase5e1FencedCodePartialEditMoveDelete.test.ts's own
    // category E for its real, non-throwing behavior) — "table" remains
    // an unimplemented stub this phase, so it still exercises the same
    // "signature is callable, unknown outlineTree accepted" concern this
    // test originally existed for.
    const request: InsertionRequest = {
      targetNodeId: "complex-1",
      kind: "table",
      position: "after",
    };
    // `outlineTree` is intentionally `unknown` in this phase (see the
    // design memo §4) — passing `undefined` here confirms the signature
    // accepts it without requiring a concrete Tree value yet.
    expect(() => resolveInsertion(request, "# H\n", undefined)).toThrow();
  });

  it("throws for every STILL-STUB InsertableBlockKind/InsertionPosition combination (table/heading/list-item have no special-cased success path)", () => {
    // Phase 5E-1 update: narrowed from all 5 InsertableBlockKind values to
    // just the 3 that remain unimplemented stubs — "fenced-code"/
    // "fenced-code-mermaid" now have a real implementation (see the next
    // test) and are covered in depth by
    // tests/phase5e1FencedCodePartialEditMoveDelete.test.ts's own
    // category E instead.
    const kinds: InsertableBlockKind[] = ["table", "heading", "list-item"];
    const positions: InsertionPosition[] = ["before", "after"];
    for (const kind of kinds) {
      for (const position of positions) {
        const request: InsertionRequest = { targetNodeId: "complex-1", kind, position };
        expect(() => resolveInsertion(request, "", null)).toThrow();
      }
    }
  });

  it("does NOT throw for fenced-code/fenced-code-mermaid (Phase 5E-1 implemented these) — returns a structured InsertionResult instead", () => {
    const kinds: InsertableBlockKind[] = ["fenced-code", "fenced-code-mermaid"];
    const positions: InsertionPosition[] = ["before", "after"];
    for (const kind of kinds) {
      for (const position of positions) {
        const request: InsertionRequest = { targetNodeId: "complex-1", kind, position };
        // An empty document has no ComplexBlockInfo with id "complex-1" at
        // all, so this resolves to a well-formed rejection (ok: false),
        // never a throw and never a guessed line — see category C below.
        expect(() => resolveInsertion(request, "", null)).not.toThrow();
        const result = resolveInsertion(request, "", null);
        expect(result.ok).toBe(false);
      }
    }
  });

  it("throw message references the Phase 5E-0.5 stub status and the design memo, not a generic error", () => {
    const request: InsertionRequest = { targetNodeId: "complex-1", kind: "table", position: "before" };
    expect(() => resolveInsertion(request, "| a |\n|---|\n| 1 |\n", undefined)).toThrow(
      /not implemented yet \(Phase 5E-0\.5 stub\)/
    );
  });
});

describe("Phase 5E-0.5 insertionFramework: category C (design-memo boundary cases, documented for Phase 5E-1)", () => {
  // Not yet runnable: resolveInsertion is a throwing stub in this phase,
  // so asserting `{ ok: false, ... }` here would fail for the wrong
  // reason (an uncaught throw, not a real boundary-case rejection).
  // `it.todo` records the expected behavior from the design memo without
  // claiming it is implemented; Phase 5E-1 replaces each with a real
  // assertion when resolveInsertion gains a real body.
  it("returns { ok: false } when the target fenced-code block is unterminated (design memo §1 'insertion point cannot be determined' / §3 rejection rules)", () => {
    // Phase 5E-1: activated (was it.todo under Phase 5E-0.5) now that
    // resolveInsertion has a real fenced-code implementation. The
    // unclosed fence's own ComplexBlockInfo.editability is "ambiguous"
    // (parser/complexBlocks.ts's scanFencedCodeBlocks), never "supported"
    // — resolveInsertion refuses it by re-deriving a fresh scan and
    // checking that field directly, exactly like every other
    // edit/*StandaloneComplexBlock.ts module in this codebase refuses an
    // unsafe target.
    const text = ["# H", "```ts", "const x = 1;"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const [unterminated] = complexScan.blocks;
    expect(unterminated.editability).not.toBe("supported");
    const request: InsertionRequest = {
      targetNodeId: unterminated.id,
      kind: "fenced-code",
      position: "after",
    };
    const result = resolveInsertion(request, text, undefined);
    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } (never a guessed line) when documentText is the empty string and targetNodeId cannot resolve to any ComplexBlockInfo (design memo §1's 'target not found in current document' rejection)", () => {
    // Phase 5E-1: activated (was it.todo under Phase 5E-0.5).
    const request: InsertionRequest = {
      targetNodeId: "does-not-exist",
      kind: "fenced-code",
      position: "before",
    };
    const result = resolveInsertion(request, "", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("target-not-found");
    }
  });
});
