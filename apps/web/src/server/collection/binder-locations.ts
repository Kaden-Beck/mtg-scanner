import { asc, count, ne, sum } from "drizzle-orm";
import { db } from "../db/client";
import { collectionItems } from "../db/schema";

export interface BinderLocationFacet {
  readonly location: string;
  readonly stackCount: number;
  readonly cardCount: number;
}

/**
 * Cap on how many locations the facet offers. Binder locations are free-form
 * text, so there is no upper bound on how many a collection can accumulate;
 * the page says so explicitly when it hits this rather than presenting a
 * truncated list as though it were the whole set.
 */
export const BINDER_FACET_LIMIT = 50;

/**
 * The distinct binder locations in use, for the location filter (KAD-21).
 *
 * Excludes the empty string: `binderLocation` is NOT NULL with `""` as the
 * "unset" value (see the `collectionItems` table comment), so an empty
 * location is the absence of one, not a location named "". There is also no
 * `binder:` term that would select it - `binder:""` is a syntax error by
 * design.
 */
export function listBinderLocations(limit = BINDER_FACET_LIMIT): BinderLocationFacet[] {
  return db
    .select({
      location: collectionItems.binderLocation,
      stackCount: count(),
      // `sum` is nullable in SQL's type system even over a NOT NULL column,
      // so drizzle types it as string | null; every group here has at least
      // one row, which is why the coalesce is a formality rather than a
      // real fallback.
      cardCount: sum(collectionItems.quantity),
    })
    .from(collectionItems)
    .where(ne(collectionItems.binderLocation, ""))
    .groupBy(collectionItems.binderLocation)
    .orderBy(asc(collectionItems.binderLocation))
    .limit(limit)
    .all()
    .map((row) => ({
      location: row.location,
      stackCount: row.stackCount,
      cardCount: Number(row.cardCount ?? 0),
    }));
}
