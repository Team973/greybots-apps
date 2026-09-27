import { createClient } from '@supabase/supabase-js'

// Supabase project identity — shared by every app in this monorepo.
export const supabaseProjectId = "rqezalinpkjjckztwgmj";
export const supabaseUrl = "https://" + supabaseProjectId + ".supabase.co";
export const supabasePublicKey = "sb_publishable_EXHZUoCVfKAZlBWDladlEQ_DSqHcT4X";

export const supabase = createClient(supabaseUrl, supabasePublicKey);
