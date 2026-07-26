export type DiaryPublicConfig = {
  apiBaseUrl: string;
  supabasePublishableKey: string;
  supabaseUrl: string;
};

const DEFAULT_API_BASE_URL = "/diary-api";

export function readDiaryPublicConfig(): DiaryPublicConfig {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Diary authentication is not configured");
  }

  return {
    apiBaseUrl:
      import.meta.env.VITE_DIARY_API_URL?.trim() || DEFAULT_API_BASE_URL,
    supabasePublishableKey,
    supabaseUrl,
  };
}
