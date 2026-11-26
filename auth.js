import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SITE_URL } from "./config.js";

// Refuses to run if a secret / service_role key was pasted by mistake.
function isSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  try {
    const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).role === "service_role";
  } catch {
    return false;
  }
}

export const configError =
  !SUPABASE_URL.startsWith("https://") || !SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_")
    ? "Setup needed: open config.js and add your Supabase URL and publishable key."
    : isSecretKey(SUPABASE_PUBLISHABLE_KEY)
      ? "config.js contains a secret key. Remove it, rotate that key in Supabase, and use the publishable key."
      : "";

export const supabase = configError ? null : createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export const register = (email, password) =>
  supabase.auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL } });
export const login = (email, password) => supabase.auth.signInWithPassword({ email, password });
export const logout = () => supabase.auth.signOut();
export const getSession = () => supabase.auth.getSession();
export const resetPassword = (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
export const updatePassword = (password) => supabase.auth.updateUser({ password });
