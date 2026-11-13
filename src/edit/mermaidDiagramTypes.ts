/**
 * Phase 5E-3M ("Mermaid 構造化部分編集"): the single registry of Mermaid
 * diagram types the Partial Edit Pane can show in structured form.
 *
 * Adding a diagram type means adding ONE entry here (plus its two i18n
 * labels). Anything not listed — quadrantChart, xychart-beta, block-beta,
 * C4Context, … — is reported as "unknown-diagram" by
 * edit/mermaidStructure.ts and edited as plain source instead.
 *
 * Pure (no Obsidian / Mermaid runtime import): mermaid.detectType() is
 * deliberately NOT used, because it returns an internal key and not where
 * the declaration sits in the source (design memo §2).
 */
import type { TranslationKey } from "../i18n";

/**
 * How the part of the declaration line after the keyword ("suffix") is
 * treated:
 *   - "direction": only a flowchart direction (TB/TD/BT/RL/LR) or nothing;
 *     edited with a direction dropdown.
 *   - "empty": nothing but whitespace is allowed.
 *   - "raw": anything is kept verbatim and edited in a small text field
 *     (pie's `showData` / `title …`, gitGraph options).
 */
export type MermaidSuffixPolicy = "direction" | "empty" | "raw";

export interface MermaidDiagramType {
  /** Stable id (not written to the note). */
  id: string;
  /** i18n key of the display name (ja: 日本語名, en: English name). */
  labelKey: TranslationKey;
  /**
   * Declaration keywords accepted for this type, case-sensitive. The FIRST
   * one is what is written when the user picks this type from the dropdown;
   * any other spelling already in the note is kept until the user re-picks.
   */
  keywords: readonly string[];
  suffixPolicy: MermaidSuffixPolicy;
  /** The suffix written together with keywords[0] when this type is newly chosen (e.g. " TD"). */
  defaultSuffix: string;
  /** Minimal body (lines after the declaration) used only for a new block or an empty body. */
  template: readonly string[];
}

export const MERMAID_FLOWCHART_DIRECTIONS = ["TB", "TD", "BT", "RL", "LR"] as const;
export type MermaidFlowchartDirection = (typeof MERMAID_FLOWCHART_DIRECTIONS)[number];

export const MERMAID_DIAGRAM_TYPES: readonly MermaidDiagramType[] = [
  {
    id: "flowchart",
    labelKey: "mermaid.type.flowchart",
    keywords: ["flowchart", "graph"],
    suffixPolicy: "direction",
    defaultSuffix: " TD",
    template: ["    A[Start] --> B[End]"],
  },
  {
    id: "sequence",
    labelKey: "mermaid.type.sequence",
    keywords: ["sequenceDiagram"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["    participant A", "    participant B", "    A->>B: Hello"],
  },
  {
    id: "class",
    labelKey: "mermaid.type.class",
    keywords: ["classDiagram"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["    class Animal", "    class Dog", "    Animal <|-- Dog"],
  },
  {
    id: "state",
    labelKey: "mermaid.type.state",
    keywords: ["stateDiagram-v2", "stateDiagram"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["    [*] --> Idle", "    Idle --> Done", "    Done --> [*]"],
  },
  {
    id: "er",
    labelKey: "mermaid.type.er",
    keywords: ["erDiagram"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["    CUSTOMER ||--o{ ORDER : places"],
  },
  {
    id: "gantt",
    labelKey: "mermaid.type.gantt",
    keywords: ["gantt"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["    dateFormat YYYY-MM-DD", "    section Phase", "    Task A :a1, 2026-01-01, 7d"],
  },
  {
    id: "pie",
    labelKey: "mermaid.type.pie",
    keywords: ["pie"],
    suffixPolicy: "raw",
    defaultSuffix: "",
    template: ['    "A" : 60', '    "B" : 40'],
  },
  {
    id: "mindmap",
    labelKey: "mermaid.type.mindmap",
    keywords: ["mindmap"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["  root((Center))", "    Branch A", "    Branch B"],
  },
  {
    id: "timeline",
    labelKey: "mermaid.type.timeline",
    keywords: ["timeline"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["    2025 : Event A", "    2026 : Event B"],
  },
  {
    id: "journey",
    labelKey: "mermaid.type.journey",
    keywords: ["journey"],
    suffixPolicy: "empty",
    defaultSuffix: "",
    template: ["    section Visit", "      Arrive: 5: User"],
  },
  {
    id: "gitgraph",
    labelKey: "mermaid.type.gitgraph",
    keywords: ["gitGraph"],
    suffixPolicy: "raw",
    defaultSuffix: "",
    template: ["    commit", "    branch develop", "    commit"],
  },
];

export function findMermaidDiagramType(id: string): MermaidDiagramType | undefined {
  return MERMAID_DIAGRAM_TYPES.find((t) => t.id === id);
}

/** The diagram type whose keyword list contains `keyword` exactly (case-sensitive). */
export function findMermaidDiagramTypeByKeyword(keyword: string): MermaidDiagramType | undefined {
  return MERMAID_DIAGRAM_TYPES.find((t) => t.keywords.includes(keyword));
}

export function isMermaidFlowchartDirection(value: string): value is MermaidFlowchartDirection {
  return (MERMAID_FLOWCHART_DIRECTIONS as readonly string[]).includes(value);
}
