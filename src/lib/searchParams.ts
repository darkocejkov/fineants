/**
 * Next's awaited `searchParams`, and the one thing every page does with it.
 *
 * Plain TypeScript on purpose (no `next/*` import): the shape is a record, and every page
 * that reads a filter out of the URL needs the same "a repeated parameter is one value"
 * rule, so it lives here rather than four times over.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a possibly-repeated parameter. An empty string reads as absent. */
export function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}
