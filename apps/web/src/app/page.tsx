import Link from "next/link";
import type { SyncType } from "@/server/db/schema";
import { countOpenReconciliationRows } from "@/server/import/reconciliation";
import { triggerCardSync, triggerHashIndexBuild, triggerPriceRefresh } from "@/server/sync/actions";
import { getSyncStatuses, type SyncStatusView } from "@/server/sync/status";
import { formatDateTime, statusBadgeClass, statusLabel } from "./sync-status-format";

const TRIGGER_ACTIONS: Partial<Record<SyncType, () => Promise<void>>> = {
  cards: triggerCardSync,
  prices: triggerPriceRefresh,
  hash_index: triggerHashIndexBuild,
};

function SyncRow({ view }: { view: SyncStatusView }) {
  const triggerAction = view.triggerable ? TRIGGER_ACTIONS[view.syncType] : undefined;

  return (
    <li className="flex flex-col gap-2 border-b border-zinc-200 py-4 last:border-none dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{view.label}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(view.status)}`}
          >
            {statusLabel(view.status)}
          </span>
          {view.stale && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Stale
            </span>
          )}
        </div>
        <dl className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <span>Last synced: {formatDateTime(view.lastSyncedAt)}</span>
          {view.rowCount !== null && <span> · {view.rowCount.toLocaleString()} rows</span>}
          {view.errorMessage && (
            <div className="mt-1 text-red-700 dark:text-red-400">{view.errorMessage}</div>
          )}
        </dl>
        {view.syncType === "prices" && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Prices are estimates for trends only, not authoritative market values.
          </p>
        )}
        {view.syncType === "hash_index" && (
          // Said plainly, because the other two buttons on this page finish
          // in under a minute and this one does not. It is safe to interrupt
          // and safe to re-run, which is the part that makes a multi-hour
          // button reasonable to offer at all.
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Downloads and hashes roughly 47,000 card artworks - this takes hours. It picks up where
            it left off, so it is safe to stop and start again.
          </p>
        )}
      </div>
      {triggerAction ? (
        <form action={triggerAction}>
          <button
            type="submit"
            disabled={view.status === "running"}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Sync now
          </button>
        </form>
      ) : (
        <span className="text-sm text-zinc-500 dark:text-zinc-500">Not yet available</span>
      )}
    </li>
  );
}

export default async function Home() {
  const statuses = await getSyncStatuses();
  const cardsStatus = statuses.find((s) => s.syncType === "cards");
  const needsSetup = cardsStatus?.rowCount === null;
  const openReconciliationCount = countOpenReconciliationRows();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">MTG Scanner</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/scan" className="text-blue-700 hover:underline dark:text-blue-400">
            Scan
          </Link>
          <Link href="/collection" className="text-blue-700 hover:underline dark:text-blue-400">
            Browse collection
          </Link>
        </div>
      </div>

      {openReconciliationCount > 0 && (
        <Link
          href="/reconciliation"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
        >
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {openReconciliationCount} row{openReconciliationCount === 1 ? "" : "s"} need review
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Some rows from a collection import couldn&apos;t be matched to a printing. Review the
            reconciliation queue.
          </p>
        </Link>
      )}

      {needsSetup && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
          <p className="font-medium text-blue-900 dark:text-blue-200">
            Welcome! Let&apos;s set up your card database.
          </p>
          <p className="mt-1 text-sm text-blue-800 dark:text-blue-300">
            The card database hasn&apos;t been synced yet. Click &quot;Sync now&quot; next to Cards
            below to download Scryfall&apos;s card data - this takes about half a minute.
          </p>
        </div>
      )}

      <section>
        <h2 className="text-lg font-medium">Sync status</h2>
        <ul className="mt-2">
          {statuses.map((view) => (
            <SyncRow key={view.syncType} view={view} />
          ))}
        </ul>
      </section>
    </main>
  );
}
