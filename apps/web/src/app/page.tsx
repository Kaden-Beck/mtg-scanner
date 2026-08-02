import { triggerCardSync } from "@/server/sync/actions";
import { getSyncStatuses, type SyncStatusView } from "@/server/sync/status";
import { formatDateTime, statusBadgeClass, statusLabel } from "./sync-status-format";

function SyncRow({ view }: { view: SyncStatusView }) {
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
        </div>
        <dl className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <span>Last synced: {formatDateTime(view.lastSyncedAt)}</span>
          {view.rowCount !== null && <span> · {view.rowCount.toLocaleString()} rows</span>}
          {view.errorMessage && (
            <div className="mt-1 text-red-700 dark:text-red-400">{view.errorMessage}</div>
          )}
        </dl>
      </div>
      {view.syncType === "cards" ? (
        <form action={triggerCardSync}>
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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">MTG Scanner</h1>

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
