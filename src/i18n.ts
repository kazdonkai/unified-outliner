/**
 * i18n実装 (2026-08-11 ticket, "Unified Outliner：日本語／英語 UI 切替の実装指示"):
 * pure, Obsidian-free translation module. Kept Obsidian-free for the same
 * reason settingsDefaults.ts is (see that file's doc comment): so it can be
 * unit-tested directly from Vitest without importing Obsidian as a value.
 *
 * Design summary:
 *  - `PluginLanguage` ("auto" | "ja" | "en") is the persisted setting value.
 *    "auto" means "follow Obsidian's own UI language" — resolved to a
 *    concrete `SupportedLocale` via resolveLocale(), which takes the
 *    Obsidian-dependent detection result (if any) as a plain string hint
 *    from the caller, so this module never has to know HOW that hint was
 *    obtained.
 *  - Every user-facing string the plugin owns is a key in `en` (the
 *    authoritative key set). `ja` is typed as `Record<TranslationKey,
 *    string>`, so TypeScript itself fails the build if a key is added to
 *    one dictionary and forgotten in the other — no separate "key parity"
 *    bookkeeping is needed.
 *  - Key names are meaning-based slugs (`command.moveBlockUp`,
 *    `reason.top-of-document`, ...), never the English text itself, so
 *    English wording can change freely without touching the ja dictionary
 *    or any call site.
 *  - `reason.*` keys intentionally reuse the exact same string literals
 *    that move/indent/rename/delete/insert outcomes already return as
 *    `LineEditOutcome.reason` (see commands/applyLineEditOutcome.ts's
 *    NOOP_MESSAGES, which stays English-only and unchanged, both as the
 *    single source of truth for which reason strings exist and so its own
 *    existing tests keep passing byte-for-byte) — callers translate a
 *    reason via `t(("reason." + reason) as TranslationKey)` rather than
 *    looking it up in NOOP_MESSAGES.
 *  - `createTranslator(locale)` returns a small `(key, vars?) => string`
 *    function with minimal `{name}`-style interpolation, enough for this
 *    plugin's existing dynamic strings (the move-result toast, "N more",
 *    "Editing (Kind): Label").
 */

export type SupportedLocale = "ja" | "en";
export type PluginLanguage = "auto" | SupportedLocale;

export function isValidPluginLanguage(value: unknown): value is PluginLanguage {
  return value === "auto" || value === "ja" || value === "en";
}

/**
 * "auto" -> resolved via `detectedLocale` (an Obsidian-dependent hint the
 * caller supplies — e.g. `localStorage.getItem("language")`, the same
 * mechanism several community plugins use to read Obsidian's own UI
 * language, since Obsidian's typed API has no official accessor for it).
 * Falls back to "en" whenever the hint is missing or not recognizably
 * Japanese, per this ticket's own explicit "auto→en fallback is
 * acceptable" allowance. "ja"/"en" pass straight through, and any other
 * (corrupted/future/unknown) value also falls back to "en" rather than
 * throwing, so a hand-edited or stale data.json can never crash the
 * plugin over this setting.
 */
export function resolveLocale(
  language: PluginLanguage,
  detectedLocale?: string | null
): SupportedLocale {
  if (language === "ja" || language === "en") return language;
  if (typeof detectedLocale === "string" && detectedLocale.toLowerCase().startsWith("ja")) {
    return "ja";
  }
  return "en";
}

export type TranslationVars = Record<string, string | number>;

const en = {
  // ---- Settings tab -----------------------------------------------------
  // Tab labels (2026-08-12 settings UI reorganization): purely cosmetic
  // grouping of the same settings/toggles below into two top-of-pane tabs.
  // Does not change any setting key, default, or persisted data shape —
  // see settings.ts's UnifiedOutlinerSettingTab for the tab-switching
  // implementation.
  "settings.tabs.general": "General",
  "settings.tabs.compositeBlock": "Extended blocks",
  "settings.language.name": "Language",
  "settings.language.desc":
    'Display language for Unified Outliner\'s settings, command names, and notices. "Auto" follows Obsidian\'s own language setting. Command names already shown in the Command Palette only update after reloading the plugin (or Obsidian) — see the notice shown after changing this.',
  "settings.language.optionAuto": "Auto (match Obsidian's language)",
  "settings.language.optionJa": "Japanese (日本語)",
  "settings.language.optionEn": "English",
  "settings.allowCrossSectionListMove.name": "Allow list moves across sections",
  "settings.allowCrossSectionListMove.desc":
    "When a root list item has no sibling in the move direction, let it hop across the adjacent heading into the neighboring section.",
  "settings.normalizeOrderedLists.name": 'Normalize ordered list markers to "1."',
  "settings.normalizeOrderedLists.desc":
    'After moving a list block, rewrite ordered markers in the affected range to "1." (renderers auto-number). Sequential renumbering is planned.',
  "settings.showNoopNotices.name": "Show no-op notices",
  "settings.showNoopNotices.desc": "Show a small notice when a move command does nothing and why.",
  "settings.showListItemsInOutline.name": "Show list items in Outline Tree View",
  "settings.showListItemsInOutline.desc":
    "Show list items as nodes in the right-sidebar Outline Tree View, alongside headings. Off by default (headings only, as in earlier versions of this plugin).",
  "settings.showParagraphsInOutline.name": "Show body paragraphs in Outline Tree View",
  "settings.showParagraphsInOutline.desc":
    "Show ordinary body paragraphs as navigation nodes (marked with ¶) in the Outline Tree View. Top-level and section-direct paragraphs can also be edited, inserted, deleted, and moved from the Tree (via its context menu or double-click) — paragraphs nested inside a list item are shown for navigation only. Off by default.",
  "settings.showFencedCodeInOutline.name": "Show fenced code blocks in Outline Tree View",
  "settings.showFencedCodeInOutline.desc":
    "Show fenced code blocks (including Mermaid, Dataview, and DataviewJS) as read-only navigation nodes in the Outline Tree View. Click a row to jump to its opening fence; nothing can be renamed, edited, moved, or deleted from these rows. Off by default.",
  "settings.showTablesInOutline.name": "Show tables in Outline Tree View",
  "settings.showTablesInOutline.desc":
    "Show Markdown tables as read-only navigation nodes in the Outline Tree View. Click a row to jump to its header row; nothing can be renamed, edited, moved, or deleted from these rows. Off by default.",
  "settings.followKeyboardSelectionIntoBody.name":
    "Follow keyboard selection into body editor",
  "settings.followKeyboardSelectionIntoBody.desc":
    "When navigating the Outline Tree with arrow keys, also move the body editor's cursor and scroll position, the same way clicking a row does. Turn off to keep arrow-key navigation confined to the tree panel (Enter still jumps to the body).",
  "settings.syncOutlineTreeFoldingToEditor.name": "Sync Outline Tree folding to editor",
  "settings.syncOutlineTreeFoldingToEditor.desc":
    "When enabled, folding or unfolding a node in the Outline Tree also folds or unfolds the matching content in the active Markdown editor.",
  // UXP-05 (2026-08-24): four category-divider headings replacing the old
  // single "Move & Outline Tree kind highlight" heading — see settings.ts's
  // renderGeneralTab doc comment for exactly which settings fall under each.
  "settings.outlineTreeContentsHeading": "Outline Tree contents",
  "settings.outlineTreeAppearanceHeading": "Outline Tree appearance",
  "settings.moveOperationsHeading": "Move operations",
  "settings.editingInteractionHeading": "Editing & interaction",
  "settings.sectionBackgroundStyle.name": "Section background style in Outline Tree",
  "settings.sectionBackgroundStyle.desc":
    "Always-on visual aid so section rows are easy to tell apart from list rows at a glance. Purely cosmetic — never changes what Move block / Move section actually operate on.",
  "settings.sectionBackgroundStyle.optionSubtle": "Subtle background",
  "settings.sectionBackgroundStyle.optionStripe": "Left edge stripe",
  "settings.sectionBackgroundStyle.optionOff": "Off",
  "settings.listHighlightStyle.name": "List row highlight style in Outline Tree",
  "settings.listHighlightStyle.desc":
    "Deliberately weaker than the section style above (hover-only by default), so the tree doesn't get visually noisy when list items are shown.",
  "settings.listHighlightStyle.optionHover": "Highlight on hover/selection only",
  "settings.listHighlightStyle.optionSubtle": "Always-on subtle background",
  "settings.listHighlightStyle.optionOff": "Off",
  "settings.headingPrefixStyle.name": "Heading prefix in Outline Tree",
  "settings.headingPrefixStyle.desc":
    "Optional badge shown before a section's heading text in the Outline Tree, indicating its heading level. Purely cosmetic — never changes the heading text itself.",
  "settings.headingPrefixStyle.optionNone": "Don't show",
  "settings.headingPrefixStyle.optionHLevel": "H1–H6",
  "settings.headingPrefixStyle.optionAtx": "#–######",
  "settings.outlineTreeSidebarPosition.name": "Outline Tree default sidebar",
  "settings.outlineTreeSidebarPosition.desc":
    "Which sidebar a brand-new Outline Tree View opens into. Only applies when no Outline Tree View is already open anywhere — an existing one (including one you've dragged elsewhere) is always reused as-is and never moved by changing this setting.",
  "settings.outlineTreeSidebarPosition.optionRight": "Right sidebar",
  "settings.outlineTreeSidebarPosition.optionLeft": "Left sidebar",
  "settings.listPrefixStyle.name": "List marker in Outline Tree",
  "settings.listPrefixStyle.desc":
    "Show the Markdown list marker (-, *, +, 1., and so on) before each list item.",
  "settings.listPrefixStyle.optionNone": "Don't show",
  "settings.listPrefixStyle.optionMarker": "Markdown marker",
  "settings.previewMoveTarget.name": "Preview move target in Outline Tree",
  "settings.previewMoveTarget.desc":
    "Briefly flash-highlight, in the Outline Tree, the block that Move block / Move section actually operated on.",
  // 2026-09-09 (Settings タブ i18n リソース改善): renamed/reworded away
  // from the jargon terms "toast" and "Move block / Move section" (command
  // names not self-explanatory to a general user) toward plain, outcome-
  // focused wording. No key name, type, or stored-value semantics changed —
  // this remains a boolean toggle read/written under the same
  // "showMoveResultToast" key.
  "settings.showMoveResultToast.name": "Show notification after moving",
  "settings.showMoveResultToast.desc":
    "Displays a brief notice showing what was moved (paragraph, list item, or section) after executing a move command.",

  // ---- Phase 5D-0 / 5D-0.3: CompositeBlock rules -------------------------
  "settings.compositeBlocksHeading": "Extended blocks",
  // Phase 5D-1L: rewritten to drop the "e.g. an image + its OCR
  // transcript" example — CompositeBlock matching has always been purely
  // structural (single-line list item + callout/blockquote, no blank line
  // between them; see model/compositeBlock.ts's DEFAULT_COMPOSITE_BLOCK_RULES
  // and parser/compositeBlocks.ts), never image-specific, and that example
  // read as a required condition or the primary use case rather than one
  // illustrative case among many (a to-do item + its own note, a heading-
  // less quote source + its citation, etc.).
  "settings.compositeBlocksIntro":
    "Built-in rules that group an immediately-adjacent, single-line list item and a callout or blockquote — with no blank line between them — into one collapsible unit in the Outline Tree. Disabling a rule here stops it from being recognized and shown as a group; your Markdown is never changed, and its member list item / callout / blockquote simply appear ungrouped again, following their own normal display settings.",
  // Phase 5D-1L: generalized from "Image + OCR" / "Image + Quote" — the
  // rule has never actually required an image (see this key's own doc
  // comment above); the label now names the STRUCTURE it matches
  // (list + callout / list + blockquote) instead of one example use case.
  // en/ja deliberately share the identical English string — see
  // compositeBlock.imageOcr.displayName's own doc comment below for why.
  "settings.compositeBlockImageOcr.name": "List + Callout",
  // 2026-09-09 (Settings タブ i18n リソース改善): adds a concrete,
  // illustrative use case back into the description. This is a deliberate
  // reversal of Phase 5D-1L's own removal of the "image + its OCR
  // transcript" example (see that comment above, on
  // settings.compositeBlocksIntro) — Phase 5D-1L's concern was that the
  // example read as a required *condition* for the rule to match; here the
  // wording is written to stay unambiguously illustrative ("e.g. ...")
  // rather than definitional, so it does not reintroduce that ambiguity.
  // The underlying match itself is still purely structural and unchanged
  // (see model/compositeBlock.ts's DEFAULT_COMPOSITE_BLOCK_RULES).
  "settings.compositeBlockImageOcr.desc":
    "Groups a single-line list item followed immediately by a callout without empty lines. (e.g. embedding an image/PDF in the list item and writing OCR text/notes in the callout)",
  "settings.compositeBlockImageQuote.name": "List + Quote",
  // 2026-09-09: same rationale as compositeBlockImageOcr.desc above.
  "settings.compositeBlockImageQuote.desc":
    "Groups a single-line list item followed immediately by a blockquote without empty lines. (e.g. writing source/citation in the list item and quoted text in the blockquote)",
  // Phase 5D-1L: generalized display label for the Outline Tree's
  // CompositeBlock parent row (see model/compositeBlock.ts's
  // compositeBlockDisplayLabel) and ConfirmCompositeDeleteModal — was
  // "Image + OCR"/"Image + Quote" (and "画像+OCR"/"画像+引用" in ja),
  // which named one illustrative use case rather than the actual
  // structural match (single-line list item + callout, or + blockquote;
  // rule id/matching/settings key "image-ocr"/"image-quote" are UNCHANGED
  // internal identifiers, not renamed by this ticket). The ja dictionary
  // deliberately keeps the same English string here (not a Japanese
  // translation) per this ticket's explicit approval.
  "compositeBlock.imageOcr.displayName": "List + Callout",
  "compositeBlock.imageQuote.displayName": "List + Quote",

  // ---- Commands (Command Palette names) ---------------------------------
  "command.moveBlockUp": "Move block up (minimal safe unit at cursor)",
  "command.moveBlockDown": "Move block down (minimal safe unit at cursor)",
  "command.moveSectionUp": "Move section up (whole enclosing section)",
  "command.moveSectionDown": "Move section down (whole enclosing section)",
  "command.moveNodeOnlyUp": "Move heading label up (current line only)",
  "command.moveNodeOnlyDown": "Move heading label down (current line only)",
  "command.moveCompositeBlockUp": "Move extended block up (at cursor)",
  "command.moveCompositeBlockDown": "Move extended block down (at cursor)",
  "command.indentBlock": "Indent block (list subtree / safe-scope heading)",
  "command.outdentBlock": "Outdent block (list subtree / safe-scope heading)",
  "command.indentNodeOnly": "Indent heading level (current line only)",
  "command.outdentNodeOnly": "Outdent heading level (current line only)",
  "command.deleteBlock": "Delete block (section / list subtree)",
  "command.insertSiblingBlock": "Insert sibling after current block",
  "command.insertChildListItem": "Insert child list item",
  "command.openOutlineTreeView": "Open outline tree view",
  "command.openPartialEditPane": "Open partial edit pane for current section",
  // Phase 5P-2: cursor-triggered paragraph hoist — see main.ts's
  // openParagraphPartialEditForCursor and view/PartialEditView.ts's
  // requestLoadParagraphAtCursor.
  "command.editParagraphAtCursor": "Edit paragraph at cursor",
  "command.ribbonTooltip": "Open Unified Outliner outline",

  // ---- Notices (main.ts, non-reason) ------------------------------------
  "notice.couldNotOpenOutlineTreeView": "Unified Outliner: could not open the outline tree view.",
  "notice.couldNotOpenRightSidebar": "Unified Outliner: could not open the right sidebar.",
  "notice.couldNotOpenLeftSidebar": "Unified Outliner: could not open the left sidebar.",
  "notice.couldNotOpenPartialEditPaneNewWindow":
    "Unified Outliner: could not open the partial edit pane in a new window.",
  "notice.couldNotOpenPartialEditPane": "Unified Outliner: could not open the partial edit pane.",
  "notice.multipleCursors": "Unified Outliner: multiple cursors are not supported.",
  "notice.moved": "Unified Outliner: moved {unit} {direction}.",
  "notice.directionUp": "up",
  "notice.directionDown": "down",
  "notice.languageChanged":
    "Unified Outliner: display language updated — check the Command Palette for the new command names.",

  // ---- Move-result toast unit descriptions (move/resolveMoveTarget.ts) --
  "unit.sectionNamed": 'section "{heading}"',
  "unit.untitledHeading": "(untitled heading)",
  "unit.listItem": "list item",
  "unit.listItemWithNestedOne": "list item (with {count} nested item)",
  "unit.listItemWithNestedMany": "list item (with {count} nested items)",
  "unit.callout": "callout",
  "unit.blockquote": "blockquote",
  "unit.codeBlock": "code block",
  "unit.table": "table",
  "unit.paragraph": "paragraph",
  "unit.thematicBreak": "thematic break",
  "tree.emptyComplexMember": "(empty)",
  "tree.complexMember.calloutFallback": "Callout",
  "tree.complexMember.blockquoteFallback": "Quote",
  "tree.complexMember.fencedCodeFallback": "Code block",
  "tree.complexMember.tableFallback": "Table",
  // Phase 5P-3 (design doc §4 priority tier 3): fallback label for a
  // paragraph Tree node when its normalized preview text has no letter/
  // digit content to show (whitespace-only, symbol-only, or otherwise
  // unextractable) — {n} is the paragraph's per-document ordinal, the same
  // number buildOutlineTree.ts's buildParagraphOrdinals computes once for
  // every eligible paragraph in document order.
  "tree.paragraphFallback": "Paragraph {n}",

  // ---- Outline Tree View --------------------------------------------------
  "tree.viewName": "Unified Outliner: Outline",
  "tree.untitledHeading": "(Untitled heading)",
  "tree.emptyListItem": "(Empty list item)",
  "tree.emptyNoHeadingsOrList": "This note has no headings or list items.",
  "tree.emptyNoHeadings": "This note has no headings.",
  "tree.emptyNoActiveNote": "No active Markdown note.",
  "tree.menu.contextual": "{title} (contextual: {mode})",
  "tree.menu.modeSubtree": "subtree",
  "tree.menu.modeNodeOnly": "node-only",
  "tree.menu.moveUp": "Move up",
  "tree.menu.moveDown": "Move down",
  "tree.menu.indent": "Indent",
  "tree.menu.outdent": "Outdent",
  "tree.menu.moveSubtreeUp": "Move subtree up",
  "tree.menu.moveSubtreeDown": "Move subtree down",
  "tree.menu.indentSubtree": "Indent subtree",
  "tree.menu.outdentSubtree": "Outdent subtree",
  "tree.menu.openPartialEditPane": "Open partial edit pane",
  "tree.menu.openPartialEditPaneNewWindow": "Open partial edit pane in new window",
  "tree.menu.insertSectionAfter": "Insert section after",
  "tree.menu.deleteSectionSubtree": "Delete section subtree",
  "tree.menu.rename": "Rename",
  "tree.menu.editListSubtreeInPane": "Edit list subtree in pane",
  "tree.menu.editListSubtreeInNewWindow": "Edit list subtree in new window",
  "tree.menu.insertListItemAfter": "Insert list item after",
  "tree.menu.insertChildListItem": "Insert child list item",
  "tree.menu.deleteListSubtree": "Delete list subtree",
  "tree.menu.unavailableSuffix": " — unavailable",
  "tree.menu.deleteCompositeBlock": "Delete extended block",
  "tree.menu.deleteFencedCodeBlock": "Delete",
  "tree.menu.compositeMoveUp": "Move extended block up",
  "tree.menu.compositeMoveDown": "Move extended block down",
  // Phase 5D-2A: the CompositeBlock parent's own, whole-block Partial Edit
  // entry point — deliberately a distinct key from tree.menu.
  // openPartialEditPane (used by section/list/standalone/member rows),
  // even though the wording is similar, since this ONE opens the entire
  // CompositeBlock (list item + callout/blockquote) as one atomic editing
  // unit rather than a single node.
  "tree.menu.openCompositeInPartialEdit": "Open extended block in partial edit",
  // Phase 5C-3: standalone (non-composite-member) callout/blockquote move
  // menu items — deliberately NEW, dedicated keys rather than reusing
  // tree.menu.compositeMoveUp/Down above, since that pair's wording
  // ("extended block") is composite-specific and would be misleading for a
  // block that was never part of any CompositeBlock.
  "tree.menu.standaloneMoveUp": "Move up",
  "tree.menu.standaloneMoveDown": "Move down",

  // Phase 5T-1 ("Outline Tree の paragraph context menu からの安全な上下移
  // 動"): a paragraph row's own move menu items — deliberately NEW, dedicated
  // keys rather than reusing tree.menu.standaloneMoveUp/Down above, matching
  // this codebase's own established precedent (see that pair's own comment)
  // of never reusing another feature's menu-label keys even when the wording
  // happens to coincide today.
  "tree.menu.paragraphMoveUp": "Move up",
  "tree.menu.paragraphMoveDown": "Move down",

  // Phase 5T-3A ("paragraph non-adjacent move の最小実装"): the four new
  // menu commands (edit/paragraphNonAdjacentMove.ts), plus the picker
  // items shown after "Move before sibling…"/"Move after sibling…" is
  // clicked (a second Menu listing each eligible sibling by its existing
  // Tree label — see view/OutlineTreeView.ts#showParagraphMoveMenu).
  "tree.menu.paragraphMoveToTop": "Move to top",
  "tree.menu.paragraphMoveToBottom": "Move to bottom",
  "tree.menu.paragraphMoveBeforeSibling": "Move before sibling…",
  "tree.menu.paragraphMoveAfterSibling": "Move after sibling…",

  // Phase 5T-4A ("Tree paragraph → 既存 Partial Edit の最小実装",
  // docs/phase5t4_tree_paragraph_partial_edit_design.md): unconditional
  // item, always shown alongside the move items above whenever the
  // paragraph itself resolves — opens the paragraph in the EXISTING
  // Partial Edit Pane via the existing, unmodified
  // main.ts#activatePartialEditViewForParagraph (see
  // view/OutlineTreeView.ts#showParagraphMoveMenu's own doc comment).
  "tree.menu.paragraphEdit": "Edit paragraph…",

  // Phase 5T-10A ("paragraph insert の最小スコープ実装"): a top-level or
  // section-direct paragraph row's own insert-before/insert-after items —
  // shown only when the paragraph is in-scope (same
  // edit/deleteParagraph.ts#isInScopeParagraphParent gate 5T-9A's delete
  // item already uses). Choosing either immediately creates a placeholder
  // paragraph and enters inline rename on it — see
  // edit/insertParagraph.ts's own top doc comment.
  "tree.menu.insertParagraphBefore": "Insert paragraph before",
  "tree.menu.insertParagraphAfter": "Insert paragraph after",

  // Phase 5T-9A ("paragraph delete の最小スコープ実装"): a top-level or
  // section-direct paragraph row's own delete item — shown only when the
  // paragraph is in-scope for delete this phase (see
  // edit/deleteParagraph.ts#isInScopeParagraphParent); opens
  // ConfirmParagraphDeleteModal rather than deleting immediately, mirroring
  // tree.menu.deleteCompositeBlock's own confirm-then-delete UX, not
  // tree.menu.deleteListSubtree's immediate-no-confirm one.
  "tree.menu.deleteParagraph": "Delete paragraph",

  // ---- Partial Edit Pane --------------------------------------------------
  "partialEdit.viewName": "Unified Outliner: Partial Edit",
  "partialEdit.noActiveNote": "Unified Outliner: no active note to load a node from.",
  "partialEdit.couldNotLoadNode": "Unified Outliner: could not load that node.",
  "partialEdit.editingTitle": "Editing ({kind}): {label}",
  "partialEdit.kindList": "List",
  "partialEdit.kindSection": "Section",
  "partialEdit.kindCallout": "Callout",
  "partialEdit.kindBlockquote": "Quote",
  // Phase 5P-2: the pane title's {kind} label for a paragraph loaded via
  // requestLoadParagraphAtCursor — see view/PartialEditView.ts's
  // renderLoadedState.
  "partialEdit.kindParagraph": "Paragraph",
  // Phase 5D-2A: label for the whole-CompositeBlock Partial Edit pane
  // (nodeKind === "composite") — "Extended block" matches this codebase's
  // existing user-facing CompositeBlock terminology (see tree.menu.
  // deleteCompositeBlock / reason.nested-in-list etc.), not "List + Callout"
  // (that's a specific rule's own display name, not the generic kind noun).
  "partialEdit.kindComposite": "Extended block",
  "partialEdit.close": "Close",
  "partialEdit.emptyPlaceholder":
    "Right-click a node in the Outline Tree View and choose “Open partial edit pane” / “Edit list subtree in pane” to load something here.",
  "partialEdit.subtreeLabel": "Subtree:",
  "partialEdit.moreChip": "More… ({count})",
  "partialEdit.moreCount": "{count} more",
  "partialEdit.noNodeLoaded": "Unified Outliner: no node loaded in this pane.",
  "partialEdit.noActiveNoteToApply": "Unified Outliner: no active note to apply to.",
  "partialEdit.couldNotApplyEdit": "Unified Outliner: could not apply this edit.",
  "partialEdit.listSubtreeUpdated": "Unified Outliner: list subtree updated.",
  "partialEdit.sectionUpdated": "Unified Outliner: section updated.",
  // Phase 5P-2: Apply-success notice for a paragraph loaded via
  // requestLoadParagraphAtCursor — see view/PartialEditView.ts's applyEdit.
  "partialEdit.paragraphUpdated": "Unified Outliner: paragraph updated.",
  // Phase 5D-2A: Apply-success notice for the whole-CompositeBlock pane
  // (compositeAnchor) — shown when the edit still matches its original
  // rule (ruleStillMatches !== false); see
  // partialEdit.compositeRuleNoLongerMatches below for the other case.
  "partialEdit.compositeUpdated": "Unified Outliner: extended block updated.",
  // Phase 5D-2A (方針A): shown INSTEAD of partialEdit.compositeUpdated
  // above, only when Apply succeeded but the just-written content no
  // longer matches the CompositeBlock rule it was loaded from (e.g. a
  // blank line was inserted, or a member was deleted) — purely
  // informational, never a reason Apply itself was refused. Exact wording
  // fixed by this ticket's own approval; do not reword.
  "partialEdit.compositeRuleNoLongerMatches":
    "Unified Outliner: this edit no longer matches the CompositeBlock rule. The blocks are now shown separately.",
  // Phase 5D-0.5: loadNodeInternal's quote-prefix-projection gate refuses
  // to open the Pane at all for a nested quote/nested callout (see
  // edit/quotePrefixProjection.ts's "nested" reason) — no raw fallback.
  "partialEdit.quoteNestedUnsupported":
    "Unified Outliner: nested quotes are not yet supported for editing quote body text here.",
  // Phase 5D-1.5 ("単独 Callout / Blockquote Partial Edit Pane の可変長
  // 本文編集"): applyEdit's invertQuotePrefixProjection refusal — the
  // body was fully cleared for a BLOCKQUOTE specifically (a callout in
  // the same situation instead succeeds with a header-only result, no
  // Notice at all — see that function's own doc comment). Zero-byte-
  // change: the note is never touched when this fires, and the pane's
  // own draft (the emptied textarea) is left exactly as the user typed
  // it. Supersedes the old, now-removed Phase 5D-0.5
  // "quoteLineCountChanged" key this ticket's own approved scope
  // explicitly retires (adding/removing lines is now supported).
  "partialEdit.quoteBodyEmptyUnsupported":
    "Unified Outliner: a blockquote body cannot be emptied here — delete the whole block in the body editor instead.",
  // Phase 5D-1.5: applyEdit's own re-verification of a variable-length
  // body edit against the CURRENT parser/scanner, run in isolation right
  // before the splice call — see that method's own doc comment for what
  // this catches (e.g. edited content that itself looks like a callout
  // header once re-prefixed with `>`). Zero-byte-change; the pane's own
  // draft is left untouched, same as every other Apply-time refusal here.
  "partialEdit.quoteEditStructureInvalid":
    "Unified Outliner: this edit can't be applied — it would break the callout/blockquote structure.",
  // Phase 5D-2C ("CompositeBlock single-line-list member marker-free
  // projection"): applyEdit's own invertListMarkerProjection refusal — the
  // marker-free list-member body contains a newline. A single-line-list
  // item is, by definition, exactly one raw line (no continuation lines,
  // no nested child list — see parser/compositeBlocks.ts's own
  // classification), so a body edit that introduces a newline can never
  // be safely reconstructed as one. Rejects the WHOLE Apply (list body
  // AND any trailing member edit together), zero-byte-change — same
  // "genuine safety error, not a grouping-rule concern" refusal class as
  // quoteEditStructureInvalid above, never confused with the separate,
  // NON-rejecting "this edit no longer matches the CompositeBlock rule"
  // notice (compositeRuleNoLongerMatches below) — see
  // edit/listMarkerProjection.ts's own top doc comment.
  "partialEdit.listBodyNewlineUnsupported":
    "Unified Outliner: a list item's body can't contain a line break here.",
  // Phase 5L-2 ("Task List Marker-Free Partial Edit"): the task-list
  // counterpart of listBodyNewlineUnsupported immediately above — shown
  // when a standalone task-list item's marker-free/checkbox-free body
  // edit would introduce a line break, which (mirroring
  // edit/taskListProjection.ts's own "multiline-body" refusal exactly)
  // can never be safely reconstructed as the item's own single raw line.
  "partialEdit.taskBodyNewlineUnsupported":
    "Unified Outliner: a task list item's body can't contain a line break here.",
  // Phase 5L-2: tooltip for the standalone task-list item's own checkbox
  // control (view/PartialEditView.ts's taskCheckboxInputEl) — the small
  // checkbox that carries the item's completion state once its `[ ]`/
  // `[x]` syntax is hidden from the shared textarea.
  "partialEdit.taskCheckboxLabel": "Task completed",
  // Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): the
  // ordered-list counterpart of listBodyNewlineUnsupported/
  // taskBodyNewlineUnsupported above — shown when a standalone
  // ordered-list item's marker-free body edit would introduce a line
  // break, which (mirroring edit/orderedListProjection.ts's own
  // "multiline-body" refusal exactly) can never be safely reconstructed
  // as the item's own single raw line.
  "partialEdit.orderedBodyNewlineUnsupported":
    "Unified Outliner: an ordered list item's body can't contain a line break here.",
  // Phase 5L-3: applyEdit's own invertOrderedListProjection refusal —
  // the number input's current text fails
  // edit/orderedListProjection.ts's own isValidOrderedListNumberText
  // (empty, zero, negative, decimal, exponential, non-ASCII-digit, or
  // whitespace-padded). Rejects the WHOLE Apply (number and any body
  // edit together), zero-byte-change, with every draft left exactly as
  // the user had it — see that module's own top doc comment's "The
  // number field" section for the exhaustive rejection-case rationale.
  "partialEdit.orderedNumberInvalid":
    "Unified Outliner: this ordered list item's number must be a positive whole number.",
  // Phase 5L-3: tooltip/label for the standalone ordered-list item's
  // own number control (view/PartialEditView.ts's
  // orderedNumberInputEl) — the small text input that carries the
  // item's ordered-list number once its `N.`/`N)` marker is hidden
  // from the shared textarea. The `.`/`)` delimiter itself is never
  // editable this phase — see edit/orderedListProjection.ts's own top
  // doc comment.
  "partialEdit.orderedNumberLabel": "List item number",
  // Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"):
  // applyEdit's own invertMultiLineListItemProjection "unsafe-structure"
  // refusal — the freshly reconstructed multi-line candidate would, once
  // re-parsed, introduce a nested child list item or a callout/
  // blockquote/fenced-code/table/thematic-break block (see
  // edit/multiLineListItemProjection.ts's own
  // validateMultiLineListItemCandidate doc comment for the exhaustive
  // check list). Rejects the WHOLE Apply, zero-byte-change, with every
  // draft (checkbox/number control AND the full multi-line body) left
  // exactly as the user had it.
  "partialEdit.multiLineListStructureInvalid":
    "Unified Outliner: this edit would change the list item's own Markdown structure and can't be applied here.",
  // Phase 5L-6 ("Parent List Item Structured Partial Edit"): applyEdit's own
  // invertParentListItemProjection "own-text-unsafe-structure" refusal — the
  // freshly reconstructed OWN-TEXT-ALONE candidate (marker/checkbox/number/
  // body/continuation) would, once re-parsed in isolation, introduce a
  // nested child list item or a callout/blockquote/fenced-code/table/
  // thematic-break block — the parent-item counterpart of
  // multiLineListStructureInvalid above, scoped to own-text only (the child
  // subtree is never touched by this rejection). Rejects the WHOLE Apply,
  // zero-byte-change, with every draft left exactly as the user had it.
  "partialEdit.parentOwnTextStructureInvalid":
    "Unified Outliner: this edit would change the parent item's own Markdown structure and can't be applied here.",
  // Phase 5L-6: the second-stage safety-net refusal — the edited own-text
  // candidate, once spliced back together with the ORIGINAL child-subtree
  // snapshot and re-parsed as a whole, no longer yields a single parent
  // list item that safely owns exactly the same child subtree (see
  // edit/parentListItemProjection.ts#invertParentListItemProjection's own
  // "child-subtree-detached"/"child-subtree-changed" reasons). Deliberately
  // a distinct key from parentOwnTextStructureInvalid above — that one is
  // about the own-text candidate failing ALONE; this one is about the
  // splice with the child subtree failing. Rejects the WHOLE Apply,
  // zero-byte-change.
  "partialEdit.parentChildSubtreeStructureInvalid":
    "Unified Outliner: this edit can't be applied — it would break the parent item's relationship with its child items.",
  // Phase 5L-6: label for the read-only child-subtree preview shown below a
  // parent list item's own editable own-text fields (view/PartialEditView.ts's
  // renderParentChildPreview) — the preview itself is never editable here;
  // existing Outline Tree/Subtree Navigator navigation remains the path for
  // actually editing a child.
  "partialEdit.parentChildPreviewLabel": "Child items",
  // Phase 5L-6: truncation indicator shown when the child-subtree preview
  // exceeds PartialEditView.PARENT_CHILD_PREVIEW_MAX_LINES lines — mirrors
  // the existing moreChip/moreCount {count} interpolation pattern above.
  "partialEdit.parentChildPreviewTruncated": "{count} more line(s) not shown",
  // Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): tooltip/
  // aria-label for a child-preview row that HAS a resolvable navigation
  // target (view/PartialEditView.ts's renderParentChildPreview) — read
  // together with the row's own already-present aria-readonly="true", so
  // this is accessibly announced as "read-only, but activating it opens
  // this child item", never as if the row itself became editable.
  "partialEdit.parentChildPreviewRowOpenLabel": "Open this child item",
  // Phase 5L-7: shown instead of navigating whenever
  // resolveParentChildPreviewNavigationTarget refuses a child-preview
  // row's activation (parent no longer eligible, target no longer found,
  // target reassigned elsewhere, or target content changed since this
  // preview was last built/reloaded — see that function's own reason type
  // doc comment). The pane stays on its current node with its current
  // draft completely untouched; this Notice never distinguishes the exact
  // reason, since every one of them leads to the identical safe outcome.
  "partialEdit.parentChildPreviewNavigationFailed":
    "Unified Outliner: couldn't open that child item — it may have changed. The parent item you're editing is unaffected.",
  // Phase 5L-8 ("Child Item Inline Structured Editing in Parent Partial
  // Edit Pane"): tooltip/aria-label for the small edit-start affordance
  // shown on an ELIGIBLE direct child's own preview row — a genuinely
  // separate control from the row's own navigation click/Enter/Space
  // handling (see partialEdit.parentChildPreviewRowOpenLabel above).
  "partialEdit.parentChildInlineEditStartLabel": "Edit this child item inline",
  // Phase 5L-8: label for the "stop editing this child" button in the
  // child inline editor panel's own header row — discards ONLY the
  // child's own draft (never the parent's) on confirmation, or closes
  // immediately when the child draft is already clean.
  "partialEdit.parentChildInlineEditStopLabel": "Stop editing",
  // Phase 5L-8: the child inline editor panel's own header label,
  // interpolating the selected child's own first raw line so it's
  // unambiguous which child is currently being edited.
  "partialEdit.parentChildInlineEditPanelLabel": "Editing child: {text}",
  // Phase 5L-8: shown when buildParentChildInlineEditSession itself
  // refuses to open a child's inline editor (the row's own eligibility
  // changed since this preview was last built/reloaded), or when the
  // active note/editor can't be resolved at all — a safe refusal, no
  // editor opens, no draft touched.
  "partialEdit.parentChildInlineEditFailed":
    "Unified Outliner: couldn't open that child item for inline editing — it may have changed.",
  // Phase 5L-8: applyParentChildCombinedEdit's own success Notice — shown
  // after a combined parent+child Apply actually saves, mirroring
  // partialEdit.listSubtreeUpdated's own identical role for the
  // single-range case.
  "partialEdit.parentChildInlineEditApplied": "Unified Outliner: parent and child item updated.",
  // Phase 5L-8: invertAndValidateParentChildCombinedEdit's own
  // "child-unsafe-structure" refusal — the edited child candidate, once
  // re-parsed (alone, or spliced back among its own unedited siblings),
  // would introduce a nested grandchild list item or a callout/
  // blockquote/fenced-code/table/thematic-break block. Rejects the WHOLE
  // Apply (parent AND child drafts both preserved), zero-byte-change.
  "partialEdit.parentChildInlineEditChildStructureInvalid":
    "Unified Outliner: this edit would change the child item's own Markdown structure and can't be applied here.",
  // Phase 5L-8: invertAndValidateParentChildCombinedEdit's own combined-
  // candidate safety-net refusal ("candidate-structure-invalid"/
  // "child-count-changed"/"child-no-longer-leaf"/"sibling-changed") — the
  // edited child, once re-spliced back among its siblings under the
  // parent, no longer yields the same number of direct children with
  // every sibling byte-for-byte preserved and the target still a leaf at
  // its own position. Rejects the WHOLE Apply, zero-byte-change.
  "partialEdit.parentChildInlineEditCandidateInvalid":
    "Unified Outliner: this edit can't be applied — it would change the parent item's relationship with its child items.",
  // Phase 5L-8: applyParentChildInlineEditToDocument's own "parent-conflict"/
  // "child-conflict" refusal — the document changed externally, in the
  // SPECIFIC range this Apply was about to write, since this session's own
  // snapshot was taken. Rejects the WHOLE Apply, zero-byte-change, both
  // drafts preserved.
  "partialEdit.parentChildInlineEditConflict":
    "Unified Outliner: the note changed since this item was loaded — reload before applying this edit.",
  // Phase 5L-8: applyParentChildInlineEditToDocument's own structural
  // re-resolution refusal ("parent-resolve-failed"/"child-resolve-failed"/
  // "not-direct-child"/"child-has-children"/"child-unsafe-indent"/
  // "range-overlap") — the parent or the selected child no longer resolves
  // the way this session expects against the CURRENT document (moved,
  // deleted, gained a grandchild, ...). Rejects the WHOLE Apply,
  // zero-byte-change, both drafts preserved.
  "partialEdit.parentChildInlineEditResolveFailed":
    "Unified Outliner: couldn't apply this edit — the parent or child item's structure has changed.",
  // Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
  // invertAndValidateParentChildAddDeleteEdit's own "new-child-unsafe-
  // structure" refusal — the pending new child's own edited body would
  // introduce a second (more deeply indented) line. Rejects the WHOLE
  // Apply, zero-byte-change, every draft preserved.
  "partialEdit.parentChildNewChildStructureInvalid":
    "Unified Outliner: this new item's text can't include a line break and can't be applied here.",
  // Phase 5L-9: tooltip for the "Add child item" control in the
  // child-preview header — see parentChildAddButtonEl's own field doc
  // comment (view/PartialEditView.ts) for its exact placement.
  "partialEdit.parentChildAddButtonLabel": "Add child item",
  // Phase 5L-9: tooltip for the SAME control while it is disabled because
  // a new-child draft is already pending — this ticket's own "prevent
  // double-add" requirement (§6/§10).
  "partialEdit.parentChildAddButtonAlreadyPendingLabel": "A new child item is already pending — apply or cancel it first",
  // Phase 5L-9: header label for the pending new-child's own inline
  // editor panel (newChildEditorEl).
  "partialEdit.parentChildNewChildPanelLabel": "New child item",
  // Phase 5L-9: label for the close button in the pending new-child
  // editor panel's own header row — mirrors
  // partialEdit.parentChildInlineEditStopLabel's own identical role for
  // the EXISTING-child slot (same clean-closes-immediately /
  // dirty-shows-the-3-choice-DiscardChangesModal behavior), and now uses
  // the EXACT SAME text as that control too — the two panels are
  // functionally identical "close this child editor" actions, so there
  // is no reason for their labels to differ. (Originally worded "Cancel
  // new item", which read as a pure discard action even though pressing
  // it can just as well lead to Apply via the 3-choice modal.)
  "partialEdit.parentChildNewChildStopLabel": "Stop editing",
  // Phase 5L-9: tooltip/aria-label for a child-preview row currently
  // marked pending-deletion — read together with that row's own
  // aria-readonly="true", so this is accessibly announced as "read-only,
  // and will be removed on Apply", never as if the row simply vanished.
  "partialEdit.parentChildPendingDeletionLabel": "Will be deleted when you apply",
  // Phase 5L-9: tooltip/aria-label for the delete affordance shown on an
  // ELIGIBLE direct child's own preview row — a genuinely separate
  // control from both the row's own navigation and the pencil edit-start
  // affordance (see partialEdit.parentChildInlineEditStartLabel above).
  "partialEdit.parentChildDeleteButtonLabel": "Delete this child item",
  // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
  // Pane"): tooltip/aria-label for the up/down reorder affordance shown
  // on an ELIGIBLE direct child's own preview row — a FOURTH genuinely
  // separate control from the row's own navigation, the pencil edit-start
  // affordance, and the trash delete affordance (see
  // partialEdit.parentChildInlineEditStartLabel/parentChildDeleteButtonLabel
  // above). Each button's own disabled state (first/last child, or a
  // non-eligible/pending-deletion neighbor) is a plain HTML disabled
  // control, so no separate "why is this disabled" wording is needed —
  // the same "no edit-pencil/delete-trash affordance at all" convention
  // this whole preview already follows for a non-eligible row.
  "partialEdit.parentChildReorderUpLabel": "Move this child item up",
  "partialEdit.parentChildReorderDownLabel": "Move this child item down",
  // Phase 5L-10: shown when handleReorderChild itself refuses to move a
  // child (the active note/editor can't be resolved, the parent no
  // longer resolves, or the move itself is refused by
  // moveChildInPendingReorder — reachable only if eligibility changed
  // since the button was last rendered). A safe refusal, nothing
  // reordered — mirrors partialEdit.parentChildDeleteFailed's own
  // identical "safe refusal" contract.
  "partialEdit.parentChildReorderFailed":
    "Unified Outliner: couldn't move that child item — it may have changed.",
  // Phase 5L-9: shown when handleRequestAddChild itself refuses to start
  // a new-child draft (the active note/editor can't be resolved, or the
  // parent no longer resolves) — a safe refusal, no draft created.
  "partialEdit.parentChildAddChildFailed":
    "Unified Outliner: couldn't start adding a new child item — the parent item may have changed.",
  // Phase 5L-9: shown when handleRequestDeleteChild/commitPendingDeletion
  // itself refuses to mark (or re-confirm) a pending deletion — the row's
  // own eligibility changed since it was last rendered, or the active
  // note/editor can't be resolved. A safe refusal, nothing marked.
  "partialEdit.parentChildDeleteFailed":
    "Unified Outliner: couldn't mark that child item for deletion — it may have changed.",
  // Phase 5L-9: applyParentChildAddDeleteCombinedEdit's own success
  // Notice — shown after a combined Apply that included an add and/or a
  // delete (and possibly the parent's own text and/or an existing
  // child's own edit too) actually saves. Deliberately a distinct key
  // from partialEdit.parentChildInlineEditApplied above (that one's own
  // "parent and child item updated" phrasing doesn't fit an add-only or
  // delete-only Apply).
  "partialEdit.parentChildAddDeleteApplied": "Unified Outliner: parent item's child items updated.",
  // Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial
  // Edit Pane"): tooltip for the "Add child item" control while it is
  // disabled because a pending indent/outdent is already in flight —
  // the indent/outdent counterpart of
  // partialEdit.parentChildAddButtonAlreadyPendingLabel above (§6's own
  // "at most one pending structural transformation" scope limit).
  "partialEdit.parentChildIndentOutdentPendingOtherDisabledLabel":
    "An indent/outdent is already pending — apply or cancel it first",
  // Phase 5L-11: tooltip/aria-label for the indent affordance shown on
  // an eligible DIRECT child's own preview row — appended into the same
  // shared actions group as the edit-pencil/delete-trash/reorder
  // controls (see partialEdit.parentChildInlineEditStartLabel/
  // parentChildDeleteButtonLabel/parentChildReorderUpLabel above).
  "partialEdit.parentChildIndentButtonLabel": "Indent this child item under the previous item",
  // Phase 5L-11: tooltip/aria-label for the outdent affordance shown on
  // an eligible NESTED (exactly-one-level-deep) child's own preview row
  // — a different row population from every other affordance above (all
  // direct-children-only).
  "partialEdit.parentChildOutdentButtonLabel": "Outdent this child item to the parent level",
  // Phase 5L-11: shown when handleRequestIndentChild itself refuses to
  // start a pending indent (the active note/editor can't be resolved,
  // or the target's own eligibility changed since the button was last
  // rendered) — a safe refusal, nothing marked pending. Mirrors
  // partialEdit.parentChildReorderFailed's own identical "safe refusal"
  // contract.
  "partialEdit.parentChildIndentFailed":
    "Unified Outliner: couldn't indent that child item — it may have changed.",
  // Phase 5L-11: the outdent counterpart of parentChildIndentFailed
  // immediately above — shown when handleRequestOutdentChild itself
  // refuses to start a pending outdent.
  "partialEdit.parentChildOutdentFailed":
    "Unified Outliner: couldn't outdent that child item — it may have changed.",
  // Phase 5L-9: ChildDeleteConfirmModal's own title/body/confirm-button
  // text — §5's own "a real Obsidian-style Modal with at minimum
  // '削除する'/'キャンセル' choices" requirement. Confirmation is shown
  // regardless of whether the target child's own body is empty. Wording
  // revised (post-Phase-5L-9 follow-up) to make explicit that this marks
  // the item as pending deletion only — the actual removal from the note
  // happens when the user later presses Apply — since the original
  // wording read as if this dialog's own confirm button deletes
  // immediately.
  "partialEdit.parentChildDeleteConfirmTitle": "Mark this child item for deletion?",
  "partialEdit.parentChildDeleteConfirmBody":
    "It will actually be removed from the note when you press Apply.",
  "partialEdit.parentChildDeleteConfirmButton": "Delete",
  // Phase 5D-1A: placeholder/tooltip label for the callout title input
  // (see view/PartialEditView.ts's onOpen/renderQuoteHeader).
  "partialEdit.quoteTitleLabel": "Callout title",
  // Phase 5D-1A: applyEdit's reconstructQuoteHeader refusal — the title
  // input contains a newline. Rejects the WHOLE Apply (title and any body
  // edit together), zero-byte-change. Deliberately a distinct key from
  // quoteBodyEmptyUnsupported/quoteEditStructureInvalid above (those are
  // about the BODY; this one is about the title, a single-line field by
  // definition).
  "partialEdit.quoteTitleNewlineUnsupported":
    "Unified Outliner: the callout title cannot contain a line break.",
  // Phase 5D-1B: tooltip/aria-label for the fold-marker <select> itself
  // (see view/PartialEditView.ts's onOpen).
  "partialEdit.quoteFoldMarkerLabel": "Callout fold behavior",
  // 2026-09-09 (Partial Edit Pane コールアウト編集ヘッダーUI改善): these
  // three <option> labels were originally the long, fully-descriptive
  // "Not foldable" / "Foldable, expanded by default" / "Foldable,
  // collapsed by default" — real-device feedback was that the <select>'s
  // own intrinsic width (driven by its longest option text, since the
  // element had no explicit `width` — see styles.css's
  // .unified-outliner-partial-edit-quote-marker-select) was eating space
  // quoteTitleInputEl needed. Shortened to compact, symbol-forward labels
  // that still read correctly next to their marker VALUE ("", "+", "-",
  // unchanged) — the full description lives on in
  // quoteFoldMarkerLabel's own tooltip, unaffected by this change.
  "partialEdit.quoteFoldMarkerNone": "Fixed",
  "partialEdit.quoteFoldMarkerExpand": "+ Expand",
  "partialEdit.quoteFoldMarkerCollapse": "- Collapse",
  // Phase 5D-1C: tooltip/aria-label for the type combobox (see
  // view/PartialEditView.ts's onOpen), and the Notice shown when
  // reconstructQuoteHeader refuses with reason "invalid-type" (empty, or
  // containing "]", or containing a line break — all three explained in
  // one message per the ticket's own instruction). User-approved exact
  // wording.
  "partialEdit.quoteTypeLabel": "Callout type",
  "partialEdit.quoteTypeInvalidUnsupported":
    'Unified Outliner: the callout type must not be empty or contain "]" or a line break.',
  "partialEdit.unsavedChangesTitle": "Unified Outliner: unsaved changes",
  // Button-row consolidation (2026-09-16 ticket): DiscardChangesModal's
  // visible buttons went from three (Apply/Discard/Cancel) to two
  // (Apply/Cancel), to match the Partial Edit Pane's own top-level
  // Apply/Cancel bar and remove the semantic collision between this
  // modal's "Cancel" (previously: stay, do nothing) and the pane's own
  // "Cancel" (discard and close). The internal DiscardChangesChoice type
  // and onClose()'s x/Escape/outside-click fallback to "cancel" are
  // UNCHANGED -- see DiscardChangesModal's own doc comment in
  // PartialEditView.ts. Body text now describes exactly the two visible
  // choices, plus a short note that closing the dialog keeps editing here
  // (the only remaining way to reach the internal "cancel" choice).
  "partialEdit.unsavedChangesBody":
    "This node has unapplied edits. Apply them before switching, or Cancel to discard them and switch anyway. Close this dialog to keep editing here.",
  // New key (2026-09-16 ticket): the discard button's new default label,
  // replacing the previous bare "common.discard" fallback so it reads
  // "Cancel" -- matching the Partial Edit Pane's own top-level Cancel
  // button's wording, since this button now IS this modal's de facto
  // Cancel action (internal choice remains "discard" -- see
  // DiscardChangesModalOptions#discardButtonKey in PartialEditView.ts).
  // common.cancel itself is deliberately left untouched, since it is
  // shared by several unrelated modals/buttons.
  "partialEdit.unsavedChangesDiscardButtonLabel": "Cancel",
  "partialEdit.previousSibling": "Previous",
  "partialEdit.nextSibling": "Next",
  "partialEdit.noPreviousSibling": "No previous sibling",
  "partialEdit.noNextSibling": "No next sibling",

  // ---- Phase 5A-1 ("Partial Edit Pane の stale 状態検知・安全な再読み込み")
  // stale/unavailable indicator, Reload button, and Reload confirmation
  // (extends DiscardChangesModal via showApply — see that class's own doc
  // comment in PartialEditView.ts).
  "partialEdit.reload": "Reload",
  // Stale status wording fix (2026-09-08 ticket, real-device UX feedback):
  // the previous wording only stated the pane's own state ("out of date")
  // without explaining WHY — that the note changed and no longer matches
  // this pane. Deliberately does not mention that Reload discards unapplied
  // edits (the adjacent Reload confirmation modal already explains that
  // precisely — see partialEdit.reloadConfirmBody/reloadConfirmDiscardButton
  // — so repeating it here would be redundant), and deliberately avoids
  // exposing implementation terms ("stale"/"conflict"/"snapshot") to the
  // user. This is a wording-only change — staleApplyDisabledReason (the
  // Apply-disabled tooltip) and every stale/unavailable state-transition
  // and Apply fail-closed behavior are unchanged.
  "partialEdit.staleLabel":
    "Unified Outliner: The note has changed, so this pane no longer matches the current content.",
  "partialEdit.staleApplyDisabledReason":
    "Apply is disabled because this pane is out of date. Reload to get the current content, then edit again.",
  // Unavailable status wording fix (2026-09-08 ticket, real-device E-3
  // feedback): the previous wording ("this content is no longer
  // available") was vague about WHAT is unavailable and WHY editing is
  // blocked, and read in a different register than the stale/Reload-
  // confirmation wording fixed earlier the same day. "unavailable" is a
  // genuinely shared state covering BOTH a deleted source file AND a
  // target that can no longer be safely re-resolved (a split/merged
  // paragraph, a changed parent, or any other fail-closed re-resolution
  // failure — see resolveCurrentTarget's own doc comment in
  // PartialEditView.ts) — this wording deliberately says only "the
  // editing target can no longer be found", which is equally true of
  // either cause, rather than naming the file-deletion cause specifically
  // (this ticket does not split "unavailable" into separate file-missing
  // vs. resolution-failure states/wording). Never exposes implementation
  // terms ("file"/"deleted"/"stale"/"conflict"/"snapshot") to the user.
  // This is a wording-only change — unavailableApplyDisabledReason (the
  // Apply-disabled tooltip) and every unavailable-state condition/
  // transition are unchanged.
  "partialEdit.unavailableLabel":
    "Unified Outliner: The editing target can no longer be found, so this pane cannot be edited.",
  "partialEdit.unavailableApplyDisabledReason":
    "Apply is disabled because this content could not be found. Try Reload, or close and reopen this pane.",
  "partialEdit.reloadedNotice": "Unified Outliner: reloaded the current content.",
  "partialEdit.reloadFailedNotice":
    "Unified Outliner: could not reload — this content is still unavailable.",
  // Reload confirmation UX wording fix (2026-09-08 ticket, real-device B-1
  // feedback): the modal's only real action is discarding this pane's
  // unapplied edits and reloading the current note content — a stale/
  // unavailable Apply is guaranteed to be refused as a conflict by the
  // existing, unchanged low-level fail-closed check, so the title/body/
  // button wording here deliberately never uses "Apply"/"Reapply"/"Save"/
  // "Overwrite" (or their ja equivalents), which would wrongly suggest the
  // pane's edits can still reach the note from this dialog. `titleKey`/
  // `bodyKey` below are consumed exclusively via performReload's own
  // DiscardChangesModal call (never shared with the three node-switch
  // Apply/Discard/Cancel call sites, which keep using
  // partialEdit.unsavedChangesTitle/Body and common.discard unchanged), so
  // their wording was updated in place here rather than introduced as new
  // keys.
  "partialEdit.reloadConfirmTitle": "Unified Outliner: Reload changes?",
  "partialEdit.reloadConfirmBody":
    "The note has changed, so this pane's edits can no longer be applied. Reloading will discard this pane's unapplied changes and show the current note content.",
  // New key (common.discard's plain "Discard" is shared with the three
  // node-switch Apply/Discard/Cancel call sites and must not change for
  // them — see DiscardChangesModalOptions#discardButtonKey in
  // PartialEditView.ts): this is the Reload confirmation's own main-button
  // label, explicit about BOTH actions it performs (discard, then reload),
  // never "Discard" alone.
  "partialEdit.reloadConfirmDiscardButton": "Discard changes and reload",

  // ---- Insert-section heading-level modal (HeadingLevelModal.ts) --------
  "modal.insertSectionTitle": "Unified Outliner: insert section",
  "modal.chooseHeadingLevel": "Choose the heading level for the new section.",

  // ---- Composite block delete confirmation modal (ConfirmCompositeDeleteModal.ts,
  // Phase 5C-1 ticket 3b) --------------------------------------------------
  "modal.deleteCompositeBlockTitle": "Unified Outliner: delete extended block",
  "modal.deleteCompositeBlockBody":
    'This will remove "{label}" ({memberCount} items, lines {startLine}–{endLine}) from the note.',
  "modal.deleteCompositeBlockUndoNote": "This can be undone with Obsidian's own Undo.",

  // ---- Paragraph delete confirmation modal (ConfirmParagraphDeleteModal.ts,
  // Phase 5T-9A) ------------------------------------------------------------
  "modal.deleteParagraphTitle": "Unified Outliner: delete paragraph",
  "modal.deleteParagraphBody": 'This will remove "{label}" (lines {startLine}–{endLine}) from the note.',
  "modal.deleteParagraphUndoNote": "This can be undone with Obsidian's own Undo.",

  // ---- Fenced code block delete confirmation modal
  // (ConfirmFencedCodeDeleteModal.ts, Phase 5E-1) ---------------------------
  "modal.deleteFencedCodeTitle": "Unified Outliner: delete code block",
  "modal.deleteFencedCodeBody": 'This will remove "{label}" (lines {startLine}–{endLine}) from the note.',
  "modal.deleteFencedCodeUndoNote": "This can be undone with Obsidian's own Undo.",

  // ---- Shared button labels ------------------------------------------------
  "common.apply": "Apply",
  "common.discard": "Discard",
  "common.cancel": "Cancel",
  "common.delete": "Delete",

  // ---- No-op reasons (see NOOP_MESSAGES in commands/applyLineEditOutcome.ts
  // for the canonical English source of truth these keys mirror) ---------
  "reason.code-block": "Unified Outliner: cannot move inside a code block.",
  "reason.frontmatter": "Unified Outliner: cannot move frontmatter.",
  "reason.no-block": "Unified Outliner: no movable block at cursor.",
  "reason.no-sibling": "Unified Outliner: nothing to swap with in that direction.",
  "reason.nested-edge":
    "Unified Outliner: nested item is at the edge of its parent. Try indent/outdent instead.",
  "reason.top-of-document": "Unified Outliner: already at the top.",
  "reason.end-of-document": "Unified Outliner: already at the bottom.",
  "reason.blocked-by-paragraph":
    "Unified Outliner: a paragraph blocks the move (paragraph hopping is not implemented yet).",
  "reason.cross-section-disabled":
    "Unified Outliner: cross-section list moves are disabled in settings.",
  "reason.unsafe-indent":
    "Unified Outliner: mixed tab/space indentation detected — skipped for safety.",
  "reason.no-previous-sibling": "Unified Outliner: no previous sibling to indent under.",
  "reason.already-root": "Unified Outliner: already at the root level.",
  "reason.max-heading-level":
    "Unified Outliner: this heading or a subsection is already at level 6.",
  "reason.min-heading-level": "Unified Outliner: heading is already at level 1.",
  "reason.not-a-heading":
    "Unified Outliner: this node-only command only applies to a heading line.",
  "reason.target-not-a-heading":
    "Unified Outliner: can only drop onto a heading, not a list item.",
  "reason.drop-into-self": "Unified Outliner: can't drop a node onto itself.",
  "reason.drop-into-descendant":
    "Unified Outliner: can't drop a node inside one of its own descendants.",
  "reason.target-resolve-failed":
    "Unified Outliner: could not resolve the drop target (the note may have changed).",
  "reason.resolve-failed":
    "Unified Outliner: could not resolve that block (the note may have changed).",
  "reason.not-a-list-item": "Unified Outliner: this operation only applies to a list item.",
  "reason.invalid-target":
    "Unified Outliner: can only drop a list item onto another list item or a heading.",
  "reason.not-editable":
    "Unified Outliner: this node cannot be opened in the Partial Edit Pane.",
  "reason.type-changed":
    "Unified Outliner: this node's kind changed — rename cancelled without changing the note.",
  "reason.heading-level-changed":
    "Unified Outliner: this heading's level changed — rename cancelled without changing the note.",
  "reason.list-syntax-changed":
    "Unified Outliner: this list item's marker or indentation changed — rename cancelled without changing the note.",
  "reason.contains-newline": "Unified Outliner: rename text can't contain a line break.",
  "reason.no-active-editor": "Unified Outliner: no active note editor — rename cancelled.",
  // Phase 5T-12A (docs/phase5t12_rename_note_leaf_switch_safety_design.md
  // §10 案A): shown when the active note changed while a rename/insert was
  // still uncommitted, so the edit was discarded rather than risking a
  // write into the wrong note.
  "reason.note-switched":
    "Unified Outliner: the note changed while this edit was uncommitted — it was not applied.",
  "reason.boundary-unknown":
    "Unified Outliner: could not confidently determine this block's boundary — move skipped for safety.",
  "reason.not-in-section": "Unified Outliner: cursor is not inside any section.",

  // ---- CompositeBlock delete reasons (edit/deleteCompositeBlock.ts's
  // NoCompositeDeleteReason, Phase 5C-1 tickets 2/3b) ----------------------
  "reason.nested-in-list":
    "Unified Outliner: this extended block is nested inside another list item and cannot be deleted in this version.",
  "reason.member-unsafe-indent":
    "Unified Outliner: mixed tab/space indentation detected — skipped for safety.",
  "reason.composite-boundary-changed":
    "Unified Outliner: the note changed since this extended block was selected — deletion was cancelled to avoid removing the wrong content.",
  "reason.range-invalid":
    "Unified Outliner: could not confirm this extended block's boundary — deletion skipped for safety.",
  "reason.member-resolve-failed":
    "Unified Outliner: could not resolve this extended block's contents (the note may have changed).",
  "reason.member-not-supported":
    "Unified Outliner: part of this extended block is no longer safely recognized — deletion skipped for safety.",
  "reason.member-has-diagnostic":
    "Unified Outliner: part of this extended block has an unresolved issue — deletion skipped for safety.",
  "reason.unsupported-member-kind":
    "Unified Outliner: this extended block contains a kind that cannot be deleted in this version.",
  "reason.ambiguous-section":
    "Unified Outliner: this extended block's members do not agree on a single enclosing section — deletion skipped for safety.",

  // ---- CompositeBlock move reasons (edit/moveCompositeBlock.ts's
  // NoCompositeMoveReason, Phase 5C-1 ticket 4-4). "unsafe-indent" is
  // reused as-is from the reason.unsafe-indent key above (already
  // operation-neutral wording). "nested-in-list", "composite-boundary-
  // changed", and "range-invalid" are NOT reused from the delete-specific
  // reason.* keys above (those say "deletion" explicitly, e.g.
  // reason.nested-in-list's "cannot be deleted in this version") — reusing
  // them here would show a misleading "deleted" message for a move
  // rejection, and this ticket's own constraints rule out editing delete's
  // existing wording/tests. Distinct reason.compositeMove* keys below cover
  // exactly those three; every other CompositeBlockMoveRejectionReason /
  // NoCompositeMoveReason value has no such collision and is looked up via
  // the ordinary "reason." + reason pattern (see
  // view/OutlineTreeView.ts#compositeMoveReasonText).
  "reason.no-adjacent-compatible-unit":
    "Unified Outliner: nothing recognizable to swap with in that direction.",
  "reason.different-parent-or-depth":
    "Unified Outliner: the adjacent item is not at the same level — move skipped for safety.",
  "reason.no-target":
    "Unified Outliner: could not determine a safe move target.",
  "reason.compositeMoveNestedInList":
    "Unified Outliner: this extended block is nested inside another list item and cannot be moved in this version.",
  "reason.compositeMoveBoundaryChanged":
    "Unified Outliner: the note changed since this extended block was selected — the move was cancelled to avoid affecting the wrong content.",
  "reason.compositeMoveRangeInvalid":
    "Unified Outliner: could not confirm this extended block's boundary — the move was skipped for safety.",

  // ---- CompositeBlock Partial Edit reasons (Phase 5D-2A,
  // edit/compositeBlockPartialEdit.ts's NoCompositePartialEditReason).
  // "resolve-failed" reuses the existing generic reason.resolve-failed key
  // above (operation-neutral wording, safe to share). "range-invalid" and
  // "snapshot-mismatch" are DELIBERATELY separate from delete's/move's own
  // reason.range-invalid / reason.compositeMoveRangeInvalid / reason.
  // composite-boundary-changed / reason.compositeMoveBoundaryChanged keys
  // — those say "deletion"/"the move" explicitly, which would misdescribe
  // an edit rejection here (same reasoning moveCompositeBlock.ts's own top
  // doc comment gives for why its own keys don't reuse delete's). There is
  // no pre-existing generic "reason.conflict" key this ticket could reuse
  // for compositePartialEditConflict either, so a dedicated key is added.
  "reason.compositePartialEditRangeInvalid":
    "Unified Outliner: could not confirm this extended block's boundary — the edit was skipped for safety.",
  "reason.compositePartialEditSnapshotMismatch":
    "Unified Outliner: the note changed since this extended block was selected — the edit was cancelled to avoid affecting the wrong content.",
  "reason.compositePartialEditConflict":
    "Unified Outliner: this extended block changed since the edit was loaded — apply was cancelled to avoid discarding that change.",

  // ---- Parent List Item Structured Partial Edit reasons (Phase 5L-6,
  // edit/parentListItemProjection.ts's ApplyParentListItemOwnTextReason).
  // "resolve-failed" and "unsafe-indent" deliberately reuse the existing
  // generic reason.resolve-failed / reason.unsafe-indent keys above
  // (operation-neutral wording, safe to share — same reasoning as
  // compositePartialEditRangeInvalid's own sibling "resolve-failed" reuse
  // noted above). There is no pre-existing generic "reason.conflict" key
  // this ticket could reuse for the own-text conflict case either (same gap
  // compositePartialEditConflict's own comment above already notes), so a
  // dedicated key is added, scoped explicitly to the parent item's OWN TEXT
  // only — an external change to the child subtree alone can never produce
  // this reason (see applyParentListItemOwnTextEdit's own doc comment).
  "reason.parent-own-text-range-unresolvable":
    "Unified Outliner: this parent item's own text could no longer be safely separated from its child items — apply was cancelled for safety.",
  "reason.parent-own-text-conflict":
    "Unified Outliner: this item's own text changed since the edit was loaded — apply was cancelled to avoid discarding that change.",

  // ---- CompositeBlock cursor/selection-driven move reasons
  // (move/resolveCompositeSelectionTarget.ts's CompositeSelectionRejectionReason,
  // Phase 5C-1 ticket 4-5). "multiple-selections" deliberately reuses the
  // existing notice.multipleCursors key above (see
  // edit/moveCompositeBlock.ts#compositeMoveReasonText's own doc comment) —
  // not duplicated here.
  "reason.compositeMoveNoTargetAtCursor":
    "Unified Outliner: no extended block was found at the cursor position.",
  "reason.compositeMoveSelectionOutOfBounds":
    "Unified Outliner: the current selection extends beyond this extended block — the move was cancelled.",

  // ---- Standalone (non-composite-member) callout/blockquote move reasons
  // (Phase 5C-3, edit/moveStandaloneComplexBlock.ts's
  // NoStandaloneComplexBlockMoveReason). Deliberately NEW, dedicated keys —
  // never a reuse of any reason.compositeMove* key above, since those are
  // worded around "extended block" (CompositeBlock-specific terminology)
  // and would misdescribe a callout/blockquote that was never part of any
  // CompositeBlock. See standaloneComplexBlockMoveReasonText's own doc
  // comment for the full mapping.
  "reason.standaloneMoveNotSupported":
    "Unified Outliner: this block cannot be moved (unsupported, ambiguous, or read-only content).",
  "reason.standaloneMoveCompositeMember":
    "Unified Outliner: this block is part of an extended block and cannot be moved on its own.",
  "reason.standaloneMoveNestedInList":
    "Unified Outliner: this block is nested inside a list item and cannot be moved in this version.",
  "reason.standaloneMoveNoAdjacentUnit":
    "Unified Outliner: nothing recognizable to swap with in that direction.",
  "reason.standaloneMoveDifferentSection":
    "Unified Outliner: the adjacent block is in a different section — move skipped for safety.",
  "reason.standaloneMoveBoundaryChanged":
    "Unified Outliner: the note changed since this block was selected — the move was cancelled to avoid affecting the wrong content.",
  "reason.standaloneMoveRangeInvalid":
    "Unified Outliner: could not confirm this block's boundary — the move was skipped for safety.",
  "reason.standaloneMoveNoTarget":
    "Unified Outliner: could not determine a safe move target.",

  // ---- Fenced code block delete (Phase 5E-1, deleteStandaloneComplexBlock.ts) ---
  "reason.standaloneFencedCodeDeleteNotSupported":
    "Unified Outliner: this block cannot be deleted (unsupported, ambiguous, or read-only content).",
  "reason.standaloneFencedCodeDeleteCompositeMember":
    "Unified Outliner: this block is part of an extended block and cannot be deleted on its own.",
  "reason.standaloneFencedCodeDeleteBoundaryChanged":
    "Unified Outliner: the note changed since this block was selected — the delete was cancelled to avoid affecting the wrong content.",
  "reason.standaloneFencedCodeDeleteRangeInvalid":
    "Unified Outliner: could not confirm this block's boundary — the delete was skipped for safety.",

  // ---- Fenced code block raw Partial Edit Apply validation (Phase 5E-1,
  // partialEdit.ts). Keys are the literal hyphenated reason strings per the
  // generic "reason." + outcome.reason pattern used by PartialEditView.ts. ---
  "reason.fenced-code-invalid-open":
    "Unified Outliner: the first line must be a valid opening code fence (three or more backticks or tildes).",
  "reason.fenced-code-invalid-close":
    "Unified Outliner: the last line must be a valid closing code fence (same fence character, at least as many marks, and nothing else on the line).",

  // ---- Partial Edit Pane source-note safety valve (Phase 5C-4,
  // view/partialEditSourceNoteCheck.ts). An ADDITIONAL, path-based check —
  // never a replacement for edit/partialEdit.ts's own content-based
  // conflict detection (applySubtreeEdit's current.text !== originalText
  // compare, which stays completely unchanged). Both reasons fail safe:
  // Apply is refused and the note is left untouched either way.
  "reason.partialEditSourceNoteChanged":
    "Unified Outliner: the active note is different from the one this edit was loaded from — apply was cancelled to avoid changing the wrong note.",
  "reason.partialEditSourceNoteUnknown":
    "Unified Outliner: could not confirm which note this edit belongs to — apply was cancelled for safety.",

  // ---- Phase 5P-2: paragraph Partial Edit hoist reasons ------------------
  // resolver/resolveParagraphAtCursor.ts's NoParagraphResolutionReason
  // ("out-of-range" is shared with other cursor-resolution reason types in
  // this codebase — e.g. resolver/resolveCurrentBlock.ts,
  // move/resolveMoveTarget.ts — and gets one shared, generic key here) and
  // edit/paragraphPartialEdit.ts's NoParagraphApplyReason
  // ("resolve-failed" is reused as-is from the existing key above —
  // already generic/operation-neutral wording that fits this case too).
  "reason.out-of-range": "Unified Outliner: cursor position is out of range.",
  "reason.no-paragraph":
    "Unified Outliner: no paragraph at the cursor. Place the cursor inside a plain paragraph — not a heading, list marker, blank line, callout, blockquote, code block, table, or thematic break.",
  "reason.boundary-ambiguous":
    "Unified Outliner: this paragraph's boundary could not be confidently determined, so it can't be opened for editing.",
  "reason.identity-changed":
    "Unified Outliner: this paragraph's position in the note changed, so the edit was not applied safely. Reopen it and try again.",
  "reason.content-changed":
    "Unified Outliner: the note changed, so the safe update to this paragraph was cancelled. Check the content and reopen it.",
  // Phase 5P-4 supplement (edit/paragraphPartialEdit.ts's persistent-anchor
  // fix): this paragraph could not be safely and uniquely re-identified —
  // it may have been deleted, or a nearby structural change (split/merge/
  // reparent) or an ambiguous duplicate made re-identification unsafe. A
  // paragraph merely repositioned by "Move block up/down" is NOT this case
  // — see that reason's own doc comment for the full boundary.
  "reason.anchor-unresolved":
    "Unified Outliner: this paragraph could not be safely re-identified, so the update was cancelled. Reopen it and try again.",
  // Phase 5T-4A ("Tree paragraph → 既存 Partial Edit の最小実装"):
  // edit/paragraphPartialEdit.ts's NoParagraphApplyReason "blank-line-not-allowed"
  // — a dedicated, new key (not reused from any reason above) since this
  // rejection is about the INPUT itself, not about the target paragraph
  // having changed or failed to resolve. Applies to every caller of
  // applyParagraphEdit (body-editor "Edit paragraph at cursor" and the new
  // Tree-triggered "Edit paragraph…" alike) — never section/list/composite
  // Partial Edit, which never calls applyParagraphEdit at all.
  "reason.blank-line-not-allowed":
    "Unified Outliner: a paragraph's text can't contain a blank line — that would split it into multiple paragraphs. Remove the blank line and try again.",

  // Phase 5T-1: paragraph Tree context-menu move (edit/paragraphTreeMove.ts)
  // rejection reasons. Deliberately NEW, dedicated keys rather than reusing
  // reason.identity-changed/reason.content-changed above — those two are
  // worded for the Partial Edit Pane's "apply" flow specifically ("...the
  // edit was not applied safely. Reopen it and try again." / "...Check the
  // content and reopen it.") and would be misleading for a move command,
  // which has no "reopen" step at all. "no-sibling"/"boundary-unknown" are
  // NOT duplicated here — this feature reuses those two existing keys
  // as-is (see edit/paragraphTreeMove.ts), since their wording is already
  // move-specific and operation-neutral.
  "reason.paragraphTreeMoveResolveFailed":
    "Unified Outliner: this paragraph could not be safely re-resolved (the note may have changed).",
  "reason.paragraphTreeMoveIdentityChanged":
    "Unified Outliner: this paragraph's position in the note changed, so the move was cancelled.",
  "reason.paragraphTreeMoveContentChanged":
    "Unified Outliner: the note changed, so the move was cancelled.",
  "reason.paragraphTreeMoveAmbiguous":
    "Unified Outliner: this paragraph could not be uniquely identified, so the move was cancelled.",

  // Phase 5T-3A: edit/paragraphNonAdjacentMove.ts's own rejection reasons.
  // The four "reason.paragraphTreeMove*" keys above are reused verbatim for
  // this feature's SOURCE-side failures (see that module's own
  // paragraphNonAdjacentMoveReasonText) — only the TARGET-side and the
  // new structural-rejection reasons need dedicated keys here.
  "reason.paragraphNonAdjacentTargetResolveFailed":
    "Unified Outliner: the destination could not be safely re-resolved (the note may have changed).",
  "reason.paragraphNonAdjacentTargetIdentityChanged":
    "Unified Outliner: the destination's position in the note changed, so the move was cancelled.",
  "reason.paragraphNonAdjacentTargetContentChanged":
    "Unified Outliner: the note changed, so the move was cancelled.",
  "reason.paragraphNonAdjacentTargetAmbiguous":
    "Unified Outliner: the destination could not be uniquely identified, so the move was cancelled.",
  "reason.paragraphNonAdjacentSelfTarget":
    "Unified Outliner: can't move a paragraph next to itself.",
  "reason.paragraphNonAdjacentParentMismatch":
    "Unified Outliner: the destination is not in the same section/list item, so the move was cancelled.",
  "reason.paragraphNonAdjacentDepthMismatch":
    "Unified Outliner: the destination is not at the same nesting depth, so the move was cancelled.",
  "reason.paragraphNonAdjacentRangeOverlap":
    "Unified Outliner: the destination overlaps the paragraph being moved, so the move was cancelled.",

  // Phase 5T-9A ("paragraph delete の最小スコープ実装",
  // edit/deleteParagraph.ts): deliberately NEW, dedicated keys rather than
  // reusing "reason.paragraphTreeMove*" above — those are worded "...so the
  // move was cancelled", which would be misleading for a delete. See
  // edit/deleteParagraph.ts#paragraphDeleteReasonText's own doc comment.
  "reason.paragraphDeleteResolveFailed":
    "Unified Outliner: this paragraph could not be safely re-resolved (the note may have changed).",
  "reason.paragraphDeleteIdentityChanged":
    "Unified Outliner: this paragraph's position in the note changed, so the delete was cancelled.",
  "reason.paragraphDeleteContentChanged":
    "Unified Outliner: the note changed, so the delete was cancelled.",
  "reason.paragraphDeleteAmbiguous":
    "Unified Outliner: this paragraph could not be uniquely identified, so the delete was cancelled.",
  // Phase 5P-5: list-item-child paragraph delete is now supported, so this
  // reason no longer fires for "is inside a list item" — kept only as
  // defense-in-depth for a parentId that fails to resolve to any BlockNode
  // at all (see edit/deleteParagraph.ts#isInScopeParagraphParent's own doc
  // comment).
  "reason.paragraphDeleteListItemParent":
    "Unified Outliner: this paragraph's parent could not be resolved, so it can't be deleted from the Outline Tree.",
  "reason.paragraphDeleteCompositeMember":
    "Unified Outliner: this paragraph is part of an extended block; delete the extended block instead.",

  // Phase 5T-10A ("paragraph insert の最小スコープ実装",
  // edit/insertParagraph.ts): deliberately NEW, dedicated keys, mirroring
  // reason.paragraphDelete*'s own precedent of not reusing
  // reason.paragraphTreeMove*'s "...so the move was cancelled" wording.
  "reason.paragraphInsertResolveFailed":
    "Unified Outliner: this paragraph could not be safely re-resolved (the note may have changed).",
  "reason.paragraphInsertIdentityChanged":
    "Unified Outliner: this paragraph's position in the note changed, so the insert was cancelled.",
  "reason.paragraphInsertContentChanged":
    "Unified Outliner: the note changed, so the insert was cancelled.",
  "reason.paragraphInsertAmbiguous":
    "Unified Outliner: this paragraph could not be uniquely identified, so the insert was cancelled.",
  // Phase 5P-5: list-item-child paragraph insert is now supported, so this
  // reason no longer fires for "is inside a list item" — kept only as
  // defense-in-depth, mirroring reason.paragraphDeleteListItemParent above.
  "reason.paragraphInsertListItemParent":
    "Unified Outliner: this paragraph's parent could not be resolved, so a paragraph can't be inserted from the Outline Tree.",
  "reason.paragraphInsertCompositeMember":
    "Unified Outliner: this paragraph is part of an extended block; insert is not available there.",
  // Phase 5P-5: the target's parent is a list item whose own leading
  // whitespace mixes tabs and spaces — its content column can't be trusted,
  // so the insert is refused before any line is built.
  "reason.paragraphInsertUnsafeIndent":
    "Unified Outliner: this list item's indentation mixes tabs and spaces, so a paragraph can't be safely inserted there.",

  // Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
  // B"): tooltip for the "add a first child" control shown on a
  // STANDALONE leaf item (childIds.length === 0) once it is projected by
  // one of the four Phase 5L-1〜5L-5 standalone leaf projections — the
  // Mode B counterpart of partialEdit.parentChildAddButtonLabel above,
  // which only ever applies once a node is ALREADY a real parent.
  "partialEdit.leafFirstChildAddButtonLabel": "Add first child item",
  // Phase 5L-9b: tooltip for the SAME control while it is disabled
  // because a first-child draft is already pending — mirrors
  // partialEdit.parentChildAddButtonAlreadyPendingLabel's own identical
  // "prevent double-add" wording.
  "partialEdit.leafFirstChildAddButtonAlreadyPendingLabel":
    "A new first child item is already pending — apply or cancel it first",
  // Phase 5L-9b: shown when handleRequestAddLeafFirstChild itself
  // refuses to start a Mode B draft (the active note/editor can't be
  // resolved, or the leaf no longer resolves as an eligible standalone
  // leaf) — a safe refusal, no draft created. Also reused by
  // applyLeafFirstChildEdit's own defensive "no standalone leaf
  // projection is active" branch.
  "partialEdit.leafFirstChildAddFailed":
    "Unified Outliner: couldn't add a first child item here — this item may have changed.",
  // Phase 5L-9b: applyLeafFirstChildEdit's own success Notice — shown
  // after this leaf successfully gained its first direct child and was
  // reloaded as a real parent item.
  "partialEdit.leafFirstChildAdded": "Unified Outliner: added a first child item to this list item.",
} as const;

export type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  // ---- 設定タブ -----------------------------------------------------------
  // タブラベル（2026-08-12 設定UI整理）: 下記の既存設定・トグルを上部の2タブに
  // 純粋に表示上だけ分けるためのラベル。設定キー・デフォルト値・保存データ
  // 形式は一切変更しない — タブ切り替えの実装は settings.ts の
  // UnifiedOutlinerSettingTab を参照。
  "settings.tabs.general": "全般",
  "settings.tabs.compositeBlock": "拡張ブロック",
  "settings.language.name": "表示言語",
  "settings.language.desc":
    "Unified Outliner の設定・コマンド名・通知の表示言語。「自動」は Obsidian 本体の言語設定に従う。すでにコマンドパレットに表示されているコマンド名は、プラグイン（または Obsidian）を再読み込みするまで更新されない — この設定を変更した直後に表示される通知を参照。",
  "settings.language.optionAuto": "自動（Obsidianの言語設定に従う）",
  "settings.language.optionJa": "日本語",
  "settings.language.optionEn": "English（英語）",
  "settings.allowCrossSectionListMove.name": "セクションをまたぐリスト移動を許可",
  "settings.allowCrossSectionListMove.desc":
    "ルートのリスト項目に移動方向の兄弟が存在しない場合、隣接する見出しを越えて隣のセクションへ移動することを許可する。",
  "settings.normalizeOrderedLists.name": '順序付きリストのマーカーを「1.」に正規化',
  "settings.normalizeOrderedLists.desc":
    'リストブロックを移動した後、影響範囲内の順序付きマーカーを「1.」に書き換える（レンダラー側が自動採番する）。連番への正規化は今後対応予定。',
  "settings.showNoopNotices.name": "無操作時の通知を表示",
  "settings.showNoopNotices.desc": "移動コマンドが何もしなかった場合に、その理由を短い通知で表示する。",
  "settings.showListItemsInOutline.name": "アウトラインツリーにリスト項目を表示",
  "settings.showListItemsInOutline.desc":
    "右サイドバーのアウトラインツリーに、見出しに加えてリスト項目もノードとして表示する。既定ではオフ（本プラグインの以前のバージョンと同様、見出しのみ）。",
  "settings.showParagraphsInOutline.name": "本文段落も Outline Tree に表示する",
  "settings.showParagraphsInOutline.desc":
    "本文の通常の段落を、¶ マーク付きのナビゲーションノードとしてアウトラインツリーに表示する。トップレベルおよびセクション直下の段落は、ツリー上のコンテキストメニューやダブルクリックから編集・追加（挿入）・削除・移動も行える（リスト項目内の段落は表示のみで、これらの操作の対象外）。既定ではオフ。",
  "settings.showFencedCodeInOutline.name": "アウトラインツリーにコードブロックを表示",
  "settings.showFencedCodeInOutline.desc":
    "fenced code block（Mermaid・Dataview・DataviewJS を含む）を、アウトラインツリーに読み取り専用のナビゲーションノードとして表示する。行をクリックすると開始フェンス行へ移動する。これらの行からの名称変更・編集・移動・削除は一切できない。既定ではオフ。",
  "settings.showTablesInOutline.name": "アウトラインツリーに表を表示",
  "settings.showTablesInOutline.desc":
    "Markdown の表を、アウトラインツリーに読み取り専用のナビゲーションノードとして表示する。行をクリックするとヘッダー行へ移動する。これらの行からの名称変更・編集・移動・削除は一切できない。既定ではオフ。",
  "settings.followKeyboardSelectionIntoBody.name": "キーボード選択を本文エディタに追従させる",
  "settings.followKeyboardSelectionIntoBody.desc":
    "アウトラインツリーを矢印キーで移動する際、行をクリックした場合と同様に本文エディタのカーソルとスクロール位置も移動する。オフにすると矢印キーによる移動はツリーパネル内に留まる（Enter キーは引き続き本文へジャンプする）。",
  "settings.syncOutlineTreeFoldingToEditor.name": "アウトラインツリーの折りたたみをエディタに同期",
  "settings.syncOutlineTreeFoldingToEditor.desc":
    "有効にすると、アウトラインツリーでノードを折りたたむ・展開する操作が、アクティブな Markdown エディタ内の対応する内容にも反映される。",
  // UXP-05（2026-08-24）: 旧「移動・アウトラインツリーの種別強調」見出しを
  // 廃止し、4つのカテゴリ区切り見出しに分割。どの設定がどの見出しの下に
  // 入るかは settings.ts の renderGeneralTab のdocコメントを参照。
  "settings.outlineTreeContentsHeading": "アウトラインツリーの表示内容",
  "settings.outlineTreeAppearanceHeading": "アウトラインツリーの見た目",
  "settings.moveOperationsHeading": "移動操作",
  "settings.editingInteractionHeading": "編集・操作",
  "settings.sectionBackgroundStyle.name": "アウトラインツリーのセクション背景スタイル",
  "settings.sectionBackgroundStyle.desc":
    "セクション行とリスト行を一目で見分けやすくする常時表示の視覚補助。純粋に見た目のみで、Move block / Move section の実際の動作対象は変わらない。",
  "settings.sectionBackgroundStyle.optionSubtle": "淡い背景",
  "settings.sectionBackgroundStyle.optionStripe": "左端のストライプ",
  "settings.sectionBackgroundStyle.optionOff": "オフ",
  "settings.listHighlightStyle.name": "アウトラインツリーのリスト行強調スタイル",
  "settings.listHighlightStyle.desc":
    "上記のセクションスタイルより意図的に弱く（既定ではホバー時のみ）設定されており、リスト項目を表示してもツリーが視覚的にうるさくならないようにしている。",
  "settings.listHighlightStyle.optionHover": "ホバー・選択時のみ強調",
  "settings.listHighlightStyle.optionSubtle": "常時、淡い背景で表示",
  "settings.listHighlightStyle.optionOff": "オフ",
  "settings.headingPrefixStyle.name": "アウトラインツリーの見出しprefix",
  "settings.headingPrefixStyle.desc":
    "アウトラインツリー上で、セクションの見出しテキストの前に見出しレベルを示すバッジを表示する。純粋に見た目のみで、見出しテキスト自体は変わらない。",
  "settings.headingPrefixStyle.optionNone": "表示しない",
  "settings.headingPrefixStyle.optionHLevel": "H1〜H6",
  "settings.headingPrefixStyle.optionAtx": "#〜######",
  "settings.outlineTreeSidebarPosition.name": "アウトラインツリーの既定のサイドバー位置",
  "settings.outlineTreeSidebarPosition.desc":
    "新規にアウトラインツリービューを開く際、どちらのサイドバーに開くかを指定する。すでにどこかにアウトラインツリービューが開いている場合（ユーザーが手動で移動した場合を含む）は、この設定に関わらず既存のものをそのまま再利用し、この設定を変更しただけでは移動しない。",
  "settings.outlineTreeSidebarPosition.optionRight": "右サイドバー",
  "settings.outlineTreeSidebarPosition.optionLeft": "左サイドバー",
  "settings.listPrefixStyle.name": "アウトラインツリーのリストmarker",
  // 2026-09-09（設定画面 文体統一）: 「です・ます調」を、画面内の他の説明
  // 文と揃える形で「である調」（表示する。）へ統一した。文面の意味・内容
  // は変更していない。
  "settings.listPrefixStyle.desc":
    "リスト項目の先頭に、Markdownで使われている marker（-、*、+、1. など）を表示する。",
  "settings.listPrefixStyle.optionNone": "表示しない",
  "settings.listPrefixStyle.optionMarker": "Markdown marker",
  "settings.previewMoveTarget.name": "アウトラインツリーで移動先をプレビュー",
  "settings.previewMoveTarget.desc":
    "Move block / Move section が実際に操作したブロックを、アウトラインツリー上で一瞬フラッシュ表示して強調する。",
  // 2026-09-09（Settings タブ i18n リソース改善）: 一般ユーザーには分かり
  // にくい専門用語「トースト」「Move block / Move section」（コマンド名で
  // あり自明ではない）を、平易で結果重視の文言へ変更した。キー名・型・保
  // 存値のセマンティクスは変更していない（引き続き "showMoveResultToast"
  // という同一キーのブール値設定である）。
  "settings.showMoveResultToast.name": "移動結果の通知を表示",
  // 2026-09-09（設定画面 文体統一）: 発注元から指定された当初の文面は
  // 「です・ます調」であったが、画面内の他の説明文（である調）との統一を
  // 図るため、続報の指示によりである調（表示する。）へ変更した。
  "settings.showMoveResultToast.desc":
    "ブロックやセクションを移動した際、何が移動したか（段落・リスト項目・見出し）を画面に短い通知（ポップアップ）で表示する。",

  // ---- Phase 5D-0 / 5D-0.3: CompositeBlock 規則 --------------------------
  "settings.compositeBlocksHeading": "拡張ブロック",
  // Phase 5D-1L: 「（例: 画像 + その OCR 転記）」という代表例表現を除去し、
  // 構造条件（空行なしで隣接する1行完結の list item と callout/blockquote）
  // のみを説明する文言へ変更。ユーザー承認済みの指定文言をそのまま採用。
  // 2026-09-09（設定画面 文体統一）: 「です・ます調」を、画面内の他の説明
  // 文と揃える形で「である調」へ統一した。文面の意味・内容は変更していな
  // い。
  "settings.compositeBlocksIntro":
    "空行を挟まず隣接する1行で完結する list item と callout または blockquote を、Outline Tree上で1つの折りたたみ可能な単位としてまとめる規則である。この設定を無効にしてもMarkdown本文は変更されない。対象となるlist item、callout、blockquoteは、それぞれ通常の表示規則に従って個別に表示される。",
  // Phase 5D-1L: 「画像+OCR」/「画像+引用」から汎用化。日本語訳ではなく
  // en辞書と同一の英語文字列 "List + Callout" / "List + Quote" を採用
  // （ユーザー承認済み）。
  "settings.compositeBlockImageOcr.name": "List + Callout",
  // 2026-09-09（Settings タブ i18n リソース改善）: 具体的な利用シーン
  // （ユースケース）の例示を説明文に追加した。これは Phase 5D-1L が
  // 「画像 + その OCR 転記」という例示を意図的に除去した判断（上記
  // settings.compositeBlocksIntro のコメント参照）を、発注元の新たな明示
  // 指示により部分的に反転させたものである。Phase 5D-1L の懸念は当該例示
  // が規則適用の必須条件であるかのように読めてしまう点にあったため、本
  // 文言は「例:」という表現で明確に例示に留め、必須条件と誤読されないよ
  // う配慮している。マッチング自体は引き続き純粋に構造的であり変更して
  // いない（model/compositeBlock.ts の DEFAULT_COMPOSITE_BLOCK_RULES 参
  // 照）。
  // 2026-09-09（設定画面 文体統一・追記）: 発注元から指定された当初の文面
  // は「です・ます調」であったが、画面内の他の説明文（である調）との統一
  // を図るため、続報の指示によりである調（表示する。）へ変更した。
  "settings.compositeBlockImageOcr.desc":
    "1行で完結するリスト項目の直後に空行を挟まずコールアウトが続く場合にまとめて表示する。（例: リスト行に画像やPDFを埋め込み、コールアウトにOCRテキストや解説を記入する場合など）",
  "settings.compositeBlockImageQuote.name": "List + Quote",
  // 2026-09-09: 上記 compositeBlockImageOcr.desc と同様の理由による変更。
  "settings.compositeBlockImageQuote.desc":
    "1行で完結するリスト項目の直後に空行を挟まず引用（blockquote）が続く場合にまとめて表示する。（例: リスト行に出典・書誌情報を記入し、引用ブロックに引用本文を記入する場合など）",
  "compositeBlock.imageOcr.displayName": "List + Callout",
  "compositeBlock.imageQuote.displayName": "List + Quote",

  // ---- コマンド（コマンドパレットの表示名） ------------------------------
  "command.moveBlockUp": "ブロックを上へ移動（カーソル位置の最小安全単位）",
  "command.moveBlockDown": "ブロックを下へ移動（カーソル位置の最小安全単位）",
  "command.moveSectionUp": "セクションを上へ移動（囲むセクション全体）",
  "command.moveSectionDown": "セクションを下へ移動（囲むセクション全体）",
  "command.moveNodeOnlyUp": "見出しラベルを上へ移動（現在行のみ）",
  "command.moveNodeOnlyDown": "見出しラベルを下へ移動（現在行のみ）",
  "command.moveCompositeBlockUp": "拡張ブロックを上へ移動（カーソル位置）",
  "command.moveCompositeBlockDown": "拡張ブロックを下へ移動（カーソル位置）",
  "command.indentBlock": "ブロックをインデント（リストサブツリー／安全範囲の見出し）",
  "command.outdentBlock": "ブロックをアウトデント（リストサブツリー／安全範囲の見出し）",
  "command.indentNodeOnly": "見出しレベルをインデント（現在行のみ）",
  "command.outdentNodeOnly": "見出しレベルをアウトデント（現在行のみ）",
  "command.deleteBlock": "ブロックを削除（セクション／リストサブツリー）",
  "command.insertSiblingBlock": "現在のブロックの後に兄弟を挿入",
  "command.insertChildListItem": "子リスト項目を挿入",
  "command.openOutlineTreeView": "アウトラインツリービューを開く",
  "command.openPartialEditPane": "現在のセクションの部分編集ペインを開く",
  "command.editParagraphAtCursor": "カーソル位置の段落を編集",
  "command.ribbonTooltip": "Unified Outliner のアウトラインを開く",

  // ---- 通知（main.ts、reason に基づかないもの） -------------------------
  "notice.couldNotOpenOutlineTreeView": "Unified Outliner: アウトラインツリービューを開けなかった。",
  "notice.couldNotOpenRightSidebar": "Unified Outliner: 右サイドバーを開けなかった。",
  "notice.couldNotOpenLeftSidebar": "Unified Outliner: 左サイドバーを開けなかった。",
  "notice.couldNotOpenPartialEditPaneNewWindow":
    "Unified Outliner: 部分編集ペインを新しいウィンドウで開けなかった。",
  "notice.couldNotOpenPartialEditPane": "Unified Outliner: 部分編集ペインを開けなかった。",
  "notice.multipleCursors": "Unified Outliner: 複数カーソルには対応していない。",
  "notice.moved": "Unified Outliner: {unit}を{direction}に移動した。",
  "notice.directionUp": "上",
  "notice.directionDown": "下",
  "notice.languageChanged":
    "Unified Outliner: 表示言語を更新した — Command Paletteで新しいコマンド名を確認してほしい。",

  // ---- 移動結果トーストの対象種別の説明（move/resolveMoveTarget.ts） -----
  "unit.sectionNamed": '「{heading}」セクション',
  "unit.untitledHeading": "（無題の見出し）",
  "unit.listItem": "リスト項目",
  "unit.listItemWithNestedOne": "リスト項目（子項目{count}件を含む）",
  "unit.listItemWithNestedMany": "リスト項目（子項目{count}件を含む）",
  "unit.callout": "コールアウト",
  "unit.blockquote": "引用",
  "unit.codeBlock": "コードブロック",
  "unit.table": "テーブル",
  "unit.paragraph": "段落",
  "unit.thematicBreak": "区切り線",
  "tree.emptyComplexMember": "（空）",
  "tree.complexMember.calloutFallback": "コールアウト",
  "tree.complexMember.blockquoteFallback": "引用",
  "tree.complexMember.fencedCodeFallback": "コードブロック",
  "tree.complexMember.tableFallback": "テーブル",
  "tree.paragraphFallback": "段落 {n}",

  // ---- アウトラインツリービュー -------------------------------------------
  "tree.viewName": "Unified Outliner: アウトライン",
  "tree.untitledHeading": "（無題の見出し）",
  "tree.emptyListItem": "（空のリスト項目）",
  "tree.emptyNoHeadingsOrList": "このノートには見出しもリスト項目もない。",
  "tree.emptyNoHeadings": "このノートには見出しがない。",
  "tree.emptyNoActiveNote": "アクティブなMarkdownノートがありません。",
  "tree.menu.contextual": "{title}（コンテクスト: {mode}）",
  "tree.menu.modeSubtree": "サブツリー",
  "tree.menu.modeNodeOnly": "ノードのみ",
  "tree.menu.moveUp": "上へ移動",
  "tree.menu.moveDown": "下へ移動",
  "tree.menu.indent": "インデント",
  "tree.menu.outdent": "アウトデント",
  "tree.menu.moveSubtreeUp": "サブツリーを上へ移動",
  "tree.menu.moveSubtreeDown": "サブツリーを下へ移動",
  "tree.menu.indentSubtree": "サブツリーをインデント",
  "tree.menu.outdentSubtree": "サブツリーをアウトデント",
  "tree.menu.openPartialEditPane": "部分編集ペインを開く",
  "tree.menu.openPartialEditPaneNewWindow": "部分編集ペインを新しいウィンドウで開く",
  "tree.menu.insertSectionAfter": "後にセクションを挿入",
  "tree.menu.deleteSectionSubtree": "セクションサブツリーを削除",
  "tree.menu.rename": "名前を変更",
  "tree.menu.editListSubtreeInPane": "リストサブツリーをペインで編集",
  "tree.menu.editListSubtreeInNewWindow": "リストサブツリーを新しいウィンドウで編集",
  "tree.menu.insertListItemAfter": "後にリスト項目を挿入",
  "tree.menu.insertChildListItem": "子リスト項目を挿入",
  "tree.menu.deleteListSubtree": "リストサブツリーを削除",
  "tree.menu.unavailableSuffix": "（利用不可）",
  "tree.menu.deleteCompositeBlock": "拡張ブロックを削除",
  "tree.menu.deleteFencedCodeBlock": "削除",
  "tree.menu.compositeMoveUp": "拡張ブロックを上へ移動",
  "tree.menu.compositeMoveDown": "拡張ブロックを下へ移動",
  // Phase 5D-2A
  "tree.menu.openCompositeInPartialEdit": "拡張ブロックを部分編集ペインで開く",
  "tree.menu.standaloneMoveUp": "上へ移動",
  "tree.menu.standaloneMoveDown": "下へ移動",
  "tree.menu.paragraphMoveUp": "上へ移動",
  "tree.menu.paragraphMoveDown": "下へ移動",

  "tree.menu.paragraphMoveToTop": "先頭へ移動",
  "tree.menu.paragraphMoveToBottom": "末尾へ移動",
  "tree.menu.paragraphMoveBeforeSibling": "指定した段落の前へ移動…",
  "tree.menu.paragraphMoveAfterSibling": "指定した段落の後へ移動…",
  "tree.menu.paragraphEdit": "段落を編集…",

  // Phase 5T-10A（paragraph insert の最小スコープ実装）: top-level または
  // section 直下の paragraph 行専用の insert-before/insert-after 項目。
  "tree.menu.insertParagraphBefore": "段落を前に挿入",
  "tree.menu.insertParagraphAfter": "段落を後に挿入",

  // Phase 5T-9A（paragraph delete の最小スコープ実装）: top-level または
  // section 直下の paragraph 行専用の delete 項目。
  "tree.menu.deleteParagraph": "段落を削除",

  // ---- 部分編集ペイン -------------------------------------------------------
  "partialEdit.viewName": "Unified Outliner: 部分編集",
  "partialEdit.noActiveNote": "Unified Outliner: ノードを読み込むアクティブなノートがない。",
  "partialEdit.couldNotLoadNode": "Unified Outliner: そのノードを読み込めなかった。",
  "partialEdit.editingTitle": "編集中（{kind}）: {label}",
  "partialEdit.kindList": "リスト",
  "partialEdit.kindSection": "セクション",
  "partialEdit.kindCallout": "コールアウト",
  "partialEdit.kindBlockquote": "引用",
  "partialEdit.kindParagraph": "段落",
  // Phase 5D-2A
  "partialEdit.kindComposite": "拡張ブロック",
  "partialEdit.close": "閉じる",
  "partialEdit.emptyPlaceholder":
    "アウトラインツリービューでノードを右クリックし、「部分編集ペインを開く」／「リストサブツリーをペインで編集」を選ぶとここに読み込まれる。",
  "partialEdit.subtreeLabel": "サブツリー:",
  "partialEdit.moreChip": "他{count}件",
  "partialEdit.moreCount": "他{count}件",
  "partialEdit.noNodeLoaded": "Unified Outliner: このペインにはノードが読み込まれていない。",
  "partialEdit.noActiveNoteToApply": "Unified Outliner: 適用先となるアクティブなノートがない。",
  "partialEdit.couldNotApplyEdit": "Unified Outliner: この編集を適用できなかった。",
  "partialEdit.listSubtreeUpdated": "Unified Outliner: リストサブツリーを更新した。",
  "partialEdit.sectionUpdated": "Unified Outliner: セクションを更新した。",
  "partialEdit.paragraphUpdated": "Unified Outliner: 段落を更新した。",
  // Phase 5D-2A: 拡張ブロック全体編集Paneの Apply成功通知（元の rule に
  // 一致し続けている場合）。一致しなくなった場合は下記
  // partialEdit.compositeRuleNoLongerMatches を代わりに表示する。
  "partialEdit.compositeUpdated": "Unified Outliner: 拡張ブロックを更新した。",
  // Phase 5D-2A（方針A）: Apply自体は成功したが、書き戻した内容が元の
  // CompositeBlock規則に一致しなくなった場合にのみ、上記の代わりに表示する。
  // 文言はチケット承認時の指定どおり変更しない。
  "partialEdit.compositeRuleNoLongerMatches":
    "Unified Outliner: この編集後の内容は CompositeBlock の規則に一致しません。各 block は個別に表示されます。",
  // Phase 5D-0.5: ユーザー指定の文言をそのまま使用する。
  "partialEdit.quoteNestedUnsupported":
    "Unified Outliner: ネストした引用は現在の引用本文編集に未対応である。",
  // Phase 5D-1.5: 引用ブロックの本文を全削除した場合の拒否。コールアウト
  // の場合は同じ操作でも header-only calloutとして成功する（Noticeなし）
  // ため、この文言は blockquote 専用である。
  "partialEdit.quoteBodyEmptyUnsupported":
    "Unified Outliner: 引用ブロックを空にはできない。ブロック全体の削除は本文エディタで行ってほしい。",
  // Phase 5D-1.5: 可変長本文編集の再直列化結果を現在のparser/scannerで
  // 再検証した際に、有効なcallout/blockquote構造として認識できなかった
  // 場合の拒否。
  "partialEdit.quoteEditStructureInvalid":
    "Unified Outliner: この編集はコールアウト／引用ブロックの構造を崩すため適用できない。",
  // Phase 5D-2C: marker-free な list member 本文の編集に改行が含まれる
  //場合の拒否。single-line-list は定義上1行のみのため、改行を含む編集は
  // 安全に1行の raw Markdown へ復元できない。CompositeBlock の grouping
  // rule に再マッチしなくなるだけの場合（compositeRuleNoLongerMatches、
  // 既存の方針A・保存自体は成功する）とは別物であり、こちらは Apply 自体
  // を拒否する「真の安全性エラー」である。
  "partialEdit.listBodyNewlineUnsupported":
    "Unified Outliner: リスト項目の本文に改行を含めることはできない。",
  // Phase 5L-2（task list marker-free Partial Edit）: 直上の
  // listBodyNewlineUnsupported の task list 版。standalone task list 項目の
  // marker-free / checkbox-free 本文編集に改行が含まれる場合の拒否。
  "partialEdit.taskBodyNewlineUnsupported":
    "Unified Outliner: タスクリスト項目の本文に改行を含めることはできない。",
  // Phase 5L-2: standalone task list 項目自身の checkbox control（
  // view/PartialEditView.ts の taskCheckboxInputEl）のツールチップ。
  "partialEdit.taskCheckboxLabel": "完了",
  // Phase 5L-3（ordered list marker-free Partial Edit）: 直上の
  // listBodyNewlineUnsupported / taskBodyNewlineUnsupported の
  // ordered list 版。standalone ordered list 項目の marker-free 本文
  // 編集に改行が含まれる場合の拒否。
  "partialEdit.orderedBodyNewlineUnsupported":
    "Unified Outliner: 番号付きリスト項目の本文に改行を含めることはできない。",
  // Phase 5L-3: applyEdit 自身の invertOrderedListProjection による拒否。
  // number input の現在のテキストが
  // edit/orderedListProjection.ts の isValidOrderedListNumberText を
  // 満たさない場合（空、ゼロ、負数、小数、指数表記、非ASCII数字、
  // 前後の空白を含む、など）に表示する。Apply全体（number と本文の編集を
  // 合わせて）を拒否し、変更はゼロバイトであり、各 draft はユーザーが
  // 入力したままの状態で保持される。
  "partialEdit.orderedNumberInvalid":
    "Unified Outliner: この番号付きリスト項目の番号は正の整数でなければならない。",
  // Phase 5L-3: standalone ordered list 項目自身の番号 control（
  // view/PartialEditView.ts の orderedNumberInputEl）のツールチップ・
  // ラベル。`.`/`)` の区切り文字自体はこのフェーズでは編集不可のまま
  // 保持される（edit/orderedListProjection.ts 自身の冒頭のdocコメント
  // を参照）。
  "partialEdit.orderedNumberLabel": "リスト項目の番号",
  // Phase 5L-4（Multi-Line Leaf List Item Partial Edit Projection）:
  // applyEdit 自身の invertMultiLineListItemProjection による
  // "unsafe-structure" 拒否。再構成した複数行のcandidateを再解析した結果、
  // 子リストやcallout/blockquote/fenced-code/table/thematic-breakなどの
  // 別ブロックが生成されてしまう場合に表示する（詳細は
  // edit/multiLineListItemProjection.ts の
  // validateMultiLineListItemCandidate 自身のdocコメントを参照）。
  // Apply全体を拒否し、変更はゼロバイトであり、各draft（checkbox/number
  // controlおよび複数行本文全体）はユーザーが入力したままの状態で保持
  // される。
  "partialEdit.multiLineListStructureInvalid":
    "Unified Outliner: この編集はリスト項目自体のMarkdown構造を変えてしまうため適用できない。",
  // Phase 5L-6（Parent List Item Structured Partial Edit）: applyEdit 自身の
  // invertParentListItemProjection による "own-text-unsafe-structure" 拒否。
  // own-text単独で再構成したcandidate（marker/checkbox/number/本文/継続行）
  // を単独で再解析した結果、子リスト項目やcallout/blockquote/fenced-code/
  // table/thematic-breakが生成されてしまう場合に表示する。直上の
  // multiLineListStructureInvalidの親項目版であり、own-textの範囲のみを
  // 対象とする（child subtree自体はこの拒否では一切変更されない）。
  // Apply全体を拒否し、変更はゼロバイトであり、各draftはユーザーが入力した
  // ままの状態で保持される。
  "partialEdit.parentOwnTextStructureInvalid":
    "Unified Outliner: この編集は親項目自体のMarkdown構造を変えてしまうため適用できない。",
  // Phase 5L-6: 2段階目の安全性検証による拒否。編集後のown-text
  // candidateを、元のchild subtreeスナップショットと結合して全体を
  // 再解析した結果、単一の親list itemが同じchild subtreeを安全に保持する
  // 状態に戻らない場合に表示する（edit/parentListItemProjection.ts の
  // invertParentListItemProjection 自身の "child-subtree-detached"／
  // "child-subtree-changed" を参照）。直上のparentOwnTextStructureInvalid
  // とは意図的に別キーである — こちらはown-text単独ではなくchild subtree
  // との結合時の検証失敗を表す。Apply全体を拒否し、変更はゼロバイトである。
  "partialEdit.parentChildSubtreeStructureInvalid":
    "Unified Outliner: この編集は適用できない。親項目と子項目の構造上の関係が崩れてしまう。",
  // Phase 5L-6: 親list itemの編集可能なown-textフィールド群の下に表示される
  // child subtreeプレビュー（view/PartialEditView.ts の
  // renderParentChildPreview）のラベル。プレビューの各行自体は直接編集不可
  // だが、Phase 5L-8以降は行ごとにeligibility判定があり、対象の直接の子には
  // インライン編集アフォーダンス（鉛筆アイコン、partialEdit.
  // parentChildInlineEditStartLabel）が表示される。よって、このラベルは
  // セクション全体を一律「読み取り専用」と断定する文言を含めない——
  // 編集可否は行ごとの鉛筆アイコンの有無で伝える（Phase 5L-6時点の
  // 「(読み取り専用)」という文言はPhase 5L-8で除去した）。
  "partialEdit.parentChildPreviewLabel": "子項目",
  // Phase 5L-6: child subtreeプレビューが
  // PartialEditView.PARENT_CHILD_PREVIEW_MAX_LINES 行を超えた場合に表示する
  // 省略表示。上記の既存moreChip／moreCountの{count}補間パターンに倣う。
  "partialEdit.parentChildPreviewTruncated": "他{count}行は表示されていない",
  // Phase 5L-7（「子サブツリー読み取り専用プレビューのナビゲーション化」）:
  // 解決可能なnavigation targetを持つchild previewの行（view/PartialEditView.ts
  // のrenderParentChildPreview）に付与するtooltip/aria-label。この操作（行
  // クリック／Enter・Space）自体は常に「別パネルとしてこの子項目を開く」
  // ナビゲーションであり、行内で直接編集が始まるわけではない、という意味は
  // 変わらない。ただしPhase 5L-8で対象の直接の子には同じ行に鉛筆アイコン
  // （インライン編集アフォーダンス）が並んで表示されるようになったため、
  // 「(読み取り専用プレビュー)」という文言を残すと、隣の鉛筆アイコンと
  // 矛盾して見える。そのためPhase 5L-8でこの文言は除去した——行自体は
  // 相変わらずクリックしても直接編集は始まらないという事実は、行内の鉛筆
  // アイコンの有無（あるいは無し）で伝える。
  "partialEdit.parentChildPreviewRowOpenLabel": "この子項目を開く",
  // Phase 5L-7: resolveParentChildPreviewNavigationTargetがchild preview行の
  // 操作を拒否した場合（親項目自体がもう対象外になった、targetがもう見つから
  // ない、targetが別の場所へ再割当てされた、あるいはこのプレビューの最終
  // 構築／再読み込み以降にtargetの内容が変わった——同関数自身のreason型の
  // doc commentを参照）に表示する。パネルは現在のnodeと現在のdraftを完全に
  // 保持したまま留まる。理由ごとの出し分けは行わない——いずれの理由も、
  // 同一の安全な結果（画面遷移しない）につながるため。
  "partialEdit.parentChildPreviewNavigationFailed":
    "Unified Outliner: 選択した子項目を開けなかった（内容が変更された可能性がある）。編集中の親項目には影響しない。",
  // Phase 5L-8: 親のPartial Edit Paneのchild subtree previewから、直接の子で
  // かつリーフ（孫を持たない）である1項目だけを選び、既存のリーフ投影
  // モジュール（listMarker/taskList/orderedList/multiLine）をそのまま再利用
  // してインライン構造編集する機能の文言群。
  "partialEdit.parentChildInlineEditStartLabel": "この子項目をインライン編集",
  "partialEdit.parentChildInlineEditStopLabel": "編集を終了",
  "partialEdit.parentChildInlineEditPanelLabel": "編集中の子項目: {text}",
  "partialEdit.parentChildInlineEditFailed":
    "Unified Outliner: その子項目をインライン編集用に開けなかった——内容が変更された可能性がある。",
  "partialEdit.parentChildInlineEditApplied":
    "Unified Outliner: 親項目と子項目を更新した。",
  "partialEdit.parentChildInlineEditChildStructureInvalid":
    "Unified Outliner: この編集は子項目自体のMarkdown構造を変えてしまうため、ここでは適用できない。",
  "partialEdit.parentChildInlineEditCandidateInvalid":
    "Unified Outliner: この編集は適用できない——親項目とその子項目との関係が変わってしまう。",
  "partialEdit.parentChildInlineEditConflict":
    "Unified Outliner: この項目を読み込んだ後にノートの内容が変更された——適用する前に再読み込みが必要。",
  "partialEdit.parentChildInlineEditResolveFailed":
    "Unified Outliner: この編集を適用できなかった——親項目または子項目の構造が変更された。",
  "partialEdit.parentChildNewChildStructureInvalid":
    "Unified Outliner: この新しい項目のテキストに改行を含めることはできず、適用できない。",
  "partialEdit.parentChildAddButtonLabel": "子項目を追加",
  "partialEdit.parentChildAddButtonAlreadyPendingLabel": "追加中の子項目がある——先に適用するか取り消すこと",
  "partialEdit.parentChildNewChildPanelLabel": "新しい子項目",
  "partialEdit.parentChildNewChildStopLabel": "編集を終了",
  "partialEdit.parentChildPendingDeletionLabel": "適用時に削除される",
  "partialEdit.parentChildDeleteButtonLabel": "この子項目を削除",
  "partialEdit.parentChildReorderUpLabel": "この子項目を上へ移動",
  "partialEdit.parentChildReorderDownLabel": "この子項目を下へ移動",
  "partialEdit.parentChildReorderFailed":
    "Unified Outliner: この子項目を移動できなかった——変更された可能性がある。",
  "partialEdit.parentChildAddChildFailed":
    "Unified Outliner: 子項目の追加を開始できなかった——親項目が変更された可能性がある。",
  "partialEdit.parentChildDeleteFailed":
    "Unified Outliner: この子項目を削除対象にできなかった——変更された可能性がある。",
  "partialEdit.parentChildAddDeleteApplied": "Unified Outliner: 親項目の子項目を更新した。",
  "partialEdit.parentChildIndentOutdentPendingOtherDisabledLabel":
    "インデント/アウトデントが保留中です——先に適用するか取り消すこと",
  "partialEdit.parentChildIndentButtonLabel": "この子項目を直前の項目の子としてインデント",
  "partialEdit.parentChildOutdentButtonLabel": "この子項目を親のレベルへアウトデント",
  "partialEdit.parentChildIndentFailed":
    "Unified Outliner: この子項目をインデントできなかった——変更された可能性がある。",
  "partialEdit.parentChildOutdentFailed":
    "Unified Outliner: この子項目をアウトデントできなかった——変更された可能性がある。",
  "partialEdit.parentChildDeleteConfirmTitle": "この子項目を削除予定にするか？",
  "partialEdit.parentChildDeleteConfirmBody":
    "実際にノートから削除されるのは、「適用」ボタンを押したときである。",
  "partialEdit.parentChildDeleteConfirmButton": "削除する",
  "partialEdit.quoteTitleLabel": "コールアウトのタイトル",
  "partialEdit.quoteTitleNewlineUnsupported":
    "Unified Outliner: コールアウトのタイトルには改行を含められない。",
  "partialEdit.quoteFoldMarkerLabel": "コールアウトの折りたたみ設定",
  // 2026-09-09 (Partial Edit Pane コールアウト編集ヘッダーUI改善):
  // 元は「固定（折りたたみなし）」「展開可能（初期状態: 展開）」「展開可能
  // （初期状態: 折りたたみ）」という完全説明形式だったが、実機確認により、
  // これらの長文がselect要素自体の横幅（明示widthが無く、最長option文言
  // に引きずられていた — styles.css の
  // .unified-outliner-partial-edit-quote-marker-select 参照）を過剰に広
  // げ、タイトル入力欄を圧迫していたため、記号中心のコンパクトな表現に短
  // 縮した（value自体は既存の ""/"+"/"-" を維持）。詳細な説明は
  // quoteFoldMarkerLabel のツールチップに引き続き残っている。
  "partialEdit.quoteFoldMarkerNone": "固定",
  "partialEdit.quoteFoldMarkerExpand": "+ 展開",
  "partialEdit.quoteFoldMarkerCollapse": "- 収納",
  // Phase 5D-1C: ユーザー承認済みの厳密な文言をそのまま使用する。
  "partialEdit.quoteTypeLabel": "コールアウトの種類",
  "partialEdit.quoteTypeInvalidUnsupported":
    'Unified Outliner: コールアウトの種類は空にできず、"]" または改行を含められません。',
  "partialEdit.previousSibling": "前へ",
  "partialEdit.nextSibling": "次へ",
  "partialEdit.noPreviousSibling": "前の兄弟がない",
  "partialEdit.noNextSibling": "次の兄弟がない",

  "partialEdit.reload": "再読み込み",
  "partialEdit.staleLabel": "Unified Outliner: 本文が変更されたため、このペインの内容は現在の本文と一致していません。",
  "partialEdit.staleApplyDisabledReason":
    "このペインの内容が古いため、適用は無効になっている。再読み込みしてから編集し直すこと。",
  "partialEdit.unavailableLabel": "Unified Outliner: 編集対象が見つからないため、このペインでは編集できません。",
  "partialEdit.unavailableApplyDisabledReason":
    "この内容が見つからないため、適用は無効になっている。再読み込みするか、このペインを閉じて開き直すこと。",
  "partialEdit.reloadedNotice": "Unified Outliner: 現在の内容を再読み込みした。",
  "partialEdit.reloadFailedNotice":
    "Unified Outliner: 再読み込みできなかった——この内容は依然として利用できない。",
  "partialEdit.reloadConfirmTitle": "Unified Outliner: 再読み込みしますか？",
  "partialEdit.reloadConfirmBody":
    "本文が変更されたため、このペインの編集内容は現在の本文に適用できません。再読み込みすると、このペインの未適用の変更は破棄され、現在の本文が表示されます。",
  "partialEdit.reloadConfirmDiscardButton": "変更を破棄して再読み込み",
  "partialEdit.unsavedChangesTitle": "Unified Outliner: 未保存の変更",
  "partialEdit.unsavedChangesBody":
    "このノードには未適用の編集がある。切り替える前に適用するか、キャンセルするかを選んでほしい。編集を続けたい場合は、このダイアログを閉じてほしい。",
  "partialEdit.unsavedChangesDiscardButtonLabel": "キャンセル",

  // ---- セクション挿入時の見出しレベル選択モーダル（HeadingLevelModal.ts） -
  "modal.insertSectionTitle": "Unified Outliner: セクションを挿入",
  "modal.chooseHeadingLevel": "新しいセクションの見出しレベルを選んでほしい。",

  // ---- 複合ブロック削除確認モーダル（ConfirmCompositeDeleteModal.ts、
  // Phase 5C-1 チケット3b） --------------------------------------------------
  "modal.deleteCompositeBlockTitle": "Unified Outliner: 拡張ブロックを削除",
  "modal.deleteCompositeBlockBody":
    "「{label}」（{memberCount}件、{startLine}〜{endLine}行目）をノートから削除する。",
  "modal.deleteCompositeBlockUndoNote": "この操作はObsidian本体のUndoで元に戻せる。",

  // ---- 段落削除確認モーダル（ConfirmParagraphDeleteModal.ts、Phase 5T-9A） --
  "modal.deleteParagraphTitle": "Unified Outliner: 段落を削除",
  "modal.deleteParagraphBody": "「{label}」（{startLine}〜{endLine}行目）をノートから削除する。",
  "modal.deleteParagraphUndoNote": "この操作はObsidian本体のUndoで元に戻せる。",

  // ---- fenced code block 削除確認モーダル
  // （ConfirmFencedCodeDeleteModal.ts、Phase 5E-1） --------------------------
  "modal.deleteFencedCodeTitle": "Unified Outliner: コードブロックを削除",
  "modal.deleteFencedCodeBody": "「{label}」（{startLine}〜{endLine}行目）をノートから削除する。",
  "modal.deleteFencedCodeUndoNote": "この操作はObsidian本体のUndoで元に戻せる。",

  // ---- 共有ボタンラベル -----------------------------------------------------
  "common.apply": "適用",
  "common.discard": "破棄",
  "common.cancel": "キャンセル",
  "common.delete": "削除",

  // ---- 無操作理由（英語版の正本は commands/applyLineEditOutcome.ts の
  // NOOP_MESSAGES を参照） --------------------------------------------------
  "reason.code-block": "Unified Outliner: コードブロック内では移動できない。",
  "reason.frontmatter": "Unified Outliner: フロントマターは移動できない。",
  "reason.no-block": "Unified Outliner: カーソル位置に移動可能なブロックがない。",
  "reason.no-sibling": "Unified Outliner: その方向に入れ替える相手がない。",
  "reason.nested-edge":
    "Unified Outliner: ネストされた項目が親の端にある。インデント／アウトデントを試してほしい。",
  "reason.top-of-document": "Unified Outliner: すでに先頭にある。",
  "reason.end-of-document": "Unified Outliner: すでに末尾にある。",
  "reason.blocked-by-paragraph":
    "Unified Outliner: 段落が移動を妨げている（段落をまたぐ移動は未実装）。",
  "reason.cross-section-disabled":
    "Unified Outliner: セクションをまたぐリスト移動は設定でオフになっている。",
  "reason.unsafe-indent":
    "Unified Outliner: タブとスペースが混在したインデントを検出したため、安全のためスキップした。",
  "reason.no-previous-sibling": "Unified Outliner: インデント先となる前の兄弟がない。",
  "reason.already-root": "Unified Outliner: すでにルートレベルにある。",
  "reason.max-heading-level": "Unified Outliner: この見出しまたはサブセクションはすでにレベル6にある。",
  "reason.min-heading-level": "Unified Outliner: この見出しはすでにレベル1にある。",
  "reason.not-a-heading": "Unified Outliner: このノード限定コマンドは見出し行にのみ適用できる。",
  "reason.target-not-a-heading": "Unified Outliner: 見出しへのドロップのみ可能で、リスト項目へは不可。",
  "reason.drop-into-self": "Unified Outliner: ノードを自分自身にドロップすることはできない。",
  "reason.drop-into-descendant":
    "Unified Outliner: ノードを自分の子孫の中にドロップすることはできない。",
  "reason.target-resolve-failed":
    "Unified Outliner: ドロップ先を解決できなかった（ノートが変更された可能性がある）。",
  "reason.resolve-failed":
    "Unified Outliner: そのブロックを解決できなかった（ノートが変更された可能性がある）。",
  "reason.not-a-list-item": "Unified Outliner: この操作はリスト項目にのみ適用できる。",
  "reason.invalid-target":
    "Unified Outliner: リスト項目は他のリスト項目か見出しにのみドロップできる。",
  "reason.not-editable": "Unified Outliner: このノードは部分編集ペインで開けない。",
  "reason.type-changed":
    "Unified Outliner: このノードの種別が変わったため、ノートを変更せずに名前変更をキャンセルした。",
  "reason.heading-level-changed":
    "Unified Outliner: この見出しのレベルが変わったため、ノートを変更せずに名前変更をキャンセルした。",
  "reason.list-syntax-changed":
    "Unified Outliner: このリスト項目のマーカーまたはインデントが変わったため、ノートを変更せずに名前変更をキャンセルした。",
  "reason.contains-newline": "Unified Outliner: 名前変更のテキストに改行を含めることはできない。",
  "reason.no-active-editor": "Unified Outliner: アクティブなノートエディタがないため、名前変更をキャンセルした。",
  // Phase 5T-12A（docs/phase5t12_rename_note_leaf_switch_safety_design.md
  // §10 案A）: rename/paragraph挿入が未確定のままノートが切り替わった場合に表示。
  "reason.note-switched":
    "Unified Outliner: ノートが切り替わったため、編集中の変更は適用しなかった。",
  "reason.boundary-unknown":
    "Unified Outliner: このブロックの境界を確信を持って判定できなかったため、安全のため移動をスキップした。",
  "reason.not-in-section": "Unified Outliner: カーソルがどのセクションの中にもない。",

  // ---- 複合ブロック削除の拒否理由（edit/deleteCompositeBlock.ts の
  // NoCompositeDeleteReason、Phase 5C-1 チケット2/3b） ------------------------
  "reason.nested-in-list":
    "Unified Outliner: この拡張ブロックは他のリスト項目にネストされているため、このバージョンでは削除できない。",
  "reason.member-unsafe-indent":
    "Unified Outliner: タブとスペースが混在したインデントを検出したため、安全のためスキップした。",
  "reason.composite-boundary-changed":
    "Unified Outliner: 選択後にノートが変更されたため、誤った内容を削除しないよう削除を中止した。",
  "reason.range-invalid":
    "Unified Outliner: この拡張ブロックの範囲を確認できなかったため、安全のため削除をスキップした。",
  "reason.member-resolve-failed":
    "Unified Outliner: この拡張ブロックの内容を解決できなかった（ノートが変更された可能性がある）。",
  "reason.member-not-supported":
    "Unified Outliner: この拡張ブロックの一部が安全に認識できなくなったため、安全のため削除をスキップした。",
  "reason.member-has-diagnostic":
    "Unified Outliner: この拡張ブロックの一部に未解決の問題があるため、安全のため削除をスキップした。",
  "reason.unsupported-member-kind":
    "Unified Outliner: この拡張ブロックには、このバージョンでは削除できない種別が含まれている。",
  "reason.ambiguous-section":
    "Unified Outliner: この拡張ブロックのmember間でセクションの所属が一致しないため、安全のため削除をスキップした。",

  // ---- CompositeBlock move reasons（edit/moveCompositeBlock.ts の
  // NoCompositeMoveReason、Phase 5C-1 チケット4-4）。"unsafe-indent" は
  // 上記 reason.unsafe-indent をそのまま再利用する（元々操作に依存しない
  // 文言であるため）。"nested-in-list"／"composite-boundary-changed"／
  // "range-invalid" は上記の削除専用 reason.* キー（例：
  // reason.nested-in-list の「削除できない」という文言）を再利用しない —
  // move の拒否に対して誤って「削除」と表示してしまうことを避けるため、
  // また本チケットの制約上、削除の既存文言・既存テストを変更しないため。
  // 以下の reason.compositeMove* キーがその3件を個別にカバーする。他の
  // CompositeBlockMoveRejectionReason／NoCompositeMoveReason 値はこの
  // 衝突が無いため、通常どおり "reason." + reason のパターンで解決する
  // （view/OutlineTreeView.ts#compositeMoveReasonText 参照）。
  "reason.no-adjacent-compatible-unit":
    "Unified Outliner: その方向に入れ替えられる認識可能な対象がない。",
  "reason.different-parent-or-depth":
    "Unified Outliner: 隣接する項目が同じ階層にないため、安全のため移動をスキップした。",
  "reason.no-target":
    "Unified Outliner: 安全な移動先を決定できなかった。",
  "reason.compositeMoveNestedInList":
    "Unified Outliner: この拡張ブロックは別の list item にネストしているため、このバージョンでは移動できない。",
  "reason.compositeMoveBoundaryChanged":
    "Unified Outliner: この拡張ブロックを選択した後にノートが変更されたため、誤った内容に影響しないよう移動をキャンセルした。",
  "reason.compositeMoveRangeInvalid":
    "Unified Outliner: この拡張ブロックの範囲を確認できなかったため、安全のため移動をスキップした。",

  // ---- CompositeBlock Partial Edit reasons (Phase 5D-2A) ----
  "reason.compositePartialEditRangeInvalid":
    "Unified Outliner: この拡張ブロックの範囲を確認できなかったため、安全のため編集をスキップした。",
  "reason.compositePartialEditSnapshotMismatch":
    "Unified Outliner: この拡張ブロックを選択した後にノートが変更されたため、誤った内容に影響しないよう編集をキャンセルした。",
  "reason.compositePartialEditConflict":
    "Unified Outliner: この編集を読み込んだ後に拡張ブロックの内容が変更されたため、その変更を破棄しないようApplyを中止した。",

  // ---- Parent List Item Structured Partial Edit reasons (Phase 5L-6、
  // edit/parentListItemProjection.ts の ApplyParentListItemOwnTextReason)。
  // "resolve-failed" と "unsafe-indent" は上記の汎用reason.resolve-failed／
  // reason.unsafe-indentキーを意図的に再利用する（操作に依存しない文言の
  // ため共有して安全。compositePartialEditRangeInvalidの
  // "resolve-failed"再利用コメントと同じ理由による）。own-text
  // conflictについても再利用できる汎用の"reason.conflict"キーは存在しない
  // （compositePartialEditConflict自身のコメントが既に指摘する同じ欠落）
  // ため、専用キーを追加する。この2件は親項目自身のOWN TEXTのみを対象と
  // する — child subtreeのみの外部変更ではこの理由は発生しない
  // （applyParentListItemOwnTextEdit自身のdocコメント参照）。
  "reason.parent-own-text-range-unresolvable":
    "Unified Outliner: この親項目の本文を子項目から安全に分離できなくなったため、安全のためApplyを中止した。",
  "reason.parent-own-text-conflict":
    "Unified Outliner: この編集を読み込んだ後にこの項目自身の本文が変更されたため、その変更を破棄しないようApplyを中止した。",

  // ---- カーソル／選択範囲起点の拡張ブロックmove理由
  // (move/resolveCompositeSelectionTarget.ts の CompositeSelectionRejectionReason、
  // Phase 5C-1 チケット4-5)。"multiple-selections" は上記の
  // notice.multipleCursors を意図的に再利用する（edit/moveCompositeBlock.ts
  // の compositeMoveReasonText 自身のコメント参照）— ここには複製しない。
  "reason.compositeMoveNoTargetAtCursor":
    "Unified Outliner: カーソル位置に拡張ブロックが見つからなかった。",
  "reason.compositeMoveSelectionOutOfBounds":
    "Unified Outliner: 現在の選択範囲がこの拡張ブロックの外へはみ出しているため、移動をキャンセルした。",

  // ---- 単体（非compositeメンバー）callout/blockquote move理由
  // (Phase 5C-3、edit/moveStandaloneComplexBlock.ts の
  // NoStandaloneComplexBlockMoveReason)。上記の reason.compositeMove* は
  // 「拡張ブロック」というcomposite前提の文言のため再利用しない — 単体の
  // callout/blockquoteはcompositeの一部だったことがないため、そのまま流用
  // すると意味が誤って伝わる。
  "reason.standaloneMoveNotSupported":
    "Unified Outliner: このブロックは移動できない（未対応・境界不確定・読み取り専用のいずれか）。",
  "reason.standaloneMoveCompositeMember":
    "Unified Outliner: このブロックは拡張ブロックの一部であり、単体では移動できない。",
  "reason.standaloneMoveNestedInList":
    "Unified Outliner: このブロックはリスト項目の中に入れ子になっており、現バージョンでは移動できない。",
  "reason.standaloneMoveNoAdjacentUnit":
    "Unified Outliner: その方向に入れ替え可能なブロックが見当たらない。",
  "reason.standaloneMoveDifferentSection":
    "Unified Outliner: 隣接するブロックが別のセクションにあるため、安全のため移動をスキップした。",
  "reason.standaloneMoveBoundaryChanged":
    "Unified Outliner: このブロックを選択した後にノートが変更されたため、誤った内容に影響しないよう移動をキャンセルした。",
  "reason.standaloneMoveRangeInvalid":
    "Unified Outliner: このブロックの範囲を確認できなかったため、安全のため移動をスキップした。",
  "reason.standaloneMoveNoTarget":
    "Unified Outliner: 安全な移動先を特定できなかった。",

  // ---- fenced code block 削除（Phase 5E-1、deleteStandaloneComplexBlock.ts） ---
  "reason.standaloneFencedCodeDeleteNotSupported":
    "Unified Outliner: このブロックは削除できない（未対応・境界不確定・読み取り専用のいずれか）。",
  "reason.standaloneFencedCodeDeleteCompositeMember":
    "Unified Outliner: このブロックは拡張ブロックの一部であり、単体では削除できない。",
  "reason.standaloneFencedCodeDeleteBoundaryChanged":
    "Unified Outliner: このブロックを選択した後にノートが変更されたため、誤った内容に影響しないよう削除をキャンセルした。",
  "reason.standaloneFencedCodeDeleteRangeInvalid":
    "Unified Outliner: このブロックの範囲を確認できなかったため、安全のため削除をスキップした。",

  // ---- fenced code block の raw Partial Edit Apply 検証（Phase 5E-1、
  // partialEdit.ts）。PartialEditView.ts の汎用パターン（"reason." +
  // outcome.reason）に合わせ、reason 文字列そのものをハイフン区切りのキーとする。 ---
  "reason.fenced-code-invalid-open":
    "Unified Outliner: 先頭行は有効な開始フェンス（バッククォートまたはチルダ3つ以上）である必要がある。",
  "reason.fenced-code-invalid-close":
    "Unified Outliner: 末尾行は有効な終了フェンス（開始と同じフェンス文字・同数以上・他に何もない行）である必要がある。",

  // ---- 部分編集ペインの元ノート同一性チェック（Phase 5C-4、
  // view/partialEditSourceNoteCheck.ts）。追加の、パスに基づく安全弁 —
  // edit/partialEdit.ts 自身の内容比較による競合検知（applySubtreeEditの
  // current.text !== originalText 比較）は変更せずそのまま残す。いずれの
  // 理由でもApplyは拒否され、ノートは変更されない。
  "reason.partialEditSourceNoteChanged":
    "Unified Outliner: この編集を読み込んだノートと現在アクティブなノートが異なるため、誤ったノートを変更しないようApplyを中止した。",
  "reason.partialEditSourceNoteUnknown":
    "Unified Outliner: この編集がどのノートに属するか確認できなかったため、安全のためApplyを中止した。",

  // ---- Phase 5P-2: 段落 Partial Edit hoist の理由キー --------------------
  "reason.out-of-range": "Unified Outliner: カーソル位置が範囲外である。",
  "reason.no-paragraph":
    "Unified Outliner: カーソル位置に段落がない。見出し・リストマーカー・空行・コールアウト・引用・コードブロック・表・区切り線ではない、通常の段落内にカーソルを置くこと。",
  "reason.boundary-ambiguous":
    "Unified Outliner: この段落の境界を安全に確定できないため、編集を開けない。",
  "reason.identity-changed":
    "Unified Outliner: この段落の文書内での位置が変化したため、安全に適用できなかった。開き直してもう一度試すこと。",
  "reason.content-changed":
    "Unified Outliner: 本文が変更されたため、段落への安全な反映を中止した。内容を確認してもう一度開くこと。",
  "reason.anchor-unresolved":
    "Unified Outliner: この段落を安全に再同定できなかったため、更新を中止した。開き直してもう一度試すこと。",
  "reason.blank-line-not-allowed":
    "Unified Outliner: 段落の本文に空行を含めることはできない（複数の段落に分割されてしまう）。空行を削除してからもう一度試すこと。",

  "reason.paragraphTreeMoveResolveFailed":
    "Unified Outliner: この段落を安全に再解決できなかった（ノートが変更された可能性がある）。",
  "reason.paragraphTreeMoveIdentityChanged":
    "Unified Outliner: この段落の文書内での位置が変化したため、移動を取り消した。",
  "reason.paragraphTreeMoveContentChanged":
    "Unified Outliner: 本文が変更されたため、移動を取り消した。",
  "reason.paragraphTreeMoveAmbiguous":
    "Unified Outliner: この段落を一意に特定できなかったため、移動を取り消した。",

  "reason.paragraphNonAdjacentTargetResolveFailed":
    "Unified Outliner: 移動先を安全に再解決できなかった（ノートが変更された可能性がある）。",
  "reason.paragraphNonAdjacentTargetIdentityChanged":
    "Unified Outliner: 移動先の文書内での位置が変化したため、移動を取り消した。",
  "reason.paragraphNonAdjacentTargetContentChanged":
    "Unified Outliner: 本文が変更されたため、移動を取り消した。",
  "reason.paragraphNonAdjacentTargetAmbiguous":
    "Unified Outliner: 移動先を一意に特定できなかったため、移動を取り消した。",
  "reason.paragraphNonAdjacentSelfTarget":
    "Unified Outliner: 段落を自分自身の隣には移動できない。",
  "reason.paragraphNonAdjacentParentMismatch":
    "Unified Outliner: 移動先が同じセクション/リスト項目内にないため、移動を取り消した。",
  "reason.paragraphNonAdjacentDepthMismatch":
    "Unified Outliner: 移動先が同じ深さにないため、移動を取り消した。",
  "reason.paragraphNonAdjacentRangeOverlap":
    "Unified Outliner: 移動先が移動対象の段落と重なっているため、移動を取り消した。",

  // Phase 5T-9A（paragraph delete の最小スコープ実装、edit/deleteParagraph.ts）
  "reason.paragraphDeleteResolveFailed":
    "Unified Outliner: この段落を安全に再解決できなかった（本文が変更された可能性がある）。",
  "reason.paragraphDeleteIdentityChanged":
    "Unified Outliner: この段落の本文中の位置が変更されたため、削除を取り消した。",
  "reason.paragraphDeleteContentChanged":
    "Unified Outliner: 本文が変更されたため、削除を取り消した。",
  "reason.paragraphDeleteAmbiguous":
    "Unified Outliner: この段落を一意に特定できなかったため、削除を取り消した。",
  "reason.paragraphDeleteListItemParent":
    "Unified Outliner: この段落の親を解決できなかったため、アウトラインツリーから削除できない。",
  "reason.paragraphDeleteCompositeMember":
    "Unified Outliner: この段落は拡張ブロックの一部である。拡張ブロックごと削除してほしい。",

  // Phase 5T-10A（paragraph insert の最小スコープ実装、edit/insertParagraph.ts）
  "reason.paragraphInsertResolveFailed":
    "Unified Outliner: この段落を安全に再解決できなかった（本文が変更された可能性がある）。",
  "reason.paragraphInsertIdentityChanged":
    "Unified Outliner: この段落の本文中の位置が変更されたため、挿入を取り消した。",
  "reason.paragraphInsertContentChanged":
    "Unified Outliner: 本文が変更されたため、挿入を取り消した。",
  "reason.paragraphInsertAmbiguous":
    "Unified Outliner: この段落を一意に特定できなかったため、挿入を取り消した。",
  "reason.paragraphInsertListItemParent":
    "Unified Outliner: この段落の親を解決できなかったため、アウトラインツリーから段落を挿入できない。",
  "reason.paragraphInsertCompositeMember":
    "Unified Outliner: この段落は拡張ブロックの一部であるため、挿入は利用できない。",
  "reason.paragraphInsertUnsafeIndent":
    "Unified Outliner: このリスト項目はタブとスペースが混在したインデントのため、段落を安全に挿入できない。",

  // Phase 5L-9b（子を持たない standalone leaf list item からの初回 direct
  // child 追加——Mode B）
  "partialEdit.leafFirstChildAddButtonLabel": "最初の子項目を追加",
  "partialEdit.leafFirstChildAddButtonAlreadyPendingLabel":
    "追加中の最初の子項目がある——先に適用するか取り消すこと",
  "partialEdit.leafFirstChildAddFailed":
    "Unified Outliner: 最初の子項目を追加できなかった——この項目が変更された可能性がある。",
  "partialEdit.leafFirstChildAdded": "Unified Outliner: この項目に最初の子項目を追加した。",
};

const DICTIONARIES: Record<SupportedLocale, Record<TranslationKey, string>> = {
  en,
  ja,
};

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

export type Translator = (key: TranslationKey, vars?: TranslationVars) => string;

/** Builds a `t()` function bound to one locale. Pure — no Obsidian dependency. */
export function createTranslator(locale: SupportedLocale): Translator {
  const dict = DICTIONARIES[locale];
  return (key, vars) => interpolate(dict[key], vars);
}

/**
 * Convenience English translator, used as the default for functions (like
 * move/resolveMoveTarget.ts's describeMoveUnit) that need a Translator but
 * whose existing callers/tests don't pass one — preserves this plugin's
 * original English-by-default behavior for anyone who doesn't opt into
 * translation explicitly.
 */
export const defaultTranslator: Translator = createTranslator("en");
