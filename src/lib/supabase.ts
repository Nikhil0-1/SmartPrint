import { createClient } from '@supabase/supabase-js';

function cleanEnv(val?: string | null): string {
  if (!val) return '';
  return val.trim().replace(/^["']|["']$/g, '');
}

function isValidConfigValue(val?: string | null): boolean {
  if (!val) return false;
  const s = val.toLowerCase().trim();
  return (
    !s.includes('placeholder') &&
    !s.includes('your-') &&
    !s.includes('change-this') &&
    s.length > 5
  );
}

// 1. Resolve canonical Supabase URL
const configuredUrl =
  cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
  cleanEnv(process.env.SUPABASE_URL);

export const supabaseUrl = isValidConfigValue(configuredUrl)
  ? configuredUrl
  : 'https://mzwswczgwndbfxgoecpv.supabase.co';

// 2. Resolve Anon Public Key
const configuredAnonKey =
  cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
  cleanEnv(process.env.SUPABASE_ANON_KEY);

export const supabaseAnonKey = isValidConfigValue(configuredAnonKey)
  ? configuredAnonKey
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16d3N3Y3pnd25kYmZ4Z29lY3B2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjExNDksImV4cCI6MjEwNzEzNzE0OX0.BiCTvNxVG3GD4L6uIprlDCLZTPmEkwjmRkbzjZ9MeDE';

// 3. Resolve privileged / service key for server operations
const configuredServiceKey =
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
  cleanEnv(process.env.SUPABASE_SERVICE_KEY);

export const supabaseServiceKey = isValidConfigValue(configuredServiceKey)
  ? configuredServiceKey
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

export const BUCKET_NAME = cleanEnv(process.env.SUPABASE_STORAGE_BUCKET) || 'print-temp';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    isValidConfigValue(supabaseUrl) &&
    (isValidConfigValue(supabaseServiceKey) || isValidConfigValue(supabaseAnonKey))
  );
};

export const getSupabaseConfigDiagnostics = () => ({
  configured: isSupabaseConfigured(),
  hasValidUrl: isValidConfigValue(supabaseUrl),
  hasServiceRoleKey: isValidConfigValue(configuredServiceKey),
  hasAnonKey: isValidConfigValue(configuredAnonKey),
  storageBucket: BUCKET_NAME,
});
