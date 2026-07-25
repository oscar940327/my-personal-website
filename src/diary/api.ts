export type HealthState = "checking" | "ready" | "unavailable";

type HealthResponse = {
  service: string;
  status: string;
};

const DEFAULT_API_BASE_URL = "/diary-api";

export async function checkDiaryApi(
  signal: AbortSignal,
): Promise<Exclude<HealthState, "checking">> {
  const apiBaseUrl =
    import.meta.env.VITE_DIARY_API_URL?.trim() || DEFAULT_API_BASE_URL;
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
