import type { ScryfallCard } from "@mtg/schemas";
import type { NewCardRow } from "../db/schema";

/**
 * Maps a validated Scryfall card object to a DB row. Pure and synchronous so
 * it's cheap to unit test without touching the network or the database.
 * Field names diverge deliberately from Scryfall's (`set` -> `setCode`) -
 * this is the one place that mapping happens.
 */
export function toCardRow(card: ScryfallCard, now: Date): NewCardRow {
  return {
    id: card.id,
    oracleId: card.oracle_id ?? null,
    name: card.name,
    layout: card.layout,
    manaCost: card.mana_cost ?? null,
    cmc: card.cmc,
    typeLine: card.type_line,
    oracleText: card.oracle_text ?? null,
    colors: card.colors ?? null,
    colorIdentity: card.color_identity,
    keywords: card.keywords,
    legalities: card.legalities,
    games: card.games,
    reserved: card.reserved,
    setCode: card.set,
    setName: card.set_name,
    setType: card.set_type,
    collectorNumber: card.collector_number,
    rarity: card.rarity,
    releasedAt: card.released_at,
    artist: card.artist ?? null,
    borderColor: card.border_color,
    frame: card.frame,
    fullArt: card.full_art,
    textless: card.textless,
    promo: card.promo,
    variation: card.variation,
    finishes: card.finishes,
    cardFaces: card.card_faces ?? null,
    imageUris: card.image_uris ?? null,
    scryfallUri: card.scryfall_uri,
    prices: card.prices,
    createdAt: now,
    updatedAt: now,
  };
}
