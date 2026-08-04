import { DECK_FORMATS, deckFormatLabel } from "@mtg/schemas";
import Link from "next/link";
import { connection } from "next/server";
import { listDecks } from "@/server/decks/decks";
import { deckColorIdentity } from "@/server/decks/hydrate";
import { createDeckAction } from "./actions";

export default async function DecksPage() {
  // Opts out of Cache Components prerendering - better-sqlite3 is sync, so
  // without this the deck list gets baked into the static build once.
  await connection();
  const decks = listDecks();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold text-neutral-100">Decks</h1>

      <form action={createDeckAction} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="New deck name"
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
          name="name"
          placeholder="New deck name"
          required
          type="text"
        />
        <select
          aria-label="Format"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
          defaultValue="commander"
          name="format"
        >
          {DECK_FORMATS.map((format) => (
            <option key={format} value={format}>
              {deckFormatLabel(format)}
            </option>
          ))}
        </select>
        <button
          className="rounded bg-neutral-100 px-3 py-1 font-medium text-neutral-900"
          type="submit"
        >
          Create deck
        </button>
      </form>

      {decks.length === 0 ? (
        <p className="text-neutral-400">No decks yet. Create one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decks.map((deck) => {
            const identity = deckColorIdentity(deck);
            return (
              <li key={deck.id}>
                <Link
                  className="block rounded border border-neutral-800 bg-neutral-950 p-3 hover:border-neutral-600"
                  href={`/decks/${deck.id}`}
                >
                  <span className="font-medium text-neutral-100">{deck.name}</span>
                  <span className="ml-2 text-sm text-neutral-400">
                    {deckFormatLabel(deck.format)}
                    {identity.length > 0 ? ` · ${identity.join("")}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
