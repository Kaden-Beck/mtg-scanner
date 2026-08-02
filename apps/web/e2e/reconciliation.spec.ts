import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Seeds an unresolved row via the real import API (a CSV row with no
// candidate printings) rather than touching the DB directly, so this
// exercises the same path a real import would take. The dev server's DB
// isn't reset between runs, and KAD-13's duplicate-file detection hashes
// file content - a random id keeps csvText unique per run so a re-run
// never collides with a prior run's completed import batch.
test("dismisses an unresolved reconciliation row (AC3)", async ({ page, request }) => {
  const scryfallId = randomUUID();
  const importResponse = await request.post("/api/import/archidekt", {
    data: {
      fileName: "e2e-collection.csv",
      csvText: `Scryfall ID,Quantity\n${scryfallId},1\n`,
    },
  });
  expect(importResponse.ok()).toBe(true);

  await page.goto("/reconciliation");
  await expect(page.getByText("Scryfall ID not found in the card database")).toBeVisible();
  await expect(page.getByText(scryfallId)).toBeVisible();

  await page.getByRole("checkbox", { name: "Select for bulk dismiss" }).first().check();
  await page.getByRole("button", { name: "Dismiss selected" }).click();

  await expect(page.getByText("Nothing to review.")).toBeVisible();
});
