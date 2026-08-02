import { assertNever } from "@mtg/schemas";
import type { SyncStatusView } from "@/server/sync/status";

export function formatDateTime(date: Date | null): string {
  if (!date) return "Never";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function statusBadgeClass(status: SyncStatusView["status"]): string {
  switch (status) {
    case "never_run":
      return "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    case "running":
      return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
    case "success":
      return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300";
    case "error":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    default:
      return assertNever(status);
  }
}

export function statusLabel(status: SyncStatusView["status"]): string {
  switch (status) {
    case "never_run":
      return "Never run";
    case "running":
      return "Running…";
    case "success":
      return "Success";
    case "error":
      return "Error";
    default:
      return assertNever(status);
  }
}
