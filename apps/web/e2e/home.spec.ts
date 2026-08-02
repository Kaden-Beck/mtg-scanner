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
  await expect(page.getByRole("button", { name: "Sync now" })).toBeEnabled();
});
