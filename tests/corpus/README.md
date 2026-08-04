# Golden recognition corpus (KAD-36)

300–500 photographed cards with known ground truth. Everything about
recognition accuracy — the M2 target (≥90% printing accuracy, KAD-53), the
CI regression gate (KAD-37), threshold tuning — is measured against this and
nothing else.

It is being built **before any recognition code exists**, on purpose. If the
corpus came second it would be shaped, unconsciously, around what the first
implementation already happened to do well.

> **Shooting it?** Use `inital-scan-plan.md` at the repo root — that is the
> step-by-step working checklist, written to be read while holding a phone.
> This file is the reference: the manifest contract, the validation rules,
> and why each stratum is there.

## What is in this directory

| Path | In git? | What it is |
| --- | --- | --- |
| `README.md` | yes | This file. The capture protocol. |
| `labels.json` | yes | The manifest: ground truth + strata for every photo. |
| `labels.example.json` | yes | Three entries showing the shape. |
| `baseline.json` | yes | Recorded accuracy, for the KAD-37 gate. Absent until the first real run. |
| `images/` | **no** | The photographs. Gitignored — see below. |

### Why `images/` is gitignored

400 phone photos at full resolution is ~1 GB, which does not belong in a git
repo that is otherwise a few megabytes of TypeScript.

**This is a decision you should confirm before shooting**, because it is
annoying to reverse afterwards. The options:

1. **Gitignored, kept locally** (current default). Simplest. The CI gate can
   only run where the corpus exists, so it runs locally / on a self-hosted
   runner rather than on GitHub-hosted CI.
2. **Downscaled and committed.** Resize the long edge to 1200px at quality
   80 — roughly 150–250 KB each, so ~60–100 MB for the whole corpus. Large
   but survivable, and CI can run the gate anywhere. Recognition is not hurt:
   pHash reduces to a 32×32 DCT regardless, and 1200px is still generous for
   the collector-number OCR (T2).
3. **git-lfs.** Cleanest technically, another moving part to maintain.

Option 2 is the one worth taking if you want the gate to actually run in
GitHub Actions. Say so and it's a one-line `.gitignore` change plus a resize
step.

## How to shoot it

### Setup

Shoot the way the app will actually be used — a phone, handheld, over a
table. A copy stand and a lightbox would produce a corpus the scanner aces
and reality fails.

- **One card per photo.** Multi-card frames are KAD-52's problem, not this
  corpus's.
- **Card roughly fills the frame**, with a visible margin of background on
  all four sides so segmentation (T0) has an edge to find.
- **Vary the background.** Wood, cloth, a playmat, a cluttered table. A
  corpus shot entirely on white teaches segmentation to expect white.
- **Vary the angle.** Most shots roughly overhead, but include a meaningful
  minority at 15–30° off-axis — perspective unwarp is an explicit part of T0
  and needs something to unwarp.
- **Do not crop, rotate, or colour-correct afterwards.** The scanner will not
  get that help.

### The strata, and why each one is there

Every axis below is recorded per photo so accuracy can be reported *per
slice*. A corpus that is 95% accurate overall and 40% accurate on foils has
not told you the thing you needed to know — and it cannot tell you unless the
axis was recorded at capture time. Nobody can look at a photo later and
reliably say whether the card was sleeved.

`validateManifest` enforces that each axis has at least two values
represented. It cannot enforce that the split is *sensible*, so aim for the
rough targets below.

| Axis | Values | Rough target | Why it matters |
| --- | --- | --- | --- |
| `condition` | `NM` `LP` `MP` `HP` `DMG` | ≥30 below NM | Whitened edges and creases change the hash and confuse edge detection. |
| `finish` | `nonfoil` `foil` `etched` | ≥60 foil | **The hardest axis.** Foils throw coloured specular glare that can wipe out whole regions of art. |
| `sleeve` | `none` `clear` `opaque-back` | ≥60 sleeved | A sleeve adds a second set of edges for T0 to lock onto, plus its own reflections. |
| `frame` | `1993` `1997` `2003` `2015` `showcase` `borderless` | ≥20 pre-2015, ≥20 showcase/borderless | The collector-number strip that T2 reads sits in a different place on each, and old frames have none at all. |
| `lighting` | `bright` `indoor` `low` `harsh-glare` | ≥40 low, ≥30 harsh-glare | The realistic failure mode: a kitchen table at night. |
| `sharedArt` | boolean | **≥40 true** | See below. |

### `sharedArt` — the one that decides the project

Set `sharedArt: true` when the same illustration appears on more than one
printing. Reprints with reused art, most Commander-precon reprints, Jumpstart,
duplicated basics.

This is the case the AC calls out specifically, and it is the ceiling on
printing-level accuracy: **pHash physically cannot separate two printings
that share an illustration.** They are the same image. The correct behaviour
is not to guess — it is to escalate to the collector-number OCR (T2).

So these photos are what prove the tiering works at all. A corpus with five of
them will report a healthy-looking printing accuracy that collapses the moment
it meets a real collection. Shoot at least 40, and deliberately include
several *sets* of two-to-three printings that share one artwork — same art,
different set symbol and collector number — so the harness can tell
"escalated and got it right" from "got lucky".

Check Scryfall's `illustration_id`: printings sharing that value share the
artwork.

### Getting ground truth right

`scryfallId` (printing) and `oracleId` (card) both have to be exact. They are
what everything is scored against, so a wrong label is worse than a missing
photo — it silently caps the accuracy the scanner can ever be measured at.

The reliable route is Scryfall's search: find the exact printing (right set,
right collector number, right finish), then take both ids off the API
response at `https://api.scryfall.com/cards/<id>`.

Both are validated as real UUIDs, including the version and variant nibbles,
so a hand-typed placeholder will be rejected rather than quietly accepted.

## Filling in `labels.json`

Copy the shape from `labels.example.json`. Paths in `image` are relative to
this directory.

Validate as you go rather than at the end:

```sh
podman exec mtg-dev sh -c "cd /workspace && pnpm corpus:validate"
```

It reports **every** problem at once — duplicate paths, missing strata,
too-few shared-art entries, corpus size — because fixing a corpus one error
per run means re-shooting cards one error per run.

It is expected to fail on corpus size until the shoot is finished. That is
the point: it tells you how far along you are.

## After the shoot

1. `pnpm corpus:validate` clean.
2. Once a recognizer exists (KAD-40 lands T1), run the harness and record
   `baseline.json`. From then on, CI fails any change that drops accuracy by
   more than one percentage point.
