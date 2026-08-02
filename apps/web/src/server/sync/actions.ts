"use server";

import { revalidatePath } from "next/cache";
import { runCardSync } from "../ingest/bulk-cards";

export async function triggerCardSync(): Promise<void> {
  try {
    await runCardSync();
  } finally {
    // Re-render "/" with the fresh sync_state row regardless of outcome -
    // an error is itself part of the status the page shows.
    revalidatePath("/");
  }
}
