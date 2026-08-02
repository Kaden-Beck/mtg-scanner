import { connection } from "next/server";
import {
  listOpenReconciliationRows,
  type ReconciliationRowView,
} from "@/server/import/reconciliation";
import { dismissSelectedAction, resolveRowAction } from "@/server/import/reconciliation-actions";
import { reasonLabel } from "./reconciliation-format";

function RawRowSummary({ rawRow }: { rawRow: Record<string, string> }) {
  const entries = Object.entries(rawRow).filter(([, value]) => value !== "");
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span className="font-medium">{key}:</span> {value}
        </div>
      ))}
    </dl>
  );
}

function CandidateButton({
  row,
  candidate,
}: {
  row: string;
  candidate: ReconciliationRowView["candidates"][number];
}) {
  const imageUrl = candidate.imageUris?.["small"];
  return (
    <button
      type="submit"
      formAction={resolveRowAction.bind(null, row, candidate.id)}
      className="flex w-40 flex-col items-center gap-1 rounded-md border border-zinc-200 p-2 text-center text-xs hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      {imageUrl ? (
        // Small fixed-size thumbnail from card image_uris - not worth
        // next/image remote-pattern config for this.
        // biome-ignore lint/performance/noImgElement: see comment above
        <img src={imageUrl} alt={candidate.name} className="rounded" />
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded bg-zinc-100 text-zinc-400 dark:bg-zinc-900">
          No image
        </div>
      )}
      <span className="font-medium">{candidate.name}</span>
      <span className="text-zinc-500">
        {candidate.setName} · #{candidate.collectorNumber}
      </span>
    </button>
  );
}

function ReconciliationRow({ row }: { row: ReconciliationRowView }) {
  return (
    <li className="border-b border-zinc-200 py-4 last:border-none dark:border-zinc-800">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          name="rowIds"
          value={row.id}
          className="mt-1.5"
          aria-label="Select for bulk dismiss"
        />
        <div className="flex-1">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {reasonLabel(row.reason)}
          </span>
          <RawRowSummary rawRow={row.rawRow} />
          {row.candidates.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {row.candidates.map((candidate) => (
                <CandidateButton key={candidate.id} row={row.id} candidate={candidate} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
              No candidate printings found.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export default async function ReconciliationPage() {
  // Same reasoning as the sync status page (KAD-9): opts this read out of
  // Cache Components' static prerendering.
  await connection();
  const rows = listOpenReconciliationRows();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Reconciliation queue</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Rows from a collection import that couldn&apos;t be resolved to exactly one printing. Pick a
        candidate to import it, or select rows and dismiss the ones you don&apos;t want.
      </p>

      {rows.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-500">Nothing to review.</p>
      ) : (
        <form action={dismissSelectedAction} className="flex flex-col gap-4">
          <ul>
            {rows.map((row) => (
              <ReconciliationRow key={row.id} row={row} />
            ))}
          </ul>
          <button
            type="submit"
            className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Dismiss selected
          </button>
        </form>
      )}
    </main>
  );
}
