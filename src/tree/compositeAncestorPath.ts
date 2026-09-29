/**
 * List+Callout (image-ocr) breadcrumb (2026-09-30): the ancestor path the
 * Partial Edit Pane's breadcrumb shows while a CompositeBlock is loaded.
 *
 * History: Phase 5D-2A deliberately left the breadcrumb / sibling nav /
 * Subtree Navigator empty for EVERY CompositeBlock (minimal initial scope,
 * not a technical constraint). This module re-enables ONLY the breadcrumb,
 * and ONLY for the rules listed in BREADCRUMB_ENABLED_COMPOSITE_RULE_IDS
 * (currently just "image-ocr" = List + Callout). "image-quote" (List +
 * Quote) and any other rule keep the original empty breadcrumb. Sibling nav
 * and the Subtree Navigator stay empty for every CompositeBlock — this
 * module never computes them.
 *
 * Anchor point: the composite's LIST member (`members[0]`) only. That
 * member is a real ListBlockNode registered in `doc.nodes` by
 * parser/parseDocument.ts, so its `parentId` chain can be walked by the
 * existing, unmodified tree/ancestorPath.ts#findAncestorPath. The trailing
 * callout/blockquote member lives in the separate ComplexBlockInfo model
 * (no parentId chain) and is never used as an anchor. The list member
 * itself is never included in the returned path (findAncestorPath's own
 * contract), so a breadcrumb segment can only ever target a section or a
 * parent list item — never a CompositeBlock member on its own (the
 * member-as-standalone-session route Phase 5D-2B removed stays removed).
 *
 * Pure and Obsidian-free, like findAncestorPath: any mismatch (unlisted
 * rule, missing/non-list first member, id that no longer resolves to a
 * list node) returns an empty array rather than throwing.
 */
import { isListNode, ParsedDocument } from "../model/block";
import { CompositeMemberKind } from "../model/compositeBlock";
import { defaultTranslator, Translator } from "../i18n";
import { AncestorPathEntry, findAncestorPath } from "./ancestorPath";

/**
 * Composite rule ids whose Partial Edit Pane shows an ancestor breadcrumb.
 * Fixed to "image-ocr" (List + Callout) for now; widening it (e.g. to
 * "image-quote") is a separate, deliberate spec decision.
 */
export const BREADCRUMB_ENABLED_COMPOSITE_RULE_IDS: ReadonlySet<string> = new Set(["image-ocr"]);

/** The minimal slice of a CompositeBlockSnapshot/CompositeBlockInfo this module reads. */
export interface CompositeBreadcrumbAnchor {
  ruleId: string;
  members: ReadonlyArray<{ kind: CompositeMemberKind; id: string }>;
}

/**
 * Root-first ancestors of `composite`'s list member, or `[]` when the
 * composite's rule is not breadcrumb-enabled or its list member cannot be
 * resolved to a list node in `doc`.
 */
export function findCompositeBreadcrumbAncestors(
  doc: ParsedDocument,
  composite: CompositeBreadcrumbAnchor | null | undefined,
  t: Translator = defaultTranslator
): AncestorPathEntry[] {
  if (!composite || !BREADCRUMB_ENABLED_COMPOSITE_RULE_IDS.has(composite.ruleId)) return [];
  const listMember = composite.members[0];
  if (!listMember || (listMember.kind !== "single-line-list" && listMember.kind !== "list")) return [];
  const node = doc.nodes.get(listMember.id);
  if (!node || !isListNode(node)) return [];
  return findAncestorPath(doc, listMember.id, t);
}
