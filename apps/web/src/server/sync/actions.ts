"use server";

import { revalidatePath } from "next/cache";
import { runCardSync } from "../ingest/bulk-cards";
import { runHashIndexBuild } from "../ingest/hash-index";
import { runPriceRefresh } from "../ingest/price-refresh";

export async function triggerCardSync(): Promise<void> {
  try {
    await runCardSync();
  } finally {
    // Re-render "/" with the fresh sync_state row regardless of outcome -
    // an error is itself part of the status the page shows.
    revalidatePath("/");
  }
}

export async function triggerPriceRefresh(): Promise<void> {
  try {
    await runPriceRefresh();
  } finally {
    revalidatePath("/");
  }
}

/**
 * Unlike the other two, this one runs for hours: ~47.4k images fetched,
 * hashed and discarded. It is resumable by construction - the job's work list
 * is "artworks with no row in `artwork_hashes`" - so a request that dies
 * under a proxy timeout costs only the images already in flight, and
 * triggering it again picks up where it stopped.
 */
export async function triggerHashIndexBuild(): Promise<void> {
  try {
    await runHashIndexBuild();
  } finally {
    revalidatePath("/");
  }
}
