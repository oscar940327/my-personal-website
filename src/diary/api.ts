import { readDiaryPublicConfig } from "./config";

export type HealthState = "checking" | "ready" | "unavailable";

type HealthResponse = {
  service: string;
  status: string;
};

export async function checkDiaryApi(
  signal: AbortSignal,
): Promise<Exclude<HealthState, "checking">> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/health`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
      signal,
    });

    if (!response.ok) {
      return "unavailable";
    }

    const body = (await response.json()) as HealthResponse;
    return body.service === "diary-api" && body.status === "ready"
      ? "ready"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

type OwnerResponse = {
  owner_id: string;
  status: string;
};

export type ProtectedAccess =
  | { state: "ready" }
  | { state: "unauthorized" }
  | { state: "unavailable" };

export async function checkProtectedOwnerAccess(
  accessToken: string,
  signal: AbortSignal,
): Promise<ProtectedAccess> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/auth/me`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });

    if (response.status === 401) {
      return { state: "unauthorized" };
    }
    if (!response.ok) {
      return { state: "unavailable" };
    }

    const body = (await response.json()) as OwnerResponse;
    return body.status === "authenticated" && Boolean(body.owner_id)
      ? { state: "ready" }
      : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

export type EntryRecord = {
  created_at: string;
  current_revision_id: string;
  entry_at: string;
  id: string;
  original_content: string;
  owner_date: string;
  processing_state:
    | "pending"
    | "processing"
    | "ready"
    | "failed"
    | "blocked_budget";
  revision_number: number;
};

export type EntryDateGroup = {
  date: string;
  entries: EntryRecord[];
};

export type EntryRevision = {
  created_at: string;
  entry_id: string;
  id: string;
  is_current: boolean;
  original_content: string;
  revision_number: number;
};

export type EntryRevisionHistory = {
  current_revision_id: string;
  entry_id: string;
  revisions: EntryRevision[];
};

type EditConflictResponse = {
  detail: {
    code: "stale_entry_revision";
    current_entry: EntryRecord;
    message: string;
  };
};

type RestoreConflictResponse = {
  detail: {
    code: "stale_entry_revision";
    current_entry: EntryRecord;
    message: string;
  };
};

export class EntryEditConflict extends Error {
  readonly currentEntry: EntryRecord;

  constructor(currentEntry: EntryRecord) {
    super("Original Content changed after this editor opened.");
    this.name = "EntryEditConflict";
    this.currentEntry = currentEntry;
  }
}

export class EntryRestoreConflict extends Error {
  readonly currentEntry: EntryRecord;

  constructor(currentEntry: EntryRecord) {
    super("Original Content changed after this restore was prepared.");
    this.name = "EntryRestoreConflict";
    this.currentEntry = currentEntry;
  }
}

export type HistoryDirection = "older" | "newer";

export type HistoryPage = {
  anchor_date: string;
  groups: EntryDateGroup[];
  newer_cursor: string | null;
  older_cursor: string | null;
};

export type CalendarDay = {
  date: string;
  entry_count: number;
};

export type CalendarMonth = {
  days: CalendarDay[];
  month: string;
  time_zone: "Asia/Taipei";
};

export async function loadCalendarMonth(
  accessToken: string,
  month: string,
  signal: AbortSignal,
): Promise<CalendarMonth> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const parameters = new URLSearchParams({ month });
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/entries/calendar?${parameters}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    },
  );
  if (!response.ok) {
    throw new Error("Diary could not load the calendar");
  }
  return (await response.json()) as CalendarMonth;
}

export async function loadHistoryEntries(
  accessToken: string,
  input: {
    anchorDate?: string;
    cursor?: string;
    direction?: HistoryDirection;
    limit?: number;
  },
  signal: AbortSignal,
): Promise<HistoryPage> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const parameters = new URLSearchParams();
  if (input.anchorDate) {
    parameters.set("anchor_date", input.anchorDate);
  }
  if (input.cursor) {
    parameters.set("cursor", input.cursor);
  }
  if (input.direction) {
    parameters.set("direction", input.direction);
  }
  if (input.limit) {
    parameters.set("limit", String(input.limit));
  }
  const query = parameters.toString();
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/entries/history${
      query ? `?${query}` : ""
    }`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    },
  );
  if (!response.ok) {
    throw new Error("Diary could not load history");
  }
  return (await response.json()) as HistoryPage;
}

export async function loadTodayEntries(
  accessToken: string,
  signal: AbortSignal,
): Promise<EntryDateGroup> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/entries/today`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    },
  );
  if (!response.ok) {
    throw new Error("Diary could not load today's Entries");
  }
  return (await response.json()) as EntryDateGroup;
}

export async function createEntry(
  accessToken: string,
  input: {
    entry_at: string;
    original_content: string;
  },
  idempotencyKey: string,
): Promise<EntryRecord> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/entries`,
    {
      body: JSON.stringify(input),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error("Diary could not save the Entry");
  }
  return (await response.json()) as EntryRecord;
}

export async function replaceOriginalContent(
  accessToken: string,
  entryId: string,
  input: {
    expected_current_revision_id: string;
    original_content: string;
  },
): Promise<EntryRecord> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/entries/${entryId}/original-content`,
    {
      body: JSON.stringify(input),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "PUT",
    },
  );
  if (response.status === 409) {
    const conflict = (await response.json()) as EditConflictResponse;
    if (
      conflict.detail?.code === "stale_entry_revision" &&
      conflict.detail.current_entry
    ) {
      throw new EntryEditConflict(conflict.detail.current_entry);
    }
  }
  if (!response.ok) {
    throw new Error("Diary could not edit Original Content");
  }
  return (await response.json()) as EntryRecord;
}

export async function loadEntryRevisions(
  accessToken: string,
  entryId: string,
  signal: AbortSignal,
): Promise<EntryRevisionHistory> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/entries/${entryId}/revisions`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    },
  );
  if (!response.ok) {
    throw new Error("Diary could not load revision history");
  }
  return (await response.json()) as EntryRevisionHistory;
}

export async function restoreEntryRevision(
  accessToken: string,
  entryId: string,
  input: {
    expected_current_revision_id: string;
    selected_revision_id: string;
  },
): Promise<EntryRecord> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, "")}/entries/${entryId}/revision-restorations`,
    {
      body: JSON.stringify(input),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  if (response.status === 409) {
    const conflict = (await response.json()) as RestoreConflictResponse;
    if (
      conflict.detail?.code === "stale_entry_revision" &&
      conflict.detail.current_entry
    ) {
      throw new EntryRestoreConflict(conflict.detail.current_entry);
    }
  }
  if (!response.ok) {
    throw new Error("Diary could not restore the historical revision");
  }
  return (await response.json()) as EntryRecord;
}
