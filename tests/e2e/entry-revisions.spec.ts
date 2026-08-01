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
