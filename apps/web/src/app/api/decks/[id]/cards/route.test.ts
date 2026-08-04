import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "@/server/decks/test-cards";

let dir: string;

const cardId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const otherCardId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const missingId = "00000000-0000-4000-8000-000000000000";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-deck-cards-route-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../../../../drizzle");
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

async function setup() {
  const { db } = await import("@/server/db/client");
  const { cards } = await import("@/server/db/schema");
  db.insert(cards)
    .values([
      buildCard(cardId, { name: "Llanowar Elves" }),
      buildCard(otherCardId, { name: "Sol Ring" }),
    ])
    .run();

  const { createDeck } = await import("@/server/decks/decks");
  const { createDeckRequestSchema } = await import("@mtg/schemas");
  return createDeck(createDeckRequestSchema.parse({ name: "Test deck" }));
}

function postCard(deckId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/decks/${deckId}/cards`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/decks/[id]/cards", () => {
  it("adds a card, defaulting board to main and category to empty", async () => {
    const deck = await setup();
    const { POST } = await import("./route");

    const response = await POST(postCard(deck.id, { scryfallId: cardId, quantity: 1 }), {
      params: Promise.resolve({ id: deck.id }),
    });
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      card: { board: string; category: string; quantity: number };
    };
    expect(body.card.board).toBe("main");
    expect(body.card.category).toBe("");
    expect(body.card.quantity).toBe(1);
  });

  it("merges quantity rather than creating a second entry", async () => {
    const deck = await setup();
    const { POST } = await import("./route");
    const { listDeckCards } = await import("@/server/decks/decks");
    const params = () => ({ params: Promise.resolve({ id: deck.id }) });

    await POST(postCard(deck.id, { scryfallId: cardId, quantity: 1 }), params());
    const second = await POST(postCard(deck.id, { scryfallId: cardId, quantity: 3 }), params());

    const body = (await second.json()) as { card: { quantity: number } };
    expect(body.card.quantity).toBe(4);
    expect(listDeckCards(deck.id)).toHaveLength(1);
  });

  it("returns 404 for an unknown deck", async () => {
    await setup();
    const { POST } = await import("./route");
    const response = await POST(postCard(missingId, { scryfallId: cardId, quantity: 1 }), {
      params: Promise.resolve({ id: missingId }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("distinguishes an unknown card from an unknown deck", async () => {
    const deck = await setup();
    const { POST } = await import("./route");
    const response = await POST(postCard(deck.id, { scryfallId: missingId, quantity: 1 }), {
      params: Promise.resolve({ id: deck.id }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "card_not_found" });
  });

  it("returns 400 for a zero quantity", async () => {
    const deck = await setup();
    const { POST } = await import("./route");
    const response = await POST(postCard(deck.id, { scryfallId: cardId, quantity: 0 }), {
      params: Promise.resolve({ id: deck.id }),
    });
    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/decks/[id]/cards/[cardId]", () => {
  it("refuses to edit an entry through a different deck's URL", async () => {
    const deck = await setup();
    const { POST } = await import("./route");
    const { PATCH } = await import("./[cardId]/route");
    const { createDeck } = await import("@/server/decks/decks");
    const { createDeckRequestSchema } = await import("@mtg/schemas");

    const created = (await (
      await POST(postCard(deck.id, { scryfallId: cardId, quantity: 1 }), {
        params: Promise.resolve({ id: deck.id }),
      })
    ).json()) as { card: { id: string } };

    const otherDeck = createDeck(createDeckRequestSchema.parse({ name: "Other" }));
    const response = await PATCH(
      new NextRequest(`http://localhost/api/decks/${otherDeck.id}/cards/${created.card.id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity: 99 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: otherDeck.id, cardId: created.card.id }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 409 when a move collides with an existing entry", async () => {
    const deck = await setup();
    const { POST } = await import("./route");
    const { PATCH } = await import("./[cardId]/route");
    const params = () => ({ params: Promise.resolve({ id: deck.id }) });

    await POST(postCard(deck.id, { scryfallId: cardId, board: "main", quantity: 1 }), params());
    const maybe = (await (
      await POST(postCard(deck.id, { scryfallId: cardId, board: "maybe", quantity: 1 }), params())
    ).json()) as { card: { id: string } };

    const response = await PATCH(
      new NextRequest(`http://localhost/api/decks/${deck.id}/cards/${maybe.card.id}`, {
        method: "PATCH",
        body: JSON.stringify({ board: "main" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: deck.id, cardId: maybe.card.id }) },
    );

    expect(response.status).toBe(409);
  });
});

describe("DELETE /api/decks/[id]/cards/[cardId]", () => {
  it("removes the entry and 404s on a repeat", async () => {
    const deck = await setup();
    const { POST } = await import("./route");
    const { DELETE } = await import("./[cardId]/route");

    const created = (await (
      await POST(postCard(deck.id, { scryfallId: otherCardId, quantity: 1 }), {
        params: Promise.resolve({ id: deck.id }),
      })
    ).json()) as { card: { id: string } };

    const url = `http://localhost/api/decks/${deck.id}/cards/${created.card.id}`;
    const first = await DELETE(new NextRequest(url, { method: "DELETE" }), {
      params: Promise.resolve({ id: deck.id, cardId: created.card.id }),
    });
    expect(first.status).toBe(204);

    const second = await DELETE(new NextRequest(url, { method: "DELETE" }), {
      params: Promise.resolve({ id: deck.id, cardId: created.card.id }),
    });
    expect(second.status).toBe(404);
  });
});
