import { readDiaryPublicConfig } from "./config";

export type HealthState = "checking" | "ready" | "unavailable";

type HealthResponse = {
  service: string;
  status: string;
};

export async function checkDiaryApi(
  signal: AbortSignal,
): Promise<Exclude<HealthState, "checking">> {
  const { apiBaseUrl } = readDiaryPublicConfig();
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

type OwnerResponse = {
  owner_id: string;
  status: string;
};

export type ProtectedAccess =
  | { state: "ready" }
  | { state: "unauthorized" }
  | { state: "unavailable" };

export async function checkProtectedOwnerAccess(
  accessToken: string,
  signal: AbortSignal,
): Promise<ProtectedAccess> {
  const { apiBaseUrl } = readDiaryPublicConfig();
  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/auth/me`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });

    if (response.status === 401) {
      return { state: "unauthorized" };
    }
    if (!response.ok) {
      return { state: "unavailable" };
    }

    const body = (await response.json()) as OwnerResponse;
    return body.status === "authenticated" && Boolean(body.owner_id)
      ? { state: "ready" }
      : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}
