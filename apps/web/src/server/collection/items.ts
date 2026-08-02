import { randomUUID } from "node:crypto";
import type { CreateCollectionItemRequest, UpdateCollectionItemRequest } from "@mtg/schemas";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  type CollectionItemRow,
  cards,
  collectionItems,
  type NewCollectionItemRow,
} from "../db/schema";

export class CardNotFoundError extends Error {
  constructor(public readonly scryfallId: string) {
    super(`No card found for scryfallId ${scryfallId}`);
  }
}

export function listCollectionItems(filter?: { scryfallId?: string }): CollectionItemRow[] {
  const query = db.select().from(collectionItems);
  if (filter?.scryfallId) {
    return query.where(eq(collectionItems.scryfallId, filter.scryfallId)).all();
  }
  return query.all();
}

export function getCollectionItem(id: string): CollectionItemRow | undefined {
  return db.select().from(collectionItems).where(eq(collectionItems.id, id)).get();
}

function findStack(
  request: Pick<
    CreateCollectionItemRequest,
    "scryfallId" | "finish" | "condition" | "isProxy" | "binderLocation" | "language"
  >,
): CollectionItemRow | undefined {
  return db
    .select()
    .from(collectionItems)
    .where(
      and(
        eq(collectionItems.scryfallId, request.scryfallId),
        eq(collectionItems.finish, request.finish),
        eq(collectionItems.condition, request.condition),
        eq(collectionItems.isProxy, request.isProxy),
        eq(collectionItems.binderLocation, request.binderLocation),
        eq(collectionItems.language, request.language),
      ),
    )
    .get();
}

/**
 * Upsert-merge on the physical-stack unique index: adding the same card
 * twice increments quantity instead of creating a second row. This is the
 * shared primitive the Archidekt import (KAD-13) and, later, scan commit
 * (KAD-48) both build on rather than reimplementing.
 */
export function createOrMergeCollectionItem(
  request: CreateCollectionItemRequest,
): CollectionItemRow {
  const card = db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.id, request.scryfallId))
    .get();
  if (!card) throw new CardNotFoundError(request.scryfallId);

  const now = new Date();
  const row: NewCollectionItemRow = {
    id: randomUUID(),
    scryfallId: request.scryfallId,
    finish: request.finish,
    condition: request.condition,
    quantity: request.quantity,
    isProxy: request.isProxy,
    binderLocation: request.binderLocation,
    language: request.language,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(collectionItems)
    .values(row)
    .onConflictDoUpdate({
      target: [
        collectionItems.scryfallId,
        collectionItems.finish,
        collectionItems.condition,
        collectionItems.isProxy,
        collectionItems.binderLocation,
        collectionItems.language,
      ],
      set: {
        // Reference `excluded` (the row that would have been inserted)
        // rather than interpolating `request.quantity` as a literal - same
        // reasoning as the bulk-cards upsert: correct even if this ever
        // becomes a batch operation.
        quantity: sql`${collectionItems.quantity} + excluded.quantity`,
        updatedAt: now,
      },
    })
    .run();

  const merged = findStack(request);
  if (!merged) throw new Error("collection item vanished immediately after upsert");
  return merged;
}

export type UpdateCollectionItemResult =
  | { outcome: "updated"; row: CollectionItemRow }
  | { outcome: "not_found" }
  | { outcome: "conflict" };

/**
 * A patch that touches any stack-identity column can collide with a
 * different existing row (e.g. changing condition to match an already-owned
 * NM copy) - reported as a conflict rather than silently merging, since
 * merging-on-update would need to combine quantities and the caller hasn't
 * asked for that.
 */
export function updateCollectionItem(
  id: string,
  patch: UpdateCollectionItemRequest,
): UpdateCollectionItemResult {
  const existing = getCollectionItem(id);
  if (!existing) return { outcome: "not_found" };

  try {
    db.update(collectionItems)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(collectionItems.id, id))
      .run();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { outcome: "conflict" };
    }
    throw error;
  }

  const row = getCollectionItem(id);
  if (!row) throw new Error("collection item vanished immediately after update");
  return { outcome: "updated", row };
}

export function deleteCollectionItem(id: string): boolean {
  const existing = getCollectionItem(id);
  if (!existing) return false;
  db.delete(collectionItems).where(eq(collectionItems.id, id)).run();
  return true;
}
