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
  await expect(
    page.getByRole("heading", { name: "Diary", exact: true }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "Diary", exact: true }),
  ).toBeVisible();
});

test("Diary explains when a Magic Link cannot be sent", async ({ page }) => {
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
  await page.route("**/auth/v1/otp", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        message: "Signups not allowed for this instance",
      },
      status: 422,
    });
  });

  await page.goto("diary.html");
  await page.getByLabel("Owner email").fill("unknown@example.com");
  await page.getByRole("button", { name: "Send Magic Link" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "could not send the sign-in link",
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to Diary" }),
  ).toBeVisible();
});

test("Diary clears an expired restored session and explains what happened", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    window.localStorage.setItem(
      "sb-127-auth-token",
      JSON.stringify({
        access_token: "expired-owner-access-token",
        expires_at: expiresAt,
        expires_in: 3600,
        refresh_token: "unused-refresh-token",
        token_type: "bearer",
        user: {
          app_metadata: {},
          aud: "authenticated",
          created_at: new Date().toISOString(),
          id: "61c2f4ca-2fab-4b50-a0cf-12aac0ec0b24",
          user_metadata: {},
        },
      }),
    );
  });
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
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        detail: "Not authenticated",
      },
      status: 401,
    });
  });

  await page.goto("diary.html");

  await expect(page.getByRole("alert")).toContainText(
    "session expired or is not authorized",
  );
  await expect(
    page.getByRole("heading", { name: "Sign in to Diary" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("sb-127-auth-token")),
    )
    .toBeNull();
});
