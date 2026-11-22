/**
 * Whether the household has actually recorded a disagreement about who owns an item. Only then does a card say
 * "not agreed yet". The importer's "suggested owner" mark is not a disagreement: it sat on almost every card and said
 * nothing a person could act on.
 */
export function ownerDisputed(m: { data?: unknown }): boolean {
  return (m.data as { owner_disputed?: unknown } | undefined)?.owner_disputed === true;
}
