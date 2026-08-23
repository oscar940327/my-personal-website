import { type FormEvent, useEffect, useState } from "react";

import {
  type EntryRecord,
  loadTrashEntries,
  permanentlyDeleteEntry,
  restoreEntryFromTrash,
  type TrashEntryRecord,
} from "./api";

type TrashViewProps = {
  accessToken: string;
  onRestored: (entry: EntryRecord) => void;
  refreshVersion: number;
};

const PERMANENT_DELETE_CONFIRMATION = "PERMANENTLY DELETE";

function formatTaipei(isoValue: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(isoValue));
}

export function TrashView({
  accessToken,
  onRestored,
  refreshVersion,
}: TrashViewProps) {
  const [entries, setEntries] = useState<TrashEntryRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [operationEntryId, setOperationEntryId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<TrashEntryRecord | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void loadTrashEntries(accessToken, controller.signal)
      .then((listing) => {
        setEntries(listing.entries);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState("unavailable");
        }
      });
    return () => controller.abort();
  }, [accessToken, refreshVersion]);

  async function restore(entry: TrashEntryRecord) {
    setOperationEntryId(entry.id);
    setOperationError(null);
    setStatusMessage(null);
    try {
      const restored = await restoreEntryFromTrash(accessToken, entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setStatusMessage(
        `Entry restored to ${restored.owner_date} (Asia/Taipei).`,
      );
      onRestored(restored);
    } catch {
      setOperationError(
        "Diary could not restore this Entry. Nothing was permanently deleted.",
      );
    } finally {
      setOperationEntryId(null);
    }
  }

  function openPermanentDelete(entry: TrashEntryRecord) {
    setDeleteEntry(entry);
    setConfirmation("");
    setOperationError(null);
    setStatusMessage(null);
  }

  function closePermanentDelete() {
    if (operationEntryId !== null) {
      return;
    }
    setDeleteEntry(null);
    setConfirmation("");
    setOperationError(null);
  }

  async function confirmPermanentDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !deleteEntry ||
      confirmation !== PERMANENT_DELETE_CONFIRMATION
    ) {
      return;
    }

    const entryId = deleteEntry.id;
    setOperationEntryId(entryId);
    setOperationError(null);
    try {
      await permanentlyDeleteEntry(
        accessToken,
        entryId,
        PERMANENT_DELETE_CONFIRMATION,
      );
      setEntries((current) => current.filter((entry) => entry.id !== entryId));
      setDeleteEntry(null);
      setConfirmation("");
      setStatusMessage("Entry permanently deleted.");
    } catch {
      setOperationError(
        "Diary could not permanently delete this Entry. No partial deletion was applied.",
      );
    } finally {
      setOperationEntryId(null);
    }
  }

  return (
    <section className="diary-trash" aria-labelledby="diary-trash-title">
      <div className="diary-history__heading">
        <div>
          <p className="diary-kicker">Retained until you decide</p>
          <h2 id="diary-trash-title">Trash</h2>
        </div>
      </div>

      {statusMessage ? (
        <p className="diary-trash__status" role="status">
          {statusMessage}
        </p>
      ) : null}
      {state === "loading" ? (
        <p role="status">Loading Trash…</p>
      ) : state === "unavailable" ? (
        <p className="diary-auth-error" role="alert">
          Diary could not load Trash.
        </p>
      ) : entries.length === 0 ? (
        <p className="diary-empty">Trash is empty.</p>
      ) : (
        <div className="diary-trash__list">
          {entries.map((entry) => (
            <article
              className="diary-entry diary-trash-entry"
              id={`trash-entry-${entry.id}`}
              key={entry.id}
            >
              <p className="diary-entry__content">{entry.original_content}</p>
              <dl className="diary-entry__metadata">
                <div>
                  <dt>Entry Date</dt>
                  <dd>{entry.owner_date}</dd>
                </div>
                <div>
                  <dt>Entry Time</dt>
                  <dd>{formatTaipei(entry.entry_at)}</dd>
                </div>
                <div>
                  <dt>Trashed</dt>
                  <dd>{formatTaipei(entry.trashed_at)}</dd>
                </div>
                <div>
                  <dt>History</dt>
                  <dd>
                    {entry.revision_count}{" "}
                    {entry.revision_count === 1 ? "revision" : "revisions"}
                  </dd>
                </div>
              </dl>
              <div className="diary-trash-entry__actions">
                <button
                  className="diary-secondary-action"
                  disabled={operationEntryId !== null}
                  onClick={() => void restore(entry)}
                  type="button"
                >
                  {operationEntryId === entry.id ? "Restoring…" : "Restore"}
                </button>
                <button
                  className="diary-danger-action"
                  disabled={operationEntryId !== null}
                  onClick={() => openPermanentDelete(entry)}
                  type="button"
                >
                  Delete permanently
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {deleteEntry ? (
        <div className="diary-composer-backdrop">
          <section
            aria-labelledby="diary-permanent-delete-title"
            aria-modal="true"
            className="diary-composer"
            role="dialog"
          >
            <div className="diary-composer__heading">
              <div>
                <p className="diary-kicker">Irreversible destruction</p>
                <h2 id="diary-permanent-delete-title">
                  Permanently delete Entry?
                </h2>
              </div>
              <button
                aria-label="Close permanent deletion"
                className="diary-icon-action"
                onClick={closePermanentDelete}
                type="button"
              >
                &times;
              </button>
            </div>
            <form
              className="diary-composer__form"
              onSubmit={confirmPermanentDelete}
            >
              <p className="diary-composer__hint">
                This destroys the Entry, every revision, processing record, and
                current derived or index record. It cannot be undone.
              </p>
              <label htmlFor="diary-permanent-delete-confirmation">
                Type PERMANENTLY DELETE to confirm
              </label>
              <input
                autoComplete="off"
                autoFocus
                id="diary-permanent-delete-confirmation"
                onChange={(event) => setConfirmation(event.target.value)}
                spellCheck={false}
                value={confirmation}
              />
              {operationError ? (
                <p className="diary-auth-error" role="alert">
                  {operationError}
                </p>
              ) : null}
              <div className="diary-composer__actions">
                <button
                  className="diary-secondary-action"
                  disabled={operationEntryId !== null}
                  onClick={closePermanentDelete}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="diary-danger-action"
                  disabled={
                    confirmation !== PERMANENT_DELETE_CONFIRMATION ||
                    operationEntryId !== null
                  }
                  type="submit"
                >
                  {operationEntryId === deleteEntry.id
                    ? "Deleting…"
                    : "Permanently delete"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
