# ADR-004: Deck allocation is advisory, not reservation

## Status

Accepted (2026-08-04). Resolves **PRD Q2**. Unblocks KAD-33; shapes KAD-35.

## Context

`deck_allocations` (KAD-26) shipped in Sprint 5 as a deliberate stub — the
shape both readings of Q2 share, and no behavior. Q2 is:

> Does allocating a card to a deck *reserve* the physical copy, making it
> unavailable to other decks, or is it advisory only?

The two answers want materially different tables. A reservation model needs
`SUM(quantity)` per `collection_item_id` constrained against
`collection_items.quantity`, enforced at write time. An advisory model needs
no such constraint and tolerates deliberate overlap.

The distinction is not academic. This is a single-user app for one person's
paper collection, and the real workflow it has to survive is:

- One Sol Ring, four Commander decks that all want it. The user knows this.
  They are not going to buy three more; they swap it in on the night.
- A deck sits assembled in a box for months while its cards are also listed
  in two brews that exist only as lists.
- Cards move between decks physically without anyone updating the app first,
  so the database is *always* behind reality by some amount.

A reservation model treats each of those as an error to be prevented. It
would make the common case — brewing a list that overlaps a built deck —
into a write failure the user has to resolve by de-allocating something
before they can continue typing card names. That inverts the tool's job:
the user is not asking permission to brew, they are asking what it would
cost them to build.

## Decision

**Allocation is advisory.** Specifically:

1. Allocating a copy to a deck never fails on account of another deck's
   claim. There is no over-allocation constraint, trigger, or `CHECK`.
2. Over-allocation is a **first-class, expected state**, not corruption. The
   sum of allocations against a stack may legitimately exceed the stack's
   quantity.
3. The app's obligation is to **surface** the conflict, clearly and with the
   competing deck named (KAD-33 AC2) — not to prevent it.
4. `deck_allocations` keeps the Sprint 5 shape unchanged. No migration.

Allocation therefore means "this deck intends to use this physical copy,"
not "this deck holds a lock on it."

### What this means for KAD-35

"Owned only" build mode filters to **owned** inventory, not to *unallocated*
inventory. A card the user owns but has already promised to another deck is
still a legal result — it is shown, and it is shown with its conflict. Under
a reservation model this filter would have been set subtraction; here it is
a filter plus an annotation.

Ranking may de-prioritise already-claimed copies so the genuinely free ones
surface first. That is a sort key, never an exclusion.

## Consequences

- **Conflict detection is a read-time query, not a write-time constraint.**
  It reads `deck_allocations` by `collection_item_id` — which is exactly the
  direction the index KAD-26 added anticipates.
- **Nothing can wedge.** There is no state the user can reach where they
  must undo an allocation before making an unrelated edit. Deleting a deck
  cascades its allocations away and other decks' conflicts simply resolve.
- **The UI carries the weight.** Because the database will not stop the
  user, a conflict that is not rendered is a conflict that does not exist as
  far as they are concerned. Conflict display is load-bearing, not
  decorative, and is tested as such.
- **Accepted cost: the app cannot promise a deck is physically assemblable.**
  Two decks can both report "fully owned" while sharing one copy. That is
  correct under advisory semantics — each *is* fully owned — but it means
  "owned" never means "available right now." KAD-33's conflict summary is
  the only thing that answers the availability question, so it must be
  reachable from anywhere "owned" is claimed.
- **Reversible.** Moving to reservation later is additive: the table already
  carries `quantity`, so it needs a constraint and a de-allocation flow, not
  a reshape. Nothing in this decision forecloses that.

## Alternatives considered

**Hard reservation.** Rejected: turns the most common brewing action into a
blocking error, and forces bookkeeping (de-allocate deck A before deck B can
claim) that buys a guarantee the physical world does not honor anyway — the
cards move without the app's involvement.

**Derive allocations from `deck_cards`, drop the table.** Cheaper: conflict
becomes "total quantity across all decks' `deck_cards` exceeds
`collection_items` quantity for that printing." Rejected because it can only
reason at printing level, discarding the per-copy condition and binder
location that KAD-21 and KAD-22 shipped. "Which of my three Sol Rings — the
NM one in Binder 2 or the played one in the bulk box — is in this deck" is a
question the user will ask, and a derived model cannot answer it.
