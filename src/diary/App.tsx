import { useEffect, useState } from "react";

import { checkDiaryApi, type HealthState } from "./api";

const statusCopy: Record<HealthState, string> = {
  checking: "Checking Diary API…",
  ready: "Diary API is ready.",
  unavailable:
    "Diary API is unavailable. Try again after the backend is running.",
};

export function App() {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    void checkDiaryApi(controller.signal).then(setHealth);

    return () => controller.abort();
  }, []);

  return (
    <main className="diary-page" aria-labelledby="diary-title">
      <section className="diary-shell">
        <p className="diary-kicker">Personal memory, kept over time</p>
        <h1 id="diary-title">Diary</h1>
        <p className="diary-intro">
          Capture and history will arrive in the next Diary tickets.
        </p>
        <p className={`diary-health diary-health--${health}`} role="status">
          <span aria-hidden="true" />
          {statusCopy[health]}
        </p>
      </section>
    </main>
  );
}
