import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  checkDiaryApi,
  checkProtectedOwnerAccess,
  type HealthState,
} from "./api";
import { createDiarySupabaseClient } from "./supabase";

type AuthState =
  | "checking"
  | "signed-out"
  | "link-sent"
  | "verifying"
  | "authenticated";

const healthCopy: Record<HealthState, string> = {
  checking: "Checking Diary API…",
  ready: "Diary API is ready.",
  unavailable:
    "Diary API is unavailable. Try again after the backend is running.",
};

function diaryRedirectUrl(): string {
  const redirect = new URL(window.location.href);
  redirect.hash = "";
  redirect.search = "";
  return redirect.toString();
}

export function App() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const supabase = useMemo<SupabaseClient>(
    () => createDiarySupabaseClient(),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void checkDiaryApi(controller.signal).then(setHealth);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setAuthState((current) =>
          current === "link-sent" ? current : "signed-out",
        );
      }
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        setError("Your saved session could not be restored. Sign in again.");
        setAuthState("signed-out");
        return;
      }
      setSession(data.session);
      setAuthState(data.session ? "verifying" : "signed-out");
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const controller = new AbortController();
    setAuthState("verifying");
    void checkProtectedOwnerAccess(
      session.access_token,
      controller.signal,
    ).then(async (access) => {
      if (access.state === "ready") {
        setError(null);
        setAuthState("authenticated");
        return;
      }
      if (access.state === "unauthorized") {
        await supabase.auth.signOut({ scope: "local" });
        setError("Your session expired or is not authorized for Diary.");
        setAuthState("signed-out");
        return;
      }

      setError("Diary could not verify protected access. Try again shortly.");
      setAuthState("signed-out");
    });

    return () => controller.abort();
  }, [session, supabase]);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: diaryRedirectUrl(),
      },
    });

    if (signInError) {
      setError(
        "Diary could not send the sign-in link. Confirm the email and try again.",
      );
      setAuthState("signed-out");
      return;
    }

    setAuthState("link-sent");
  }

  async function signOut() {
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError("Diary could not sign out. Try again.");
      return;
    }
    setSession(null);
    setAuthState("signed-out");
  }

  return (
    <main className="diary-page" aria-labelledby="diary-title">
      <section className="diary-shell">
        <p className="diary-kicker">Personal memory, kept over time</p>
        <h1 id="diary-title">Diary</h1>

        {authState === "authenticated" ? (
          <>
            <p className="diary-intro">
              Your private Diary shell is protected and ready for Entries.
            </p>
            <p className="diary-health diary-health--ready" role="status">
              <span aria-hidden="true" />
              Authenticated Diary is ready.
            </p>
            <button className="diary-secondary-action" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <h2>Sign in to Diary</h2>
            <p className="diary-intro">
              Enter the pre-configured owner email. Supabase will send a
              one-time Magic Link.
            </p>
            <form className="diary-auth-form" onSubmit={sendMagicLink}>
              <label htmlFor="diary-owner-email">Owner email</label>
              <input
                id="diary-owner-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit">Send Magic Link</button>
            </form>
            <p
              className={`diary-health diary-health--${health}`}
              role="status"
            >
              <span aria-hidden="true" />
              {authState === "link-sent"
                ? "Check your email and open the one-time Magic Link."
                : authState === "verifying"
                  ? "Verifying protected Diary access…"
                  : healthCopy[health]}
            </p>
          </>
        )}

        {error ? (
          <p className="diary-auth-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
