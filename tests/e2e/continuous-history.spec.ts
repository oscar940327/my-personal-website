import { expect, test } from "@playwright/test";

const ownerId = "61c2f4ca-2fab-4b50-a0cf-12aac0ec0b24";

function unsignedAccessToken(subject: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: subject,
  })}.c2ln`;
}

function entry(
  id: string,
  ownerDate: string,
  entryAt: string,
  originalContent: string,
) {
  return {
    created_at: entryAt,
    current_revision_id: `${id}-revision`,
    entry_at: entryAt,
    id,
    original_content: originalContent,
    owner_date: ownerDate,
    processing_state: "pending",
    revision_number: 1,
  };
}

test("owner incrementally browses both directions without losing the reading anchor", async ({
  page,
}) => {
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "history-refresh-token",
          token_type: "bearer",
          user: {
            app_metadata: {},
            aud: "authenticated",
            created_at: new Date().toISOString(),
            id: userId,
            user_metadata: {},
          },
        }),
      );
    },
    { ownerAccessToken: accessToken, userId: ownerId },
  );
  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { service: "diary-api", status: "ready" },
      status: 200,
    });
  });
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { owner_id: ownerId, status: "authenticated" },
      status: 200,
    });
  });

  const completeAnchorContent =
    "Past anchor complete Original Content.\n" +
    "Every line remains visible while adjacent dates load.\n".repeat(8);
  const historyRequests: URL[] = [];
  await page.route("**/entries/history**", async (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url);
    const direction = url.searchParams.get("direction");
    const cursor = url.searchParams.get("cursor");

    if (direction === "newer" && cursor === "newer-page") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-24",
          groups: [
            {
              date: "2026-07-26",
              entries: [
                entry(
                  "newer-26",
                  "2026-07-26",
                  "2026-07-26T04:00:00Z",
                  "Newer date content.",
                ),
              ],
            },
            {
              date: "2026-07-25",
              entries: [
                entry(
                  "newer-25",
                  "2026-07-25",
                  "2026-07-25T04:00:00Z",
                  "Adjacent newer content.",
                ),
              ],
            },
          ],
          newer_cursor: null,
          older_cursor: "back-to-anchor",
        },
        status: 200,
      });
      return;
    }

    if (direction === "older" && cursor === "older-page") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-24",
          groups: [
            {
              date: "2026-07-22",
              entries: [
                entry(
                  "older-22",
                  "2026-07-22",
                  "2026-07-22T04:00:00Z",
                  "Older date content.",
                ),
              ],
            },
          ],
          newer_cursor: "back-to-anchor",
          older_cursor: null,
        },
        status: 200,
      });
      return;
    }

    expect(url.searchParams.get("anchor_date")).toBe("2026-07-24");
    expect(direction).toBeNull();
    expect(cursor).toBeNull();
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-07-24",
        groups: [
          {
            date: "2026-07-24",
            entries: [
              entry(
                "anchor-24",
                "2026-07-24",
                "2026-07-24T04:00:00Z",
                completeAnchorContent,
              ),
            ],
          },
          {
            date: "2026-07-23",
            entries: [
              entry(
                "anchor-23",
                "2026-07-23",
                "2026-07-23T04:00:00Z",
                "Previous date in the initial bounded page.",
              ),
            ],
          },
        ],
        newer_cursor: "newer-page",
        older_cursor: "older-page",
      },
      status: 200,
    });
  });
  await page.route("**/entries/today", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { date: "2026-07-24", entries: [] },
      status: 200,
    });
  });

  await page.goto("diary.html?date=2026-07-24");

  await expect(
    page.getByRole("heading", { name: "History" }),
  ).toBeVisible();
  await expect(
    page.getByText(completeAnchorContent, { exact: true }),
  ).toBeVisible();
  expect(historyRequests.length).toBeGreaterThanOrEqual(1);
  expect(
    historyRequests.every(
      (url) => url.searchParams.get("direction") === null,
    ),
  ).toBe(true);

  const readingEntry = page.locator("#entry-anchor-24");
  await readingEntry.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
  const beforePrepend = await readingEntry.evaluate(
    (element) => element.getBoundingClientRect().top,
  );

  await page
    .getByRole("button", { name: "Load newer Entries" })
    .evaluate((button: HTMLButtonElement) => button.click());

  await expect(page.getByText("Newer date content.")).toBeVisible();
  await expect
    .poll(() =>
      readingEntry.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    )
    .toBeCloseTo(beforePrepend, 0);

  const beforeAppend = await readingEntry.evaluate(
    (element) => element.getBoundingClientRect().top,
  );

  await page
    .getByRole("button", { name: "Load older Entries" })
    .evaluate((button: HTMLButtonElement) => button.click());

  await expect(page.getByText("Older date content.")).toBeVisible();
  await expect
    .poll(() =>
      readingEntry.evaluate(
        (element) => element.getBoundingClientRect().top,
      ),
    )
    .toBeCloseTo(beforeAppend, 0);
  const incrementalRequests = historyRequests.filter(
    (url) => url.searchParams.get("direction") !== null,
  );
  expect(
    incrementalRequests.map((url) => [
      url.searchParams.get("direction"),
      url.searchParams.get("cursor"),
    ]),
  ).toEqual([
    ["newer", "newer-page"],
    ["older", "older-page"],
  ]);
  await expect(
    page.getByRole("button", { name: "New Entry" }),
  ).toBeVisible();
});

test("scrolling near the older boundary incrementally reveals older history", async ({
  page,
}) => {
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "scroll-history-refresh-token",
          token_type: "bearer",
          user: {
            app_metadata: {},
            aud: "authenticated",
            created_at: new Date().toISOString(),
            id: userId,
            user_metadata: {},
          },
        }),
      );
    },
    { ownerAccessToken: accessToken, userId: ownerId },
  );
  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { service: "diary-api", status: "ready" },
      status: 200,
    });
  });
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { owner_id: ownerId, status: "authenticated" },
      status: 200,
    });
  });

  let olderRequests = 0;
  await page.route("**/entries/history**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("direction") === "older") {
      olderRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-28",
          groups: [
            {
              date: "2026-07-26",
              entries: [
                entry(
                  "scroll-older",
                  "2026-07-26",
                  "2026-07-26T04:00:00Z",
                  "Older content loaded near the scroll boundary.",
                ),
              ],
            },
          ],
          newer_cursor: "unused-newer",
          older_cursor: null,
        },
        status: 200,
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-07-28",
        groups: [
          {
            date: "2026-07-27",
            entries: [
              entry(
                "scroll-initial",
                "2026-07-27",
                "2026-07-27T04:00:00Z",
                `Yesterday content.\n${"Long reading content.\n".repeat(45)}`,
              ),
            ],
          },
        ],
        newer_cursor: null,
        older_cursor: "scroll-older-page",
      },
      status: 200,
    });
  });

  await page.goto("diary.html");

  await expect(
    page.getByRole("heading", { name: "Today" }),
  ).toBeVisible();
  await expect(page.locator("#entry-scroll-initial")).toBeVisible();
  expect(olderRequests).toBe(0);

  await page.mouse.wheel(0, 10_000);

  await expect(
    page.getByText(
      "Older content loaded near the scroll boundary.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(olderRequests).toBe(1);
});

test("distinct Entry Times within one millisecond keep full precision", async ({
  page,
}) => {
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "microsecond-history-refresh-token",
          token_type: "bearer",
          user: {
            app_metadata: {},
            aud: "authenticated",
            created_at: new Date().toISOString(),
            id: userId,
            user_metadata: {},
          },
        }),
      );
    },
    { ownerAccessToken: accessToken, userId: ownerId },
  );
  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { service: "diary-api", status: "ready" },
      status: 200,
    });
  });
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { owner_id: ownerId, status: "authenticated" },
      status: 200,
    });
  });
  await page.route("**/entries/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-07-29",
        groups: [
          {
            date: "2026-07-29",
            entries: [
              entry(
                "00000000-0000-0000-0000-000000000001",
                "2026-07-29",
                "2026-07-29T04:00:00.000900Z",
                "Newer microsecond Entry.",
              ),
              entry(
                "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "2026-07-29",
                "2026-07-29T04:00:00.000100Z",
                "Older microsecond Entry.",
              ),
            ],
          },
        ],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });

  await page.goto("diary.html?date=2026-07-29");

  await expect(page.locator(".diary-entry__content")).toHaveText([
    "Newer microsecond Entry.",
    "Older microsecond Entry.",
  ]);
});
