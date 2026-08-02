"use server";

import { revalidatePath } from "next/cache";
import { dismissReconciliationRows, resolveReconciliationRow } from "./reconciliation";

// Next.js requires "use server" exports to be async functions regardless of
// whether the body itself needs to await anything - both underlying calls
// are synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function resolveRowAction(rowId: string, scryfallId: string): Promise<void> {
  resolveReconciliationRow(rowId, scryfallId);
  revalidatePath("/reconciliation");
  revalidatePath("/");
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function dismissSelectedAction(formData: FormData): Promise<void> {
  const rowIds = formData.getAll("rowIds").filter((v): v is string => typeof v === "string");
  dismissReconciliationRows(rowIds);
  revalidatePath("/reconciliation");
  revalidatePath("/");
}
