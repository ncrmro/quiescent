import { test } from "@playwright/test";

test("viewer can login and logout", async ({ page }) => {

  await page.goto("/");
}

