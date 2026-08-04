"use client";

import { useEffect, useId, useState } from "react";
import type { CardSuggestion } from "@/server/decks/card-search";

/**
 * Search-as-you-type against the local card DB (KAD-27 AC1).
 *
 * A client component because the AC is explicitly *as-you-type* - a form
 * round trip per keystroke isn't that. It hits /api/cards/search, which
 * reuses the KAD-10 FTS index rather than introducing a second search path.
 *
 * The chosen card is written into a hidden input inside the parent form, so
 * the actual add still goes through the same Server Action (and the same
 * Zod contract) as everything else on the page.
 */
/** Narrows the fetch response instead of asserting it - the endpoint is
 * ours, but a parse failure should show no results rather than crash the
 * editor mid-keystroke. */
function isSuggestionResponse(body: unknown): body is { cards: CardSuggestion[] } {
  if (typeof body !== "object" || body === null || !("cards" in body)) return false;
  return Array.isArray(body.cards);
}

export function CardSearch({ categories }: { categories: string[] }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CardSuggestion[]>([]);
  const [selected, setSelected] = useState<CardSuggestion | null>(null);
  const [preview, setPreview] = useState<CardSuggestion | null>(null);
  const listId = useId();

  useEffect(() => {
    // Debounced, and aborted on the next keystroke - without the abort,
    // slow responses can land out of order and overwrite newer results.
    // The short-term case goes through the same timer rather than calling
    // setState synchronously in the effect body, which triggers a cascading
    // render.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (term.trim().length < 2) {
        setResults([]);
        return;
      }

      fetch(`/api/cards/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then(async (response) => {
          const body: unknown = await response.json();
          return isSuggestionResponse(body) ? body.cards : [];
        })
        .then(setResults)
        .catch((error: unknown) => {
          // An aborted fetch is the normal path on every keystroke, not an
          // error worth surfacing.
          if (error instanceof DOMException && error.name === "AbortError") return;
          setResults([]);
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-neutral-300" htmlFor={listId}>
        Add a card
      </label>
      <input
        autoComplete="off"
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
        id={listId}
        onChange={(event) => {
          setTerm(event.target.value);
          setSelected(null);
        }}
        placeholder="Search cards by name or text"
        type="search"
        value={term}
      />

      {selected ? (
        // An explicit accessible name rather than relying on the visible
        // text: the label is split across spans, so a text match can't see
        // it as one string - and naming it is the better a11y outcome too.
        <p aria-label="Selected card" className="text-sm text-neutral-300">
          Selected: <span className="font-medium text-neutral-100">{selected.name}</span>{" "}
          <span className="text-neutral-500">
            ({selected.setCode.toUpperCase()} {selected.collectorNumber})
          </span>
        </p>
      ) : null}

      {/* The list is given an accessible name because the card name alone is
          ambiguous: the deck list below has a "Remove <card>" button for
          every card, so an unnamed results list makes any by-name selector
          match both - which is exactly how the first e2e run "selected" a
          card by deleting it. */}
      {results.length > 0 && !selected ? (
        <ul
          aria-label="Card search results"
          className="max-h-64 overflow-y-auto rounded border border-neutral-800"
        >
          {results.map((card) => (
            <li key={card.id}>
              <button
                className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                onBlur={() => {
                  setPreview(null);
                }}
                onClick={() => {
                  setSelected(card);
                  setResults([]);
                }}
                // Both hover and focus, so the preview is reachable by
                // keyboard and not only by mouse.
                onFocus={() => {
                  setPreview(card);
                }}
                onMouseEnter={() => {
                  setPreview(card);
                }}
                onMouseLeave={() => {
                  setPreview(null);
                }}
                type="button"
              >
                <span>{card.name}</span>
                <span className="shrink-0 text-neutral-500">
                  {card.setCode.toUpperCase()} · {card.typeLine}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {preview?.imageUri ? (
        // eslint-disable-next-line @next/next/no-img-element -- Scryfall CDN, same call as the collection page
        <img
          alt={preview.name}
          className="w-40 rounded"
          height={340}
          src={preview.imageUri}
          width={244}
        />
      ) : null}

      <input name="scryfallId" type="hidden" value={selected?.id ?? ""} />

      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Quantity"
          className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
          defaultValue={1}
          min={1}
          name="quantity"
          type="number"
        />
        <input
          aria-label="Category"
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
          list={`${listId}-categories`}
          name="category"
          placeholder="Category (e.g. ramp)"
          type="text"
        />
        {/* A datalist, not a select: categories are free-form, and a closed
            vocabulary is exactly what KAD-26 decided against. */}
        <datalist id={`${listId}-categories`}>
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <select
          aria-label="Board"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
          defaultValue="main"
          name="board"
        >
          <option value="main">Main</option>
          <option value="side">Sideboard</option>
          <option value="maybe">Maybe</option>
        </select>
        <button
          className="rounded bg-neutral-100 px-3 py-1 font-medium text-neutral-900 disabled:opacity-50"
          disabled={!selected}
          type="submit"
        >
          Add
        </button>
      </div>
    </div>
  );
}
