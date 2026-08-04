import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { type CorpusEntry, type CorpusManifest, corpusManifestSchema } from "@mtg/corpus";
import {
  applySticky,
  buildEntry,
  DEFAULT_STICKY,
  formatSticky,
  parseLabelInput,
  pendingImages,
  type StickyStrata,
  stickyFromLastEntry,
} from "./labeling.ts";
import { findPrinting, suggestSets } from "./lookup.ts";

/**
 * `pnpm corpus:label` (KAD-36) - the interactive labeller.
 *
 * Thin on purpose: parsing lives in `labeling.ts` and lookups in
 * `lookup.ts`, both of which have real tests. What is left here is I/O and
 * the prompt loop, which a test could only assert by re-implementing.
 *
 * Writes after **every** entry rather than on exit. 400 photographs is
 * several sittings, and losing an hour of labelling to a closed terminal
 * would be the kind of thing that stops the corpus being finished at all.
 */

const CORPUS_DIR = new URL("../../../../../tests/corpus/", import.meta.url).pathname;
const IMAGES_DIR = `${CORPUS_DIR}images`;
const LABELS_PATH = `${CORPUS_DIR}labels.json`;

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic"];

function listImages(): string[] {
  if (!existsSync(IMAGES_DIR)) return [];
  return readdirSync(IMAGES_DIR)
    .filter((name) => IMAGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))
    .sort()
    .map((name) => `images/${name}`);
}

function loadManifest(): CorpusManifest {
  if (!existsSync(LABELS_PATH)) {
    return { version: 1, capture: "", entries: [] };
  }
  return corpusManifestSchema.parse(JSON.parse(readFileSync(LABELS_PATH, "utf8")));
}

function save(manifest: CorpusManifest): void {
  writeFileSync(LABELS_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function help(): void {
  console.log(`
  <set> <number>            label the current photo, e.g.  dom 168
  <set> <number> foil lp    ...and change strata (they stick until changed)
  # some note               trailing note, e.g.  dom 168 # glare top-left
  skip / s                  skip this photo (marker shots, bad frames)
  back / b                  remove the previous entry and redo it
  ?                         show the current sticky strata
  quit / q                  save and exit (resumable)
`);
}

async function main(): Promise<void> {
  const images = listImages();
  if (images.length === 0) {
    console.log(`No images found in ${IMAGES_DIR}`);
    console.log("Copy your photographs there first - see inital-scan-plan.md.");
    return;
  }

  const manifest = loadManifest();
  let sticky: StickyStrata = stickyFromLastEntry(manifest.entries) ?? { ...DEFAULT_STICKY };

  console.log(
    `${String(images.length)} photos, ${String(manifest.entries.length)} already labelled.`,
  );
  help();
  console.log(`  sticky: ${formatSticky(sticky)}\n`);

  let queue = pendingImages(images, manifest.entries);

  // Iterated as a line stream rather than driven by `rl.question`, which
  // never settles once stdin closes - so a Ctrl+D (or a piped script) would
  // hang forever instead of saving and exiting. `for await` ends cleanly on
  // EOF and behaves identically when a human is typing.
  const prompt = (): string =>
    `[${String(manifest.entries.length + 1)}/${String(images.length)}] ${queue[0] ?? ""} > `;

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: prompt() });
  rl.prompt();

  /** Handles one line. Returns false when the loop should end. */
  function handleLine(answer: string): boolean {
    const image = queue[0];
    if (!image) return false;

    const parsed = parseLabelInput(answer);

    if (parsed.kind === "error") {
      console.log(`  ${parsed.message}`);
      return true;
    }

    if (parsed.kind === "command") {
      if (parsed.command === "quit") return false;
      if (parsed.command === "help") {
        help();
        console.log(`  sticky: ${formatSticky(sticky)}\n`);
        return true;
      }
      if (parsed.command === "skip") {
        queue = queue.slice(1);
        return true;
      }
      // back: drop the last entry and put its photo at the front of the
      // queue. Cheap because the manifest is the only state.
      const removed = manifest.entries.pop();
      if (removed) {
        save(manifest);
        queue = [removed.image, ...queue];
        console.log(`  removed ${removed.image} (${removed.name})`);
      } else {
        console.log("  nothing to undo");
      }
      return true;
    }

    const resolved = findPrinting(parsed.setCode, parsed.collectorNumber);
    if (!resolved) {
      console.log(`  No printing "${parsed.setCode} ${parsed.collectorNumber}".`);
      const suggestions = suggestSets(parsed.collectorNumber);
      if (suggestions.length > 0) {
        console.log(`  Sets with a #${parsed.collectorNumber}: ${suggestions.join(", ")}`);
      }
      return true;
    }

    sticky = applySticky(sticky, parsed.strata);

    const built = buildEntry({
      image,
      card: resolved.card,
      sticky,
      sharedArt: resolved.sharedArt,
      notes: parsed.notes,
    });
    if (!built.ok) {
      console.log(`  ${built.message}`);
      return true;
    }

    manifest.entries.push(built.entry);
    save(manifest);
    queue = queue.slice(1);

    const flags = [
      built.entry.finish,
      built.entry.condition,
      built.entry.sleeve === "none" ? "unsleeved" : built.entry.sleeve,
      built.entry.lighting,
      built.entry.frame,
      resolved.sharedArt ? "SHARED ART" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`  ${built.entry.name} [${built.entry.setCode}] — ${flags}`);
    return true;
  }

  for await (const answer of rl) {
    if (!handleLine(answer)) break;
    if (queue.length === 0) break;
    rl.setPrompt(prompt());
    rl.prompt();
  }

  rl.close();
  save(manifest);
  console.log(`\nSaved ${String(manifest.entries.length)} entries to ${LABELS_PATH}`);
  console.log("Run `pnpm corpus:validate` to check coverage.");
}

await main();
