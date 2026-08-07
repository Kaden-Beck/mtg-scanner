"use client";

import { detectFoilCard, recognizeCollectorNumber } from "@mtg/scan-ocr";
import { type Finish, finishSchema, type ScanResolvedCard } from "@mtg/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildVideoConstraints,
  listVideoInputs,
  readStoredDeviceId,
  writeStoredDeviceId,
} from "./camera";
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
  const [manualSet, setManualSet] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lastCommitted, setLastCommitted] = useState<string | null>(null);

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
    // Defer so setState from getUserMedia isn't synchronous in the effect body
    // (react-hooks/set-state-in-effect) — same timer pattern as CardSearch.
    const stored = readStoredDeviceId(localStorage);
    const timer = setTimeout(() => {
      void startCamera(stored);
    }, 0);
    return () => {
      clearTimeout(timer);
      stopStream();
    };
  }, [startCamera, stopStream]);

  async function resolveSetNumber(setCode: string, collectorNumber: string, foilLikely: boolean) {
    const response = await fetch("/api/scan/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setCode, collectorNumber }),
    });
    const body: unknown = await response.json();
    if (isResolveOk(body)) {
      setCard(body.card);
      setFinish(foilLikely ? "foil" : "nonfoil");
      setSuggestions([]);
      setPhase("confirm");
      return;
    }
    if (isResolveMiss(body)) {
      setSuggestions(body.suggestions);
      setError("No printing matched that set and number.");
      setPhase("live");
      return;
    }
    setError("Could not resolve this card.");
    setPhase("live");
  }

  async function identifyFromRgba(image: ReturnType<typeof rgbaFromImageSource>) {
    setPhase("identifying");
    setError(null);
    setSuggestions([]);
    try {
      engineRef.current ??= createTesseractEngine();
      const foilLikely = detectFoilCard(image);
      const result = await recognizeCollectorNumber(image, {
        engine: engineRef.current,
      });
      const setCode = result.best?.parsed.setCode;
      const collectorNumber = result.best?.parsed.collectorNumber;
      if (!setCode || !collectorNumber) {
        setError(
          result.best?.attempt.text
            ? `Could not parse collector number from “${result.best.attempt.text.trim()}”. Enter set and number manually.`
            : "OCR found no collector number. Enter set and number manually.",
        );
        setPhase("live");
        return;
      }
      await resolveSetNumber(setCode, collectorNumber, foilLikely || result.foilLikely);
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
    const image = rgbaFromImageSource(video, video.videoWidth, video.videoHeight);
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
    await resolveSetNumber(manualSet.trim(), manualNumber.trim(), finish === "foil");
  }

  function parseFinish(value: string): Finish {
    const parsed = finishSchema.safeParse(value);
    return parsed.success ? parsed.data : "nonfoil";
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
          condition: "NM",
          quantity: 1,
        }),
      });
      if (!response.ok) {
        setError("Commit failed.");
        setPhase("confirm");
        return;
      }
      setLastCommitted(card.name);
      setCard(null);
      setPhase("live");
    } catch {
      setError("Commit failed.");
      setPhase("confirm");
    }
  }

  async function onDeviceChange(nextId: string) {
    setDeviceId(nextId);
    writeStoredDeviceId(localStorage, nextId);
    await startCamera(nextId);
  }

  return (
    <div className="flex flex-col gap-4">
      {phase !== "camera_denied" && (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="aspect-[3/4] w-full object-cover" playsInline muted />
          {/* Guide frame: user aligns the physical card to this rectangle. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[8%] rounded border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          />
          <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-white/90">
            Align the card to the frame
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

      <div className="flex flex-wrap gap-2">
        {phase !== "camera_denied" && (
          <button
            type="button"
            disabled={phase === "identifying" || phase === "committing"}
            onClick={() => {
              void captureFromVideo();
            }}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {phase === "identifying" ? "Reading…" : "Capture"}
          </button>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
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

      {lastCommitted && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          Added {lastCommitted} to collection.
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

      <form
        onSubmit={(event) => {
          void onManualResolve(event);
        }}
        className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
      >
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
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            Look up
          </button>
        </div>
      </form>
    </div>
  );
}
