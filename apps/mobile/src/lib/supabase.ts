import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy apps/mobile/.env.example to apps/mobile/.env and fill it in.',
  );
}

// The publishable key is safe to ship in the app: it only identifies the
// project. What each user can actually read or write is enforced by Row Level
// Security in the database.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Keep the session on the device so users stay signed in between launches.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // There are no sign-in links in this app (we use typed codes), so there
    // is never a session to read from a URL.
    detectSessionInUrl: false,
  },
});

// Only refresh the session while the app is open. This saves battery and
// avoids refreshes failing in the background.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
