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

test.use({ timezoneId: "America/Los_Angeles" });

test("owner jumps from Calendar into bidirectional continuous History", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-04-01T00:30:00+08:00"));
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: "calendar-refresh-token",
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

  const calendarRequests: URL[] = [];
  await page.route("**/entries/calendar**", async (route) => {
    const url = new URL(route.request().url());
    calendarRequests.push(url);
    const month = url.searchParams.get("month");
    await route.fulfill({
      contentType: "application/json",
      json: {
        days:
          month === "2026-03"
            ? [
                { date: "2026-03-01", entry_count: 2 },
                { date: "2026-03-31", entry_count: 1 },
              ]
            : [],
        month,
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });

  const historyRequests: URL[] = [];
  await page.route("**/entries/history**", async (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url);
    const direction = url.searchParams.get("direction");
    const anchorDate = url.searchParams.get("anchor_date");
    const body =
      direction === "newer"
        ? {
            anchor_date: "2026-03-15",
            groups: [
              {
                date: "2026-03-20",
                entries: [
                  entry(
                    "calendar-newer",
                    "2026-03-20",
                    "2026-03-20T04:00:00Z",
                    "Newer than the selected empty date.",
                  ),
                ],
              },
            ],
            newer_cursor: null,
            older_cursor: "older-calendar-cursor",
          }
        : direction === "older"
          ? {
              anchor_date: "2026-03-15",
              groups: [
                {
                  date: "2026-03-10",
                  entries: [
                    entry(
                      "calendar-older",
                      "2026-03-10",
                      "2026-03-10T04:00:00Z",
                      "Older than the selected empty date.",
                    ),
                  ],
                },
              ],
              newer_cursor: "newer-calendar-cursor",
              older_cursor: null,
            }
          : anchorDate === "2026-03-15"
            ? {
                anchor_date: "2026-03-15",
                groups: [
                  {
                    date: "2026-03-14",
                    entries: [
                      entry(
                        "calendar-nearby",
                        "2026-03-14",
                        "2026-03-14T04:00:00Z",
                        "Nearby continuous History Entry.",
                      ),
                    ],
                  },
                ],
                newer_cursor: "newer-calendar-cursor",
                older_cursor: "older-calendar-cursor",
              }
            : {
                anchor_date: "2026-04-01",
                groups: [],
                newer_cursor: null,
                older_cursor: null,
              };
    await route.fulfill({
      contentType: "application/json",
      json: body,
      status: 200,
    });
  });

  await page.goto("diary.html");
  await expect(
    page.getByRole("heading", { name: "History" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(
    page.getByRole("heading", { name: "Calendar" }),
  ).toBeVisible();
  await expect(page.getByText("April 2026")).toBeVisible();
  await expect(page.getByText("Today", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText("March 2026")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "March 1, 2026, 2 Entries" }),
  ).toBeVisible();
  expect(
    calendarRequests.some(
      (request) => request.searchParams.get("month") === "2026-03",
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "March 15, 2026, no Entries" }).click();
  await expect(
    page.getByRole("heading", { name: "History" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\?date=2026-03-15$/);
  await expect(page.getByRole("heading", { name: "2026-03-15" })).toBeVisible();
  await expect(
    page.getByText(
      "No Entries on this date. History continues with nearby Entries.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Nearby continuous History Entry.")).toBeVisible();
  expect(
    historyRequests.some(
      (request) => request.searchParams.get("anchor_date") === "2026-03-15",
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Load newer Entries" }).click();
  await expect(page.getByText("Newer than the selected empty date.")).toBeVisible();
  await page.getByRole("button", { name: "Load older Entries" }).click();
  await expect(page.getByText("Older than the selected empty date.")).toBeVisible();

  await expect(page.getByRole("button", { name: "New Entry" })).toBeVisible();
  await page.getByRole("button", { name: "New Entry" }).click();
  await expect(page.getByRole("dialog", { name: "New Entry" })).toBeVisible();
});

test("mobile owner selects an empty Calendar date and keeps New Entry available", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date("2026-04-01T00:30:00+08:00"));
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: "mobile-calendar-refresh-token",
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
        days: [{ date: "2026-04-01", entry_count: 3 }],
        month: "2026-04",
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });
  await page.route("**/entries/history**", async (route) => {
    const url = new URL(route.request().url());
    const selectedDate = url.searchParams.get("anchor_date");
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: selectedDate ?? "2026-04-01",
        groups: selectedDate
          ? [
              {
                date: "2026-04-01",
                entries: [
                  entry(
                    "mobile-calendar-nearby",
                    "2026-04-01",
                    "2026-04-01T04:00:00Z",
                    "Nearby mobile History Entry.",
                  ),
                ],
              },
            ]
          : [],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });

  await page.goto("diary.html");
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(
    page.getByRole("button", { name: "April 1, 2026, 3 Entries" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "April 2, 2026, no Entries" }).click();

  await expect(page).toHaveURL(/\?date=2026-04-02$/);
  await expect(
    page.getByText(
      "No Entries on this date. History continues with nearby Entries.",
    ),
  ).toBeVisible();
  const newEntry = page.getByRole("button", { name: "New Entry" });
  await expect(newEntry).toBeVisible();
  await newEntry.click();
  await expect(page.getByRole("dialog", { name: "New Entry" })).toBeVisible();
});

test("calendar jump isolates the new History from an in-flight adjacent request", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-05-01T12:00:00+08:00"));
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: "calendar-race-refresh-token",
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
        days: [{ date: "2026-05-10", entry_count: 1 }],
        month: "2026-05",
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });

  let markOldAdjacentStarted!: () => void;
  const oldAdjacentStarted = new Promise<void>((resolve) => {
    markOldAdjacentStarted = resolve;
  });
  let releaseOldAdjacent!: () => void;
  const oldAdjacentRelease = new Promise<void>((resolve) => {
    releaseOldAdjacent = resolve;
  });
  let markOldAdjacentSettled!: () => void;
  const oldAdjacentSettled = new Promise<void>((resolve) => {
    markOldAdjacentSettled = resolve;
  });
  const historyRequests: URL[] = [];
  await page.route("**/entries/history**", async (route) => {
    const url = new URL(route.request().url());
    historyRequests.push(url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction");
    const anchorDate = url.searchParams.get("anchor_date");

    if (cursor === "old-snapshot-newer" && direction === "newer") {
      markOldAdjacentStarted();
      await oldAdjacentRelease;
      try {
        await route.fulfill({
          contentType: "application/json",
          json: {
            anchor_date: "2026-05-01",
            groups: [
              {
                date: "2026-06-01",
                entries: [
                  entry(
                    "stale-snapshot-entry",
                    "2026-06-01",
                    "2026-06-01T04:00:00Z",
                    "Stale Entry from the old snapshot.",
                  ),
                ],
              },
            ],
            newer_cursor: "stale-snapshot-next",
            older_cursor: null,
          },
          status: 200,
        });
      } catch {
        // An aborted transport is an acceptable isolation mechanism.
      } finally {
        markOldAdjacentSettled();
      }
      return;
    }

    const body =
      anchorDate === "2026-05-10"
        ? {
            anchor_date: "2026-05-10",
            groups: [
              {
                date: "2026-05-10",
                entries: [
                  entry(
                    "new-anchor-entry",
                    "2026-05-10",
                    "2026-05-10T04:00:00Z",
                    "Entry from the new Calendar anchor.",
                  ),
                ],
              },
            ],
            newer_cursor: null,
            older_cursor: "new-snapshot-older",
          }
        : cursor === "new-snapshot-older" && direction === "older"
          ? {
              anchor_date: "2026-05-10",
              groups: [
                {
                  date: "2026-05-09",
                  entries: [
                    entry(
                      "new-anchor-older-entry",
                      "2026-05-09",
                      "2026-05-09T04:00:00Z",
                      "Older Entry from the new snapshot.",
                    ),
                  ],
                },
              ],
              newer_cursor: null,
              older_cursor: null,
            }
          : {
              anchor_date: "2026-05-01",
              groups: [
                {
                  date: "2026-05-01",
                  entries: [
                    entry(
                      "old-anchor-entry",
                      "2026-05-01",
                      "2026-05-01T04:00:00Z",
                      "Entry from the old History anchor.",
                    ),
                  ],
                },
              ],
              newer_cursor: "old-snapshot-newer",
              older_cursor: null,
            };
    await route.fulfill({
      contentType: "application/json",
      json: body,
      status: 200,
    });
  });

  await page.goto("diary.html");
  await expect(page.getByText("Entry from the old History anchor.")).toBeVisible();
  await page.getByRole("button", { name: "Load newer Entries" }).click();
  await oldAdjacentStarted;

  await page.getByRole("button", { name: "Calendar" }).click();
  await page.getByRole("button", { name: "May 10, 2026, 1 Entry" }).click();
  await expect(page).toHaveURL(/\?date=2026-05-10$/);
  const newAnchorEntry = page.getByText("Entry from the new Calendar anchor.");
  await expect(newAnchorEntry).toBeVisible();
  const newAnchorTop = await newAnchorEntry.evaluate(
    (element) => element.getBoundingClientRect().top,
  );

  releaseOldAdjacent();
  await oldAdjacentSettled;

  await expect(page.getByText("Stale Entry from the old snapshot.")).toHaveCount(0);
  await expect(page.getByText("Entry from the old History anchor.")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Load newer Entries" }),
  ).toHaveCount(0);
  const loadOlder = page.getByRole("button", { name: "Load older Entries" });
  await expect(loadOlder).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/Loading (newer|older) Entries/)).toHaveCount(0);
  await expect
    .poll(async () =>
      newAnchorEntry.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(newAnchorTop, 0);

  await loadOlder.click();
  await expect(page.getByText("Older Entry from the new snapshot.")).toBeVisible();
  expect(
    historyRequests.some(
      (request) => request.searchParams.get("cursor") === "new-snapshot-older",
    ),
  ).toBe(true);
});

test("calendar jump retires Entry Time History recovery for the old date", async ({
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
          refresh_token: "calendar-retires-recovery-token",
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

  const movingBefore = entry(
    "calendar-recovery-moving",
    "2026-07-30",
    "2026-07-30T12:00:00+08:00",
    "Calendar recovery must be retired.",
  );
  const movingAfter = {
    ...movingBefore,
    entry_at: "2026-07-29T09:00:00+08:00",
    owner_date: "2026-07-29",
  };
  const selectedEntry = entry(
    "calendar-selected-entry",
    "2026-07-27",
    "2026-07-27T12:00:00+08:00",
    "History owned by the newly selected Calendar date.",
  );
  let mutationCommitted = false;
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
    if (
      mutationCommitted &&
      url.searchParams.get("anchor_date") === "2026-07-27"
    ) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          anchor_date: "2026-07-27",
          groups: [{ date: "2026-07-27", entries: [selectedEntry] }],
          newer_cursor: "selected-date-newer",
          older_cursor: "selected-date-older",
        },
        status: 200,
      });
      return;
    }
    if (mutationCommitted) {
      await route.fulfill({
        contentType: "application/json",
        json: { detail: "old-date rebuild unavailable" },
        status: 503,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-07-30",
        groups: [{ date: "2026-07-30", entries: [movingBefore] }],
        newer_cursor: "old-date-newer",
        older_cursor: "old-date-older",
      },
      status: 200,
    });
  });
  await page.route("**/entries/calendar?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        days: [{ date: "2026-07-27", entry_count: 1 }],
        month: "2026-07",
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });

  await page.goto("diary.html?date=2026-07-30");
  const movingEntry = page.locator("#entry-calendar-recovery-moving");
  await expect(movingEntry).toBeVisible();
  await movingEntry.getByText("Entry actions", { exact: true }).click();
  await movingEntry
    .getByRole("button", { name: "Change Entry Time" })
    .click();
  const editor = page.getByRole("dialog", { name: "Change Entry Time" });
  await editor.getByLabel("New Entry Time").fill("2026-07-29T09:00");
  await editor.getByRole("button", { name: "Save Entry Time" }).click();
  await expect(page.getByRole("button", { name: "Refresh History" })).toBeVisible();

  await page.getByRole("button", { name: "Calendar" }).click();
  await page
    .getByRole("button", { name: "July 27, 2026, 1 Entry" })
    .click();
  await expect(page).toHaveURL(/\?date=2026-07-27$/);
  await expect(
    page.getByText("History owned by the newly selected Calendar date."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh History" })).toHaveCount(0);
  await expect(page.getByText("Calendar recovery must be retired.")).toHaveCount(0);
  expect(
    historyRequests.at(-1)?.searchParams.get("anchor_date"),
  ).toBe("2026-07-27");
});

test("Calendar updates Taipei Today across midnight without stealing a browsed month", async ({
  page,
}) => {
  const beforeTaipeiMidnight = new Date("2026-04-30T23:59:59+08:00");
  await page.clock.install({
    time: beforeTaipeiMidnight,
  });
  await page.clock.pauseAt(beforeTaipeiMidnight);
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 48 * 60 * 60,
          expires_in: 48 * 60 * 60,
          refresh_token: "calendar-midnight-refresh-token",
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
  const calendarMonths: Array<string | null> = [];
  await page.route("**/entries/calendar**", async (route) => {
    const month = new URL(route.request().url()).searchParams.get("month");
    calendarMonths.push(month);
    await route.fulfill({
      contentType: "application/json",
      json: { days: [], month, time_zone: "Asia/Taipei" },
      status: 200,
    });
  });
  await page.route("**/entries/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-04-30",
        groups: [],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });

  await page.goto("diary.html");
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(page.getByText("April 2026")).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "April 30, 2026, no Entries" })
      .getByText("Today", { exact: true }),
  ).toBeVisible();

  await page.clock.runFor(2_000);
  await expect(page.getByText("May 2026")).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "May 1, 2026, no Entries" })
      .getByText("Today", { exact: true }),
  ).toBeVisible();
  expect(calendarMonths).toContain("2026-05");

  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText("April 2026")).toBeVisible();
  await page.clock.fastForward(24 * 60 * 60 * 1_000);
  await expect(page.getByText("April 2026")).toBeVisible();

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByText("May 2026")).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "May 2, 2026, no Entries" })
      .getByText("Today", { exact: true }),
  ).toBeVisible();
});

test("Calendar date explains when no active History exists", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-05-15T12:00:00+08:00"));
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: "calendar-empty-history-refresh-token",
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
        days: [],
        month: "2026-05",
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });
  await page.route("**/entries/history**", async (route) => {
    const anchorDate = new URL(route.request().url()).searchParams.get(
      "anchor_date",
    );
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: anchorDate ?? "2026-05-15",
        groups: [],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });

  await page.goto("diary.html");
  await page.getByRole("button", { name: "Calendar" }).click();
  await page
    .getByRole("button", { name: "May 10, 2026, no Entries" })
    .click();

  await expect(page.getByRole("heading", { name: "2026-05-10" })).toBeVisible();
  await expect(
    page.getByText("No active Entries yet. Capture whatever is on your mind."),
  ).toBeVisible();
  await expect(
    page.getByText("History continues with nearby Entries."),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Load (newer|older) Entries/ })).toHaveCount(0);
});
