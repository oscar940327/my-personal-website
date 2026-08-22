import { expect, type Page, test } from "@playwright/test";

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

async function authenticateOwner(page: Page, refreshToken: string) {
  const accessToken = unsignedAccessToken(ownerId);
  await page.addInitScript(
    ({ ownerAccessToken, token, userId }) => {
      window.localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: ownerAccessToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: token,
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
    { ownerAccessToken: accessToken, token: refreshToken, userId: ownerId },
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
}

test("owner moves an Entry to recoverable Trash and restores it to its Taipei date", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2050-04-05T12:00:00+08:00"));
  await authenticateOwner(page, "trash-restore-refresh-token");
  const activeEntry = {
    created_at: "2050-04-05T15:00:00.000001Z",
    current_revision_id: "trash-revision-2",
    entry_at: "2050-04-05T15:59:59.123456Z",
    id: "entry-trash-restore",
    original_content: "Complete current Original Content in recoverable Trash.",
    owner_date: "2050-04-05",
    processing_state: "pending",
    revision_number: 2,
  };
  const trashEntry = {
    ...activeEntry,
    revision_count: 2,
    trashed_at: "2050-04-06T01:02:03.000004Z",
  };
  let isTrashed = false;
  const trashRequests: Array<{ method: string; url: string }> = [];
  const restoreRequests: Array<{ method: string; url: string }> = [];
  const permanentDeleteRequests: Array<Record<string, string>> = [];

  await page.route("**/entries/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2050-04-05",
        groups: [
          { date: "2050-04-05", entries: isTrashed ? [] : [activeEntry] },
        ],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });
  await page.route("**/entries/entry-trash-restore/trash", async (route) => {
    trashRequests.push({
      method: route.request().method(),
      url: route.request().url(),
    });
    isTrashed = true;
    await route.fulfill({
      contentType: "application/json",
      json: trashEntry,
      status: 200,
    });
  });
  await page.route("**/trash/entry-trash-restore/restore", async (route) => {
    restoreRequests.push({
      method: route.request().method(),
      url: route.request().url(),
    });
    isTrashed = false;
    await route.fulfill({
      contentType: "application/json",
      json: activeEntry,
      status: 200,
    });
  });
  await page.route("**/trash/entry-trash-restore", async (route) => {
    permanentDeleteRequests.push(
      (route.request().postDataJSON() ?? {}) as Record<string, string>,
    );
    await route.fulfill({ status: 204 });
  });
  await page.route("**/diary-api/trash", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { entries: isTrashed ? [trashEntry] : [] },
      status: 200,
    });
  });
  await page.route("**/entries/calendar**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        days: isTrashed
          ? []
          : [{ date: "2050-04-05", entry_count: 1 }],
        month: "2050-04",
        time_zone: "Asia/Taipei",
      },
      status: 200,
    });
  });

  await page.goto("diary.html?date=2050-04-05");
  const card = page.locator("#entry-entry-trash-restore");
  await card.getByText("Entry actions", { exact: true }).click();
  await card.getByRole("button", { name: "Move to Trash" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Move Entry to Trash?",
  });
  await expect(confirmation).toContainText(
    "This is recoverable and does not permanently delete any revision.",
  );
  await confirmation
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();

  await expect(card).toHaveCount(0);
  expect(trashRequests).toEqual([
    { method: "POST", url: expect.stringContaining("/entries/entry-trash-restore/trash") },
  ]);
  expect(permanentDeleteRequests).toEqual([]);

  await page.getByRole("button", { name: "Trash" }).click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  const trashCard = page.locator("#trash-entry-entry-trash-restore");
  await expect(trashCard).toContainText(activeEntry.original_content);
  await expect(trashCard).toContainText("2050-04-05");
  await expect(trashCard).toContainText("2 revisions");
  await expect(trashCard).toContainText("Trashed");
  await trashCard.getByRole("button", { name: "Restore" }).click();

  await expect(trashCard).toHaveCount(0);
  await expect(
    page.getByText("Entry restored to 2050-04-05 (Asia/Taipei)."),
  ).toBeVisible();
  expect(restoreRequests).toEqual([
    { method: "POST", url: expect.stringContaining("/trash/entry-trash-restore/restore") },
  ]);
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.locator("#entry-entry-trash-restore")).toContainText(
    activeEntry.original_content,
  );
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(
    page.getByRole("button", { name: "April 5, 2050, 1 Entry" }),
  ).toBeVisible();
});

test("permanent deletion requires manually typed exact confirmation", async ({
  page,
}) => {
  await authenticateOwner(page, "permanent-delete-refresh-token");
  const trashEntry = {
    created_at: "2053-05-06T07:08:09Z",
    current_revision_id: "permanent-revision-3",
    entry_at: "2053-05-06T07:08:09Z",
    id: "entry-permanent-delete",
    original_content: "Entry awaiting deliberate permanent deletion.",
    owner_date: "2053-05-06",
    processing_state: "pending",
    revision_count: 3,
    revision_number: 3,
    trashed_at: "2053-05-07T08:09:10Z",
  };
  let deleted = false;
  const deleteBodies: Array<Record<string, string>> = [];

  await page.route("**/entries/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        anchor_date: "2053-05-06",
        groups: [{ date: "2053-05-06", entries: [] }],
        newer_cursor: null,
        older_cursor: null,
      },
      status: 200,
    });
  });
  await page.route("**/trash/entry-permanent-delete", async (route) => {
    deleteBodies.push(
      route.request().postDataJSON() as Record<string, string>,
    );
    deleted = true;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/diary-api/trash", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { entries: deleted ? [] : [trashEntry] },
      status: 200,
    });
  });

  await page.goto("diary.html?date=2053-05-06");
  await page.getByRole("button", { name: "Trash" }).click();
  const trashCard = page.locator("#trash-entry-entry-permanent-delete");
  await trashCard.getByRole("button", { name: "Delete permanently" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Permanently delete Entry?",
  });
  const confirmation = dialog.getByLabel(
    "Type PERMANENTLY DELETE to confirm",
  );
  const submit = dialog.getByRole("button", { name: "Permanently delete" });

  await expect(submit).toBeDisabled();
  await confirmation.fill("Permanently Delete");
  await expect(submit).toBeDisabled();
  expect(deleteBodies).toEqual([]);
  await confirmation.fill("PERMANENTLY DELETE");
  await expect(submit).toBeEnabled();
  await submit.click();

  expect(deleteBodies).toEqual([
    { confirmation: "PERMANENTLY DELETE" },
  ]);
  await expect(trashCard).toHaveCount(0);
  await expect(page.getByText("Entry permanently deleted.")).toBeVisible();
});
