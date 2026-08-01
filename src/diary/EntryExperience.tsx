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
  EntryEditConflict,
  type EntryDateGroup,
  type EntryRecord,
  type EntryRevisionHistory,
  type HistoryDirection,
  loadEntryRevisions,
  loadHistoryEntries,
  replaceOriginalContent,
} from "./api";
import { CalendarView } from "./CalendarView";
import {
  millisecondsUntilNextTaipeiMidnight,
  taipeiDateTimeInputValue,
} from "./ownerClock";

type EntryExperienceProps = {
  accessToken: string;
  onSignOut: () => Promise<void>;
};

type ReadingAnchor = {
  elementId: string;
  viewportTop: number;
};

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

type EntryCardProps = {
  entry: EntryRecord;
  onEdit: (entry: EntryRecord) => void;
  onViewRevisions: (entry: EntryRecord) => void;
};

function EntryCard({
  entry,
  onEdit,
  onViewRevisions,
}: EntryCardProps) {
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
      <details className="diary-entry-actions">
        <summary>Entry actions</summary>
        <div className="diary-entry-actions__menu">
          <button
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onEdit(entry);
            }}
            type="button"
          >
            Edit Original Content
          </button>
          <button
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onViewRevisions(entry);
            }}
            type="button"
          >
            View revision history
          </button>
        </div>
      </details>
    </article>
  );
}

export function EntryExperience({
  accessToken,
  onSignOut,
}: EntryExperienceProps) {
  const requestedAnchorDate = useRef(historyAnchorFromLocation());
  const usesTodayAnchor = requestedAnchorDate.current === undefined;
  const [surface, setSurface] = useState<"history" | "calendar">("history");
  const [historyRequestVersion, setHistoryRequestVersion] = useState(0);
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
  const [editingEntry, setEditingEntry] = useState<EntryRecord | null>(null);
  const [replacementContent, setReplacementContent] = useState("");
  const [expectedRevisionId, setExpectedRevisionId] = useState("");
  const [editState, setEditState] = useState<"idle" | "saving">("idle");
  const [editError, setEditError] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState<EntryRecord | null>(null);
  const [revisionHistoryEntry, setRevisionHistoryEntry] =
    useState<EntryRecord | null>(null);
  const [revisionHistory, setRevisionHistory] =
    useState<EntryRevisionHistory | null>(null);
  const [revisionHistoryState, setRevisionHistoryState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const idempotencyKey = useRef("");
  const preservedScrollPosition = useRef(0);
  const preservedReadingAnchor = useRef<ReadingAnchor | null>(null);
  const pendingHistoryAnchor = useRef<ReadingAnchor | null>(null);
  const adjacentController = useRef<AbortController | null>(null);
  const revisionHistoryController = useRef<AbortController | null>(null);
  const historyGeneration = useRef(0);
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
  }, [accessToken, historyRequestVersion, usesTodayAnchor]);

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
    if (
      !cursor ||
      adjacentLoad !== null ||
      adjacentController.current !== null
    ) {
      return;
    }

    const generation = historyGeneration.current;
    pendingHistoryAnchor.current = captureReadingAnchor();
    setAdjacentError(null);
    setAdjacentLoad(direction);
    const controller = new AbortController();
    adjacentController.current = controller;
    try {
      const page = await loadHistoryEntries(
        accessToken,
        {
          cursor,
          direction,
        },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        generation !== historyGeneration.current
      ) {
        return;
      }
      setEntries((current) =>
        mergeEntries(current, flattenGroups(page.groups))
      );
      if (direction === "older") {
        setOlderCursor(page.older_cursor);
      } else {
        setNewerCursor(page.newer_cursor);
      }
    } catch {
      if (
        controller.signal.aborted ||
        generation !== historyGeneration.current
      ) {
        return;
      }
      pendingHistoryAnchor.current = null;
      setAdjacentError(
        `Diary could not load ${direction} Entries. Try again.`,
      );
    } finally {
      if (adjacentController.current === controller) {
        adjacentController.current = null;
      }
      if (generation === historyGeneration.current) {
        setAdjacentLoad(null);
      }
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

  function openEditor(entry: EntryRecord) {
    setEditingEntry(entry);
    setReplacementContent(entry.original_content);
    setExpectedRevisionId(entry.current_revision_id);
    setEditConflict(null);
    setEditError(null);
  }

  function closeEditor() {
    if (editState === "saving") {
      return;
    }
    setEditingEntry(null);
    setEditConflict(null);
    setEditError(null);
  }

  async function saveReplacement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEntry || !replacementContent.trim()) {
      setEditError("Original Content cannot be blank.");
      return;
    }

    setEditState("saving");
    setEditError(null);
    try {
      const edited = await replaceOriginalContent(
        accessToken,
        editingEntry.id,
        {
          expected_current_revision_id: expectedRevisionId,
          original_content: replacementContent,
        },
      );
      setEntries((current) => mergeEntries(current, [edited]));
      setSavedEntry((current) =>
        current?.id === edited.id ? edited : current
      );
      setEditingEntry(null);
      setEditConflict(null);
    } catch (error) {
      if (error instanceof EntryEditConflict) {
        setEditConflict(error.currentEntry);
        setEntries((current) =>
          mergeEntries(current, [error.currentEntry])
        );
        setSavedEntry((current) =>
          current?.id === error.currentEntry.id
            ? error.currentEntry
            : current
        );
      } else {
        setEditError(
          "Diary could not save this replacement. Your text is still in the editor.",
        );
      }
    } finally {
      setEditState("idle");
    }
  }

  function continueAfterConflict() {
    if (!editConflict) {
      return;
    }
    setEditingEntry(editConflict);
    setExpectedRevisionId(editConflict.current_revision_id);
    setEditConflict(null);
    setEditError(null);
  }

  function handleEditorShortcut(
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

  async function openRevisionHistory(entry: EntryRecord) {
    revisionHistoryController.current?.abort();
    const controller = new AbortController();
    revisionHistoryController.current = controller;
    setRevisionHistoryEntry(entry);
    setRevisionHistory(null);
    setRevisionHistoryState("loading");
    try {
      const history = await loadEntryRevisions(
        accessToken,
        entry.id,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setRevisionHistory(history);
        setRevisionHistoryState("ready");
      }
    } catch {
      if (!controller.signal.aborted) {
        setRevisionHistoryState("unavailable");
      }
    } finally {
      if (revisionHistoryController.current === controller) {
        revisionHistoryController.current = null;
      }
    }
  }

  function closeRevisionHistory() {
    revisionHistoryController.current?.abort();
    revisionHistoryController.current = null;
    setRevisionHistoryEntry(null);
    setRevisionHistory(null);
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

  function jumpToHistoryDate(date: string) {
    historyGeneration.current += 1;
    adjacentController.current?.abort();
    adjacentController.current = null;
    pendingHistoryAnchor.current = null;
    userScrolledHistory.current = false;
    setAdjacentLoad(null);
    setAdjacentError(null);
    setEntries([]);
    setOlderCursor(null);
    setNewerCursor(null);
    requestedAnchorDate.current = date;
    const location = new URL(window.location.href);
    location.searchParams.set("date", date);
    window.history.replaceState({}, "", location);
    setHistoryState("loading");
    setSurface("history");
    setHistoryRequestVersion((current) => current + 1);
  }

  const groups = groupEntries(entries);
  const displayedGroups =
    anchorDate && !groups.some((group) => group.date === anchorDate)
      ? [...groups, { date: anchorDate, entries: [] }].sort((left, right) =>
          right.date.localeCompare(left.date)
        )
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

      <nav aria-label="Diary views" className="diary-view-navigation">
        <button
          aria-pressed={surface === "history"}
          className="diary-secondary-action"
          onClick={() => setSurface("history")}
          type="button"
        >
          History
        </button>
        <button
          aria-pressed={surface === "calendar"}
          className="diary-secondary-action"
          onClick={() => setSurface("calendar")}
          type="button"
        >
          Calendar
        </button>
      </nav>

      {surface === "calendar" ? (
        <CalendarView
          accessToken={accessToken}
          onSelectDate={jumpToHistoryDate}
        />
      ) : (
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
                      {usesTodayAnchor
                        ? "No Entries at or before this date. Capture whatever is on your mind."
                        : entries.length === 0 &&
                            olderCursor === null &&
                            newerCursor === null
                          ? "No active Entries yet. Capture whatever is on your mind."
                          : "No Entries on this date. History continues with nearby Entries."}
                    </p>
                  ) : (
                    <div className="diary-entry-list">
                      {group.entries.map((entry) => (
                        <EntryCard
                          entry={entry}
                          key={entry.id}
                          onEdit={openEditor}
                          onViewRevisions={(selectedEntry) =>
                            void openRevisionHistory(selectedEntry)
                          }
                        />
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
      )}

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
              <EntryCard
                entry={savedEntry}
                onEdit={openEditor}
                onViewRevisions={(selectedEntry) =>
                  void openRevisionHistory(selectedEntry)
                }
              />
            </div>
          </section>
        </div>
      ) : null}

      {editingEntry ? (
        <div className="diary-composer-backdrop">
          <section
            aria-labelledby="diary-editor-title"
            aria-modal="true"
            className="diary-composer"
            role="dialog"
          >
            <div className="diary-composer__heading">
              <div>
                <p className="diary-kicker">
                  Editing from Revision {editingEntry.revision_number}
                </p>
                <h2 id="diary-editor-title">Edit Original Content</h2>
              </div>
              <button
                aria-label="Close Original Content editor"
                className="diary-icon-action"
                onClick={closeEditor}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="diary-composer__form" onSubmit={saveReplacement}>
              <label htmlFor="diary-replacement-original-content">
                Replacement Original Content
              </label>
              <textarea
                autoFocus
                id="diary-replacement-original-content"
                onChange={(event) => setReplacementContent(event.target.value)}
                onKeyDown={handleEditorShortcut}
                rows={12}
                value={replacementContent}
              />
              <p className="diary-composer__hint">
                Saving creates a new immutable Entry Revision. Earlier content
                remains available in revision history.
              </p>
              {editConflict ? (
                <section className="diary-edit-conflict" role="alert">
                  <h3>Newer revision found</h3>
                  <p>
                    Another edit saved Revision {editConflict.revision_number}
                    while this editor was open. Your replacement remains above.
                  </p>
                  <p className="diary-edit-conflict__label">
                    Current Original Content
                  </p>
                  <p className="diary-edit-conflict__content">
                    {editConflict.original_content}
                  </p>
                  <button onClick={continueAfterConflict} type="button">
                    Keep editing against Revision {editConflict.revision_number}
                  </button>
                </section>
              ) : null}
              {editError ? (
                <p className="diary-auth-error" role="alert">
                  {editError}
                </p>
              ) : null}
              <div className="diary-composer__actions">
                <button
                  className="diary-secondary-action"
                  onClick={closeEditor}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={
                    editState === "saving" ||
                    !replacementContent.trim() ||
                    editConflict !== null
                  }
                  type="submit"
                >
                  {editState === "saving"
                    ? "Saving…"
                    : "Save replacement"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {revisionHistoryEntry ? (
        <div className="diary-composer-backdrop">
          <section
            aria-labelledby="diary-revision-history-title"
            aria-modal="true"
            className="diary-composer diary-revision-history"
            role="dialog"
          >
            <div className="diary-composer__heading">
              <div>
                <p className="diary-kicker">
                  Entry revision {revisionHistoryEntry.revision_number}
                </p>
                <h2 id="diary-revision-history-title">Revision History</h2>
              </div>
              <button
                aria-label="Close revision history"
                className="diary-icon-action"
                onClick={closeRevisionHistory}
                type="button"
              >
                ×
              </button>
            </div>
            {revisionHistoryState === "loading" ? (
              <p role="status">Loading revision history…</p>
            ) : revisionHistoryState === "unavailable" ? (
              <p className="diary-auth-error" role="alert">
                Diary could not load revision history.
              </p>
            ) : (
              <div className="diary-revision-list">
                {revisionHistory?.revisions.map((revision) => (
                  <article className="diary-revision" key={revision.id}>
                    <div className="diary-revision__heading">
                      <h3>
                        Revision {revision.revision_number}
                        {revision.is_current ? " · Current" : ""}
                      </h3>
                      <time dateTime={revision.created_at}>
                        {formatTaipei(revision.created_at)}
                      </time>
                    </div>
                    <p>{revision.original_content}</p>
                  </article>
                ))}
              </div>
            )}
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
