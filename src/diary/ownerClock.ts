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

export function taipeiToday(now = new Date()): string {
  const values = taipeiDateTimeParts(now);
  return `${values.year}-${values.month}-${values.day}`;
}

export function taipeiDateTimeInputValue(now = new Date()): string {
  const values = taipeiDateTimeParts(now);
  return (
    `${values.year}-${values.month}-${values.day}` +
    `T${values.hour}:${values.minute}`
  );
}

export function millisecondsUntilNextTaipeiMidnight(
  now = new Date(),
): number {
  const values = taipeiDateTimeParts(now);
  const nextMidnight =
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + 1,
    ) -
    8 * 60 * 60 * 1000;
  return Math.max(1, nextMidnight - now.getTime());
}
