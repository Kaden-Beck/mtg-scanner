"use server";

import {
  createDeckCardRequestSchema,
  createDeckRequestSchema,
  updateDeckCardRequestSchema,
} from "@mtg/schemas";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addOrMergeDeckCard,
  createDeck,
  deleteDeck,
  removeDeckCard,
  updateDeck,
  updateDeckCard,
} from "@/server/decks/decks";

/**
 * Server Actions for the deck editor (KAD-27).
 *
 * Plain forms posting to actions rather than client-side fetch: they work
 * before hydration, which matters for the phone read-only path, and they
 * reuse the same validated request schemas the API routes use rather than a
 * parallel set of rules. Same approach as the collection page's binder edit.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

// Next.js requires "use server" exports to be async regardless of whether
// the body awaits anything - every write here is synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function createDeckAction(form: FormData): Promise<void> {
  const parsed = createDeckRequestSchema.safeParse({
    name: text(form, "name"),
    format: text(form, "format") || undefined,
  });
  // A blank name just re-renders the list; there is nothing to report and
  // nothing was created.
  if (!parsed.success) {
    revalidatePath("/decks");
    return;
  }

  const deck = createDeck(parsed.data);
  revalidatePath("/decks");
  redirect(`/decks/${deck.id}`);
}

// Next.js requires "use server" exports to be async regardless of whether
// the body awaits anything - every write here is synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function deleteDeckAction(deckId: string): Promise<void> {
  deleteDeck(deckId);
  revalidatePath("/decks");
  redirect("/decks");
}

// Next.js requires "use server" exports to be async regardless of whether
// the body awaits anything - every write here is synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function setCommanderAction(deckId: string, form: FormData): Promise<void> {
  const scryfallId = text(form, "scryfallId");
  const slot = text(form, "slot") === "partner" ? "partnerCardId" : "commanderCardId";
  // Empty clears the slot - `null`, not `undefined`, or the patch would be
  // read as "leave alone" (see updateDeck).
  updateDeck(deckId, { [slot]: scryfallId === "" ? null : scryfallId });
  revalidatePath(`/decks/${deckId}`);
}

// Next.js requires "use server" exports to be async regardless of whether
// the body awaits anything - every write here is synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function addCardAction(deckId: string, form: FormData): Promise<void> {
  const parsed = createDeckCardRequestSchema.safeParse({
    scryfallId: text(form, "scryfallId"),
    board: text(form, "board") || undefined,
    category: text(form, "category"),
    quantity: Number(text(form, "quantity") || "1"),
  });
  if (parsed.success) addOrMergeDeckCard(deckId, parsed.data);
  revalidatePath(`/decks/${deckId}`);
}

// Next.js requires "use server" exports to be async regardless of whether
// the body awaits anything - every write here is synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function updateCardAction(
  deckId: string,
  deckCardId: string,
  form: FormData,
): Promise<void> {
  const quantityRaw = text(form, "quantity");
  const parsed = updateDeckCardRequestSchema.safeParse({
    ...(quantityRaw ? { quantity: Number(quantityRaw) } : {}),
    ...(form.has("category") ? { category: text(form, "category") } : {}),
    ...(form.has("board") ? { board: text(form, "board") } : {}),
  });
  if (parsed.success) updateDeckCard(deckCardId, parsed.data);
  revalidatePath(`/decks/${deckId}`);
}

// Next.js requires "use server" exports to be async regardless of whether
// the body awaits anything - every write here is synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function removeCardAction(deckId: string, deckCardId: string): Promise<void> {
  removeDeckCard(deckCardId);
  revalidatePath(`/decks/${deckId}`);
}
