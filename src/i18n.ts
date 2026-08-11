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
  "settings.followKeyboardSelectionIntoBody.name":
    "Follow keyboard selection into body editor",
  "settings.followKeyboardSelectionIntoBody.desc":
    "When navigating the Outline Tree with arrow keys, also move the body editor's cursor and scroll position, the same way clicking a row does. Turn off to keep arrow-key navigation confined to the tree panel (Enter still jumps to the body).",
  "settings.syncOutlineTreeFoldingToEditor.name": "Sync Outline Tree folding to editor",
  "settings.syncOutlineTreeFoldingToEditor.desc":
    "When enabled, folding or unfolding a node in the Outline Tree also folds or unfolds the matching content in the active Markdown editor.",
  "settings.moveHighlightHeading": "Move & Outline Tree kind highlight",
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
  "settings.previewMoveTarget.name": "Preview move target in Outline Tree",
  "settings.previewMoveTarget.desc":
    "Briefly flash-highlight, in the Outline Tree, the block that Move block / Move section actually operated on.",
  "settings.showMoveResultToast.name": "Show move result toast",
  "settings.showMoveResultToast.desc":
    "Show a short notice naming what was moved (paragraph / list item / section) after Move block or Move section.",

  // ---- Commands (Command Palette names) ---------------------------------
  "command.moveBlockUp": "Move block up (minimal safe unit at cursor)",
  "command.moveBlockDown": "Move block down (minimal safe unit at cursor)",
  "command.moveSectionUp": "Move section up (whole enclosing section)",
  "command.moveSectionDown": "Move section down (whole enclosing section)",
  "command.moveNodeOnlyUp": "Move heading label up (current line only)",
  "command.moveNodeOnlyDown": "Move heading label down (current line only)",
  "command.indentBlock": "Indent block (list subtree / safe-scope heading)",
  "command.outdentBlock": "Outdent block (list subtree / safe-scope heading)",
  "command.indentNodeOnly": "Indent heading level (current line only)",
  "command.outdentNodeOnly": "Outdent heading level (current line only)",
  "command.deleteBlock": "Delete block (section / list subtree)",
  "command.insertSiblingBlock": "Insert sibling after current block",
  "command.insertChildListItem": "Insert child list item",
  "command.openOutlineTreeView": "Open outline tree view",
  "command.openPartialEditPane": "Open partial edit pane for current section",
  "command.ribbonTooltip": "Open Unified Outliner outline",

  // ---- Notices (main.ts, non-reason) ------------------------------------
  "notice.couldNotOpenOutlineTreeView": "Unified Outliner: could not open the outline tree view.",
  "notice.couldNotOpenRightSidebar": "Unified Outliner: could not open the right sidebar.",
  "notice.couldNotOpenPartialEditPaneNewWindow":
    "Unified Outliner: could not open the partial edit pane in a new window.",
  "notice.couldNotOpenPartialEditPane": "Unified Outliner: could not open the partial edit pane.",
  "notice.multipleCursors": "Unified Outliner: multiple cursors are not supported.",
  "notice.moved": "Unified Outliner: moved {unit} {direction}.",
  "notice.directionUp": "up",
  "notice.directionDown": "down",
  "notice.languageChanged":
    "Unified Outliner: display language changed. Command names already shown in the Command Palette will update after reloading the plugin (or Obsidian).",

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

  // ---- Outline Tree View --------------------------------------------------
  "tree.viewName": "Unified Outliner: Outline",
  "tree.untitledHeading": "(Untitled heading)",
  "tree.emptyListItem": "(Empty list item)",
  "tree.emptyNoHeadingsOrList": "This note has no headings or list items.",
  "tree.emptyNoHeadings": "This note has no headings.",
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

  // ---- Partial Edit Pane --------------------------------------------------
  "partialEdit.viewName": "Unified Outliner: Partial Edit",
  "partialEdit.noActiveNote": "Unified Outliner: no active note to load a node from.",
  "partialEdit.couldNotLoadNode": "Unified Outliner: could not load that node.",
  "partialEdit.editingTitle": "Editing ({kind}): {label}",
  "partialEdit.kindList": "List",
  "partialEdit.kindSection": "Section",
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
  "partialEdit.unsavedChangesTitle": "Unified Outliner: unsaved changes",
  "partialEdit.unsavedChangesBody":
    "This node has unapplied edits. Apply them before switching, discard them, or stay here.",
  "partialEdit.previousSibling": "Previous",
  "partialEdit.nextSibling": "Next",
  "partialEdit.noPreviousSibling": "No previous sibling",
  "partialEdit.noNextSibling": "No next sibling",

  // ---- Insert-section heading-level modal (HeadingLevelModal.ts) --------
  "modal.insertSectionTitle": "Unified Outliner: insert section",
  "modal.chooseHeadingLevel": "Choose the heading level for the new section.",

  // ---- Shared button labels ------------------------------------------------
  "common.apply": "Apply",
  "common.discard": "Discard",
  "common.cancel": "Cancel",

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
  "reason.boundary-unknown":
    "Unified Outliner: could not confidently determine this block's boundary — move skipped for safety.",
  "reason.not-in-section": "Unified Outliner: cursor is not inside any section.",
} as const;

export type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  // ---- 設定タブ -----------------------------------------------------------
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
  "settings.followKeyboardSelectionIntoBody.name": "キーボード選択を本文エディタに追従させる",
  "settings.followKeyboardSelectionIntoBody.desc":
    "アウトラインツリーを矢印キーで移動する際、行をクリックした場合と同様に本文エディタのカーソルとスクロール位置も移動する。オフにすると矢印キーによる移動はツリーパネル内に留まる（Enter キーは引き続き本文へジャンプする）。",
  "settings.syncOutlineTreeFoldingToEditor.name": "アウトラインツリーの折りたたみをエディタに同期",
  "settings.syncOutlineTreeFoldingToEditor.desc":
    "有効にすると、アウトラインツリーでノードを折りたたむ・展開する操作が、アクティブな Markdown エディタ内の対応する内容にも反映される。",
  "settings.moveHighlightHeading": "移動・アウトラインツリーの種別強調",
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
  "settings.previewMoveTarget.name": "アウトラインツリーで移動先をプレビュー",
  "settings.previewMoveTarget.desc":
    "Move block / Move section が実際に操作したブロックを、アウトラインツリー上で一瞬フラッシュ表示して強調する。",
  "settings.showMoveResultToast.name": "移動結果のトーストを表示",
  "settings.showMoveResultToast.desc":
    "Move block または Move section の実行後、何が移動したか（段落／リスト項目／セクション）を短い通知で表示する。",

  // ---- コマンド（コマンドパレットの表示名） ------------------------------
  "command.moveBlockUp": "ブロックを上へ移動（カーソル位置の最小安全単位）",
  "command.moveBlockDown": "ブロックを下へ移動（カーソル位置の最小安全単位）",
  "command.moveSectionUp": "セクションを上へ移動（囲むセクション全体）",
  "command.moveSectionDown": "セクションを下へ移動（囲むセクション全体）",
  "command.moveNodeOnlyUp": "見出しラベルを上へ移動（現在行のみ）",
  "command.moveNodeOnlyDown": "見出しラベルを下へ移動（現在行のみ）",
  "command.indentBlock": "ブロックをインデント（リストサブツリー／安全範囲の見出し）",
  "command.outdentBlock": "ブロックをアウトデント（リストサブツリー／安全範囲の見出し）",
  "command.indentNodeOnly": "見出しレベルをインデント（現在行のみ）",
  "command.outdentNodeOnly": "見出しレベルをアウトデント（現在行のみ）",
  "command.deleteBlock": "ブロックを削除（セクション／リストサブツリー）",
  "command.insertSiblingBlock": "現在のブロックの後に兄弟を挿入",
  "command.insertChildListItem": "子リスト項目を挿入",
  "command.openOutlineTreeView": "アウトラインツリービューを開く",
  "command.openPartialEditPane": "現在のセクションの部分編集ペインを開く",
  "command.ribbonTooltip": "Unified Outliner のアウトラインを開く",

  // ---- 通知（main.ts、reason に基づかないもの） -------------------------
  "notice.couldNotOpenOutlineTreeView": "Unified Outliner: アウトラインツリービューを開けなかった。",
  "notice.couldNotOpenRightSidebar": "Unified Outliner: 右サイドバーを開けなかった。",
  "notice.couldNotOpenPartialEditPaneNewWindow":
    "Unified Outliner: 部分編集ペインを新しいウィンドウで開けなかった。",
  "notice.couldNotOpenPartialEditPane": "Unified Outliner: 部分編集ペインを開けなかった。",
  "notice.multipleCursors": "Unified Outliner: 複数カーソルには対応していない。",
  "notice.moved": "Unified Outliner: {unit}を{direction}に移動した。",
  "notice.directionUp": "上",
  "notice.directionDown": "下",
  "notice.languageChanged":
    "Unified Outliner: 表示言語を変更した。コマンドパレットにすでに表示されているコマンド名は、プラグイン（または Obsidian）を再読み込みすると更新される。",

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

  // ---- アウトラインツリービュー -------------------------------------------
  "tree.viewName": "Unified Outliner: アウトライン",
  "tree.untitledHeading": "（無題の見出し）",
  "tree.emptyListItem": "（空のリスト項目）",
  "tree.emptyNoHeadingsOrList": "このノートには見出しもリスト項目もない。",
  "tree.emptyNoHeadings": "このノートには見出しがない。",
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

  // ---- 部分編集ペイン -------------------------------------------------------
  "partialEdit.viewName": "Unified Outliner: 部分編集",
  "partialEdit.noActiveNote": "Unified Outliner: ノードを読み込むアクティブなノートがない。",
  "partialEdit.couldNotLoadNode": "Unified Outliner: そのノードを読み込めなかった。",
  "partialEdit.editingTitle": "編集中（{kind}）: {label}",
  "partialEdit.kindList": "リスト",
  "partialEdit.kindSection": "セクション",
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
  "partialEdit.previousSibling": "前へ",
  "partialEdit.nextSibling": "次へ",
  "partialEdit.noPreviousSibling": "前の兄弟がない",
  "partialEdit.noNextSibling": "次の兄弟がない",
  "partialEdit.unsavedChangesTitle": "Unified Outliner: 未保存の変更",
  "partialEdit.unsavedChangesBody":
    "このノードには未適用の編集がある。切り替える前に適用するか、破棄するか、このまま留まるかを選んでほしい。",

  // ---- セクション挿入時の見出しレベル選択モーダル（HeadingLevelModal.ts） -
  "modal.insertSectionTitle": "Unified Outliner: セクションを挿入",
  "modal.chooseHeadingLevel": "新しいセクションの見出しレベルを選んでほしい。",

  // ---- 共有ボタンラベル -----------------------------------------------------
  "common.apply": "適用",
  "common.discard": "破棄",
  "common.cancel": "キャンセル",

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
  "reason.boundary-unknown":
    "Unified Outliner: このブロックの境界を確信を持って判定できなかったため、安全のため移動をスキップした。",
  "reason.not-in-section": "Unified Outliner: カーソルがどのセクションの中にもない。",
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
