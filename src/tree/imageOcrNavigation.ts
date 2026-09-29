/**
 * List+Callout (image-ocr) sibling navigation (2026-09-30): the pure,
 * Obsidian-free "previous / next image-ocr CompositeBlock in this note"
 * resolver behind the Partial Edit Pane's image-ocr-only Previous/Next
 * buttons.
 *
 * Deliberately NOT tree/siblingNavigation.ts: that module follows a
 * BlockNode's own prevSiblingId/nextSiblingId pointers (same parent, same
 * kind), which for a CompositeBlock's list member would land on ANY
 * neighbouring list item — including a plain list item that is not part of
 * a CompositeBlock, which requestLoadNode would then open as an ordinary
 * list session. This module instead enumerates ONLY the CompositeBlocks
 * whose rule id is in IMAGE_OCR_NAVIGATION_RULE_IDS (currently just
 * "image-ocr"), across the WHOLE note (not limited to one section — a
 * possible future narrowing), in document order.
 *
 * Order: `range.startLine` of each matched CompositeBlockInfo, i.e. the
 * parser/matcher's own resolved position in the note — never heading
 * text, image names, or any lexical ordering. matchCompositeBlocks already
 * emits in document order; the explicit sort only makes that contract
 * local and obvious.
 *
 * Identity of the "current" composite: a full field-for-field match
 * (ruleId, sectionId, whole range, every member's kind/id/range) against a
 * snapshot the CALLER has just freshly re-resolved against the same `doc`
 * (e.g. edit/compositeBlockPartialEdit.ts#extractCompositeBlockText's
 * resolvedSnapshot) — the same comparison that module's own local
 * snapshotMatches uses, never the positional `composite-N` id alone. A
 * current composite that is absent, not image-ocr, or matches nothing in
 * the list yields an empty result (both directions null).
 *
 * Targets are whole CompositeBlockInfo values (never a member id), so the
 * caller can only ever open them as a CompositeBlock — never as a
 * standalone list/callout member session.
 */
import { LineRange } from "../model/block";
import { CompositeBlockInfo, CompositeMemberKind } from "../model/compositeBlock";

/** CompositeBlock rule ids that get the dedicated Previous/Next navigation. Fixed to "image-ocr" for now. */
export const IMAGE_OCR_NAVIGATION_RULE_IDS: ReadonlySet<string> = new Set(["image-ocr"]);

/** The fields of a CompositeBlockSnapshot/CompositeBlockInfo this module compares. */
export interface CompositeNavigationAnchor {
  ruleId: string;
  sectionId: string | null;
  range: LineRange;
  members: ReadonlyArray<{ kind: CompositeMemberKind; id: string; range: LineRange }>;
}

export interface CompositeSiblingTargets {
  previous: CompositeBlockInfo | null;
  next: CompositeBlockInfo | null;
}

/** Every navigable (image-ocr) CompositeBlock in `composites`, in document order. */
export function listNavigableComposites(
  composites: readonly CompositeBlockInfo[],
  ruleIds: ReadonlySet<string> = IMAGE_OCR_NAVIGATION_RULE_IDS
): CompositeBlockInfo[] {
  return composites
    .filter((c) => ruleIds.has(c.ruleId))
    .slice()
    .sort((a, b) => a.range.startLine - b.range.startLine);
}

/** Field-for-field identity check — see this module's top doc comment. */
export function compositeMatchesAnchor(anchor: CompositeNavigationAnchor, composite: CompositeBlockInfo): boolean {
  if (composite.ruleId !== anchor.ruleId) return false;
  if (composite.sectionId !== anchor.sectionId) return false;
  if (composite.range.startLine !== anchor.range.startLine || composite.range.endLine !== anchor.range.endLine) {
    return false;
  }
  if (composite.members.length !== anchor.members.length) return false;
  for (let i = 0; i < composite.members.length; i++) {
    const actual = composite.members[i];
    const expected = anchor.members[i];
    if (actual.kind !== expected.kind || actual.id !== expected.id) return false;
    if (actual.range.startLine !== expected.range.startLine || actual.range.endLine !== expected.range.endLine) {
      return false;
    }
  }
  return true;
}

/**
 * Previous/next image-ocr CompositeBlock of `current` among `composites`
 * (all CompositeBlocks matched from ONE fresh parse of the note — the
 * same parse `current` was re-resolved against). Both null when `current`
 * is null/undefined, not a navigable rule, or not found; `previous` null at
 * the first entry, `next` null at the last.
 */
export function findCompositeSiblingTargets(
  current: CompositeNavigationAnchor | null | undefined,
  composites: readonly CompositeBlockInfo[],
  ruleIds: ReadonlySet<string> = IMAGE_OCR_NAVIGATION_RULE_IDS
): CompositeSiblingTargets {
  if (!current || !ruleIds.has(current.ruleId)) return { previous: null, next: null };
  const ordered = listNavigableComposites(composites, ruleIds);
  const index = ordered.findIndex((c) => compositeMatchesAnchor(current, c));
  if (index === -1) return { previous: null, next: null };
  return {
    previous: index > 0 ? ordered[index - 1] : null,
    next: index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}
