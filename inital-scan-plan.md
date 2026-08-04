# Initial scan plan — shooting the golden corpus (KAD-36)

The working checklist for photographing 300–500 cards. Self-contained on
purpose: you'll be holding a phone while you read it.

`tests/corpus/README.md` is the companion reference — it covers the manifest
schema, the validation rules, and *why* each stratum exists. This file is
what to actually do.

---

## Before you start: one decision

Keep your originals regardless. The decision is whether **downscaled copies
go in git**:

- **Yes** (1200px long edge, q80, ~150–250 KB each, ~60–100 MB total) — the
  KAD-37 accuracy gate runs in CI, on every push, forever.
- **No** (current default, `tests/corpus/images/` is gitignored) — the gate
  only ever runs on your machine.

It doesn't change how you shoot. It is annoying to reverse afterwards, so
decide now. Switching is a one-line `.gitignore` change plus a resize step.

---

## Step 1 — Pull the cards first, in stratified piles

**This is the step that decides whether the corpus is any good.** Don't shoot
whatever comes to hand and hope the spread works out — pull physical piles
first.

| Pile | Count | Why |
| --- | --- | --- |
| **Shared art** | **40–60** | The critical one. See below. |
| Foils | 60+ | Hardest axis — glare wipes out whole art regions |
| Sleeved | 60+ | Mix clear and opaque-back |
| Played (LP/MP/HP/DMG) | 30+ | Whitened edges, creases |
| Old frames (pre-2015) | 20+ | 1993 / 1997 / 2003 |
| Showcase / borderless | 20+ | |
| Ordinary NM modern | remainder | Fills to 300–500 |

Piles overlap — one played foil in a clear sleeve counts toward three.

### The shared-art pile is the one to get right

Find **sets of 2–3 printings that share one illustration**: reprints,
Commander precons, Jumpstart, duplicated basics. On Scryfall they share an
`illustration_id`.

pHash physically cannot tell these apart — they are the same image. The
correct behaviour is not to guess, it's to escalate to collector-number OCR.
So these photos are the only thing that proves the tiering works at all, and
shooting *sets* rather than scattered singles is what lets the harness
distinguish "escalated and got it right" from "got lucky".

A corpus with five of them will report a healthy printing accuracy that
collapses the moment it meets your real collection.

---

## Step 2 — Sort by set before shooting

Ground truth needs set + collector number. Sorting into set piles first makes
labelling mechanical instead of 400 individual lookups.

Pre-2015 frames have **no collector number printed at all**, so you must know
the set for those — don't leave them to the end.

---

## Step 3 — Shoot

Phone, handheld, over a table. **Not** a copy stand or a lightbox: that
produces a corpus the scanner aces and reality fails.

- **One card per photo.** Multi-card frames are a later story (KAD-52).
- **Card fills most of the frame**, with visible background margin on **all
  four sides** — segmentation needs an edge to find.
- **Vary the background**: wood, cloth, playmat, cluttered table. Shooting
  everything on white teaches the segmenter to expect white.
- **Vary the angle.** Mostly overhead, but a real minority at **15–30°
  off-axis** — perspective unwarp needs something to unwarp.
- **No cropping, rotating, or colour correction afterwards.** The scanner
  won't get that help.

### Shoot in batches by lighting, not by set

This is what makes Step 4 survivable — within a session `lighting`, `sleeve`
and `finish` are usually constant, so labelling becomes fill-down rather than
per-card recall.

| Session | Target |
| --- | --- |
| Bright daylight | remainder |
| Indoor / room lamp | ~80 |
| Low light | ~40 |
| Harsh glare (desk lamp raking across foils) | ~30 |

Name files sequentially — `001.jpg`, `002.jpg`, … — into
`tests/corpus/images/`.

---

## Step 4 — Label

Copy `tests/corpus/labels.example.json` to `tests/corpus/labels.json` and
work through it.

Per entry you need:

- `scryfallId` — the exact **printing**
- `oracleId` — the **card**, shared across its printings
- `name`, `setCode`, `collectorNumber` — human-readable, for reading a
  failure report without a DB lookup
- `condition`, `finish`, `sleeve`, `frame`, `lighting` — the strata
- `sharedArt` — see Step 1
- `notes` — anything unusual about the shot

Both ids are validated as real UUIDs (version and variant nibbles included),
so a hand-typed placeholder is rejected rather than quietly accepted.

> **Accuracy here matters more than photo count.** A wrong `scryfallId`
> silently caps the accuracy the scanner can *ever* be measured at, which is
> worse than a missing photo.

---

## Step 5 — Validate as you go, not at the end

```sh
podman exec mtg-dev sh -c "cd /workspace && pnpm corpus:validate"
```

It prints a coverage table and reports **every** problem in one pass —
because fixing a corpus one error per run means re-photographing cards one
error per run.

Expect it to fail on corpus size until you're finished. That's the point:
it's your progress bar.

**Done when it exits clean.**

---

## What happens next

Once the corpus exists and a recognizer lands (T1, KAD-40), the harness runs
it and records `tests/corpus/baseline.json`. From then on CI fails any change
that drops accuracy by more than one percentage point.

If the first numbers are bad, **that is the finding, not a failure** — KAD-41
says so explicitly, and the corpus tells you exactly where it breaks.
