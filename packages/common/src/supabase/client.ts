import { createClient } from '@supabase/supabase-js'

// Supabase project identity — shared by every app in this monorepo.
export const supabaseProjectId = "rqezalinpkjjckztwgmj";
const publicKey = "sb_publishable_EXHZUoCVfKAZlBWDladlEQ_DSqHcT4X";

export const supabase = createClient("https://" + supabaseProjectId + ".supabase.co", publicKey);
