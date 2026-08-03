import Link from "next/link";
import { connection } from "next/server";
import {
  BINDER_FACET_LIMIT,
  type BinderLocationFacet,
  listBinderLocations,
} from "@/server/collection/binder-locations";
import { type CollectionSearchRow, runCollectionSearch } from "@/server/search/collection-search";
import type { QueryErrorPresentation } from "@/server/search/query-errors";
import { updateBinderLocationAction } from "./actions";
import {
  binderConflictMessage,
  binderFieldLabel,
  binderFilterTerm,
  cardImageUrl,
  collectionHref,
  errorHeading,
  firstParam,
  isTermActive,
  parseViewMode,
  resultSummary,
  type SearchParamValue,
  toggleQueryTerm,
  type ViewMode,
} from "./collection-view";

const RESULT_LIMIT = 200;

function stackSummary(item: CollectionSearchRow["item"]): string {
  const parts = [`${String(item.quantity)}x`, item.finish, item.condition];
  if (item.isProxy) parts.push("proxy");
  return parts.join(" · ");
}

/**
 * Inline edit for one stack's binder location (KAD-21 AC1). A plain form
 * posting to a Server Action, so it works before hydration and needs no
 * client component; `q`/`view` ride along as hidden fields so the action can
 * rebuild the page URL it redirects back to without trusting a client-
 * supplied one.
 */
function BinderEditor({
  row,
  query,
  view,
}: {
  row: CollectionSearchRow;
  query: string;
  view: ViewMode;
}) {
  return (
    <form
      action={updateBinderLocationAction.bind(null, row.item.id)}
      className="flex items-center gap-1"
    >
      <input type="hidden" name="q" value={query} />
      <input type="hidden" name="view" value={view} />
      <input
        type="text"
        name="binderLocation"
        defaultValue={row.item.binderLocation}
        placeholder="No location"
        aria-label={binderFieldLabel(row.card.name, row.item)}
        className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium dark:border-zinc-700"
      >
        Save
      </button>
    </form>
  );
}

/**
 * The location filter (KAD-21). Each chip toggles a `binder:` term into the
 * same query string the search box owns, rather than being a second filter
 * mechanism the user then has to reconcile with what they typed.
 */
function LocationFacet({
  locations,
  query,
  view,
}: {
  locations: readonly BinderLocationFacet[];
  query: string;
  view: ViewMode;
}) {
  if (locations.length === 0) return null;

  return (
    <nav aria-label="Filter by binder location" className="flex flex-wrap items-center gap-2">
      {locations.map((facet) => {
        const term = binderFilterTerm(facet.location);
        const label = `${facet.location} (${String(facet.cardCount)})`;

        // A location containing a double quote has no query spelling at all
        // (the tokenizer has no escape for it), so it is shown as plain text
        // instead of a link that would filter to something else.
        if (term === null) {
          return (
            <span
              key={facet.location}
              title="This location can't be filtered on - its name contains a quote character."
              className="rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
            >
              {label}
            </span>
          );
        }

        const active = isTermActive(query, term);
        return (
          <Link
            key={facet.location}
            href={collectionHref(toggleQueryTerm(query, term), view)}
            aria-pressed={active}
            className={
              active
                ? "rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "rounded-full border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
            }
          >
            {label}
          </Link>
        );
      })}
      {locations.length === BINDER_FACET_LIMIT && (
        <span className="text-xs text-zinc-500 dark:text-zinc-500">
          first {BINDER_FACET_LIMIT} locations - type a `binder:` term for the rest
        </span>
      )}
    </nav>
  );
}

function ConflictBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      // Named for the same reason as the search error banner: Next renders
      // its own unnamed role="alert" route announcer on every page.
      aria-label="Binder location conflict"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      {message}
    </div>
  );
}

/**
 * The card image. `h-auto` with no `object-cover` and no clipping parent is
 * load-bearing, not incidental styling: the artist credit and copyright
 * line live on the card's bottom edge, and the provider requires they stay
 * visible (AC4). The eligible-sizes decision is in `cardImageUrl`.
 */
function CardImage({ row, view }: { row: CollectionSearchRow; view: ViewMode }) {
  const url = cardImageUrl(row.card.imageUris, view);
  const sizeClass = view === "grid" ? "w-full" : "w-16 shrink-0";

  if (url === null) {
    return (
      <div
        className={`${sizeClass} flex aspect-5/7 items-center justify-center rounded-lg bg-zinc-100 text-center text-xs text-zinc-400 dark:bg-zinc-900`}
      >
        No image
      </div>
    );
  }

  return (
    // Card images come straight from Scryfall's image_uris; not worth
    // next/image remote-pattern config for this.
    // biome-ignore lint/performance/noImgElement: see comment above
    <img
      src={url}
      alt={row.card.name}
      loading="lazy"
      className={`${sizeClass} h-auto rounded-lg`}
    />
  );
}

interface RowProps {
  readonly row: CollectionSearchRow;
  readonly query: string;
  readonly view: ViewMode;
}

function GridCard({ row, query, view }: RowProps) {
  return (
    <li className="flex flex-col gap-1">
      <CardImage row={row} view="grid" />
      <span className="text-sm font-medium">{row.card.name}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-500">
        {row.card.setName} · #{row.card.collectorNumber}
      </span>
      <span className="text-xs text-zinc-600 dark:text-zinc-400">{stackSummary(row.item)}</span>
      <BinderEditor row={row} query={query} view={view} />
    </li>
  );
}

function ListCard({ row, query, view }: RowProps) {
  return (
    <li className="flex items-start gap-3 border-b border-zinc-200 py-3 last:border-none dark:border-zinc-800">
      <CardImage row={row} view="list" />
      <div className="flex-1">
        <div className="font-medium">{row.card.name}</div>
        <div className="text-sm text-zinc-500 dark:text-zinc-500">
          {row.card.setName} · #{row.card.collectorNumber} · {row.card.rarity}
        </div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">{stackSummary(row.item)}</div>
        {row.card.typeLine !== "" && (
          <div className="text-sm text-zinc-500 dark:text-zinc-500">{row.card.typeLine}</div>
        )}
        <div className="mt-1 max-w-xs">
          <BinderEditor row={row} query={query} view={view} />
        </div>
      </div>
    </li>
  );
}

function ErrorBanner({ error }: { error: QueryErrorPresentation }) {
  return (
    <div
      role="alert"
      // Named because Next renders its own unnamed role="alert" route
      // announcer on every page - without this there is no way to address
      // this banner specifically, from a test or a screen reader.
      aria-label="Search error"
      className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
    >
      <p className="font-medium text-red-900 dark:text-red-200">{errorHeading(error.kind)}</p>
      {/* The parser's own message already names the operator or token at
          fault - a generic "invalid search" is the failure KAD-18 exists
          to prevent, so it is rendered verbatim. */}
      <p className="mt-1 text-sm text-red-800 dark:text-red-300">{error.message}</p>
    </div>
  );
}

/**
 * Search box and view toggle. On phone width this is pinned to the bottom
 * of the viewport (NFR-7: primary controls in the lower third, within thumb
 * reach); from `sm` up it sits inline at the top where there's no reach
 * constraint.
 */
function Controls({ query, view }: { query: string; view: ViewMode }) {
  const otherView: ViewMode = view === "grid" ? "list" : "grid";

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:static sm:border-none sm:bg-transparent sm:p-0 sm:dark:bg-transparent">
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <form method="get" action="/collection" className="flex flex-1 gap-2">
          {/* Keeps the current view across a search submit - a GET form
              only sends its own fields. */}
          {view !== "grid" && <input type="hidden" name="view" value={view} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="c:rg t:creature cmc<=3"
            aria-label="Search collection"
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Search
          </button>
        </form>
        <Link
          href={collectionHref(query, otherView)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          {otherView === "grid" ? "Grid view" : "List view"}
        </Link>
      </div>
    </div>
  );
}

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamValue>>;
}) {
  // Awaiting searchParams already forces request-time rendering, but the DB
  // read below is synchronous better-sqlite3 - the same trap as the sync
  // status page (KAD-9), where nothing signals to Cache Components that the
  // data is per-request. Explicit beats relying on a side effect of param
  // access.
  await connection();
  const params = await searchParams;
  const query = firstParam(params["q"]);
  const view = parseViewMode(params["view"]);
  const outcome = runCollectionSearch(query, RESULT_LIMIT);
  const locations = listBinderLocations();

  const conflictId = firstParam(params["conflict"]);
  const conflictRow = outcome.ok
    ? outcome.rows.find((candidate) => candidate.item.id === conflictId)
    : undefined;

  return (
    // Bottom padding clears the fixed control bar on phone widths.
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4 pb-32 sm:p-8 sm:pb-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Collection</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          Home
        </Link>
      </div>

      <Controls query={query} view={view} />

      {conflictId !== "" && (
        <ConflictBanner
          message={binderConflictMessage(
            conflictRow?.card.name ?? null,
            firstParam(params["conflictTo"]),
          )}
        />
      )}

      <LocationFacet locations={locations} query={query} view={view} />

      {outcome.ok ? (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {resultSummary(outcome.rows.length, RESULT_LIMIT)}
          </p>
          {view === "grid" ? (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {outcome.rows.map((row) => (
                <GridCard key={row.item.id} row={row} query={query} view={view} />
              ))}
            </ul>
          ) : (
            <ul>
              {outcome.rows.map((row) => (
                <ListCard key={row.item.id} row={row} query={query} view={view} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <ErrorBanner error={outcome.error} />
      )}
    </main>
  );
}
