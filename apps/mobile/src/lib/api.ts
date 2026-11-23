import Constants from 'expo-constants';

import { supabase } from './supabase';

/**
 * Where the Python API runs.
 *
 * On a real phone, "localhost" means the phone itself, not your Mac. In
 * development, Expo knows your Mac's network address (it's how the phone loads
 * the app), so we reuse it with the API's port. Set EXPO_PUBLIC_API_URL to
 * override this, for example for a deployed API.
 */
function apiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');

  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (devHost) return `http://${devHost}:8000`;

  throw new Error('Set EXPO_PUBLIC_API_URL to the API address');
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the API with the signed-in user's token attached. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new ApiError(401, 'Not signed in');

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') message = body.detail;
    } catch {
      // Not JSON; keep the generic message.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export type Outfit = {
  id: string;
  user_id: string;
  photo_path: string;
  caption: string | null;
  worn_on: string; // YYYY-MM-DD
  rank_key: number | null;
  created_at: string;
};

export function postOutfit(input: { photo_path: string; caption?: string; worn_on: string }) {
  return apiFetch<Outfit>('/outfits', { method: 'POST', body: JSON.stringify(input) });
}

export function listMyOutfits() {
  return apiFetch<Outfit[]>('/outfits/me');
}
