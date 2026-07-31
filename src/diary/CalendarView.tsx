import { useEffect, useMemo, useState } from "react";

import {
  type CalendarDay,
  loadCalendarMonth,
} from "./api";

type CalendarViewProps = {
  accessToken: string;
  onSelectDate: (date: string) => void;
};

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function taipeiToday(now = new Date()): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Taipei",
      year: "numeric",
    })
      .formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function adjacentMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthTitle(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function monthDates(month: string): Array<string | null> {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(
    Date.UTC(year, monthNumber - 1, 1),
  ).getUTCDay();
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from(
      { length: dayCount },
      (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
    ),
  ];
}

export function CalendarView({
  accessToken,
  onSelectDate,
}: CalendarViewProps) {
  const today = taipeiToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const dates = useMemo(() => monthDates(month), [month]);
  const counts = useMemo(
    () => new Map(days.map((day) => [day.date, day.entry_count])),
    [days],
  );

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void loadCalendarMonth(accessToken, month, controller.signal)
      .then((calendar) => {
        setDays(calendar.days);
        setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState("unavailable");
        }
      });
    return () => controller.abort();
  }, [accessToken, month]);

  return (
    <section className="diary-calendar" aria-labelledby="diary-calendar-title">
      <div className="diary-calendar__heading">
        <div>
          <p className="diary-kicker">Asia/Taipei</p>
          <h2 id="diary-calendar-title">Calendar</h2>
        </div>
        <div className="diary-calendar__month-navigation">
          <button
            aria-label="Previous month"
            className="diary-icon-action"
            onClick={() => setMonth((current) => adjacentMonth(current, -1))}
            type="button"
          >
            &larr;
          </button>
          <p aria-live="polite">{monthTitle(month)}</p>
          <button
            aria-label="Next month"
            className="diary-icon-action"
            onClick={() => setMonth((current) => adjacentMonth(current, 1))}
            type="button"
          >
            &rarr;
          </button>
        </div>
      </div>

      {state === "loading" ? (
        <p role="status">Loading Diary calendar…</p>
      ) : state === "unavailable" ? (
        <p className="diary-auth-error" role="alert">
          Diary could not load the calendar.
        </p>
      ) : (
        <div className="diary-calendar__grid" role="grid">
          {weekdayLabels.map((weekday) => (
            <span className="diary-calendar__weekday" key={weekday} role="columnheader">
              {weekday}
            </span>
          ))}
          {dates.map((date, index) => {
            if (date === null) {
              return <span aria-hidden="true" key={`empty-${index}`} />;
            }
            const entryCount = counts.get(date) ?? 0;
            const countLabel =
              entryCount === 0
                ? "no Entries"
                : `${entryCount} ${entryCount === 1 ? "Entry" : "Entries"}`;
            return (
              <button
                aria-label={`${dateLabel(date)}, ${countLabel}`}
                className={`diary-calendar__day${date === today ? " diary-calendar__day--today" : ""}`}
                key={date}
                onClick={() => onSelectDate(date)}
                type="button"
              >
                <span>{Number(date.slice(-2))}</span>
                {date === today ? <strong>Today</strong> : null}
                {entryCount > 0 ? <small>{entryCount}</small> : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
