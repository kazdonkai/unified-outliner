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
}

/** See UnifiedOutlinerSettings.headingPrefixStyle's doc comment. */
export type HeadingPrefixStyle = "none" | "hLevel" | "atx";

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
  return merged;
}
