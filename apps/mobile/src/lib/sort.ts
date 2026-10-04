/** The orders search results can be sorted in (the search API also has distance, which needs a place). */
export const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];
