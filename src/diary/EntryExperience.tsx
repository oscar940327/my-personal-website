import type {
  FormEvent,
  KeyboardEvent,
} from "react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  createEntry,
  type EntryDateGroup,
  type EntryRecord,
  type HistoryDirection,
  loadHistoryEntries,
} from "./api";

type EntryExperienceProps = {
  accessToken: string;
  onSignOut: () => Promise<void>;
};

type ReadingAnchor = {
  elementId: string;
  viewportTop: number;
};

function taipeiDateTimeParts(now: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Taipei",
      year: "numeric",
    })
      .formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
}

function taipeiDateTimeInputValue(now = new Date()): string {
  const values = taipeiDateTimeParts(now);
  return (
    `${values.year}-${values.month}-${values.day}` +
    `T${values.hour}:${values.minute}`
  );
}

function millisecondsUntilNextTaipeiMidnight(now = new Date()): number {
  const values = taipeiDateTimeParts(now);
  const nextMidnight = (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + 1,
    ) -
    8 * 60 * 60 * 1000
  );
  return Math.max(1, nextMidnight - now.getTime());
}

function asTaipeiIso(inputValue: string): string {
  return `${inputValue}:00+08:00`;
}

function formatTaipei(isoValue: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(isoValue));
}

function historyAnchorFromLocation(): string | undefined {
  const value = new URLSearchParams(window.location.search).get("date");
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined;
}

function flattenGroups(groups: EntryDateGroup[]): EntryRecord[] {
  return groups.flatMap((group) => group.entries);
}

function timestampMicroseconds(isoValue: string): bigint {
  const match = isoValue.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    throw new Error("Entry Time is not a supported ISO timestamp");
  }
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fraction = "",
    offset,
  ] = match;
  const offsetMinutes =
    offset === "Z"
      ? 0
      : (
          Number(offset.slice(1, 3)) * 60 +
          Number(offset.slice(4, 6))
        ) * (offset.startsWith("+") ? 1 : -1);
  const utcMilliseconds =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    offsetMinutes * 60_000;
  return (
    BigInt(utcMilliseconds) * 1_000n +
    BigInt(fraction.padEnd(6, "0"))
  );
}

function sortEntries(entries: EntryRecord[]): EntryRecord[] {
  return [...entries].sort((left, right) => {
    const leftEntryTime = timestampMicroseconds(left.entry_at);
    const rightEntryTime = timestampMicroseconds(right.entry_at);
    if (leftEntryTime !== rightEntryTime) {
      return leftEntryTime > rightEntryTime ? -1 : 1;
    }
    return right.id.localeCompare(left.id);
  });
}

function mergeEntries(
  current: EntryRecord[],
  incoming: EntryRecord[],
): EntryRecord[] {
  const entriesById = new Map(
    current.map((entry) => [entry.id, entry]),
  );
  for (const entry of incoming) {
    entriesById.set(entry.id, entry);
  }
  return sortEntries([...entriesById.values()]);
}

function groupEntries(entries: EntryRecord[]): EntryDateGroup[] {
  const groups: EntryDateGroup[] = [];
  for (const entry of entries) {
    const currentGroup = groups.at(-1);
    if (!currentGroup || currentGroup.date !== entry.owner_date) {
      groups.push({
        date: entry.owner_date,
        entries: [entry],
      });
      continue;
    }
    currentGroup.entries.push(entry);
  }
  return groups;
}

function captureReadingAnchor(): ReadingAnchor | null {
  const visibleEntry = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".diary-entry-list .diary-entry",
    ),
  ).find((entry) => {
    const bounds = entry.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < window.innerHeight;
  });
  return visibleEntry
    ? {
        elementId: visibleEntry.id,
        viewportTop: visibleEntry.getBoundingClientRect().top,
      }
    : null;
}

function restoreReadingAnchor(anchor: ReadingAnchor | null): boolean {
  const anchorElement = anchor
    ? document.getElementById(anchor.elementId)
    : null;
  if (!anchor || !anchorElement) {
    return false;
  }
  const currentTop = anchorElement.getBoundingClientRect().top;
  window.scrollBy({ top: currentTop - anchor.viewportTop });
  return true;
}

function EntryCard({ entry }: { entry: EntryRecord }) {
  return (
    <article className="diary-entry" id={`entry-${entry.id}`}>
      <p className="diary-entry__content">{entry.original_content}</p>
      <dl className="diary-entry__metadata">
        <div>
          <dt>Entry Time</dt>
          <dd>{formatTaipei(entry.entry_at)}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{formatTaipei(entry.created_at)}</dd>
        </div>
      </dl>
      <p className={`diary-processing diary-processing--${entry.processing_state}`}>
        AI processing {entry.processing_state.replace("_", " ")}
      </p>
    </article>
  );
}

export function EntryExperience({
  accessToken,
  onSignOut,
}: EntryExperienceProps) {
  const requestedAnchorDate = useRef(historyAnchorFromLocation());
  const usesTodayAnchor = requestedAnchorDate.current === undefined;
  const [anchorDate, setAnchorDate] = useState("");
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [adjacentLoad, setAdjacentLoad] = useState<
    HistoryDirection | null
  >(null);
  const [adjacentError, setAdjacentError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [content, setContent] = useState("");
  const [entryTime, setEntryTime] = useState("");
  const [captureState, setCaptureState] = useState<
    "idle" | "saving"
  >("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [savedEntry, setSavedEntry] = useState<EntryRecord | null>(null);
  const [savedEntryPreviewOpen, setSavedEntryPreviewOpen] = useState(false);
  const idempotencyKey = useRef("");
  const preservedScrollPosition = useRef(0);
  const preservedReadingAnchor = useRef<ReadingAnchor | null>(null);
  const pendingHistoryAnchor = useRef<ReadingAnchor | null>(null);
  const newerBoundary = useRef<HTMLDivElement>(null);
  const olderBoundary = useRef<HTMLDivElement>(null);
  const userScrolledHistory = useRef(false);

  useLayoutEffect(() => {
    if (pendingHistoryAnchor.current) {
      restoreReadingAnchor(pendingHistoryAnchor.current);
      pendingHistoryAnchor.current = null;
    }
  }, [entries]);

  useEffect(() => {
    let current = true;
    let controller: AbortController | null = null;
    let midnightTimer: number | null = null;

    function scheduleMidnightRefresh() {
      if (!current || !usesTodayAnchor) {
        return;
      }
      midnightTimer = window.setTimeout(() => {
        void refreshHistory();
      }, millisecondsUntilNextTaipeiMidnight());
    }

    async function refreshHistory() {
      controller?.abort();
      controller = new AbortController();
      try {
        const page = await loadHistoryEntries(
          accessToken,
          {
            anchorDate: requestedAnchorDate.current,
          },
          controller.signal,
        );
        if (!current) {
          return;
        }
        setAnchorDate(page.anchor_date);
        setEntries(sortEntries(flattenGroups(page.groups)));
        setOlderCursor(page.older_cursor);
        setNewerCursor(page.newer_cursor);
        setHistoryState("ready");
      } catch {
        if (current) {
          setHistoryState("unavailable");
        }
      } finally {
        scheduleMidnightRefresh();
      }
    }

    void refreshHistory();
    return () => {
      current = false;
      controller?.abort();
      if (midnightTimer !== null) {
        window.clearTimeout(midnightTimer);
      }
    };
  }, [accessToken, usesTodayAnchor]);

  useEffect(() => {
    function markUserScrollIntent() {
      userScrolledHistory.current = true;
    }
    function markKeyboardScrollIntent(event: globalThis.KeyboardEvent) {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "End",
          "Home",
          "PageDown",
          "PageUp",
          " ",
        ].includes(event.key)
      ) {
        markUserScrollIntent();
      }
    }
    window.addEventListener("wheel", markUserScrollIntent, {
      passive: true,
    });
    window.addEventListener("touchmove", markUserScrollIntent, {
      passive: true,
    });
    window.addEventListener("keydown", markKeyboardScrollIntent);
    return () => {
      window.removeEventListener("wheel", markUserScrollIntent);
      window.removeEventListener("touchmove", markUserScrollIntent);
      window.removeEventListener("keydown", markKeyboardScrollIntent);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (observations) => {
        if (
          !userScrolledHistory.current ||
          adjacentLoad !== null
        ) {
          return;
        }
        const visibleBoundary = observations.find(
          (observation) => observation.isIntersecting,
        )?.target;
        const direction =
          visibleBoundary === olderBoundary.current && olderCursor
            ? "older"
            : visibleBoundary === newerBoundary.current && newerCursor
              ? "newer"
              : null;
        if (direction) {
          userScrolledHistory.current = false;
          void loadAdjacentHistory(direction);
        }
      },
      {
        rootMargin: "192px 0px",
      },
    );
    if (newerBoundary.current) {
      observer.observe(newerBoundary.current);
    }
    if (olderBoundary.current) {
      observer.observe(olderBoundary.current);
    }
    return () => observer.disconnect();
  }, [adjacentLoad, newerCursor, olderCursor]);

  async function loadAdjacentHistory(direction: HistoryDirection) {
    const cursor = direction === "older" ? olderCursor : newerCursor;
    if (!cursor || adjacentLoad !== null) {
      return;
    }

    pendingHistoryAnchor.current = captureReadingAnchor();
    setAdjacentError(null);
    setAdjacentLoad(direction);
    const controller = new AbortController();
    try {
      const page = await loadHistoryEntries(
        accessToken,
        {
          cursor,
          direction,
        },
        controller.signal,
      );
      setEntries((current) =>
        mergeEntries(current, flattenGroups(page.groups))
      );
      if (direction === "older") {
        setOlderCursor(page.older_cursor);
      } else {
        setNewerCursor(page.newer_cursor);
      }
    } catch {
      pendingHistoryAnchor.current = null;
      setAdjacentError(
        `Diary could not load ${direction} Entries. Try again.`,
      );
    } finally {
      setAdjacentLoad(null);
    }
  }

  function openComposer() {
    preservedScrollPosition.current = window.scrollY;
    preservedReadingAnchor.current = captureReadingAnchor();
    idempotencyKey.current = crypto.randomUUID();
    setContent("");
    setEntryTime(taipeiDateTimeInputValue());
    setCaptureError(null);
    setComposerOpen(true);
  }

  function closeComposer() {
    if (captureState === "saving") {
      return;
    }
    setComposerOpen(false);
    restoreReadingPosition();
  }

  function restoreReadingPosition() {
    if (restoreReadingAnchor(preservedReadingAnchor.current)) {
      return;
    }
    window.scrollTo({ top: preservedScrollPosition.current });
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) {
      setCaptureError("Original Content cannot be blank.");
      return;
    }

    setCaptureError(null);
    setCaptureState("saving");
    try {
      const captured = await createEntry(
        accessToken,
        {
          entry_at: asTaipeiIso(entryTime),
          original_content: content,
        },
        idempotencyKey.current,
      );
      const loadedDates = new Set(
        entries.map((entry) => entry.owner_date),
      );
      if (
        captured.owner_date === anchorDate ||
        loadedDates.has(captured.owner_date)
      ) {
        setEntries((current) => mergeEntries(current, [captured]));
      }
      setSavedEntry(captured);
      setComposerOpen(false);
      requestAnimationFrame(() => {
        restoreReadingPosition();
      });
    } catch {
      setCaptureError(
        "Diary could not save this Entry. Your text is still in the composer.",
      );
    } finally {
      setCaptureState("idle");
    }
  }

  function handleComposerShortcut(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function viewSavedEntry() {
    if (savedEntry === null) {
      return;
    }
    const entryElement = document.getElementById(
      `entry-${savedEntry.id}`,
    );
    if (entryElement) {
      entryElement.scrollIntoView({ block: "center" });
      return;
    }
    setSavedEntryPreviewOpen(true);
  }

  const groups = groupEntries(entries);
  const displayedGroups =
    groups.length === 0 && anchorDate
      ? [{ date: anchorDate, entries: [] }]
      : usesTodayAnchor &&
          anchorDate &&
          !groups.some((group) => group.date === anchorDate)
        ? [{ date: anchorDate, entries: [] }, ...groups]
      : groups;

  return (
    <>
      <div className="diary-app-header">
        <div>
          <p className="diary-health diary-health--ready" role="status">
            <span aria-hidden="true" />
            Authenticated Diary is ready.
          </p>
        </div>
        <button className="diary-secondary-action" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <section className="diary-history" aria-labelledby="diary-history-title">
        <div className="diary-history__heading">
          <div>
            <p className="diary-kicker">Asia/Taipei</p>
            <h2 id="diary-history-title">History</h2>
          </div>
        </div>

        {newerCursor ? (
          <div
            className="diary-history-boundary diary-history-boundary--newer"
            ref={newerBoundary}
          >
            <button
              className="diary-secondary-action"
              disabled={adjacentLoad !== null}
              onClick={() => void loadAdjacentHistory("newer")}
              type="button"
            >
              {adjacentLoad === "newer"
                ? "Loading newer Entries…"
                : "Load newer Entries"}
            </button>
          </div>
        ) : null}

        {historyState === "loading" ? (
          <p role="status">Loading Diary history…</p>
        ) : historyState === "unavailable" ? (
          <p className="diary-auth-error" role="alert">
            Diary could not load history.
          </p>
        ) : (
          <div className="diary-history-groups">
            {displayedGroups.map((group) => {
              const isToday =
                usesTodayAnchor && group.date === anchorDate;
              const headingId = `diary-date-${group.date}`;
              return (
                <section
                  aria-labelledby={headingId}
                  className="diary-date-group"
                  key={group.date}
                >
                  <div className="diary-date-group__heading">
                    <h3 id={headingId}>
                      {isToday ? "Today" : group.date}
                    </h3>
                    <time dateTime={group.date}>{group.date}</time>
                  </div>
                  {group.entries.length === 0 ? (
                    <p className="diary-empty">
                      No Entries at or before this date. Capture whatever is
                      on your mind.
                    </p>
                  ) : (
                    <div className="diary-entry-list">
                      {group.entries.map((entry) => (
                        <EntryCard entry={entry} key={entry.id} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {olderCursor ? (
          <div
            className="diary-history-boundary diary-history-boundary--older"
            ref={olderBoundary}
          >
            <button
              className="diary-secondary-action"
              disabled={adjacentLoad !== null}
              onClick={() => void loadAdjacentHistory("older")}
              type="button"
            >
              {adjacentLoad === "older"
                ? "Loading older Entries…"
                : "Load older Entries"}
            </button>
          </div>
        ) : null}
        {adjacentError ? (
          <p className="diary-auth-error" role="alert">
            {adjacentError}
          </p>
        ) : null}
      </section>

      <button className="diary-capture-action" onClick={openComposer}>
        New Entry
      </button>

      {savedEntry ? (
        <aside className="diary-save-confirmation" aria-live="polite">
          <span>Entry saved for {savedEntry.owner_date}.</span>
          <button onClick={viewSavedEntry}>View new Entry</button>
        </aside>
      ) : null}

      {savedEntryPreviewOpen && savedEntry ? (
        <div className="diary-composer-backdrop">
          <section
            aria-labelledby="diary-saved-entry-title"
            aria-modal="true"
            className="diary-composer"
            role="dialog"
          >
            <div className="diary-composer__heading">
              <div>
                <p className="diary-kicker">{savedEntry.owner_date}</p>
                <h2 id="diary-saved-entry-title">Saved Entry</h2>
              </div>
              <button
                aria-label="Close saved Entry"
                className="diary-icon-action"
                onClick={() => setSavedEntryPreviewOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="diary-saved-entry-preview">
              <EntryCard entry={savedEntry} />
            </div>
          </section>
        </div>
      ) : null}

      {composerOpen ? (
        <div className="diary-composer-backdrop">
          <section
            aria-labelledby="diary-composer-title"
            aria-modal="true"
            className="diary-composer"
            role="dialog"
          >
            <div className="diary-composer__heading">
              <div>
                <p className="diary-kicker">Capture a moment</p>
                <h2 id="diary-composer-title">New Entry</h2>
              </div>
              <button
                aria-label="Close composer"
                className="diary-icon-action"
                onClick={closeComposer}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="diary-composer__form" onSubmit={saveEntry}>
              <label htmlFor="diary-original-content">
                Original Content
              </label>
              <textarea
                autoFocus
                id="diary-original-content"
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={handleComposerShortcut}
                placeholder="Write freely. No template required."
                rows={9}
                value={content}
              />
              <label htmlFor="diary-entry-time">Entry Time</label>
              <input
                id="diary-entry-time"
                onChange={(event) => setEntryTime(event.target.value)}
                required
                type="datetime-local"
                value={entryTime}
              />
              <p className="diary-composer__hint">
                Defaults to now in Asia/Taipei. Change it only for a late or
                backdated Entry. Press Ctrl/Cmd + Enter to save.
              </p>
              {captureError ? (
                <p className="diary-auth-error" role="alert">
                  {captureError}
                </p>
              ) : null}
              <div className="diary-composer__actions">
                <button
                  className="diary-secondary-action"
                  onClick={closeComposer}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={
                    captureState === "saving" || !content.trim()
                  }
                  type="submit"
                >
                  {captureState === "saving" ? "Saving…" : "Save Entry"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
