import { expect, test } from "@playwright/test";

const ownerId = "61c2f4ca-2fab-4b50-a0cf-12aac0ec0b24";

function unsignedAccessToken(
  subject: string,
  lifetimeSeconds = 3600,
): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
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

test("committed Entry Time change disables stale cursors until fresh History recovery", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-07-30T12:00:00+08:00"));
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: "entry-time-recovery-refresh-token",
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

  const readingEntry = entry(
    "entry-time-recovery-reading",
    "2026-07-29",
    "2026-07-29T05:00:00.123456Z",
    "Preserved reading anchor distinct from the changed Entry.",
  );
  const movingBefore = entry(
    "entry-time-recovery-moving",
    "2026-07-29",
    "2026-07-29T04:00:00.123456Z",
    "Committed Entry Time recovery anchor.",
  );
  const movingAfter = {
    ...movingBefore,
    entry_at: "2026-07-28T01:00:00.654321Z",
    owner_date: "2026-07-28",
  };
  let mutationCommitted = false;
  let freshRebuildAttempts = 0;
  const historyRequests: URL[] = [];
  const denseRecoveryEntries = Array.from({ length: 40 }, (_, rank) =>
    entry(
      `entry-time-recovery-rank-${rank}`,
      "2026-07-28",
      `2026-07-28T12:${String(59 - rank).padStart(2, "0")}:00Z`,
      `Fresh recovery rank ${rank + 1}.`,
    )
  );
  const recoveryTailEntries = Array.from({ length: 18 }, (_, rank) =>
    entry(
      `entry-time-recovery-tail-${rank}`,
      "2026-07-28",
      `2026-07-28T00:${String(59 - rank).padStart(2, "0")}:00Z`,
      `Fresh recovery tail ${rank + 1}.`,
    )
  );

  await page.route("**/entries/*/entry-time", async (route) => {
    mutationCommitted = true;
    await route.fulfill({
      contentType: "application/json",
      json: movingAfter,
      status: 200,
    });
  });
  await page.route("**/entries/history**", async (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url);
    const cursor = url.searchParams.get("cursor");

    if (!mutationCommitted) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-29",
          groups: [
            {
              date: "2026-07-29",
              entries: [
                readingEntry,
                movingBefore,
                entry(
                  "entry-time-recovery-old-sentinel",
                  "2026-07-29",
                  "2026-07-29T03:00:00Z",
                  "Old date sentinel.",
                ),
              ],
            },
            {
              date: "2026-07-28",
              entries: [
                entry(
                  "entry-time-recovery-new-sentinel",
                  "2026-07-28",
                  "2026-07-28T00:00:00Z",
                  "New date sentinel.",
                ),
              ],
            },
          ],
          newer_cursor: "old-snapshot-newer",
          older_cursor: "old-snapshot-older",
        },
        status: 200,
      });
      return;
    }

    if (cursor?.startsWith("old-snapshot")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-29",
          groups: [{ date: "2026-07-29", entries: [movingBefore] }],
          newer_cursor: null,
          older_cursor: null,
        },
        status: 200,
      });
      return;
    }

    if (!cursor && freshRebuildAttempts === 0) {
      freshRebuildAttempts += 1;
      await route.fulfill({
        contentType: "application/json",
        json: { detail: "fresh snapshot temporarily unavailable" },
        status: 503,
      });
      return;
    }

    freshRebuildAttempts += 1;
    const responseBody =
      cursor === "new-snapshot-search-2"
        ? {
            anchor_date: "2026-07-29",
            groups: [
              {
                date: "2026-07-28",
                entries: denseRecoveryEntries.slice(19, 39),
              },
            ],
            newer_cursor: "new-snapshot-newer",
            older_cursor: "new-snapshot-search-3",
          }
        : cursor === "new-snapshot-search-3"
          ? {
              anchor_date: "2026-07-29",
              groups: [
                {
                  date: "2026-07-28",
                  entries: [
                    ...denseRecoveryEntries.slice(39),
                    movingAfter,
                    ...recoveryTailEntries,
                  ],
                },
              ],
              newer_cursor: "new-snapshot-newer",
              older_cursor: "new-snapshot-older-next",
            }
          : cursor === "new-snapshot-newer"
            ? {
                anchor_date: "2026-07-29",
                groups: [
                  {
                    date: "2026-07-30",
                    entries: [
                      entry(
                        "entry-time-recovery-newer",
                        "2026-07-30",
                        "2026-07-30T03:00:00Z",
                        "Fresh snapshot newer page.",
                      ),
                    ],
                  },
                ],
                newer_cursor: null,
                older_cursor: "new-snapshot-older-next",
              }
            : cursor === "new-snapshot-older-next"
              ? {
                  anchor_date: "2026-07-29",
                  groups: [
                    {
                      date: "2026-07-26",
                      entries: [
                        entry(
                          "entry-time-recovery-oldest",
                          "2026-07-26",
                          "2026-07-26T03:00:00Z",
                          "Fresh snapshot oldest page.",
                        ),
                      ],
                    },
                  ],
                  newer_cursor: null,
                  older_cursor: null,
                }
            : {
                anchor_date: "2026-07-29",
                groups: [
                  {
                    date: "2026-07-29",
                    entries: [readingEntry],
                  },
                  {
                    date: "2026-07-28",
                    entries: denseRecoveryEntries.slice(0, 19),
                  },
                ],
                newer_cursor: "new-snapshot-newer",
                older_cursor: "new-snapshot-search-2",
              };
    await route.fulfill({
      contentType: "application/json",
      json: responseBody,
      status: 200,
    });
  });
  await page.route("**/entries/calendar**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        days: [
          { date: "2026-07-29", entry_count: 1 },
          { date: "2026-07-28", entry_count: 2 },
        ],
        month: "2026-07",
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });

  await page.goto("diary.html?date=2026-07-29");
  const readingCard = page.locator("#entry-entry-time-recovery-reading");
  const movingEntry = page.locator("#entry-entry-time-recovery-moving");
  await expect(readingCard).toBeVisible();
  await expect(movingEntry).toBeVisible();
  await readingCard.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
  const topBefore = await readingCard.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await movingEntry.getByText("Entry actions", { exact: true }).click();
  await movingEntry
    .getByRole("button", { name: "Change Entry Time" })
    .click();
  const editor = page.getByRole("dialog", { name: "Change Entry Time" });
  await editor.getByLabel("New Entry Time").fill("2026-07-28T09:00");
  await editor.getByRole("button", { name: "Save Entry Time" }).click();

  await expect(editor).not.toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Entry Time changed");
  await expect(
    page.getByRole("button", { name: "Load newer Entries" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Load older Entries" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh History" }),
  ).toBeVisible();
  await expect(
    movingEntry.getByText("Committed Entry Time recovery anchor."),
  ).toBeVisible();
  await expect(
    movingEntry.locator("xpath=ancestor::section[1]").getByRole("heading", {
      name: "2026-07-28",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(
    page.getByRole("button", { name: "July 29, 2026, 1 Entry" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "July 28, 2026, 2 Entries" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History" }).click();

  const recoveryRequestStart = historyRequests.length;
  await page.getByRole("button", { name: "Refresh History" }).click();
  await expect(page.getByRole("button", { name: "Refresh History" })).toHaveCount(0);
  await expect(page.locator("article.diary-entry")).toHaveCount(60);
  await expect
    .poll(() =>
      readingCard.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(topBefore, 0);

  await page.getByRole("button", { name: "Load newer Entries" }).click();
  await expect(page.getByText("Fresh snapshot newer page.")).toBeVisible();
  await page.getByRole("button", { name: "Load older Entries" }).click();
  await expect(page.getByText("Fresh snapshot oldest page.")).toBeVisible();

  const recoveryRequests = historyRequests.slice(recoveryRequestStart);
  expect(recoveryRequests.length).toBe(5);
  expect(
    recoveryRequests.every(
      (url) => Number(url.searchParams.get("limit") ?? "20") <= 20,
    ),
  ).toBe(true);
  expect(
    recoveryRequests
      .map((url) => url.searchParams.get("cursor"))
      .filter((cursor): cursor is string => cursor !== null)
      .every((cursor) => cursor.startsWith("new-snapshot-")),
  ).toBe(true);
  expect(
    historyRequests.some((url) =>
      url.searchParams.get("cursor")?.startsWith("old-snapshot"),
    ),
  ).toBe(false);
  await expect(movingEntry).toHaveCount(1);
  await expect(movingEntry.locator("dd").first()).toContainText("Jul");
});

for (const scenario of [
  { rebuildPath: "save", delayedLayoutShift: false },
  { rebuildPath: "recovery", delayedLayoutShift: false },
  { rebuildPath: "recovery", delayedLayoutShift: true },
] as const) {
  const { rebuildPath, delayedLayoutShift } = scenario;
  const delayedLayoutLabel = delayedLayoutShift
    ? " after a delayed layout change"
    : "";
  test(`Entry Time ${rebuildPath} rebuild searches newer for the committed active Entry${delayedLayoutLabel}`, async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-07-30T12:00:00+08:00"));
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: `newer-${userId}-refresh-token`,
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

  const readingEntry = entry(
    "newer-search-reading-a",
    "2026-07-29",
    "2026-07-29T05:00:00.123456Z",
    "Reading card A remains the viewport anchor.",
  );
  const movingBefore = entry(
    "newer-search-moving-b",
    "2026-07-29",
    "2026-07-29T04:00:00.123456Z",
    "Changed card B must be found as the active Entry.",
  );
  const movingAfter = {
    ...movingBefore,
    entry_at: "2026-07-30T01:00:00.654321Z",
    owner_date: "2026-07-30",
  };
  const initialFillers = Array.from({ length: 19 }, (_, rank) =>
    entry(
      `newer-search-initial-${rank}`,
      "2026-07-29",
      `2026-07-29T03:${String(59 - rank).padStart(2, "0")}:00Z`,
      `Fresh initial filler ${rank + 1}.`,
    ),
  );
  const olderEntries = Array.from({ length: 80 }, (_, rank) =>
    entry(
      `newer-search-older-${rank}`,
      "2026-07-28",
      `2026-07-28T${String(23 - Math.floor(rank / 4)).padStart(2, "0")}:${String(59 - (rank % 4)).padStart(2, "0")}:00Z`,
      `Older lifetime Entry ${rank + 1}.`,
    ),
  );
  let mutationCommitted = false;
  let freshRootRequests = 0;
  const historyRequests: URL[] = [];

  await page.route("**/entries/*/entry-time", async (route) => {
    mutationCommitted = true;
    await route.fulfill({
      contentType: "application/json",
      json: movingAfter,
      status: 200,
    });
  });
  await page.route("**/entries/history**", async (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url);
    const cursor = url.searchParams.get("cursor");
    if (!mutationCommitted) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-29",
          groups: [
            {
              date: "2026-07-29",
              entries: [readingEntry, movingBefore],
            },
          ],
          newer_cursor: "old-newer",
          older_cursor: "old-older",
        },
        status: 200,
      });
      return;
    }

    if (!cursor) {
      freshRootRequests += 1;
      if (rebuildPath === "recovery" && freshRootRequests === 1) {
        await route.fulfill({
          contentType: "application/json",
          json: { detail: "first fresh snapshot unavailable" },
          status: 503,
        });
        return;
      }
    }

    if (cursor === "fresh-newer-1") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-29",
          groups: [{ date: "2026-07-30", entries: [movingAfter] }],
          newer_cursor: "fresh-newer-continuation",
          older_cursor: "fresh-older-1",
        },
        status: 200,
      });
      return;
    }

    if (cursor === "fresh-newer-continuation") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-29",
          groups: [
            {
              date: "2026-07-31",
              entries: [
                entry(
                  "newer-search-fresh-continuation",
                  "2026-07-31",
                  "2026-07-31T01:00:00Z",
                  "Fresh newer continuation.",
                ),
              ],
            },
          ],
          newer_cursor: null,
          older_cursor: "fresh-older-1",
        },
        status: 200,
      });
      return;
    }

    const olderPage = /^fresh-older-(\d)$/.exec(cursor ?? "");
    if (olderPage) {
      const pageNumber = Number(olderPage[1]);
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-29",
          groups: [
            {
              date: "2026-07-28",
              entries: olderEntries.slice(
                (pageNumber - 1) * 20,
                pageNumber * 20,
              ),
            },
          ],
          newer_cursor: "fresh-newer-continuation",
          older_cursor:
            pageNumber < 4
              ? `fresh-older-${pageNumber + 1}`
              : "fresh-older-continuation",
        },
        status: 200,
      });
      return;
    }

    expect(cursor).toBeNull();
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-07-29",
        groups: [
          {
            date: "2026-07-29",
            entries: [readingEntry, ...initialFillers],
          },
        ],
        newer_cursor: "fresh-newer-1",
        older_cursor: "fresh-older-1",
      },
      status: 200,
    });
  });
  await page.route("**/entries/calendar**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        days: [
          { date: "2026-07-29", entry_count: 1 },
          { date: "2026-07-30", entry_count: 1 },
        ],
        month: "2026-07",
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });

  await page.goto("diary.html?date=2026-07-29");
  if (delayedLayoutShift) {
    await page.evaluate(() => {
      let releaseFontReady!: () => void;
      const controlledFontReady = new Promise<FontFaceSet>((resolve) => {
        releaseFontReady = () => resolve(document.fonts);
      });
      Object.defineProperty(document.fonts, "ready", {
        configurable: true,
        get: () => controlledFontReady,
      });
      (
        window as typeof window & {
          __ticket08ReleaseFontReady: () => void;
        }
      ).__ticket08ReleaseFontReady = releaseFontReady;
    });
    await page.addStyleTag({
      content: `
        html[data-ticket08-delayed-layout] .diary-history-groups {
          font-family: serif;
          letter-spacing: 0.04em;
        }

        .diary-history-groups {
          overflow-anchor: none;
        }
      `,
    });
  }
  const readingCard = page.locator(`#entry-${readingEntry.id}`);
  const movingCard = page.locator(`#entry-${movingBefore.id}`);
  await readingCard.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
  const topBefore = await readingCard.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await movingCard.getByText("Entry actions", { exact: true }).click();
  await movingCard
    .getByRole("button", { name: "Change Entry Time" })
    .click();
  const editor = page.getByRole("dialog", { name: "Change Entry Time" });
  let rebuildRequestStart = historyRequests.length;
  await editor.getByLabel("New Entry Time").fill("2026-07-30T09:00");
  await editor.getByRole("button", { name: "Save Entry Time" }).click();

  if (rebuildPath === "recovery") {
    const refresh = page.getByRole("button", { name: "Refresh History" });
    await expect(refresh).toBeVisible();
    rebuildRequestStart = historyRequests.length;
    await refresh.click();
  }
  await expect(editor).not.toBeVisible();
  await expect(page.locator(`#entry-${movingAfter.id}`)).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Refresh History" }),
  ).toHaveCount(0);
  if (delayedLayoutShift) {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
      document.documentElement.dataset.ticket08DelayedLayout = "true";
      (
        window as typeof window & {
          __ticket08ReleaseFontReady: () => void;
        }
      ).__ticket08ReleaseFontReady();
    });
  }
  await expect
    .poll(() =>
      readingCard.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(topBefore, 0);
  const rebuildRequests = historyRequests.slice(rebuildRequestStart);
  expect(rebuildRequests.length).toBeLessThanOrEqual(5);
  expect(
    rebuildRequests.filter(
      (url) => url.searchParams.get("cursor") === null,
    ),
  ).toHaveLength(1);
  expect(
    rebuildRequests.filter(
      (url) => url.searchParams.get("direction") === "newer",
    ),
  ).toHaveLength(1);
  expect(
    rebuildRequests.filter(
      (url) => url.searchParams.get("direction") === "older",
    ),
  ).toHaveLength(0);

  await page.getByRole("button", { name: "Load older Entries" }).click();
  await expect(page.getByText("Older lifetime Entry 1.")).toBeVisible();
  await page.getByRole("button", { name: "Load newer Entries" }).click();
  await expect(page.getByText("Fresh newer continuation.")).toBeVisible();
  await expect(page.locator(`#entry-${movingAfter.id}`)).toHaveCount(1);
  expect(await page.locator("article.diary-entry").count()).toBeLessThan(101);
  expect(
    historyRequests.some((url) =>
      url.searchParams.get("cursor")?.startsWith("old-"),
    ),
  ).toBe(false);
});
}

for (const rootOutcome of ["success", "failure"] as const) {
  const adjacentDirection = rootOutcome === "success" ? "older" : "newer";
  test(`delayed ${adjacentDirection} load retires at midnight root ${rootOutcome}`, async ({
    page,
  }) => {
    const beforeMidnight = new Date("2026-07-30T23:00:00+08:00");
    await page.clock.install({ time: beforeMidnight });
    await page.clock.pauseAt(beforeMidnight);
    const syntheticSessionLifetimeSeconds = 48 * 60 * 60;
    const accessToken = unsignedAccessToken(
      ownerId,
      syntheticSessionLifetimeSeconds,
    );
    await page.addInitScript(
      ({ ownerAccessToken, syntheticSessionLifetimeSeconds, userId }) => {
        window.localStorage.setItem(
          "sb-127-auth-token",
          JSON.stringify({
            access_token: ownerAccessToken,
            expires_at:
              Math.floor(Date.now() / 1000) + syntheticSessionLifetimeSeconds,
            expires_in: syntheticSessionLifetimeSeconds,
            refresh_token: `midnight-adjacent-${userId}`,
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
      {
        ownerAccessToken: accessToken,
        syntheticSessionLifetimeSeconds,
        userId: ownerId,
      },
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

    const initialEntry = entry(
      `midnight-adjacent-initial-${rootOutcome}`,
      "2026-07-30",
      "2026-07-30T12:00:00+08:00",
      `Initial History before midnight ${rootOutcome}.`,
    );
    const freshRootEntry = entry(
      `midnight-adjacent-fresh-${rootOutcome}`,
      "2026-07-31",
      "2026-07-31T00:00:00+08:00",
      `Fresh root after midnight ${rootOutcome}.`,
    );
    const freshAdjacentEntry = entry(
      `midnight-adjacent-continuation-${rootOutcome}`,
      adjacentDirection === "older" ? "2026-07-29" : "2026-08-01",
      adjacentDirection === "older"
        ? "2026-07-29T12:00:00+08:00"
        : "2026-08-01T12:00:00+08:00",
      `Fresh ${adjacentDirection} continuation after midnight.`,
    );
    let releaseStaleAdjacent!: () => void;
    const staleAdjacentRelease = new Promise<void>((resolve) => {
      releaseStaleAdjacent = resolve;
    });
    let markStaleAdjacentStarted!: () => void;
    const staleAdjacentStarted = new Promise<void>((resolve) => {
      markStaleAdjacentStarted = resolve;
    });
    let markStaleAdjacentSettled!: () => void;
    const staleAdjacentSettled = new Promise<void>((resolve) => {
      markStaleAdjacentSettled = resolve;
    });
    let midnightTakeoverStarted = false;
    let midnightFailureReturned = false;
    const historyRequests: URL[] = [];

    await page.route("**/entries/history**", async (route) => {
      const url = new URL(route.request().url());
      historyRequests.push(url);
      const cursor = url.searchParams.get("cursor");
      if (cursor === `old-${adjacentDirection}`) {
        markStaleAdjacentStarted();
        await staleAdjacentRelease;
        try {
          await route.fulfill({
            contentType: "application/json",
            json: {
              anchor_date: "2026-07-30",
              groups: [
                {
                  date: "2026-07-28",
                  entries: [
                    entry(
                      `midnight-adjacent-stale-${rootOutcome}`,
                      "2026-07-28",
                      "2026-07-28T12:00:00+08:00",
                      "Stale adjacent response must not install.",
                    ),
                  ],
                },
              ],
              newer_cursor: "old-newer",
              older_cursor: "old-older",
            },
            status: 200,
          });
        } catch {
          // The midnight root is expected to abort this transport.
        } finally {
          markStaleAdjacentSettled();
        }
        return;
      }
      if (cursor === `fresh-${adjacentDirection}`) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            anchor_date: "2026-07-31",
            groups: [
              {
                date: freshAdjacentEntry.owner_date,
                entries: [freshAdjacentEntry],
              },
            ],
            newer_cursor: null,
            older_cursor: null,
          },
          status: 200,
        });
        return;
      }
      expect(cursor).toBeNull();
      if (!midnightTakeoverStarted) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            anchor_date: "2026-07-30",
            groups: [
              { date: "2026-07-30", entries: [initialEntry] },
            ],
            newer_cursor: "old-newer",
            older_cursor: "old-older",
          },
          status: 200,
        });
        return;
      }
      if (rootOutcome === "failure" && !midnightFailureReturned) {
        midnightFailureReturned = true;
        await route.fulfill({
          contentType: "application/json",
          json: { detail: "midnight root temporarily unavailable" },
          status: 503,
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-31",
          groups: [
            { date: "2026-07-31", entries: [freshRootEntry] },
          ],
          newer_cursor: "fresh-newer",
          older_cursor: "fresh-older",
        },
        status: 200,
      });
    });

    await page.goto("diary.html");
    await expect(page.locator(`#entry-${initialEntry.id}`)).toBeVisible();
    await page
      .getByRole("button", {
        name: `Load ${adjacentDirection} Entries`,
      })
      .click();
    await staleAdjacentStarted;
    const takeoverRequestStart = historyRequests.length;
    midnightTakeoverStarted = true;
    await page.clock.runFor(3_601_000);

    if (rootOutcome === "success") {
      await expect(page.locator(`#entry-${freshRootEntry.id}`)).toBeVisible();
    } else {
      await expect(page.getByRole("alert")).toContainText(
        "Diary could not load history.",
      );
      await expect(
        page.getByRole("button", { name: "Retry History" }),
      ).toBeVisible();
    }
    await expect(
      page.getByText(`Loading ${adjacentDirection} Entries`),
    ).toHaveCount(0);

    releaseStaleAdjacent();
    await staleAdjacentSettled;
    await expect(
      page.getByText("Stale adjacent response must not install."),
    ).toHaveCount(0);

    if (rootOutcome === "failure") {
      await page.getByRole("button", { name: "Retry History" }).click();
      await expect(page.locator(`#entry-${freshRootEntry.id}`)).toBeVisible();
    }

    const freshLoad = page.getByRole("button", {
      name: `Load ${adjacentDirection} Entries`,
    });
    await expect(freshLoad).toBeEnabled();
    await freshLoad.click();
    await expect(
      page.locator(`#entry-${freshAdjacentEntry.id}`),
    ).toBeVisible();
    expect(
      historyRequests
        .slice(takeoverRequestStart)
        .some((url) =>
          url.searchParams.get("cursor")?.startsWith("old-"),
        ),
    ).toBe(false);
    expect(
      historyRequests.filter(
        (url) =>
          url.searchParams.get("cursor") ===
          `fresh-${adjacentDirection}`,
      ),
    ).toHaveLength(1);
  });
}

for (const rootOutcome of ["success", "failure"] as const) {
  test(`midnight root ${rootOutcome} preserves a committed Entry Time rebuild`, async ({
    page,
  }) => {
    const beforeMidnight = new Date("2026-07-30T23:59:59+08:00");
    await page.clock.install({ time: beforeMidnight });
    await page.clock.pauseAt(beforeMidnight);
    const syntheticSessionLifetimeSeconds = 48 * 60 * 60;
    const accessToken = unsignedAccessToken(
      ownerId,
      syntheticSessionLifetimeSeconds,
    );
    await page.addInitScript(
      ({ ownerAccessToken, syntheticSessionLifetimeSeconds, userId }) => {
        window.localStorage.setItem(
          "sb-127-auth-token",
          JSON.stringify({
            access_token: ownerAccessToken,
            expires_at:
              Math.floor(Date.now() / 1000) + syntheticSessionLifetimeSeconds,
            expires_in: syntheticSessionLifetimeSeconds,
            refresh_token: `midnight-committed-${userId}`,
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
      {
        ownerAccessToken: accessToken,
        syntheticSessionLifetimeSeconds,
        userId: ownerId,
      },
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

    const readingEntry = entry(
      `midnight-committed-reading-${rootOutcome}`,
      "2026-07-30",
      "2026-07-30T05:00:00.123456Z",
      `Reading anchor before committed root ${rootOutcome}.`,
    );
    const movingBefore = entry(
      `midnight-committed-moving-${rootOutcome}`,
      "2026-07-30",
      "2026-07-30T04:00:00.123456Z",
      `Committed mutation survives root ${rootOutcome}.`,
    );
    const movingAfter = {
      ...movingBefore,
      entry_at: "2026-07-31T01:00:00.654321Z",
      owner_date: "2026-07-31",
    };
    const freshRootCompanion = entry(
      `midnight-committed-root-${rootOutcome}`,
      "2026-07-31",
      "2026-07-31T02:00:00Z",
      `Fresh root state after ${rootOutcome}.`,
    );
    const freshContinuation = entry(
      `midnight-committed-continuation-${rootOutcome}`,
      "2026-07-29",
      "2026-07-29T02:00:00Z",
      `Fresh root continuation after ${rootOutcome}.`,
    );
    let mutationCommitted = false;
    let rootRequests = 0;
    let releaseRebuild!: () => void;
    const rebuildRelease = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    let markRebuildStarted!: () => void;
    const rebuildStarted = new Promise<void>((resolve) => {
      markRebuildStarted = resolve;
    });
    let markRebuildSettled!: () => void;
    const rebuildSettled = new Promise<void>((resolve) => {
      markRebuildSettled = resolve;
    });
    const historyRequests: URL[] = [];
    let calendarRequests = 0;

    await page.route("**/entries/*/entry-time", async (route) => {
      mutationCommitted = true;
      await route.fulfill({
        contentType: "application/json",
        json: movingAfter,
        status: 200,
      });
    });
    await page.route("**/entries/history**", async (route) => {
      const url = new URL(route.request().url());
      historyRequests.push(url);
      const cursor = url.searchParams.get("cursor");
      if (cursor === "fresh-root-older") {
        await route.fulfill({
          contentType: "application/json",
          json: {
            anchor_date: "2026-07-31",
            groups: [
              { date: "2026-07-29", entries: [freshContinuation] },
            ],
            newer_cursor: "fresh-root-newer",
            older_cursor: null,
          },
          status: 200,
        });
        return;
      }
      if (cursor === "fresh-root-newer") {
        await route.fulfill({
          contentType: "application/json",
          json: {
            anchor_date: "2026-07-31",
            groups: [],
            newer_cursor: null,
            older_cursor: null,
          },
          status: 200,
        });
        return;
      }
      expect(cursor).toBeNull();
      if (!mutationCommitted) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            anchor_date: "2026-07-30",
            groups: [
              {
                date: "2026-07-30",
                entries: [readingEntry, movingBefore],
              },
            ],
            newer_cursor: "old-root-newer",
            older_cursor: "old-root-older",
          },
          status: 200,
        });
        return;
      }
      if (url.searchParams.get("anchor_date") === "2026-07-30") {
        markRebuildStarted();
        await rebuildRelease;
        try {
          await route.fulfill({
            contentType: "application/json",
            json: {
              anchor_date: "2026-07-30",
              groups: [
                { date: "2026-07-30", entries: [movingBefore] },
              ],
              newer_cursor: "stale-rebuild-newer",
              older_cursor: "stale-rebuild-older",
            },
            status: 200,
          });
        } catch {
          // Root takeover should abort the delayed mutation rebuild.
        } finally {
          markRebuildSettled();
        }
        return;
      }

      rootRequests += 1;
      if (rootOutcome === "failure" && rootRequests === 1) {
        await route.fulfill({
          contentType: "application/json",
          json: { detail: "midnight root unavailable" },
          status: 503,
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-31",
          groups: [
            {
              date: "2026-07-31",
              entries: [freshRootCompanion, movingAfter],
            },
          ],
          newer_cursor: "fresh-root-newer",
          older_cursor: "fresh-root-older",
        },
        status: 200,
      });
    });
    await page.route("**/entries/calendar**", async (route) => {
      calendarRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        json: {
          days: [
            { date: "2026-07-30", entry_count: 1 },
            { date: "2026-07-31", entry_count: 1 },
          ],
          month: "2026-07",
          time_zone: "Asia/Taipei",
        },
        status: 200,
      });
    });

    await page.goto("diary.html");
    const readingCard = page.locator(`#entry-${readingEntry.id}`);
    const movingCard = page.locator(`#entry-${movingBefore.id}`);
    await readingCard.evaluate((element) => {
      element.scrollIntoView({ block: "start" });
    });
    await movingCard.getByText("Entry actions", { exact: true }).click();
    await movingCard
      .getByRole("button", { name: "Change Entry Time" })
      .click();
    const editor = page.getByRole("dialog", { name: "Change Entry Time" });
    await editor.getByLabel("New Entry Time").fill("2026-07-31T09:00");
    await editor.getByRole("button", { name: "Save Entry Time" }).click();
    await rebuildStarted;
    await page.clock.runFor(2_000);

    if (rootOutcome === "success") {
      await expect(page.locator(`#entry-${freshRootCompanion.id}`)).toBeVisible();
    } else {
      await expect(page.getByRole("alert")).toContainText(
        "Diary could not load history.",
      );
      await expect(
        page.getByRole("button", { name: "Retry History" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Refresh History" }),
      ).toBeVisible();
    }
    releaseRebuild();
    await rebuildSettled;
    await expect(editor).not.toBeVisible();

    if (rootOutcome === "failure") {
      await page.getByRole("button", { name: "Retry History" }).click();
    }
    await expect(page.locator(`#entry-${movingAfter.id}`)).toHaveCount(1);
    await expect(page.locator(`#entry-${freshRootCompanion.id}`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh History" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(
      page.getByRole("button", { name: "July 31, 2026, 1 Entry" }),
    ).toBeVisible();
    expect(calendarRequests).toBeGreaterThan(0);
    await page.getByRole("button", { name: "History" }).click();
    await expect(
      page.getByRole("button", { name: "Load older Entries" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Load older Entries" }).click();
    await expect(page.locator(`#entry-${freshContinuation.id}`)).toBeVisible();
    expect(
      historyRequests.some((url) =>
        url.searchParams.get("cursor")?.startsWith("old-root"),
      ),
    ).toBe(false);
    expect(
      historyRequests.some((url) =>
        url.searchParams.get("cursor")?.startsWith("stale-rebuild"),
      ),
    ).toBe(false);
  });
}

for (const rebuildOutcome of ["success", "recovery"] as const) {
  test(`delayed root refresh cannot overwrite ${rebuildOutcome} after Entry Time commit`, async ({
    page,
  }) => {
    const beforeMidnight = new Date("2026-07-30T23:59:59+08:00");
    await page.clock.install({ time: beforeMidnight });
    await page.clock.pauseAt(beforeMidnight);
    const accessToken = unsignedAccessToken(ownerId);
    await page.addInitScript(
      ({ ownerAccessToken, userId }) => {
        window.localStorage.setItem(
          "sb-127-auth-token",
          JSON.stringify({
            access_token: ownerAccessToken,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            refresh_token: `delayed-root-${userId}`,
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
    await page.route("**/entries/calendar**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          days: [
            { date: "2026-07-30", entry_count: 0 },
            { date: "2026-07-29", entry_count: 1 },
          ],
          month: "2026-07",
          time_zone: "Asia/Taipei",
        },
        status: 200,
      });
    });

    const movingBefore = entry(
      `delayed-root-moving-${rebuildOutcome}`,
      "2026-07-30",
      "2026-07-30T12:00:00+08:00",
      `Delayed root ${rebuildOutcome} anchor.`,
    );
    const movingAfter = {
      ...movingBefore,
      entry_at: "2026-07-29T09:00:00+08:00",
      owner_date: "2026-07-29",
    };
    let markOldRootStarted!: () => void;
    const oldRootStarted = new Promise<void>((resolve) => {
      markOldRootStarted = resolve;
    });
    let releaseOldRoot!: () => void;
    const oldRootRelease = new Promise<void>((resolve) => {
      releaseOldRoot = resolve;
    });
    let markOldRootSettled!: () => void;
    const oldRootSettled = new Promise<void>((resolve) => {
      markOldRootSettled = resolve;
    });
    let delayNextRoot = false;
    let mutationCommitted = false;
    let freshRebuildAttempted = false;
    const historyRequests: URL[] = [];

    await page.route("**/entries/*/entry-time", async (route) => {
      mutationCommitted = true;
      await route.fulfill({
        contentType: "application/json",
        json: movingAfter,
        status: 200,
      });
    });
    await page.route("**/entries/history**", async (route) => {
      const url = new URL(route.request().url());
      historyRequests.push(url);
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            anchor_date: "2026-07-29",
            groups: [],
            newer_cursor: null,
            older_cursor: null,
          },
          status: 200,
        });
        return;
      }

      if (delayNextRoot) {
        delayNextRoot = false;
        markOldRootStarted();
        await oldRootRelease;
        try {
          await route.fulfill({
            contentType: "application/json",
            json: {
              anchor_date: "2026-07-30",
              groups: [{ date: "2026-07-30", entries: [movingBefore] }],
              newer_cursor: "old-root-newer",
              older_cursor: "old-root-older",
            },
            status: 200,
          });
        } catch {
          // Aborting the old generation is the preferred isolation path.
        } finally {
          markOldRootSettled();
        }
        return;
      }

      if (
        mutationCommitted &&
        !freshRebuildAttempted &&
        rebuildOutcome === "recovery"
      ) {
        freshRebuildAttempted = true;
        await route.fulfill({
          contentType: "application/json",
          json: { detail: "fresh snapshot unavailable" },
          status: 503,
        });
        return;
      }

      const isFresh = mutationCommitted;
      freshRebuildAttempted ||= isFresh;
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: isFresh ? "2026-07-29" : "2026-07-30",
          groups: [
            {
              date: isFresh ? "2026-07-29" : "2026-07-30",
              entries: [isFresh ? movingAfter : movingBefore],
            },
          ],
          newer_cursor: isFresh ? "new-root-newer" : "old-root-newer",
          older_cursor: isFresh ? "new-root-older" : "old-root-older",
        },
        status: 200,
      });
    });

    await page.goto("diary.html");
    const movingEntry = page.locator(`#entry-${movingBefore.id}`);
    await expect(movingEntry).toBeVisible();
    await movingEntry.getByText("Entry actions", { exact: true }).click();
    await movingEntry
      .getByRole("button", { name: "Change Entry Time" })
      .click();
    const editor = page.getByRole("dialog", { name: "Change Entry Time" });
    await editor.getByLabel("New Entry Time").fill("2026-07-29T09:00");

    delayNextRoot = true;
    await page.clock.runFor(2_000);
    await oldRootStarted;
    await editor.getByRole("button", { name: "Save Entry Time" }).click();
    await expect(editor).not.toBeVisible();
    if (rebuildOutcome === "success") {
      await expect(
        movingEntry.locator("xpath=ancestor::section[1]").getByRole("heading", {
          name: "2026-07-29",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh History" })).toHaveCount(0);
    } else {
      await expect(page.getByRole("button", { name: "Refresh History" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Load newer Entries" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Load older Entries" })).toHaveCount(0);
    }

    releaseOldRoot();
    await oldRootSettled;
    await expect(
      movingEntry.locator("xpath=ancestor::section[1]").getByRole("heading", {
        name: "2026-07-29",
        exact: true,
      }),
    ).toBeVisible();
    if (rebuildOutcome === "recovery") {
      await expect(page.getByRole("button", { name: "Load newer Entries" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Load older Entries" })).toHaveCount(0);
    } else {
      expect(
        historyRequests.some(
          (url) => url.searchParams.get("cursor") === "new-root-older",
        ),
      ).toBe(true);
      expect(
        historyRequests.some((url) =>
          url.searchParams.get("cursor")?.startsWith("old-root"),
        ),
      ).toBe(false);
    }
  });
}

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

test("History orders years 0001 through 0099 without losing timestamp precision", async ({
  page,
}) => {
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: "ancient-history-refresh-token",
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
        anchor_date: "1800-01-01",
        groups: [
          {
            date: "0001-01-01",
            entries: [
              entry(
                "00000000-0000-0000-0000-000000000001",
                "0001-01-01",
                "0001-01-01T00:00:00.000500Z",
                "Year 0001 lower UUID tie.",
              ),
            ],
          },
          {
            date: "0099-01-01",
            entries: [
              entry(
                "00000000-0000-0000-0000-000000000099",
                "0099-01-01",
                "0099-01-01T00:00:00.000100Z",
                "Year 0099 older microsecond.",
              ),
              entry(
                "00000000-0000-0000-0000-000000000098",
                "0099-01-01",
                "0099-01-01T00:00:00.000900Z",
                "Year 0099 newer microsecond.",
              ),
            ],
          },
          {
            date: "1800-01-01",
            entries: [
              entry(
                "00000000-0000-0000-0000-000000001800",
                "1800-01-01",
                "1800-01-01T00:00:00Z",
                "Year 1800 newest Entry.",
              ),
            ],
          },
          {
            date: "0100-01-01",
            entries: [
              entry(
                "00000000-0000-0000-0000-000000000100",
                "0100-01-01",
                "0100-01-01T00:00:00Z",
                "Year 0100 UTC Entry.",
              ),
            ],
          },
          {
            date: "0099-12-31",
            entries: [
              entry(
                "00000000-0000-0000-0000-000000000097",
                "0099-12-31",
                "0099-12-31T23:59:59-02:00",
                "Year 0099 offset-normalized past 0100 UTC.",
              ),
            ],
          },
          {
            date: "0001-01-01",
            entries: [
              entry(
                "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "0001-01-01",
                "0001-01-01T00:00:00.000500+00:00",
                "Year 0001 higher UUID tie.",
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

  await page.goto("diary.html?date=1800-01-01");

  await expect(page.locator(".diary-entry__content")).toHaveText([
    "Year 1800 newest Entry.",
    "Year 0099 offset-normalized past 0100 UTC.",
    "Year 0100 UTC Entry.",
    "Year 0099 newer microsecond.",
    "Year 0099 older microsecond.",
    "Year 0001 higher UUID tie.",
    "Year 0001 lower UUID tie.",
  ]);
});
