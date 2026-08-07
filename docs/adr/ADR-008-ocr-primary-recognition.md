# ADR-008: OCR-primary recognition (pHash deferred)

## Status

Accepted (2026-08-07). Retargets KAD-44 as the primary scanner path; defers
KAD-39 (T0 segmentation) and KAD-40 (T1 pHash matching) for this slice.

## Context

Linear's R3 plan was a tiered pipeline: Scanic segment/unwarp (T0) → pHash
oracle matching (T1) → collector-number OCR to pick a printing (T2) → optional
VLM (T3) → top-5 UI (T4). `packages/phash`, the hash-index job, and the
corpus gate were built to support that.

Hobbyist scanners that tried full-name OCR + fuzzy matching repeatedly ripped
that complexity back out. The pattern that survived: **OCR the collector
number only**, then **exact** set+collector lookup. A fixed on-screen guide
frame replaces general-purpose card segmentation for live capture.

GrimbiXcode/mtgscan's README claimed MIT but the repo is **GPL-3.0**, so we
reimplement the *ideas* (multi-crop CN strip, foil heuristic, exact lookup)
without copying that code. Joshua-Beatty/MTG-Scanner (MIT) informs the
capture UI flow only.

## Decision

1. **Primary identifier is collector-number OCR** against a user-aligned
   guide frame, implemented in `@mtg/scan-ocr` + `/scan`.
2. **Lookup is local** via `findPrinting(set, cn)` on the SQLite `cards`
   table — no Scryfall HTTP at scan time.
3. **OCR engine v1 is Tesseract.js** (browser) behind an `OcrEngine`
   interface; PaddleOCR-VL on the ROCm worker (KAD-42/43) may replace it
   later without changing crop/score/lookup.
4. **pHash / Scanic / worker queue remain in the tree** but are not on the
   critical path for the first shippable scanner. Shared-art and pre-2015
   (no CN) cases escalate to manual entry until T4 UI / deferred tiers land.
5. Corpus harness reports this path as tier **`T2`** so metrics stay
   comparable when T1 returns later.

## Consequences

- Sprint 7 no longer blocks on a full hash-index populate.
- KAD-41's first baseline is an OCR-primary run, not T0+T1.
- Printing accuracy on shared-art cards becomes the main OCR quality signal;
  unique-art cards no longer get a free pHash win.
- Adopting GrimbiXcode *code* later would require relicensing this repo
  GPL-3.0; that is an explicit future decision, not the default.
