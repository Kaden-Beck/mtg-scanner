import { DECK_BOARDS, deckBoardLabel, deckFormatLabel } from "@mtg/schemas";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/server/db/client";
import { cards, deckCards } from "@/server/db/schema";
import { getDeck, listDeckCards } from "@/server/decks/decks";
import { deckColorIdentity, validateDeckById } from "@/server/decks/hydrate";
import { addCardAction, removeCardAction, updateCardAction } from "../actions";
import {
  boardSummary,
  cardImageUrl,
  type DeckEntryView,
  entriesForBoard,
  groupByCategory,
  knownCategories,
} from "../deck-view";
import { LegalityReport } from "../legality-report";
import { CardSearch } from "./card-search";

function loadEntries(deckId: string): DeckEntryView[] {
  const rows = db
    .select({ entry: deckCards, card: cards })
    .from(deckCards)
    .innerJoin(cards, eq(deckCards.scryfallId, cards.id))
    .where(eq(deckCards.deckId, deckId))
    .all();
  return rows.map((row) => ({ entry: row.entry, card: row.card }));
}

/**
 * Deck editor (KAD-27) plus the legality report (KAD-31).
 *
 * Everything that mutates goes through a plain form posting to a Server
 * Action, so the whole page works without JavaScript. The one client
 * component is the typeahead, because "search-as-you-type" can't be a form
 * round trip per keystroke. That split is also what makes the phone
 * read-only path (the pre-game check in the AC) cheap: it renders and reads
 * fine before hydration.
 */
export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;

  const deck = getDeck(id);
  if (!deck) notFound();

  const entries = loadEntries(id);
  const identity = deckColorIdentity(deck);
  const validation = validateDeckById(id);
  const categories = knownCategories(entries);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <Link className="text-sm text-neutral-400 hover:text-neutral-200" href="/decks">
          ← All decks
        </Link>
        <h1 className="text-2xl font-semibold text-neutral-100">{deck.name}</h1>
        <p className="text-sm text-neutral-400">
          {deckFormatLabel(deck.format)}
          {identity.length > 0 ? ` · Color identity ${identity.join("")}` : " · Colorless"}
          {` · ${boardSummary(entries)}`}
        </p>
      </div>

      {validation ? <LegalityReport result={validation} /> : null}

      <form action={addCardAction.bind(null, id)} className="rounded border border-neutral-800 p-3">
        <CardSearch categories={categories} />
      </form>

      {DECK_BOARDS.map((board) => {
        const boardEntries = entriesForBoard(entries, board);
        if (boardEntries.length === 0) return null;

        return (
          <section className="flex flex-col gap-3" key={board}>
            <h2 className="text-lg font-semibold text-neutral-100">{deckBoardLabel(board)}</h2>

            {groupByCategory(boardEntries).map((group) => (
              <div key={group.category}>
                <h3 className="text-sm font-semibold text-neutral-300">
                  {group.label}
                  <span className="ml-2 font-normal text-neutral-500">({group.count})</span>
                </h3>
                <ul className="mt-1 flex flex-col divide-y divide-neutral-900">
                  {group.entries.map(({ entry, card }) => {
                    const image = cardImageUrl(card, "normal");
                    return (
                      <li className="flex flex-wrap items-center gap-2 py-1 text-sm" key={entry.id}>
                        {/* `title` gives a tap/hover preview target on the
                            card name even where the image is absent. */}
                        <span className="min-w-0 flex-1 text-neutral-100" title={card.typeLine}>
                          {entry.quantity}× {card.name}
                        </span>

                        {image ? (
                          // biome-ignore lint/performance/noImgElement: Scryfall CDN images, same call as the collection page
                          // eslint-disable-next-line @next/next/no-img-element -- same
                          <img
                            alt={card.name}
                            className="h-16 w-auto rounded"
                            height={340}
                            loading="lazy"
                            src={image}
                            width={244}
                          />
                        ) : null}

                        <form
                          action={updateCardAction.bind(null, id, entry.id)}
                          className="flex items-center gap-1"
                        >
                          <input
                            aria-label={`Quantity for ${card.name}`}
                            className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-100"
                            defaultValue={entry.quantity}
                            min={1}
                            name="quantity"
                            type="number"
                          />
                          <input
                            aria-label={`Category for ${card.name}`}
                            className="w-28 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-100"
                            defaultValue={entry.category}
                            name="category"
                            type="text"
                          />
                          <button
                            className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-200"
                            type="submit"
                          >
                            Save
                          </button>
                        </form>

                        <form action={removeCardAction.bind(null, id, entry.id)}>
                          <button
                            aria-label={`Remove ${card.name}`}
                            className="rounded border border-red-800 px-2 py-0.5 text-red-300"
                            type="submit"
                          >
                            Remove
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}

      {listDeckCards(id).length === 0 ? (
        <p className="text-neutral-400">No cards yet. Search above to add one.</p>
      ) : null}
    </main>
  );
}
