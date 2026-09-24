/**
 * Pure, Obsidian-free half of settings.ts: the settings shape, its
 * defaults, and the merge-with-defaults logic main.ts's loadSettings()
 * uses to reconcile them with whatever a real data.json contains. Split
 * out from settings.ts (which also defines UnifiedOutlinerSettingTab, an
 * Obsidian PluginSettingTab subclass) so this data and logic can be unit
 * tested directly: node_modules/obsidian has no runtime implementation
 * outside a real Obsidian process (its package.json's "main" is empty —
 * it ships types only), so any module that imports Obsidian classes as
 * VALUES (not just types), like settings.ts's own PluginSettingTab/Setting
 * import, cannot be imported from a vitest test at all. Every other
 * tests/*.ts file in this repo already follows that constraint by only
 * importing Obsidian-free modules (see foldStateAcceptance.test.ts's doc
 * comment for the same reasoning applied to persistence/foldStateStore.ts,
 * which exists for an identical reason relative to foldStateManager.ts).
 * settings.ts re-exports both of these unchanged, so nothing outside this
 * file and settings.ts needs to know the split exists.
 */
import { isValidPluginLanguage, PluginLanguage } from "./i18n";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "./model/compositeBlock";

export interface UnifiedOutlinerSettings {
  /**
   * i18n実装 (2026-08-11): display language for every Unified-Outliner-owned
   * user-facing string (settings tab, command names, Notices, modals). See
   * src/i18n.ts's doc comment for the full "auto"/"ja"/"en" resolution
   * policy. Defaults to "auto" so existing installs (pre-i18n data.json,
   * where this key is simply absent) keep behaving exactly as before —
   * "auto" without a recognizable Japanese hint resolves to "en", this
   * plugin's pre-existing default language.
   */
  language: PluginLanguage;
  /** Allow a root list item to hop across a heading boundary. */
  allowCrossSectionListMove: boolean;
  /** Normalize ordered markers to "1." after a list move (MVP policy). */
  normalizeOrderedLists: boolean;
  /** Show a Notice explaining why a command was a no-op. */
  showNoopNotices: boolean;
  /**
   * Phase 3C: show list items as nodes in the Outline Tree View, alongside
   * sections. Off by default — the tree has been heading-only since Phase
   * 2A, and this keeps that the default experience; users who want the
   * fuller view opt in here.
   */
  showListItemsInOutline: boolean;
  /**
   * Post-Phase-3D: when moving the Outline Tree View's keyboard selection
   * with Up/Down (and the "step into child" / "step out to parent"
   * branches of Right/Left), also preview the newly selected node into the
   * body editor — same jumpToLine(..., { focusEditor: false }) a row click
   * already does. On by default, since this is the current, already-
   * shipped behavior (matches what a mouse click does, and keeps the
   * selected row and the body editor's position in sync during normal
   * browsing/editing). Turning this off restores the pre-existing Phase 4D
   * behavior: arrow keys move only the tree's own selection, and only
   * Enter jumps into the body — a compatibility mode for users who prefer
   * to explore the tree structure without disturbing the body editor's
   * scroll position on every arrow press.
   */
  followKeyboardSelectionIntoBody: boolean;
  /**
   * Phase 3D's Outline Tree -> CM6 body editor fold sync
   * (OutlineTreeView.syncFoldToBodyEditor, invoked from the single control
   * point in setNodeCollapsed) is one-directional only: it never affects
   * the reverse direction. On by default, matching the already-shipped
   * behavior. Turning this off stops a Tree-initiated fold/unfold from
   * touching the body editor's own CM6 fold state at all — the Tree's own
   * collapsedIds and the persisted FoldStateManager entry are still
   * updated and still propagate to every other open Outline Tree View
   * leaf exactly as before, and folding/unfolding directly in the body
   * editor (gutter, or Obsidian's Fold/Unfold heading commands) still
   * flows back into the Tree via the separate, always-on CM6 -> Tree
   * sync (handleCm6FoldEffect) regardless of this setting.
   */
  syncOutlineTreeFoldingToEditor: boolean;
  /**
   * 2026-08-11 ticket ("Move block の対象を最小安全ブロックへ" §5–6): purely
   * cosmetic Outline Tree visual aids, plus the two move-command
   * notifications introduced alongside the Move block/Move section
   * redefinition. Kept as one nested object (rather than four more flat
   * top-level keys) since these all belong to the same feature and are
   * always read/written together from the settings tab — see settings.ts's
   * display() for the corresponding controls.
   */
  treeKindHighlight: TreeKindHighlightSettings;
  /**
   * Phase 5D-0: enabled/disabled flags for the built-in CompositeBlock
   * rules (model/compositeBlock.ts's DEFAULT_COMPOSITE_BLOCK_RULES). This
   * phase does not offer a free-form rule-authoring UI — only toggling the
   * two built-in defaults — so this is a flat per-rule boolean map rather
   * than a persisted list of rule DEFINITIONS. See
   * docs/phase5d0_basic-block-extension-and-composite-block-spec.md §3.6.
   */
  compositeBlocks: CompositeBlockSettings;
  /**
   * 2026-08-12 ticket ("Heading prefix 表示設定"): optional prefix badge shown
   * before a section's heading text in the Outline Tree — "none" (no
   * prefix, the pre-existing look), "hLevel" ("H1".."H6"), or "atx" ("#"..
   * "######", the literal ATX marker count). Purely a Tree display concern;
   * see tree/buildOutlineTree.ts's headingPrefixText for the pure
   * level->string mapping and view/OutlineTreeView.ts's section rendering
   * branch for where it's applied. Defaults to "none" so existing installs
   * (pre-ticket data.json, where this key is absent) keep their current
   * look — this is a scalar top-level field, so mergeSettings's shallow
   * Object.assign already resolves a missing key to this default with no
   * extra migration code needed.
   */
  headingPrefixStyle: HeadingPrefixStyle;
  /**
   * UXP-03 (2026-08-15, "Configurable Outline Tree Sidebar Placement"):
   * which sidebar `main.ts`'s activateOutlineTreeView opens a NEW Outline
   * Tree View leaf into, when no leaf of that type exists yet anywhere in
   * the workspace. Defaults to "right", matching this plugin's pre-UXP-03
   * behavior exactly (activateOutlineTreeView previously called
   * `workspace.getRightLeaf(false)` unconditionally). Deliberately a
   * narrow two-value union (not a boolean like the reference
   * implementation this ticket was modeled on, obsidian-2hop-links-plus's
   * `panePositionIsRight`) so a future third placement (e.g. "main area")
   * can be added later without a breaking rename.
   *
   * This setting affects ONLY where a brand-new leaf is created. It is
   * deliberately NOT read anywhere else: activateOutlineTreeView's
   * existing "reuse any already-open Outline Tree View leaf, wherever it
   * is" path (workspace.getLeavesOfType + revealLeaf) always takes
   * priority and ignores this setting entirely — per the ticket's own
   * explicit requirement, changing this setting must never detach, move,
   * or duplicate a leaf the user (or an earlier default) has already
   * placed somewhere. See settings.ts's corresponding dropdown control,
   * whose onChange intentionally does NOT call refreshOutlineTreeViews()
   * or touch any existing leaf for the same reason.
   */
  outlineTreeSidebarPosition: OutlineTreeSidebarPosition;
  /**
   * UXP-04 (2026-08-15, "Configurable List Marker Prefix Display"): whether
   * the Outline Tree shows a list item's own actual Markdown list marker
   * (`item.listMarker` — "-", "*", "+", "1.", "2)", a mid-list restart like
   * "3.", ...) as an independent prefix before its label text, the same
   * "separate <span> rendered before the label" architecture
   * OutlineTreeCompositeNode.prefix / OutlineTreeComplexMemberNode.prefix
   * already use — see tree/buildOutlineTree.ts's listPrefixText and
   * OutlineTreeListNode.prefix.
   *
   * Deliberately a two-value union, NOT three: a hypothetical "auto" value
   * (e.g. "show for ordered lists only") was considered and rejected —
   * task-list checkboxes are not modeled anywhere in parser/model/block.ts
   * today, so there is no third display mode this setting could usefully
   * distinguish yet; add one only once task-list support actually exists
   * and a real need is demonstrated, not speculatively.
   *
   * Defaults to "none" so existing installs (pre-ticket data.json, where
   * this key is absent) keep their current look unchanged — this is a
   * top-level scalar field, but (unlike headingPrefixStyle) DOES get an
   * explicit mergeSettings re-validation, same treatment as `language` /
   * `outlineTreeSidebarPosition`, per this ticket's own explicit "不正な
   * 永続値が入っていた場合も、安全に none へ正規化してください" requirement.
   */
  listPrefixStyle: ListPrefixStyle;
  /**
   * Phase 5P-3 ("本文 paragraph の任意 Outline Tree 表示"): show a body
   * paragraph (parser/complexBlocks.ts's "paragraph" ComplexBlockInfo kind,
   * the same population Phase 5P-2's cursor-based Partial Edit hoist reads
   * from) as its own leaf node — `¶ {label}` — in the Outline Tree. Off by
   * default, mirroring showListItemsInOutline's own "opt-in, tree stays
   * heading/list-only by default" precedent: an existing installs'
   * data.json (or one written before this field existed at all) has this
   * key absent, and the shallow Object.assign in mergeSettings already
   * resolves a missing top-level scalar boolean to this default with no
   * extra migration code needed (same treatment as showListItemsInOutline
   * itself — no explicit re-validation branch below, since any truthy/
   * falsy raw value is already a valid boolean-ish outcome and there is no
   * "corrupted enum" failure mode a scalar boolean can hit).
   *
   * This is READ-ONLY NAVIGATION ONLY (design doc §5/§6): turning it on
   * never enables editing, adding, deleting, indenting, or moving a
   * paragraph from the Tree — see tree/buildOutlineTree.ts's
   * OutlineTreeParagraphNode (`isReadOnly: true`, `isLeaf: true`, never a
   * CompositeBlock member, never inserted into ParsedDocument.nodes) and
   * collectReadOnlyOutlineNodeIds's explicit `"paragraph"` inclusion. See
   * settings.ts's corresponding toggle control, whose onChange (like
   * showListItemsInOutline's) calls refreshOutlineTreeViews() so every open
   * Outline Tree View leaf re-renders immediately in either direction.
   */
  showParagraphsInOutline: boolean;
  /**
   * Phase 5E-0 ("Fenced Code Block / Markdown Table 読み取り専用 Outline
   * Tree 投影基盤"): opt-in, independent toggle for projecting a
   * STANDALONE fenced-code block (kind "fenced-code", editability
   * "supported") as its own read-only Outline Tree row — see
   * tree/buildOutlineTree.ts's BuildOutlineTreeOptions
   * .standaloneComplexBlocks.includeFencedCode. Off by default, mirroring
   * showParagraphsInOutline above and every other opt-in display toggle in
   * this file. Deliberately a SEPARATE toggle from showTablesInOutline
   * below rather than one shared switch — per this ticket's own explicit
   * user decision ("別々のスイッチ2つ"), so code-block and table
   * visibility can be turned on independently.
   */
  showFencedCodeInOutline: boolean;
  /**
   * Phase 5E-0: the table counterpart of showFencedCodeInOutline above —
   * opt-in, independent toggle for projecting a STANDALONE table block
   * (kind "table", editability "supported") as its own read-only Outline
   * Tree row. Off by default; see showFencedCodeInOutline's own doc
   * comment for why this is a separate toggle rather than a shared one.
   */
  showTablesInOutline: boolean;
  /**
   * Phase 5M-0 ("ミラーの基盤型定義と読み取り専用 Outline Tree 投影"):
   * opt-in toggle for projecting a single-note mirror embed line
   * (`![[#Heading]]` / `![[#^block-id]]`) as its own read-only "Mirror:"
   * Outline Tree row — see tree/buildOutlineTree.ts's
   * BuildOutlineTreeOptions.mirrors. Off by default, like every other
   * opt-in display toggle here; when off, embed lines are handled exactly
   * as before this phase (as ordinary paragraphs).
   */
  showMirrorEmbedsInOutline: boolean;
}

/** See UnifiedOutlinerSettings.headingPrefixStyle's doc comment. */
export type HeadingPrefixStyle = "none" | "hLevel" | "atx";

/** See UnifiedOutlinerSettings.listPrefixStyle's doc comment. */
export type ListPrefixStyle = "none" | "marker";

/**
 * Guards mergeSettings's re-validation of a raw, possibly-corrupted/
 * hand-edited listPrefixStyle value — same role isValidOutlineTreeSidebarPosition
 * plays for that field. See UnifiedOutlinerSettings.listPrefixStyle's doc
 * comment for why this stays a strict two-value union.
 */
export function isValidListPrefixStyle(value: unknown): value is ListPrefixStyle {
  return value === "none" || value === "marker";
}

/** See UnifiedOutlinerSettings.outlineTreeSidebarPosition's doc comment. */
export type OutlineTreeSidebarPosition = "right" | "left";

/**
 * Guards mergeSettings's re-validation of a raw, possibly-corrupted/
 * hand-edited outlineTreeSidebarPosition value — same role
 * isValidPluginLanguage plays for `language` in i18n.ts. Unlike
 * headingPrefixStyle (whose merge relies on the shallow Object.assign's
 * "missing key falls back to default" behavior alone, with no re-
 * validation of an explicitly-present-but-invalid value), this field gets
 * an explicit validator per this ticket's own "left/right 以外の値を安全に
 * right へ正規化" requirement.
 */
export function isValidOutlineTreeSidebarPosition(
  value: unknown
): value is OutlineTreeSidebarPosition {
  return value === "right" || value === "left";
}

/** One flag per model/compositeBlock.ts DEFAULT_COMPOSITE_BLOCK_RULES entry, by rule id. */
export interface CompositeBlockSettings {
  imageOcr: boolean;
  imageQuote: boolean;
}

export const DEFAULT_COMPOSITE_BLOCK_SETTINGS: CompositeBlockSettings = {
  imageOcr: true,
  imageQuote: true,
};

/**
 * Maps `settings.compositeBlocks`'s per-rule flags onto
 * DEFAULT_COMPOSITE_BLOCK_RULES, filtering out disabled ones while
 * preserving DEFAULT_COMPOSITE_BLOCK_RULES's own array order (which is also
 * the match-priority order — see parser/compositeBlocks.ts's
 * matchCompositeBlocks doc comment). A rule id with no corresponding
 * settings key defaults to enabled, so a future rule added to
 * DEFAULT_COMPOSITE_BLOCK_RULES without a matching settings field yet still
 * participates in matching rather than silently vanishing.
 */
export function getEnabledCompositeBlockRules(settings: CompositeBlockSettings): CompositeBlockRule[] {
  const flagByRuleId: Record<string, boolean> = {
    "image-ocr": settings.imageOcr,
    "image-quote": settings.imageQuote,
  };
  return DEFAULT_COMPOSITE_BLOCK_RULES.filter((rule) => flagByRuleId[rule.id] ?? true);
}

/**
 * Section rows get an always-on, subtle visual aid by default ("subtle" —
 * a faint background tint) so they're easy to tell apart from list rows at
 * a glance without opening a menu or hovering. List rows deliberately get a
 * WEAKER default ("hover" — highlighted only on hover/selection, never
 * always-on) per the ticket's explicit "list の視覚補助は section よりさらに
 * 弱く" requirement, so the tree doesn't get visually noisy when list items
 * are shown (settings.showListItemsInOutline). Both move-command
 * notifications default to on, matching this ticket's own recommended
 * defaults verbatim.
 */
export interface TreeKindHighlightSettings {
  sectionMode: "subtle" | "stripe" | "off";
  listMode: "hover" | "subtle" | "off";
  showMoveTargetPreview: boolean;
  showMoveResultToast: boolean;
}

export const DEFAULT_TREE_KIND_HIGHLIGHT: TreeKindHighlightSettings = {
  sectionMode: "subtle",
  listMode: "hover",
  showMoveTargetPreview: true,
  showMoveResultToast: true,
};

export const DEFAULT_SETTINGS: UnifiedOutlinerSettings = {
  language: "auto",
  allowCrossSectionListMove: true,
  normalizeOrderedLists: true,
  showNoopNotices: true,
  showListItemsInOutline: false,
  followKeyboardSelectionIntoBody: true,
  syncOutlineTreeFoldingToEditor: true,
  treeKindHighlight: { ...DEFAULT_TREE_KIND_HIGHLIGHT },
  compositeBlocks: { ...DEFAULT_COMPOSITE_BLOCK_SETTINGS },
  headingPrefixStyle: "none",
  outlineTreeSidebarPosition: "right",
  listPrefixStyle: "none",
  showParagraphsInOutline: false,
  showFencedCodeInOutline: false,
  showTablesInOutline: false,
  showMirrorEmbedsInOutline: false,
};

/**
 * Merges a raw, possibly-partial settings object (typically data.json's
 * top-level keys minus `foldState` — see main.ts's loadSettings) over
 * DEFAULT_SETTINGS, so any key missing from `raw` (a pre-existing
 * data.json written before that key existed, or a hand-edited/corrupted
 * one) falls back to its default rather than becoming `undefined`. Pure
 * and side-effect-free — main.ts's loadSettings is the only real caller,
 * wiring this into `this.settings` alongside the actual Obsidian
 * loadData() call.
 */
export function mergeSettings(
  raw: Record<string, unknown>
): UnifiedOutlinerSettings {
  const merged = Object.assign({}, DEFAULT_SETTINGS, raw) as UnifiedOutlinerSettings;
  // treeKindHighlight is a NESTED object — the shallow Object.assign above
  // would otherwise replace it wholesale with whatever partial (or absent)
  // object `raw` has, silently dropping any of ITS sub-keys missing from a
  // pre-existing data.json (e.g. one written before this ticket's settings
  // existed at all, where raw.treeKindHighlight is simply undefined). Merge
  // it one level deeper explicitly, same "missing key falls back to its
  // default" policy as the top-level merge above.
  const rawTreeKindHighlight = (
    raw as { treeKindHighlight?: Partial<TreeKindHighlightSettings> }
  ).treeKindHighlight;
  merged.treeKindHighlight = Object.assign(
    {},
    DEFAULT_TREE_KIND_HIGHLIGHT,
    rawTreeKindHighlight ?? {}
  );
  // compositeBlocks is a NESTED object, same "missing key falls back to its
  // default" policy as treeKindHighlight above (a pre-existing data.json
  // written before Phase 5D-0 simply has raw.compositeBlocks === undefined).
  const rawCompositeBlocks = (
    raw as { compositeBlocks?: Partial<CompositeBlockSettings> }
  ).compositeBlocks;
  merged.compositeBlocks = Object.assign(
    {},
    DEFAULT_COMPOSITE_BLOCK_SETTINGS,
    rawCompositeBlocks ?? {}
  );
  // language is a top-level SCALAR field (unlike treeKindHighlight above),
  // so the shallow Object.assign already carries over whatever raw.language
  // was — including a value that is not "auto"/"ja"/"en" at all (a
  // corrupted/hand-edited data.json, or a value from some future plugin
  // version this one doesn't know). Explicitly re-validate it here and fall
  // back to the default ("auto") rather than let an invalid value reach
  // resolveLocale()/createTranslator(), per this ticket's own explicit
  // "不明な値は安全に auto へフォールバックする" requirement.
  merged.language = isValidPluginLanguage(raw.language) ? raw.language : DEFAULT_SETTINGS.language;
  // outlineTreeSidebarPosition (UXP-03): same "top-level scalar, explicit
  // re-validation" treatment as `language` just above — a raw value of
  // anything other than "right"/"left" (a corrupted/hand-edited data.json,
  // or a future value this version doesn't know) safely normalizes to the
  // "right" default rather than reaching main.ts's activateOutlineTreeView
  // unchecked.
  merged.outlineTreeSidebarPosition = isValidOutlineTreeSidebarPosition(
    raw.outlineTreeSidebarPosition
  )
    ? raw.outlineTreeSidebarPosition
    : DEFAULT_SETTINGS.outlineTreeSidebarPosition;
  // listPrefixStyle (UXP-04): same "top-level scalar, explicit
  // re-validation" treatment as `language`/`outlineTreeSidebarPosition`
  // above — a raw value other than "none"/"marker" (a corrupted/
  // hand-edited data.json, or a future value this version doesn't know)
  // safely normalizes to the "none" default rather than reaching
  // tree/buildOutlineTree.ts's listPrefixText unchecked.
  merged.listPrefixStyle = isValidListPrefixStyle(raw.listPrefixStyle)
    ? raw.listPrefixStyle
    : DEFAULT_SETTINGS.listPrefixStyle;
  return merged;
}
