import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseMarkdownTable, serializeMarkdownTable } from "../src/edit/editableMarkdownTable";

/**
 * Real-device report (2026-09-25): opening a table in the Partial Edit Pane
 * and merely switching Raw -> Table (no edit) made the pane "dirty", so
 * switching to another block showed the unsaved-changes dialog. Cause: the
 * Table tab compared the serializer's CANONICAL output with the note's own
 * text, and a table written e.g. with a "| - |" delimiter row never matches
 * it. Fix: compare against the canonical serialization of the loaded text,
 * and give an unchanged model's Raw text back verbatim on Table -> Raw.
 */
const canonical = (t: string): string => {
  const p = parseMarkdownTable(t);
  if (!p.ok) throw new Error("parse");
  return serializeMarkdownTable(p.table).join("\n");
};

describe("root cause and fix basis", () => {
  const nonCanonical = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");

  it("a non-canonical table's own text differs from its serialization (the old false-positive)", () => {
    expect(canonical(nonCanonical)).not.toBe(nonCanonical);
  });

  it("an unchanged model serializes to the canonical form of the loaded text (the new baseline) — not dirty", () => {
    const p = parseMarkdownTable(nonCanonical);
    if (!p.ok) throw new Error("parse");
    expect(serializeMarkdownTable(p.table).join("\n")).toBe(canonical(nonCanonical));
  });

  it("a real cell edit still differs from the baseline — dirty", () => {
    const p = parseMarkdownTable(nonCanonical);
    if (!p.ok) throw new Error("parse");
    const edited = { ...p.table, rows: [["1", "3"]] };
    expect(serializeMarkdownTable(edited).join("\n")).not.toBe(canonical(nonCanonical));
  });

  it("the canonical form is stable (serialize(parse(canonical)) === canonical)", () => {
    const c = canonical(nonCanonical);
    expect(canonical(c)).toBe(c);
  });
});

describe("view wiring (static)", () => {
  const pane = readFileSync(path.resolve(__dirname, "../src/view/PartialEditView.ts"), "utf-8");
  const body = (sig: string): string => {
    const i = pane.indexOf(sig);
    expect(i, sig).toBeGreaterThan(-1);
    return pane.slice(i, pane.indexOf("\n  }\n", i));
  };

  it("tableModeDirty compares against the canonical baseline", () => {
    expect(pane).toContain('serializeMarkdownTable(this.tableModeTable).join("\\n") !== this.tableModeBaselineSerialized();');
    const b = body("private tableModeBaselineSerialized(): string {");
    expect(b).toContain("parseMarkdownTable(this.originalText)");
    expect(b).toContain(": this.originalText;");
  });

  it("Raw -> Table remembers the Raw text; Table -> Raw restores it when the model is unchanged", () => {
    expect(body("private handleTableModeSwitchToTableTab(): void {")).toContain("this.tableModeRawAtSwitch = {");
    const toRaw = body("private handleTableModeSwitchToRawTab(): void {");
    expect(toRaw).toContain("atSwitch && atSwitch.serialized === serialized ? atSwitch.raw : serialized");
    expect(toRaw).toContain("this.tableModeRawAtSwitch = null;");
  });

  it("a fresh load / reset forgets the remembered Raw text", () => {
    expect(body("private resetLoadedState(): void {")).toContain("this.tableModeRawAtSwitch = null;");
    expect(body("private loadNodeInternal(nodeId: string): void {")).toContain("this.tableModeRawAtSwitch = null;");
  });
});
