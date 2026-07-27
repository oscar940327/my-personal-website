import type {
  FormEvent,
  KeyboardEvent,
} from "react";
import { useEffect, useRef, useState } from "react";

import {
  createEntry,
  type EntryRecord,
  loadTodayEntries,
} from "./api";

type EntryExperienceProps = {
  accessToken: string;
  onSignOut: () => Promise<void>;
};

function taipeiDateTimeInputValue(now = new Date()): string {
  const values = Object.fromEntries(
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
  return (
    `${values.year}-${values.month}-${values.day}` +
    `T${values.hour}:${values.minute}`
  );
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
  const [date, setDate] = useState("");
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [historyState, setHistoryState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
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

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void loadTodayEntries(accessToken, controller.signal)
      .then((group) => {
        if (!current) {
          return;
        }
        setDate(group.date);
        setEntries(group.entries);
        setHistoryState("ready");
      })
      .catch(() => {
        if (current) {
          setHistoryState("unavailable");
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [accessToken]);

  function openComposer() {
    preservedScrollPosition.current = window.scrollY;
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
      if (captured.owner_date === date) {
        setEntries((current) => [
          captured,
          ...current.filter((entry) => entry.id !== captured.id),
        ]);
      }
      setSavedEntry(captured);
      setComposerOpen(false);
      requestAnimationFrame(() => {
        window.scrollTo({ top: preservedScrollPosition.current });
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

      <section className="diary-today" aria-labelledby="diary-today-title">
        <div className="diary-today__heading">
          <div>
            <p className="diary-kicker">Asia/Taipei</p>
            <h2 id="diary-today-title">Today</h2>
          </div>
          {date ? <time dateTime={date}>{date}</time> : null}
        </div>

        {historyState === "loading" ? (
          <p role="status">Loading today&apos;s Entries…</p>
        ) : historyState === "unavailable" ? (
          <p className="diary-auth-error" role="alert">
            Diary could not load today&apos;s Entries.
          </p>
        ) : entries.length === 0 ? (
          <p className="diary-empty">
            No Entries yet today. Capture whatever is on your mind.
          </p>
        ) : (
          <div className="diary-entry-list">
            {entries.map((entry) => (
              <EntryCard entry={entry} key={entry.id} />
            ))}
          </div>
        )}
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
