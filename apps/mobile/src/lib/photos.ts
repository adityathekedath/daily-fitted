import { randomUUID } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { supabase } from './supabase';

export const PHOTO_BUCKET = 'outfit-photos';

// Phone photos are often 4000+ px wide and several MB. 1440 px wide is plenty
// for a full-screen photo, uploads much faster (helping the 10-second post
// goal), and cuts storage cost.
const MAX_WIDTH = 1440;
const JPEG_QUALITY = 0.8;

/** Shrinks and re-encodes a photo as JPEG. Returns the new local file URI. */
export async function preparePhoto(uri: string, width: number): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  if (width > MAX_WIDTH) {
    context.resize({ width: MAX_WIDTH, height: null });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return result.uri;
}

/**
 * Uploads a prepared photo to the private bucket at "<userId>/<random>.jpg"
 * and returns that storage path. The storage rules only allow uploads into
 * your own folder.
 */
export async function uploadPhoto(userId: string, localUri: string): Promise<string> {
  const path = `${userId}/${randomUUID()}.jpg`;
  const file = await fetch(localUri);
  const body = await file.arrayBuffer();

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Photos are private, so there are no permanent links. Instead we ask for
 * signed URLs that stop working after an hour.
 */
export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) throw error;

  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}

/** Today's date in the user's time zone, as YYYY-MM-DD. */
export function localDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
