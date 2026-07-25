import { expect, test } from "@playwright/test";

test("owner can navigate to Diary and see that its API is ready", async ({
  page,
}) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        service: "diary-api",
        status: "ready",
      },
      status: 200,
    });
  });

  await page.goto("index.html");

  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await navigation.getByRole("link", { name: "DIARY", exact: true }).click();

  await expect(page).toHaveURL(/\/my-personal-website\/diary\.html$/);
  await expect(page.getByRole("heading", { name: "Diary" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Diary API is ready");
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("Diary shows an unavailable state when its API is not ready", async ({
  page,
}) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        service: "diary-api",
        status: "starting",
      },
      status: 503,
    });
  });

  await page.goto("diary.html");

  await expect(page.getByRole("status")).toContainText(
    "Diary API is unavailable",
  );
});

test("mobile navigation keeps Diary between Journey and MktAgent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        service: "diary-api",
        status: "ready",
      },
      status: 200,
    });
  });
  await page.goto("index.html");

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const links = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link");
  await expect(links).toHaveText([
    "HOME",
    "PROJECT",
    "JOURNEY",
    "DIARY",
    "MktAgent",
    "VideoNote",
  ]);
  await links.getByText("DIARY", { exact: true }).click();

  await expect(page).toHaveURL(/\/my-personal-website\/diary\.html$/);
  await expect(page.getByRole("heading", { name: "Diary" })).toBeVisible();
});
