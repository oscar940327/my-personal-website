import { expect, test } from "@playwright/test";

const ownerId = "61c2f4ca-2fab-4b50-a0cf-12aac0ec0b24";

type StaleRequestWindow = Window & {
  releaseStaleProtectedRequest?: () => void;
};

function unsignedAccessToken(subject: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: subject,
  })}.c2ln`;
}

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

test("Diary preserves a valid session while protected access recovers", async ({
  page,
}) => {
  await page.addInitScript(
    ({ accessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: accessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "owner-refresh-token",
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
      accessToken: unsignedAccessToken(ownerId),
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
  let protectedChecks = 0;
  await page.route("**/auth/me", async (route) => {
    protectedChecks += 1;
    if (protectedChecks === 1) {
      await route.fulfill({
        contentType: "application/json",
        json: { detail: "Authentication service unavailable" },
        status: 503,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { owner_id: ownerId, status: "authenticated" },
      status: 200,
    });
  });

  await page.goto("diary.html");

  await expect(page.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Retry protected access" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to Diary" }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("sb-127-auth-token")),
    )
    .not.toBeNull();

  await page
    .getByRole("button", { name: "Retry protected access" })
    .click();

  await expect(page.getByText("Authenticated Diary is ready.")).toBeVisible();
  expect(protectedChecks).toBe(2);
});

test("a stale protected-access denial cannot sign out a newer session", async ({
  page,
}) => {
  const oldAccessToken = unsignedAccessToken(ownerId);
  const newAccessToken = unsignedAccessToken(ownerId).replace(
    /\.c2ln$/,
    ".bmV3",
  );
  await page.addInitScript(
    ({ accessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: accessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "old-refresh-token",
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
    { accessToken: oldAccessToken, userId: ownerId },
  );
  await page.addInitScript((staleAccessToken) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const headers = new Headers(init?.headers);
      if (
        requestUrl.endsWith("/auth/me") &&
        headers.get("Authorization") ===
          `Bearer ${staleAccessToken}`
      ) {
        return new Promise<Response>((resolve) => {
          (
            window as StaleRequestWindow
          ).releaseStaleProtectedRequest = () => {
            resolve(
              new Response(
                JSON.stringify({
                  detail: "Authentication required",
                }),
                {
                  headers: {
                    "Content-Type": "application/json",
                  },
                  status: 401,
                },
              ),
            );
          };
        });
      }
      return originalFetch(input, init);
    };
  }, oldAccessToken);
  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { service: "diary-api", status: "ready" },
      status: 200,
    });
  });
  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        app_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString(),
        id: ownerId,
        user_metadata: {},
      },
      status: 200,
    });
  });
  await page.route("**/auth/v1/logout**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { owner_id: ownerId, status: "authenticated" },
      status: 200,
    });
  });

  await page.goto("diary.html");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as StaleRequestWindow)
            .releaseStaleProtectedRequest,
      ),
    )
    .toBe("function");
  await page.evaluate(
    async ({ accessToken, userId }) => {
      const modulePath = "/my-personal-website/src/diary/supabase.ts";
      const module = await import(modulePath);
      const { error } = await module
        .createDiarySupabaseClient()
        .auth.setSession({
          access_token: accessToken,
          refresh_token: "new-refresh-token",
        });
      if (error) {
        throw error;
      }
      const stored = JSON.parse(
        window.localStorage.getItem("sb-127-auth-token") ?? "null",
      );
      if (stored?.user?.id !== userId) {
        throw new Error("New owner session was not persisted");
      }
    },
    { accessToken: newAccessToken, userId: ownerId },
  );

  await expect(page.getByText("Authenticated Diary is ready.")).toBeVisible();
  await page.evaluate(() => {
    (window as StaleRequestWindow).releaseStaleProtectedRequest?.();
  });
  await page.waitForTimeout(100);

  await expect(page.getByText("Authenticated Diary is ready.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          window.localStorage.getItem("sb-127-auth-token") ?? "null",
        );
        return stored?.access_token;
      }),
    )
    .toBe(newAccessToken);
});

test("authenticated owner captures an Entry without losing the reading position", async ({
  page,
}) => {
  const ownerAccessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ accessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: accessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "capture-refresh-token",
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
    { accessToken: ownerAccessToken, userId: ownerId },
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

  const existingEntries = Array.from({ length: 8 }, (_, index) => ({
    created_at: `2026-07-27T0${index}:00:00+00:00`,
    current_revision_id: `revision-${index}`,
    entry_at: `2026-07-27T0${index}:00:00+00:00`,
    id: `entry-${index}`,
    original_content: `Existing Entry ${index}\n${"閱讀位置。".repeat(30)}`,
    owner_date: "2026-07-27",
    processing_state: "pending",
    revision_number: 1,
  }));
  const capturedEntry = {
    created_at: "2026-07-27T05:30:10+00:00",
    current_revision_id: "new-revision",
    entry_at: "2026-07-27T05:30:00+00:00",
    id: "new-entry",
    original_content:
      "完成 API 串接。\n保留這一整段 Original Content。",
    owner_date: "2026-07-27",
    processing_state: "pending",
    revision_number: 1,
  };
  let capturedRequest:
    | {
        entry_at?: string;
        original_content?: string;
      }
    | undefined;
  let idempotencyKey: string | null = null;
  await page.route("**/entries**", async (route) => {
    if (route.request().method() === "POST") {
      capturedRequest = route.request().postDataJSON();
      idempotencyKey =
        route.request().headers()["x-idempotency-key"] ?? null;
      await route.fulfill({
        contentType: "application/json",
        json: capturedEntry,
        status: 201,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-07-27",
        groups: [
          {
            date: "2026-07-27",
            entries: existingEntries,
          },
        ],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });

  await page.goto("diary.html");
  await expect(
    page.getByRole("heading", { name: "Today" }),
  ).toBeVisible();
  await expect(page.getByText("Existing Entry 7", { exact: false })).toBeVisible();
  const readingEntry = page.locator("#entry-entry-6");
  await readingEntry.evaluate((entry) => {
    entry.scrollIntoView({ block: "center" });
  });
  const readingEntryTop = await readingEntry.evaluate(
    (entry) => entry.getBoundingClientRect().top,
  );
  expect(readingEntryTop).toBeGreaterThan(0);

  await page.getByRole("button", { name: "New Entry" }).click();
  await expect(
    page.getByRole("dialog", { name: "New Entry" }),
  ).toBeVisible();
  await expect(page.getByLabel("Original Content")).toBeFocused();
  await page
    .getByLabel("Original Content")
    .fill("完成 API 串接。\n保留這一整段 Original Content。");
  await page.getByLabel("Original Content").press("Control+Enter");

  await expect(
    page.getByRole("button", { name: "View new Entry" }),
  ).toBeVisible();
  expect(idempotencyKey).toBeTruthy();
  expect(capturedRequest?.original_content).toBe(
    "完成 API 串接。\n保留這一整段 Original Content。",
  );
  expect(capturedRequest?.entry_at).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/,
  );
  await expect
    .poll(async () =>
      readingEntry.evaluate(
        (entry) => entry.getBoundingClientRect().top,
      ),
    )
    .toBeCloseTo(readingEntryTop, 0);

  await page.getByRole("button", { name: "View new Entry" }).click();
  const savedEntry = page.locator("#entry-new-entry");
  await expect(
    savedEntry.getByText(
      "完成 API 串接。\n保留這一整段 Original Content。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(savedEntry.getByText("AI processing pending")).toBeVisible();
  await expect(
    savedEntry.getByText("Entry Time", { exact: true }),
  ).toBeVisible();
  await expect(savedEntry.getByText(/Captured/)).toBeVisible();
});

test("authenticated Today rolls over at Asia Taipei midnight", async ({
  page,
}) => {
  await page.clock.install({
    time: new Date("2026-07-27T15:59:00Z"),
  });
  const ownerAccessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ accessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: accessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "midnight-refresh-token",
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
    { accessToken: ownerAccessToken, userId: ownerId },
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
  await page.route("**/auth/v1/logout**", async (route) => {
    await route.fulfill({ status: 204 });
  });

  let todayRequests = 0;
  let apiToday = "2026-07-27";
  let capturedRequest:
    | {
        entry_at?: string;
        original_content?: string;
      }
    | undefined;
  await page.route("**/entries**", async (route) => {
    if (route.request().method() === "POST") {
      capturedRequest = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        json: {
          created_at: "2026-07-27T16:00:00+00:00",
          current_revision_id: "midnight-revision",
          entry_at: "2026-07-27T16:00:00+00:00",
          id: "midnight-entry",
          original_content: "First Entry after Taipei midnight.",
          owner_date: "2026-07-28",
          processing_state: "pending",
          revision_number: 1,
        },
        status: 201,
      });
      return;
    }

    todayRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: apiToday,
        groups: [],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });

  await page.goto("diary.html");
  await expect(page.getByText("2026-07-27", { exact: true })).toBeVisible();
  const requestsBeforeMidnight = todayRequests;
  apiToday = "2026-07-28";

  await page.clock.runFor("01:00");

  await expect(page.getByText("2026-07-28", { exact: true })).toBeVisible();
  expect(todayRequests).toBeGreaterThan(requestsBeforeMidnight);

  await page.getByRole("button", { name: "New Entry" }).click();
  await page
    .getByLabel("Original Content")
    .fill("First Entry after Taipei midnight.");
  await page.getByRole("button", { name: "Save Entry" }).click();

  expect(capturedRequest).toEqual({
    entry_at: "2026-07-28T00:00:00+08:00",
    original_content: "First Entry after Taipei midnight.",
  });
  await expect(page.locator("#entry-midnight-entry")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Diary" }),
  ).toBeVisible();
  const requestsAfterUnmount = todayRequests;

  await page.clock.fastForward("24:00:00");

  expect(todayRequests).toBe(requestsAfterUnmount);
});

test("mobile backdated capture stays outside Today but remains viewable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ownerAccessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ accessToken, userId }) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: accessToken,
          expires_at: expiresAt,
          expires_in: 3600,
          refresh_token: "mobile-capture-refresh-token",
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
    { accessToken: ownerAccessToken, userId: ownerId },
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
  let capturedRequest:
    | {
        entry_at?: string;
        original_content?: string;
      }
    | undefined;
  await page.route("**/entries**", async (route) => {
    if (route.request().method() === "POST") {
      capturedRequest = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        json: {
          created_at: "2026-07-27T05:30:10+00:00",
          current_revision_id: "mobile-backdated-revision",
          entry_at: "2026-07-24T15:30:00+00:00",
          id: "mobile-backdated-entry",
          original_content: "補記手機上的面試準備。",
          owner_date: "2026-07-24",
          processing_state: "pending",
          revision_number: 1,
        },
        status: 201,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-07-27",
        groups: [],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });

  await page.goto("diary.html");
  await expect(page.getByText("2026-07-27", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Entry" }).click();
  const composer = page.getByRole("dialog", { name: "New Entry" });
  await expect(composer).toBeVisible();
  const composerBox = await composer.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox?.x).toBeGreaterThanOrEqual(0);
  expect((composerBox?.x ?? 0) + (composerBox?.width ?? 0)).toBeLessThanOrEqual(
    390,
  );

  await page.getByLabel("Original Content").fill("補記手機上的面試準備。");
  await page.getByLabel("Entry Time").fill("2026-07-24T23:30");
  await page.getByRole("button", { name: "Save Entry" }).click();

  expect(capturedRequest).toEqual({
    entry_at: "2026-07-24T23:30:00+08:00",
    original_content: "補記手機上的面試準備。",
  });
  await expect(page.getByText("2026-07-27", { exact: true })).toBeVisible();
  await expect(
    page.locator("#entry-mobile-backdated-entry"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "View new Entry" }).click();
  const savedEntryDialog = page.getByRole("dialog", {
    name: "Saved Entry",
  });
  await expect(savedEntryDialog).toContainText("補記手機上的面試準備。");
  await expect(savedEntryDialog).toContainText("AI processing pending");
});
