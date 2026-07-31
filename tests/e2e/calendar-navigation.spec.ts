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
        groups: [],
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
