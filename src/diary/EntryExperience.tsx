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
  changeEntryTime,
  createEntry,
  EntryEditConflict,
  EntryRestoreConflict,
  type EntryDateGroup,
  type EntryRecord,
  type EntryRevision,
  type EntryRevisionHistory,
  type HistoryDirection,
  loadEntryRevisions,
  loadHistoryEntries,
  replaceOriginalContent,
  restoreEntryRevision,
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

type PendingHistoryAnchor = {
  anchor: ReadingAnchor | null;
  trackRecoveryLayout: boolean;
  viewportOwnership: number;
};

type HistoryWindow = {
  anchorDate: string;
  entries: EntryRecord[];
  newerCursor: string | null;
  olderCursor: string | null;
};

type HistoryRecovery = {
  anchorDate: string;
  activeEntry: EntryRecord;
  navigationAnchor: ReadingAnchor;
  targetEntryCount: number;
};

const HISTORY_PAGE_LIMIT = 20;
const HISTORY_REBUILD_ENTRY_LIMIT = HISTORY_PAGE_LIMIT * 3;
const HISTORY_ANCHOR_SEARCH_PAGE_LIMIT = 5;

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
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const adjustedYear = numericYear - (numericMonth <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const marchBasedMonth = numericMonth + (numericMonth > 2 ? -3 : 9);
  const dayOfYear =
    Math.floor((153 * marchBasedMonth + 2) / 5) + Number(day) - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  const daysSinceUnixEpoch = BigInt(era * 146_097 + dayOfEra - 719_468);
  const utcSeconds =
    daysSinceUnixEpoch * 86_400n +
    BigInt(Number(hour) * 3_600 + Number(minute) * 60 + Number(second)) -
    BigInt(offsetMinutes * 60);
  return (
    utcSeconds * 1_000_000n +
    BigInt(fraction.padEnd(6, "0"))
  );
}

function compareEntries(left: EntryRecord, right: EntryRecord): number {
  const leftEntryTime = timestampMicroseconds(left.entry_at);
  const rightEntryTime = timestampMicroseconds(right.entry_at);
  if (leftEntryTime !== rightEntryTime) {
    return leftEntryTime > rightEntryTime ? -1 : 1;
  }
  return right.id.localeCompare(left.id);
}

function sortEntries(entries: EntryRecord[]): EntryRecord[] {
  return [...entries].sort(compareEntries);
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

async function rebuildHistoryWindow(
  accessToken: string,
  anchorDate: string | undefined,
  activeEntry: EntryRecord,
  targetEntryCount: number,
  signal: AbortSignal,
): Promise<HistoryWindow> {
  const initialPage = await loadHistoryEntries(
    accessToken,
    {
      anchorDate,
      limit: HISTORY_PAGE_LIMIT,
    },
    signal,
  );
  let rebuiltEntries = sortEntries(flattenGroups(initialPage.groups));
  let olderCursor = initialPage.older_cursor;
  let newerCursor = initialPage.newer_cursor;
  const requestedCursors = new Set<string>();
  const boundedTargetEntryCount = Math.max(
    HISTORY_PAGE_LIMIT,
    Math.min(targetEntryCount, HISTORY_REBUILD_ENTRY_LIMIT),
  );
  let requestCount = 1;
  let lastAmbiguousDirection: HistoryDirection | null = null;
  const mandatoryEntries = [activeEntry];

  while (
    (rebuiltEntries.length < boundedTargetEntryCount ||
      mandatoryEntries.some(
        (mandatoryEntry) =>
          !rebuiltEntries.some((entry) => entry.id === mandatoryEntry.id),
      )) &&
    requestCount < HISTORY_ANCHOR_SEARCH_PAGE_LIMIT
  ) {
    const firstEntry = rebuiltEntries[0];
    const lastEntry = rebuiltEntries.at(-1);
    const missingMandatoryEntries = mandatoryEntries.filter(
      (mandatoryEntry) =>
        !rebuiltEntries.some((entry) => entry.id === mandatoryEntry.id),
    );
    const necessaryDirection =
      firstEntry &&
      missingMandatoryEntries.some(
        (mandatoryEntry) => compareEntries(mandatoryEntry, firstEntry) < 0,
      ) &&
      newerCursor
        ? "newer"
        : lastEntry &&
            missingMandatoryEntries.some(
              (mandatoryEntry) => compareEntries(mandatoryEntry, lastEntry) > 0,
            ) &&
            olderCursor
          ? "older"
          : null;
    const ambiguousDirection: HistoryDirection | null =
      olderCursor && newerCursor
        ? lastAmbiguousDirection === "older"
          ? "newer"
          : "older"
        : olderCursor
          ? "older"
          : newerCursor
            ? "newer"
            : null;
    const direction: HistoryDirection | null =
      necessaryDirection ?? ambiguousDirection;
    const cursor = direction === "older" ? olderCursor : newerCursor;
    const requestKey = direction && cursor ? `${direction}:${cursor}` : null;
    if (!direction || !cursor || !requestKey || requestedCursors.has(requestKey)) {
      break;
    }
    requestedCursors.add(requestKey);
    if (!necessaryDirection) {
      lastAmbiguousDirection = direction;
    }
    const page = await loadHistoryEntries(
      accessToken,
      {
        cursor,
        direction,
        limit: HISTORY_PAGE_LIMIT,
      },
      signal,
    );
    rebuiltEntries = mergeEntries(
      rebuiltEntries,
      flattenGroups(page.groups),
    );
    if (direction === "older") {
      olderCursor = page.older_cursor;
    } else {
      newerCursor = page.newer_cursor;
    }
    requestCount += 1;
  }

  if (
    mandatoryEntries.some(
      (mandatoryEntry) =>
        !rebuiltEntries.some((entry) => entry.id === mandatoryEntry.id),
    )
  ) {
    throw new Error("History rebuild did not locate its mandatory Entries");
  }

  return {
    anchorDate: initialPage.anchor_date,
    entries: rebuiltEntries,
    newerCursor,
    olderCursor,
  };
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
  const visibleEntries = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".diary-entry-list .diary-entry",
    ),
  )
    .map((element) => ({
      bounds: element.getBoundingClientRect(),
      element,
    }))
    .filter(
      ({ bounds }) =>
        bounds.bottom > 0 && bounds.top < window.innerHeight,
    );
  const visibleEntry =
    visibleEntries.find(({ bounds }) => bounds.top >= 0) ??
    visibleEntries[0];
  return visibleEntry
    ? {
        elementId: visibleEntry.element.id,
        viewportTop: visibleEntry.bounds.top,
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
  onChangeTime: (
    entry: EntryRecord,
    readingAnchor: ReadingAnchor | null,
  ) => void;
  onEdit: (entry: EntryRecord) => void;
  onViewRevisions: (entry: EntryRecord) => void;
};

function EntryCard({
  entry,
  onChangeTime,
  onEdit,
  onViewRevisions,
}: EntryCardProps) {
  const actionsReadingAnchor = useRef<ReadingAnchor | null>(null);

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
        <summary
          onClick={() => {
            actionsReadingAnchor.current = captureReadingAnchor();
          }}
        >
          Entry actions
        </summary>
        <div className="diary-entry-actions__menu">
          <button
            onClick={(event) => {
              const readingAnchor =
                actionsReadingAnchor.current ?? captureReadingAnchor();
              actionsReadingAnchor.current = null;
              event.currentTarget.closest("details")?.removeAttribute("open");
              onChangeTime(entry, readingAnchor);
            }}
            type="button"
          >
            Change Entry Time
          </button>
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
  const [calendarRequestVersion, setCalendarRequestVersion] = useState(0);
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
  const [historyRecovery, setHistoryRecovery] =
    useState<HistoryRecovery | null>(null);
  const [historyRecoveryState, setHistoryRecoveryState] = useState<
    "idle" | "loading"
  >("idle");
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
  const [timeEditingEntry, setTimeEditingEntry] =
    useState<EntryRecord | null>(null);
  const [replacementEntryTime, setReplacementEntryTime] = useState("");
  const [entryTimeState, setEntryTimeState] = useState<"idle" | "saving">(
    "idle",
  );
  const [entryTimeError, setEntryTimeError] = useState<string | null>(null);
  const [entryTimeConfirmation, setEntryTimeConfirmation] =
    useState<string | null>(null);
  const [revisionHistoryEntry, setRevisionHistoryEntry] =
    useState<EntryRecord | null>(null);
  const [revisionHistory, setRevisionHistory] =
    useState<EntryRevisionHistory | null>(null);
  const [revisionHistoryState, setRevisionHistoryState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [restoreRevision, setRestoreRevision] =
    useState<EntryRevision | null>(null);
  const [restoreState, setRestoreState] = useState<"idle" | "saving">(
    "idle",
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const idempotencyKey = useRef("");
  const preservedScrollPosition = useRef(0);
  const preservedReadingAnchor = useRef<ReadingAnchor | null>(null);
  const entryTimeReadingAnchor = useRef<ReadingAnchor | null>(null);
  const committedHistoryRecovery = useRef<HistoryRecovery | null>(null);
  const pendingHistoryAnchor = useRef<PendingHistoryAnchor | null>(null);
  const activeHistoryAnchorRestoration = useRef<(() => void) | null>(
    null,
  );
  const historyRequestController = useRef<AbortController | null>(null);
  const revisionHistoryController = useRef<AbortController | null>(null);
  const historyGeneration = useRef(0);
  const viewportOwnership = useRef(0);
  const newerBoundary = useRef<HTMLDivElement>(null);
  const olderBoundary = useRef<HTMLDivElement>(null);
  const userScrolledHistory = useRef(false);

  function cancelHistoryAnchorRestoration() {
    const cancel = activeHistoryAnchorRestoration.current;
    activeHistoryAnchorRestoration.current = null;
    cancel?.();
  }

  function claimViewportOwnership() {
    viewportOwnership.current += 1;
    pendingHistoryAnchor.current = null;
    cancelHistoryAnchorRestoration();
  }

  function retireHistoryOwnership(retireOperationState = false) {
    cancelHistoryAnchorRestoration();
    historyGeneration.current += 1;
    historyRequestController.current?.abort();
    historyRequestController.current = null;
    if (retireOperationState) {
      pendingHistoryAnchor.current = null;
      setAdjacentLoad(null);
      setHistoryRecoveryState("idle");
    }
  }

  function beginHistoryRequest() {
    retireHistoryOwnership(true);
    const controller = new AbortController();
    const generation = historyGeneration.current;
    historyRequestController.current = controller;
    return { controller, generation };
  }

  function ownsHistoryRequest(
    controller: AbortController,
    generation: number,
  ) {
    return (
      !controller.signal.aborted &&
      historyRequestController.current === controller &&
      historyGeneration.current === generation
    );
  }

  function finishHistoryRequest(
    controller: AbortController,
    generation: number,
  ) {
    if (!ownsHistoryRequest(controller, generation)) {
      return false;
    }
    historyRequestController.current = null;
    return true;
  }

  useLayoutEffect(() => {
    const pendingAnchor = pendingHistoryAnchor.current;
    if (!pendingAnchor) {
      return;
    }
    pendingHistoryAnchor.current = null;
    const {
      anchor,
      trackRecoveryLayout,
      viewportOwnership: anchorViewportOwnership,
    } = pendingAnchor;
    if (!anchor) {
      return;
    }
    const generation = historyGeneration.current;
    let cancelled = false;
    let frame: number | null = null;
    let observer: ResizeObserver | null = null;

    const cancel = () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      observer?.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      if (activeHistoryAnchorRestoration.current === cancel) {
        activeHistoryAnchorRestoration.current = null;
      }
    };

    const restoreAfterLayout = () => {
      if (cancelled) {
        return;
      }
      if (
        historyGeneration.current !== generation ||
        viewportOwnership.current !== anchorViewportOwnership
      ) {
        cancel();
        return;
      }
      restoreReadingAnchor(anchor);
      if (frame === null) {
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (
            !cancelled &&
            historyGeneration.current === generation &&
            viewportOwnership.current === anchorViewportOwnership
          ) {
            restoreReadingAnchor(anchor);
          }
        });
      }
    };

    if (trackRecoveryLayout) {
      const historySurface = document.querySelector<HTMLElement>(
        ".diary-history",
      );
      const historyGroups = document.querySelector<HTMLElement>(
        ".diary-history-groups",
      );
      if (historySurface || historyGroups) {
        observer = new ResizeObserver(() => {
          if (!cancelled) {
            restoreAfterLayout();
          }
        });
        if (historySurface) {
          observer.observe(historySurface);
        }
        if (historyGroups) {
          observer.observe(historyGroups);
        }
      }
    }
    activeHistoryAnchorRestoration.current = cancel;
    restoreAfterLayout();
    void document.fonts.ready.then(restoreAfterLayout);
    return cancel;
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
      const currentRecovery = committedHistoryRecovery.current;
      const recoveryViewportOwnership = viewportOwnership.current;
      if (currentRecovery) {
        setTimeEditingEntry(null);
        entryTimeReadingAnchor.current = null;
      }
      const request = beginHistoryRequest();
      controller = request.controller;
      setOlderCursor(null);
      setNewerCursor(null);
      setAdjacentError(null);
      setHistoryState("loading");
      try {
        const freshWindow = currentRecovery
          ? await rebuildHistoryWindow(
              accessToken,
              currentRecovery.anchorDate,
              currentRecovery.activeEntry,
              currentRecovery.targetEntryCount,
              controller.signal,
            )
          : await loadHistoryEntries(
              accessToken,
              {
                anchorDate: requestedAnchorDate.current,
              },
              controller.signal,
            ).then((page) => ({
              anchorDate: page.anchor_date,
              entries: sortEntries(flattenGroups(page.groups)),
              newerCursor: page.newer_cursor,
              olderCursor: page.older_cursor,
            }));
        if (
          !current ||
          !ownsHistoryRequest(request.controller, request.generation)
        ) {
          return;
        }
        if (
          currentRecovery &&
          viewportOwnership.current === recoveryViewportOwnership
        ) {
          pendingHistoryAnchor.current = {
            anchor: currentRecovery.navigationAnchor,
            trackRecoveryLayout: true,
            viewportOwnership: recoveryViewportOwnership,
          };
        }
        setAnchorDate(freshWindow.anchorDate);
        setEntries(freshWindow.entries);
        setOlderCursor(freshWindow.olderCursor);
        setNewerCursor(freshWindow.newerCursor);
        setHistoryState("ready");
        if (currentRecovery) {
          setHistoryRecovery(null);
          committedHistoryRecovery.current = null;
        } else {
          setHistoryRecovery((recovery) =>
            recovery &&
            !freshWindow.entries.some(
              (entry) => entry.id === recovery.activeEntry.id,
            )
              ? recovery
              : null,
          );
        }
      } catch {
        if (
          current &&
          ownsHistoryRequest(request.controller, request.generation)
        ) {
          setHistoryState("unavailable");
        }
      } finally {
        finishHistoryRequest(request.controller, request.generation);
        scheduleMidnightRefresh();
      }
    }

    void refreshHistory();
    return () => {
      current = false;
      if (
        controller &&
        historyRequestController.current === controller
      ) {
        retireHistoryOwnership();
      } else {
        controller?.abort();
      }
      if (midnightTimer !== null) {
        window.clearTimeout(midnightTimer);
      }
    };
  }, [accessToken, historyRequestVersion, usesTodayAnchor]);

  useEffect(() => {
    function markUserScrollIntent() {
      userScrolledHistory.current = true;
      claimViewportOwnership();
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
    function markPointerIntent(event: PointerEvent) {
      const verticalScrollbarStart =
        document.documentElement.clientWidth < window.innerWidth
          ? document.documentElement.clientWidth
          : window.innerWidth - 2;
      if (
        event.clientX >= verticalScrollbarStart
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
    window.addEventListener("pointerdown", markPointerIntent);
    return () => {
      window.removeEventListener("wheel", markUserScrollIntent);
      window.removeEventListener("touchmove", markUserScrollIntent);
      window.removeEventListener("keydown", markKeyboardScrollIntent);
      window.removeEventListener("pointerdown", markPointerIntent);
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
      historyRequestController.current !== null
    ) {
      return;
    }

    const request = beginHistoryRequest();
    pendingHistoryAnchor.current = {
      anchor: captureReadingAnchor(),
      trackRecoveryLayout: false,
      viewportOwnership: viewportOwnership.current,
    };
    setAdjacentError(null);
    setAdjacentLoad(direction);
    try {
      const page = await loadHistoryEntries(
        accessToken,
        {
          cursor,
          direction,
        },
        request.controller.signal,
      );
      if (!ownsHistoryRequest(request.controller, request.generation)) {
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
      if (!ownsHistoryRequest(request.controller, request.generation)) {
        return;
      }
      pendingHistoryAnchor.current = null;
      setAdjacentError(
        `Diary could not load ${direction} Entries. Try again.`,
      );
    } finally {
      if (finishHistoryRequest(request.controller, request.generation)) {
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

  function openEntryTimeEditor(
    entry: EntryRecord,
    readingAnchor: ReadingAnchor | null,
  ) {
    entryTimeReadingAnchor.current = readingAnchor;
    setTimeEditingEntry(entry);
    setReplacementEntryTime(
      taipeiDateTimeInputValue(new Date(entry.entry_at)),
    );
    setEntryTimeError(null);
    setEntryTimeConfirmation(null);
  }

  function closeEntryTimeEditor() {
    if (entryTimeState === "saving") {
      return;
    }
    setTimeEditingEntry(null);
    entryTimeReadingAnchor.current = null;
    setEntryTimeError(null);
  }

  async function saveEntryTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!timeEditingEntry || !replacementEntryTime) {
      setEntryTimeError("Entry Time is required.");
      return;
    }

    setEntryTimeState("saving");
    setEntryTimeError(null);
    let changedEntry: EntryRecord | null = null;
    let recovery: HistoryRecovery | null = null;
    let rebuildRequest: ReturnType<typeof beginHistoryRequest> | null = null;
    try {
      const changed = await changeEntryTime(
        accessToken,
        timeEditingEntry.id,
        { entry_at: asTaipeiIso(replacementEntryTime) },
      );
      changedEntry = changed;
      const readingAnchor = entryTimeReadingAnchor.current;
      const navigationViewportTop = Math.max(
        0,
        Math.min(
          readingAnchor?.viewportTop ?? 96,
          Math.max(window.innerHeight - 1, 0),
        ),
      );
      recovery = {
        anchorDate: changed.owner_date,
        activeEntry: changed,
        navigationAnchor: {
          elementId: `entry-${changed.id}`,
          viewportTop: navigationViewportTop,
        },
        targetEntryCount: HISTORY_PAGE_LIMIT,
      };
      committedHistoryRecovery.current = recovery;
      setOlderCursor(null);
      setNewerCursor(null);
      setHistoryRecovery(recovery);
      setSavedEntry((current) =>
        current?.id === changed.id ? changed : current
      );
      setCalendarRequestVersion((current) => current + 1);
      setAdjacentLoad(null);
      setAdjacentError(null);
      setEntryTimeConfirmation(
        `Entry Time changed to ${changed.owner_date} (Asia/Taipei).`,
      );
      setTimeEditingEntry(null);
      entryTimeReadingAnchor.current = null;
      rebuildRequest = beginHistoryRequest();
      const recoveryViewportOwnership = viewportOwnership.current;
      const rebuilt = await rebuildHistoryWindow(
        accessToken,
        recovery.anchorDate,
        recovery.activeEntry,
        recovery.targetEntryCount,
        rebuildRequest.controller.signal,
      );
      if (
        !ownsHistoryRequest(
          rebuildRequest.controller,
          rebuildRequest.generation,
        )
      ) {
        return;
      }
      if (viewportOwnership.current === recoveryViewportOwnership) {
        pendingHistoryAnchor.current = {
          anchor: recovery.navigationAnchor,
          trackRecoveryLayout: true,
          viewportOwnership: recoveryViewportOwnership,
        };
      }
      setEntries(rebuilt.entries);
      setOlderCursor(rebuilt.olderCursor);
      setNewerCursor(rebuilt.newerCursor);
      setHistoryState("ready");
      setHistoryRecovery(null);
      committedHistoryRecovery.current = null;
    } catch {
      const ownsFailedRebuild =
        rebuildRequest === null ||
        ownsHistoryRequest(
          rebuildRequest.controller,
          rebuildRequest.generation,
      );
      if (changedEntry && recovery && ownsFailedRebuild) {
        const committedEntry = changedEntry;
        setEntries((current) => mergeEntries(current, [committedEntry]));
        setHistoryState("ready");
        setTimeEditingEntry(null);
        entryTimeReadingAnchor.current = null;
        setAdjacentError(
          "Entry Time changed, but Diary needs a fresh History snapshot. Refresh History to continue browsing.",
        );
      } else if (!changedEntry) {
        setEntryTimeError(
          "Diary could not change Entry Time. No Entry metadata or revision was changed.",
        );
      }
    } finally {
      if (rebuildRequest) {
        finishHistoryRequest(
          rebuildRequest.controller,
          rebuildRequest.generation,
        );
      }
      setEntryTimeState("idle");
    }
  }

  async function recoverHistory() {
    if (
      !historyRecovery ||
      historyRecoveryState === "loading" ||
      historyRequestController.current !== null
    ) {
      return;
    }

    const recovery = historyRecovery;
    const recoveryTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const request = beginHistoryRequest();
    const recoveryViewportOwnership = viewportOwnership.current;
    setHistoryRecoveryState("loading");
    try {
      const rebuilt = await rebuildHistoryWindow(
        accessToken,
        recovery.anchorDate,
        recovery.activeEntry,
        recovery.targetEntryCount,
        request.controller.signal,
      );
      if (!ownsHistoryRequest(request.controller, request.generation)) {
        return;
      }
      if (document.activeElement === recoveryTrigger) {
        recoveryTrigger?.blur();
      }
      if (viewportOwnership.current === recoveryViewportOwnership) {
        pendingHistoryAnchor.current = {
          anchor: recovery.navigationAnchor,
          trackRecoveryLayout: true,
          viewportOwnership: recoveryViewportOwnership,
        };
      }
      setEntries(rebuilt.entries);
      setOlderCursor(rebuilt.olderCursor);
      setNewerCursor(rebuilt.newerCursor);
      setHistoryState("ready");
      setHistoryRecovery(null);
      committedHistoryRecovery.current = null;
      setAdjacentError(null);
    } catch {
      if (ownsHistoryRequest(request.controller, request.generation)) {
        setAdjacentError(
          "Entry Time changed, but Diary still needs a fresh History snapshot. Refresh History to try again.",
        );
      }
    } finally {
      if (finishHistoryRequest(request.controller, request.generation)) {
        setHistoryRecoveryState("idle");
      }
    }
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
    setRestoreRevision(null);
    setRestoreError(null);
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
    if (restoreState === "saving") {
      return;
    }
    revisionHistoryController.current?.abort();
    revisionHistoryController.current = null;
    setRevisionHistoryEntry(null);
    setRevisionHistory(null);
    setRestoreRevision(null);
    setRestoreError(null);
  }

  async function confirmRevisionRestore() {
    if (!revisionHistoryEntry || !revisionHistory || !restoreRevision) {
      return;
    }

    setRestoreState("saving");
    setRestoreError(null);
    try {
      const restored = await restoreEntryRevision(
        accessToken,
        revisionHistoryEntry.id,
        {
          expected_current_revision_id:
            revisionHistory.current_revision_id,
          selected_revision_id: restoreRevision.id,
        },
      );
      setEntries((current) => mergeEntries(current, [restored]));
      setSavedEntry((current) =>
        current?.id === restored.id ? restored : current
      );
      setRevisionHistoryEntry(null);
      setRevisionHistory(null);
      setRestoreRevision(null);
    } catch (error) {
      if (error instanceof EntryRestoreConflict) {
        setEntries((current) =>
          mergeEntries(current, [error.currentEntry])
        );
        setSavedEntry((current) =>
          current?.id === error.currentEntry.id
            ? error.currentEntry
            : current
        );
        setRevisionHistoryEntry(error.currentEntry);
        setRevisionHistory(null);
        setRevisionHistoryState("ready");
        setRestoreRevision(null);
        setRestoreError(
          `Restore was not applied because Revision ${error.currentEntry.revision_number} is now current. Close and reopen Revision History before trying again.`,
        );
      } else {
        setRestoreError(
          "Diary could not restore this revision. No revision was changed.",
        );
      }
    } finally {
      setRestoreState("idle");
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

  function jumpToHistoryDate(date: string) {
    claimViewportOwnership();
    retireHistoryOwnership();
    pendingHistoryAnchor.current = null;
    userScrolledHistory.current = false;
    setAdjacentLoad(null);
    setAdjacentError(null);
    setHistoryRecovery(null);
    committedHistoryRecovery.current = null;
    setHistoryRecoveryState("idle");
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

  function showCalendar() {
    claimViewportOwnership();
    setSurface("calendar");
  }

  function showHistory() {
    claimViewportOwnership();
    setSurface("history");
  }

  function retryHistory() {
    setHistoryState("loading");
    setHistoryRequestVersion((current) => current + 1);
  }

  const groups = groupEntries(entries);
  const displayedGroups =
    anchorDate && !groups.some((group) => group.date === anchorDate)
      ? [...groups, { date: anchorDate, entries: [] }].sort((left, right) =>
          right.date.localeCompare(left.date)
        )
      : groups;
  const currentHistoryRevision = revisionHistory?.revisions.find(
    (revision) => revision.is_current,
  );

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
          onClick={showHistory}
          type="button"
        >
          History
        </button>
        <button
          aria-pressed={surface === "calendar"}
          className="diary-secondary-action"
          onClick={showCalendar}
          type="button"
        >
          Calendar
        </button>
      </nav>

      {surface === "calendar" ? (
        <CalendarView
          accessToken={accessToken}
          onSelectDate={jumpToHistoryDate}
          refreshVersion={calendarRequestVersion}
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
          <div>
            <p className="diary-auth-error" role="alert">
              Diary could not load history.
            </p>
            <button
              className="diary-secondary-action"
              onClick={retryHistory}
              type="button"
            >
              Retry History
            </button>
          </div>
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
                          onChangeTime={openEntryTimeEditor}
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
        {historyRecovery ? (
          <button
            className="diary-secondary-action"
            disabled={historyRecoveryState === "loading"}
            onClick={() => void recoverHistory()}
            type="button"
          >
            {historyRecoveryState === "loading"
              ? "Refreshing History…"
              : "Refresh History"}
          </button>
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

      {entryTimeConfirmation ? (
        <p className="diary-save-confirmation" role="status">
          {entryTimeConfirmation}
        </p>
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
                onChangeTime={openEntryTimeEditor}
                onEdit={openEditor}
                onViewRevisions={(selectedEntry) =>
                  void openRevisionHistory(selectedEntry)
                }
              />
            </div>
          </section>
        </div>
      ) : null}

      {timeEditingEntry ? (
        <div className="diary-composer-backdrop">
          <section
            aria-labelledby="diary-entry-time-editor-title"
            aria-modal="true"
            className="diary-composer"
            role="dialog"
          >
            <div className="diary-composer__heading">
              <div>
                <p className="diary-kicker">Entry metadata</p>
                <h2 id="diary-entry-time-editor-title">Change Entry Time</h2>
              </div>
              <button
                aria-label="Close Entry Time editor"
                className="diary-icon-action"
                onClick={closeEntryTimeEditor}
                type="button"
              >
                &times;
              </button>
            </div>
            <form className="diary-composer__form" onSubmit={saveEntryTime}>
              <label htmlFor="diary-replacement-entry-time">
                New Entry Time
              </label>
              <input
                autoFocus
                id="diary-replacement-entry-time"
                onChange={(event) =>
                  setReplacementEntryTime(event.target.value)
                }
                required
                type="datetime-local"
                value={replacementEntryTime}
              />
              <p className="diary-composer__hint">
                Changing Entry Time changes Entry metadata only. Captured time
                and Original Content revisions remain unchanged.
              </p>
              <dl className="diary-entry__metadata">
                <div>
                  <dt>Captured</dt>
                  <dd>{formatTaipei(timeEditingEntry.created_at)}</dd>
                </div>
                <div>
                  <dt>Current Revision</dt>
                  <dd>Revision {timeEditingEntry.revision_number}</dd>
                </div>
              </dl>
              {entryTimeError ? (
                <p className="diary-auth-error" role="alert">
                  {entryTimeError}
                </p>
              ) : null}
              <div className="diary-composer__actions">
                <button
                  className="diary-secondary-action"
                  onClick={closeEntryTimeEditor}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={entryTimeState === "saving" || !replacementEntryTime}
                  type="submit"
                >
                  {entryTimeState === "saving" ? "Saving…" : "Save Entry Time"}
                </button>
              </div>
            </form>
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
              <>
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
                      {!revision.is_current ? (
                        <button
                          className="diary-revision__restore"
                          onClick={() => {
                            setRestoreRevision(revision);
                            setRestoreError(null);
                          }}
                          type="button"
                        >
                          Restore Revision {revision.revision_number}
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
                {restoreRevision && revisionHistory ? (
                  <section
                    aria-labelledby="diary-restore-confirmation-title"
                    className="diary-restore-confirmation"
                    role="alertdialog"
                  >
                    <h3 id="diary-restore-confirmation-title">
                      Restore Revision {restoreRevision.revision_number}?
                    </h3>
                    <p>
                      This copies Revision {restoreRevision.revision_number}
                      {" "}into a new Revision{
                        currentHistoryRevision
                          ? ` ${currentHistoryRevision.revision_number + 1}`
                          : ""
                      }. Revision {restoreRevision.revision_number} and Revision{
                        currentHistoryRevision
                          ? ` ${currentHistoryRevision.revision_number}`
                          : ""
                      } remain unchanged.
                    </p>
                    {restoreError ? (
                      <p className="diary-auth-error" role="alert">
                        {restoreError}
                      </p>
                    ) : null}
                    <div className="diary-composer__actions">
                      <button
                        className="diary-secondary-action"
                        disabled={restoreState === "saving"}
                        onClick={() => setRestoreRevision(null)}
                        type="button"
                      >
                        Cancel restore
                      </button>
                      <button
                        disabled={restoreState === "saving"}
                        onClick={() => void confirmRevisionRestore()}
                        type="button"
                      >
                        {restoreState === "saving"
                          ? "Restoring…"
                          : "Confirm restore"}
                      </button>
                    </div>
                  </section>
                ) : restoreError ? (
                  <p className="diary-auth-error" role="alert">
                    {restoreError}
                  </p>
                ) : null}
              </>
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
