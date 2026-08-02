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

test("stale editor shows current content and retries only after owner confirmation", async ({
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
          refresh_token: "revision-conflict-refresh-token",
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

  const originalEntry = {
    created_at: "2026-08-01T04:00:00Z",
    current_revision_id: "revision-1",
    entry_at: "2026-08-01T04:00:00Z",
    id: "entry-1",
    original_content: "Original content opened by both clients.",
    owner_date: "2026-08-01",
    processing_state: "pending",
    revision_number: 1,
  };
  const currentEntry = {
    ...originalEntry,
    current_revision_id: "revision-2",
    original_content: "Current content saved by the other client.",
    revision_number: 2,
  };
  const replacement = "Owner keeps this complete replacement for retry.";
  const editRequests: Array<Record<string, string>> = [];

  await page.route("**/entries/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-08-01",
        groups: [{ date: "2026-08-01", entries: [originalEntry] }],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });
  await page.route("**/entries/entry-1/original-content", async (route) => {
    const request = route.request().postDataJSON() as Record<string, string>;
    editRequests.push(request);
    if (editRequests.length === 1) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          detail: {
            code: "stale_entry_revision",
            current_entry: currentEntry,
            message: "Original Content changed after this editor opened.",
          },
        },
        status: 409,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...currentEntry,
        current_revision_id: "revision-3",
        original_content: replacement,
        revision_number: 3,
      },
      status: 200,
    });
  });

  await page.goto("diary.html");
  const entry = page.locator("#entry-entry-1");
  await expect(entry).toContainText(originalEntry.original_content);
  await entry.getByText("Entry actions", { exact: true }).click();
  await entry.getByRole("button", { name: "Edit Original Content" }).click();

  const editor = page.getByRole("dialog", { name: "Edit Original Content" });
  const replacementField = editor.getByLabel("Replacement Original Content");
  await replacementField.fill(replacement);
  await editor.getByRole("button", { name: "Save replacement" }).click();

  await expect(editor.getByRole("alert")).toContainText(
    "Another edit saved Revision 2",
  );
  await expect(editor.getByRole("alert")).toContainText(
    currentEntry.original_content,
  );
  await expect(replacementField).toHaveValue(replacement);
  expect(editRequests[0]).toEqual({
    expected_current_revision_id: "revision-1",
    original_content: replacement,
  });

  await editor
    .getByRole("button", { name: "Keep editing against Revision 2" })
    .click();
  await editor.getByRole("button", { name: "Save replacement" }).click();

  await expect(editor).not.toBeVisible();
  await expect(page.locator("#entry-entry-1")).toContainText(replacement);
  expect(editRequests[1]).toEqual({
    expected_current_revision_id: "revision-2",
    original_content: replacement,
  });
});

test("owner explicitly confirms restoring a historical revision as new current content", async ({
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
          refresh_token: "revision-restore-refresh-token",
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

  const currentEntry = {
    created_at: "2026-08-01T04:00:00Z",
    current_revision_id: "revision-2",
    entry_at: "2026-08-01T04:00:00Z",
    id: "entry-restore",
    original_content: "Revision 2 current content.",
    owner_date: "2026-08-01",
    processing_state: "pending",
    revision_number: 2,
  };
  const restoredEntry = {
    ...currentEntry,
    current_revision_id: "revision-3",
    original_content: "Revision 1 historical content.",
    revision_number: 3,
  };
  const restoreRequests: Array<Record<string, string>> = [];

  await page.route("**/entries/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-08-01",
        groups: [{ date: "2026-08-01", entries: [currentEntry] }],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });
  await page.route("**/entries/entry-restore/revisions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        current_revision_id: "revision-2",
        entry_id: "entry-restore",
        revisions: [
          {
            created_at: "2026-08-01T05:00:00Z",
            entry_id: "entry-restore",
            id: "revision-2",
            is_current: true,
            original_content: "Revision 2 current content.",
            revision_number: 2,
          },
          {
            created_at: "2026-08-01T04:00:00Z",
            entry_id: "entry-restore",
            id: "revision-1",
            is_current: false,
            original_content: "Revision 1 historical content.",
            revision_number: 1,
          },
        ],
      },
      status: 200,
    });
  });
  await page.route(
    "**/entries/entry-restore/revision-restorations",
    async (route) => {
      restoreRequests.push(
        route.request().postDataJSON() as Record<string, string>,
      );
      await route.fulfill({
        contentType: "application/json",
        json: restoredEntry,
        status: 200,
      });
    },
  );

  await page.goto("diary.html");
  const entry = page.locator("#entry-entry-restore");
  await entry.getByText("Entry actions", { exact: true }).click();
  await entry.getByRole("button", { name: "View revision history" }).click();

  const history = page.getByRole("dialog", { name: "Revision History" });
  await history.getByRole("button", { name: "Restore Revision 1" }).click();
  const confirmation = history.getByRole("alertdialog", {
    name: "Restore Revision 1?",
  });
  await expect(confirmation).toContainText(
    "copies Revision 1 into a new Revision 3",
  );
  await expect(confirmation).toContainText(
    "Revision 1 and Revision 2 remain unchanged",
  );
  expect(restoreRequests).toEqual([]);

  await confirmation.getByRole("button", { name: "Confirm restore" }).click();

  await expect(history).not.toBeVisible();
  await expect(entry).toContainText("Revision 1 historical content.");
  expect(restoreRequests).toEqual([
    {
      expected_current_revision_id: "revision-2",
      selected_revision_id: "revision-1",
    },
  ]);
});

test("stale restore shows the newer current revision without retrying", async ({
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
          refresh_token: "stale-restore-refresh-token",
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

  const openedEntry = {
    created_at: "2026-08-01T04:00:00Z",
    current_revision_id: "revision-2",
    entry_at: "2026-08-01T04:00:00Z",
    id: "entry-stale-restore",
    original_content: "Revision 2 opened by this client.",
    owner_date: "2026-08-01",
    processing_state: "pending",
    revision_number: 2,
  };
  const newerEntry = {
    ...openedEntry,
    current_revision_id: "revision-3",
    original_content: "Revision 3 saved by another client.",
    revision_number: 3,
  };
  let restoreRequestCount = 0;

  await page.route("**/entries/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2026-08-01",
        groups: [{ date: "2026-08-01", entries: [openedEntry] }],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });
  await page.route(
    "**/entries/entry-stale-restore/revisions",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          current_revision_id: "revision-2",
          entry_id: "entry-stale-restore",
          revisions: [
            {
              created_at: "2026-08-01T05:00:00Z",
              entry_id: "entry-stale-restore",
              id: "revision-2",
              is_current: true,
              original_content: "Revision 2 opened by this client.",
              revision_number: 2,
            },
            {
              created_at: "2026-08-01T04:00:00Z",
              entry_id: "entry-stale-restore",
              id: "revision-1",
              is_current: false,
              original_content: "Revision 1 selected for restore.",
              revision_number: 1,
            },
          ],
        },
        status: 200,
      });
    },
  );
  await page.route(
    "**/entries/entry-stale-restore/revision-restorations",
    async (route) => {
      restoreRequestCount += 1;
      await route.fulfill({
        contentType: "application/json",
        json: {
          detail: {
            code: "stale_entry_revision",
            current_entry: newerEntry,
            message:
              "Original Content changed after this restore was prepared.",
          },
        },
        status: 409,
      });
    },
  );

  await page.goto("diary.html");
  const entry = page.locator("#entry-entry-stale-restore");
  await entry.getByText("Entry actions", { exact: true }).click();
  await entry.getByRole("button", { name: "View revision history" }).click();
  const history = page.getByRole("dialog", { name: "Revision History" });
  await history.getByRole("button", { name: "Restore Revision 1" }).click();
  await history.getByRole("button", { name: "Confirm restore" }).click();

  await expect(history.getByRole("alert")).toContainText(
    "Restore was not applied because Revision 3 is now current",
  );
  await expect(entry).toContainText("Revision 3 saved by another client.");
  await expect(
    history.getByRole("button", { name: "Confirm restore" }),
  ).not.toBeVisible();
  expect(restoreRequestCount).toBe(1);
});
