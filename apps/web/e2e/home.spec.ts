import { expect, test } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MTG Scanner" })).toBeVisible();
});

// Doesn't actually trigger a sync - that hits live Scryfall and takes ~25s
// (verified manually against real data; see KAD-8). This checks the page
// renders sync status correctly against a fresh, never-synced DB.
test("shows an actionable setup prompt before the first successful sync (AC4)", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("Welcome! Let's set up your card database.")).toBeVisible();

  for (const label of ["Cards", "Prices", "Hash index"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  // Prices also has its own "Sync now" button as of KAD-11 - scope to the
  // Cards row specifically rather than assuming there's only one.
  const cardsRow = page.getByRole("listitem").filter({ hasText: "Cards" });
  await expect(cardsRow.getByRole("button", { name: "Sync now" })).toBeEnabled();

  const pricesRow = page.getByRole("listitem").filter({ hasText: "Prices" });
  await expect(pricesRow.getByRole("button", { name: "Sync now" })).toBeEnabled();

  // "Not yet available" until KAD-24 gave the hash index a real trigger; it
  // now has its own Sync now button like the other two. This assertion was
  // stale from that story, not from Sprint 5 - the same failure mode as the
  // Prices row getting its own button, recorded in CLAUDE.md.
  const hashIndexRow = page.getByRole("listitem").filter({ hasText: "Hash index" });
  await expect(hashIndexRow.getByRole("button", { name: "Sync now" })).toBeEnabled();
});
