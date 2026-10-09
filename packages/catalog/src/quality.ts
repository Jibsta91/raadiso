import { attributesOf } from './categories.js';

/*
 * How complete a listing is (ADR-0042, ADR-0045): what search ranks by and what the listing form's meter
 * shows. Zod-free, shared by the search service, the website and the app.
 */

export interface QualityInput {
  category: string;
  subcategory: string;
  description: string;
  imageCount: number;
  attributes: Record<string, unknown>;
}

export interface Quality {
  /** 0–1, rounded to two decimals. */
  score: number;
  /** Each part's share of the score, 0–1 of its weight. */
  photos: number;
  description: number;
  details: number;
  /** The single step that adds the most, if the listing isn't complete. */
  next?:
    | { kind: 'photos'; more: number }
    | { kind: 'description'; more: number }
    | { kind: 'details'; missing: string[] };
}

export const QUALITY = { photos: 4, descriptionChars: 400 } as const;

export function qualityOf(l: QualityInput): Quality {
  const photos = Math.min(l.imageCount, QUALITY.photos) / QUALITY.photos;
  const description =
    Math.min(l.description.trim().length, QUALITY.descriptionChars) / QUALITY.descriptionChars;
  const defs = attributesOf(l.category, l.subcategory);
  const missing = defs
    .filter((d) => l.attributes[d.key] === undefined || l.attributes[d.key] === '')
    .map((d) => d.key);
  const details = defs.length ? (defs.length - missing.length) / defs.length : 1;
  const score = Math.round((0.5 * photos + 0.25 * description + 0.25 * details) * 100) / 100;
  // What each step would add to the score; the biggest comes first.
  const gains = [
    {
      gain: 0.5 * (1 - photos),
      next: {
        kind: 'photos' as const,
        more: QUALITY.photos - Math.min(l.imageCount, QUALITY.photos),
      },
    },
    {
      gain: 0.25 * (1 - description),
      next: {
        kind: 'description' as const,
        more:
          QUALITY.descriptionChars -
          Math.min(l.description.trim().length, QUALITY.descriptionChars),
      },
    },
    { gain: 0.25 * (1 - details), next: { kind: 'details' as const, missing } },
  ].sort((a, b) => b.gain - a.gain);
  return {
    score,
    photos,
    description,
    details,
    ...(gains[0]!.gain > 0.001 ? { next: gains[0]!.next } : {}),
  };
}
