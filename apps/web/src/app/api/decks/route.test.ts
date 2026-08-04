import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCard } from "@/server/decks/test-cards";

let dir: string;

const commanderId = "6b3f2a4d-5c1e-4a8b-9d2f-7e0c3b5a1d84";
const missingCardId = "00000000-0000-4000-8000-000000000000";

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "mtg-decks-route-test-"));
  process.env["DATABASE_PATH"] = join(dir, "test.db");
  process.env["DRIZZLE_MIGRATIONS_FOLDER"] = join(import.meta.dirname, "../../../../drizzle");
});

afterEach(() => {
  globalThis.__mtgSqlite?.close();
  globalThis.__mtgSqlite = undefined;
  globalThis.__mtgDb = undefined;
  rmSync(dir, { recursive: true, force: true });
  delete process.env["DATABASE_PATH"];
  delete process.env["DRIZZLE_MIGRATIONS_FOLDER"];
});

async function seedCard(id: string) {
  const { db } = await import("@/server/db/client");
  const { cards } = await import("@/server/db/schema");
  db.insert(cards).values(buildCard(id)).run();
}

function postDeck(body: unknown) {
  return new NextRequest("http://localhost/api/decks", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/decks", () => {
  it("creates a deck and defaults the format to commander", async () => {
    const { POST } = await import("./route");

    const response = await POST(postDeck({ name: "Tana & Sidar" }));
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      deck: { name: string; format: string; description: string };
    };
    expect(body.deck.name).toBe("Tana & Sidar");
    expect(body.deck.format).toBe("commander");
    expect(body.deck.description).toBe(""); // defaulted, not null
  });

  it("returns 404 when the commander isn't a known printing", async () => {
    const { POST } = await import("./route");
    const response = await POST(postDeck({ name: "Ghost", commanderCardId: missingCardId }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "card_not_found" });
  });

  it("accepts a commander that exists", async () => {
    await seedCard(commanderId);
    const { POST } = await import("./route");
    const response = await POST(postDeck({ name: "Real", commanderCardId: commanderId }));
    expect(response.status).toBe(201);
  });

  it("returns 400 for a blank name", async () => {
    const { POST } = await import("./route");
    expect((await POST(postDeck({ name: "   " }))).status).toBe(400);
  });

  it("returns 400 for an unknown format", async () => {
    const { POST } = await import("./route");
    expect((await POST(postDeck({ name: "Deck", format: "commanderr" }))).status).toBe(400);
  });
});

describe("PATCH /api/decks/[id]", () => {
  it("renames a deck", async () => {
    const { POST } = await import("./route");
    const { PATCH } = await import("./[id]/route");
    const created = (await (await POST(postDeck({ name: "Before" }))).json()) as {
      deck: { id: string };
    };

    const response = await PATCH(
      new NextRequest(`http://localhost/api/decks/${created.deck.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "After" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: created.deck.id }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { deck: { name: string } };
    expect(body.deck.name).toBe("After");
  });

  it("returns 404 for an unknown deck", async () => {
    const { PATCH } = await import("./[id]/route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/decks/${missingCardId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Nope" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: missingCardId }) },
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 for an empty patch", async () => {
    const { POST } = await import("./route");
    const { PATCH } = await import("./[id]/route");
    const created = (await (await POST(postDeck({ name: "Deck" }))).json()) as {
      deck: { id: string };
    };

    const response = await PATCH(
      new NextRequest(`http://localhost/api/decks/${created.deck.id}`, {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: created.deck.id }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/decks/[id]", () => {
  it("returns 204 and then 404 on a second delete", async () => {
    const { POST } = await import("./route");
    const { DELETE } = await import("./[id]/route");
    const created = (await (await POST(postDeck({ name: "Doomed" }))).json()) as {
      deck: { id: string };
    };
    const params = { params: Promise.resolve({ id: created.deck.id }) };

    const first = await DELETE(
      new NextRequest(`http://localhost/api/decks/${created.deck.id}`, { method: "DELETE" }),
      params,
    );
    expect(first.status).toBe(204);

    const second = await DELETE(
      new NextRequest(`http://localhost/api/decks/${created.deck.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: created.deck.id }) },
    );
    expect(second.status).toBe(404);
  });
});

// The GET handlers open with `await connection()`, which needs Next's real
// request-scoped AsyncLocalStorage and throws when a handler is invoked
// directly - same constraint as the collection-items routes. The query logic
// they delegate to is covered in server/decks/decks.test.ts; that these
// routes render dynamically is verified by `next build` reporting them as
// `ƒ Dynamic`.
