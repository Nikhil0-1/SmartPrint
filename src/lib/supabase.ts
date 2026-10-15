import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
// Use SUPABASE_SERVICE_ROLE_KEY if set, otherwise fall back to supabaseAnonKey so backend operations still authenticate
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseServiceKey = (rawServiceKey && !rawServiceKey.includes('placeholder'))
  ? rawServiceKey
  : supabaseAnonKey;

// Client for public operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Privileged Service Role client for backend & storage operations
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'print-temp';

export const isSupabaseConfigured = (): boolean => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && !url.includes('placeholder') && !key.includes('placeholder'));
};
