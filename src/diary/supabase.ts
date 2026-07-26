import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { readDiaryPublicConfig } from "./config";

let diarySupabaseClient: SupabaseClient | undefined;

export function createDiarySupabaseClient(): SupabaseClient {
  if (diarySupabaseClient) {
    return diarySupabaseClient;
  }

  const config = readDiaryPublicConfig();

  diarySupabaseClient = createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
    },
  );

  return diarySupabaseClient;
}
