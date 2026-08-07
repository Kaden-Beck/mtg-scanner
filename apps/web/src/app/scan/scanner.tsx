"use client";

import { detectFoilCard, recognizeCardTitle, recognizeCollectorNumber } from "@mtg/scan-ocr";
import {
  CONDITIONS,
  type Condition,
  conditionSchema,
  type Finish,
  finishSchema,
  type ScanResolvedCard,
} from "@mtg/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyScanFocus,
  buildVideoConstraints,
  listVideoInputs,
  readStoredDeviceId,
  writeStoredDeviceId,
} from "./camera";
import { rgbaFromVideoGuide, SCAN_GUIDE_INSET } from "./capture-frame";
import {
  DEFAULT_SCAN_SESSION,
  type FinishDefault,
  readScanSession,
  resolveCommitFinish,
  type ScanSessionEntry,
  type ScanSessionState,
  withDefaults,
  withEntryAppended,
  withEntryRemoved,
  writeScanSession,
} from "./session";
import { createTesseractEngine, rgbaFromImageSource } from "./tesseract-engine";

type Phase = "live" | "identifying" | "confirm" | "committing" | "done" | "camera_denied";

function isResolveOk(body: unknown): body is { ok: true; card: ScanResolvedCard } {
  if (typeof body !== "object" || body === null) return false;
  if (!("ok" in body) || body.ok !== true) return false;
  if (!("card" in body) || typeof body.card !== "object" || body.card === null) return false;
  return true;
}

function isResolveMiss(body: unknown): body is { ok: false; suggestions: string[] } {
  if (typeof body !== "object" || body === null) return false;
  return "ok" in body && body.ok === false;
}

function isCommitOk(body: unknown): body is { item: { id: string }; quantityAdded: number } {
  if (typeof body !== "object" || body === null) return false;
  if (!("item" in body) || typeof body.item !== "object" || body.item === null) return false;
  if (!("id" in body.item) || typeof body.item.id !== "string") return false;
  if (!("quantityAdded" in body) || typeof body.quantityAdded !== "number") return false;
  return true;
}

export function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<ReturnType<typeof createTesseractEngine> | null>(null);

  const [phase, setPhase] = useState<Phase>("live");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<ScanResolvedCard | null>(null);
  const [finish, setFinish] = useState<Finish>("nonfoil");
  const [foilLikely, setFoilLikely] = useState(false);
  const [manualSet, setManualSet] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Always start with defaults so the panel is visible on first paint / SSR.
  // sessionStorage is applied in an effect (may throw on some mobile browsers).
  const [session, setSession] = useState<ScanSessionState>(DEFAULT_SCAN_SESSION);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(
    async (preferredId: string | null) => {
      stopStream();
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildVideoConstraints(preferredId),
        });
        const track = stream.getVideoTracks()[0];
        if (track) {
          await applyScanFocus(track);
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const all = await navigator.mediaDevices.enumerateDevices();
        const videos = listVideoInputs(all);
        setDevices(videos);
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? preferredId;
        if (activeId) {
          setDeviceId(activeId);
          writeStoredDeviceId(localStorage, activeId);
        }
        setPhase("live");
      } catch {
        setPhase("camera_denied");
        setError("Camera permission denied or unavailable. You can upload a photo instead.");
      }
    },
    [stopStream],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setSession(readScanSession(sessionStorage));
      } catch {
        setSession(DEFAULT_SCAN_SESSION);
      }
      let stored: string | null = null;
      try {
        stored = readStoredDeviceId(localStorage);
      } catch {
        stored = null;
      }
      void startCamera(stored);
    }, 0);
    return () => {
      clearTimeout(timer);
      stopStream();
    };
  }, [startCamera, stopStream]);

  function updateSession(next: ScanSessionState) {
    setSession(next);
    writeScanSession(sessionStorage, next);
  }

  async function resolveSetNumber(
    setCode: string,
    collectorNumber: string | undefined,
    likelyFoil: boolean,
    name?: string,
  ): Promise<boolean> {
    const response = await fetch("/api/scan/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setCode,
        ...(collectorNumber ? { collectorNumber } : {}),
        ...(name ? { name } : {}),
      }),
    });
    const body: unknown = await response.json();
    if (isResolveOk(body)) {
      setCard(body.card);
      setFoilLikely(likelyFoil);
      const defaults = session.defaults;
      setFinish(resolveCommitFinish(defaults, likelyFoil));
      setSuggestions([]);
      setPhase("confirm");
      return true;
    }
    if (isResolveMiss(body)) {
      setSuggestions(body.suggestions);
      const label = collectorNumber
        ? `${setCode.toUpperCase()} · ${collectorNumber}`
        : `${setCode.toUpperCase()} · ${name ?? "?"}`;
      setError(`No printing matched ${label}. Try Manual lookup if OCR misread the strip.`);
      setPhase("live");
      return false;
    }
    setError("Could not resolve this card.");
    setPhase("live");
    return false;
  }

  async function identifyFromRgba(image: ReturnType<typeof rgbaFromImageSource>) {
    setPhase("identifying");
    setError(null);
    setSuggestions([]);
    try {
      engineRef.current ??= createTesseractEngine();
      const likelyFoil = detectFoilCard(image);
      const result = await recognizeCollectorNumber(image, {
        engine: engineRef.current,
      });
      const setCode = result.best?.parsed.setCode;
      const collectorNumber = result.best?.parsed.collectorNumber;
      const foil = likelyFoil || result.foilLikely;

      if (setCode && collectorNumber) {
        const ok = await resolveSetNumber(setCode, collectorNumber, foil);
        if (ok) return;
        // CN looked plausible but missed — try title + set (modern strip noise).
        const title = await recognizeCardTitle(image, {
          engine: engineRef.current,
          preprocessMode: result.preprocessMode,
        });
        if (title.name) {
          const named = await resolveSetNumber(setCode, undefined, foil, title.name);
          if (named) return;
        }
        return;
      }

      if (setCode) {
        const title = await recognizeCardTitle(image, {
          engine: engineRef.current,
          preprocessMode: result.preprocessMode,
        });
        if (title.name) {
          const named = await resolveSetNumber(setCode, undefined, foil, title.name);
          if (named) return;
        }
      }

      setError(
        result.best?.attempt.text
          ? `Could not parse collector number from “${result.best.attempt.text.trim()}”. Enter set and number manually.`
          : "OCR found no collector number. Enter set and number manually.",
      );
      setPhase("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Identification failed.");
      setPhase("live");
    }
  }

  async function captureFromVideo() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setError("Camera is not ready yet.");
      return;
    }
    // Sample the guide overlay region (object-cover + inset), not the raw
    // sensor buffer — otherwise CN crops read artist / language chrome.
    const image = rgbaFromVideoGuide(video, SCAN_GUIDE_INSET);
    await identifyFromRgba(image);
  }

  async function onFileSelected(file: File | undefined) {
    if (!file) return;
    setPhase("identifying");
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const image = rgbaFromImageSource(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      await identifyFromRgba(image);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
      setPhase(phase === "camera_denied" ? "camera_denied" : "live");
    }
  }

  async function onManualResolve(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!manualSet.trim() || !manualNumber.trim()) return;
    setPhase("identifying");
    const defaults = session.defaults;
    const likelyFoil =
      defaults.finish === "foil" || (defaults.finish === "auto" && finish === "foil");
    await resolveSetNumber(manualSet.trim(), manualNumber.trim(), likelyFoil);
  }

  function parseFinish(value: string): Finish {
    const parsed = finishSchema.safeParse(value);
    return parsed.success ? parsed.data : "nonfoil";
  }

  function parseFinishDefault(value: string): FinishDefault {
    if (value === "auto") return "auto";
    return parseFinish(value);
  }

  function parseCondition(value: string): Condition {
    const parsed = conditionSchema.safeParse(value);
    return parsed.success ? parsed.data : "NM";
  }

  async function onCommit() {
    if (!card) return;
    setPhase("committing");
    setError(null);
    try {
      const response = await fetch("/api/scan/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scryfallId: card.scryfallId,
          finish,
          condition: session.defaults.condition,
          quantity: 1,
          binderLocation: session.defaults.binderLocation,
        }),
      });
      if (!response.ok) {
        setError("Commit failed.");
        setPhase("confirm");
        return;
      }
      const body: unknown = await response.json();
      if (!isCommitOk(body)) {
        setError("Commit failed.");
        setPhase("confirm");
        return;
      }
      const entry: ScanSessionEntry = {
        id: crypto.randomUUID(),
        collectionItemId: body.item.id,
        scryfallId: card.scryfallId,
        name: card.name,
        setCode: card.setCode,
        collectorNumber: card.collectorNumber,
        finish,
        condition: session.defaults.condition,
        quantityDelta: body.quantityAdded,
        committedAt: new Date().toISOString(),
      };
      updateSession(withEntryAppended(session, entry));
      setCard(null);
      setPhase("live");
    } catch {
      setError("Commit failed.");
      setPhase("confirm");
    }
  }

  async function onUndo(entry: ScanSessionEntry) {
    setUndoingId(entry.id);
    setError(null);
    try {
      const response = await fetch("/api/scan/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionItemId: entry.collectionItemId,
          quantityDelta: entry.quantityDelta,
        }),
      });
      if (!response.ok && response.status !== 404) {
        setError("Undo failed.");
        return;
      }
      updateSession(withEntryRemoved(session, entry.id));
    } catch {
      setError("Undo failed.");
    } finally {
      setUndoingId(null);
    }
  }

  async function onDeviceChange(nextId: string) {
    setDeviceId(nextId);
    writeStoredDeviceId(localStorage, nextId);
    await startCamera(nextId);
  }

  const defaults = session.defaults;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Session defaults"
        className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
      >
        <h2 className="text-sm font-medium">Session defaults</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Condition</span>
            <select
              className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              value={defaults.condition}
              onChange={(e) => {
                updateSession(withDefaults(session, { condition: parseCondition(e.target.value) }));
              }}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Finish</span>
            <select
              className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              value={defaults.finish}
              onChange={(e) => {
                updateSession(
                  withDefaults(session, { finish: parseFinishDefault(e.target.value) }),
                );
              }}
            >
              <option value="auto">Auto (foil detect)</option>
              <option value="nonfoil">Nonfoil</option>
              <option value="foil">Foil</option>
              <option value="etched">Etched</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-1">
            <span className="text-zinc-600 dark:text-zinc-400">Binder</span>
            <input
              aria-label="Binder location"
              placeholder="Optional"
              value={defaults.binderLocation}
              onChange={(e) => {
                updateSession(withDefaults(session, { binderLocation: e.target.value }));
              }}
              className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
      </section>

      {phase !== "camera_denied" && (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="aspect-[3/4] w-full object-cover" playsInline muted />
          <div
            aria-hidden
            className="pointer-events-none absolute rounded border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
            style={{ inset: `${SCAN_GUIDE_INSET * 100}%` }}
          >
            {/* CN / set strip target — get this corner large and sharp. */}
            <div className="absolute bottom-[2%] left-[2%] h-[14%] w-[42%] rounded-sm border-2 border-amber-300 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" />
          </div>
          <p className="pointer-events-none absolute bottom-3 left-0 right-0 px-3 text-center text-xs text-white/90">
            Get close — fill the yellow box with the set/number text
          </p>
        </div>
      )}

      {phase === "camera_denied" && (
        <div
          role="alert"
          aria-label="Camera unavailable"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {error}
        </div>
      )}

      {devices.length > 1 && phase !== "camera_denied" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Camera</span>
          <select
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            value={deviceId ?? ""}
            onChange={(e) => {
              void onDeviceChange(e.target.value);
            }}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-2">
        {phase !== "camera_denied" && (
          <button
            type="button"
            disabled={phase === "identifying" || phase === "committing"}
            onClick={() => {
              void captureFromVideo();
            }}
            className="w-full rounded-md bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {phase === "identifying" ? "Reading…" : "Capture"}
          </button>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-md border border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-700"
        >
          Upload photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onFileSelected(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {error && phase !== "camera_denied" && (
        <p role="alert" aria-label="Scan error" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {suggestions.length > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sets with that number: {suggestions.join(", ")}
        </p>
      )}

      {(phase === "confirm" || phase === "committing") && card && (
        <section
          aria-label="Confirm scanned card"
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div>
            <h2 className="text-lg font-medium">{card.name}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {card.setCode.toUpperCase()} · {card.collectorNumber}
              {card.sharedArt ? " · shared art" : ""}
              {foilLikely ? " · foil likely" : ""}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Commits as {defaults.condition}
              {defaults.binderLocation ? ` · ${defaults.binderLocation}` : ""}
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Finish</span>
            <select
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              value={finish}
              onChange={(e) => {
                setFinish(parseFinish(e.target.value));
              }}
            >
              <option value="nonfoil">Nonfoil</option>
              <option value="foil">Foil</option>
              <option value="etched">Etched</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={phase === "committing"}
              onClick={() => {
                void onCommit();
              }}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Add to collection
            </button>
            <button
              type="button"
              onClick={() => {
                setCard(null);
                setPhase("live");
              }}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {session.entries.length > 0 && (
        <section aria-label="Session commits" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">This session ({session.entries.length})</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {session.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.name}</p>
                  <p className="text-xs text-zinc-500">
                    {entry.setCode.toUpperCase()} · {entry.collectorNumber} · {entry.finish} ·{" "}
                    {entry.condition}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Undo ${entry.name}`}
                  disabled={undoingId === entry.id}
                  onClick={() => {
                    void onUndo(entry);
                  }}
                  className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
                >
                  {undoingId === entry.id ? "…" : "Undo"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Manual lookup</h2>
        <div className="flex gap-2">
          <input
            aria-label="Set code"
            placeholder="Set"
            value={manualSet}
            onChange={(e) => {
              setManualSet(e.target.value);
            }}
            className="w-24 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            aria-label="Collector number"
            placeholder="Number"
            value={manualNumber}
            onChange={(e) => {
              setManualNumber(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onManualResolve({ preventDefault() {} });
              }
            }}
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={() => {
              void onManualResolve({ preventDefault() {} });
            }}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            Look up
          </button>
        </div>
      </div>
    </div>
  );
}
