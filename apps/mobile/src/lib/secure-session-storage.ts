import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { utf8Decode, utf8Encode } from './utf8';

/**
 * Encrypted storage for the Supabase sign-in session.
 *
 * Why not just AsyncStorage? AsyncStorage is a plain file in the app's folder.
 * Anyone who gets a copy of it (an unencrypted backup, a jailbroken phone)
 * could read the session tokens and act as the user.
 *
 * Why not just SecureStore (the iPhone Keychain)? It's built for small
 * secrets, and a session is larger than older iOS versions accept.
 *
 * So we combine them, the approach Supabase recommends:
 *   - a random 256-bit AES key lives in the Keychain (small, hardware-protected)
 *   - the session is encrypted with that key (AES-GCM) and stored in AsyncStorage
 *
 * AES-GCM also detects tampering: a modified ciphertext fails to decrypt
 * instead of producing garbage.
 */

const KEY_NAME = 'dailyfitted.session-encryption-key';

const keychainOptions: SecureStore.SecureStoreOptions = {
  // Readable after the first unlock since restart, so the session can still
  // refresh while the phone is locked.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

// Load (or create) the key once, and share the same promise. Without this,
// two writes at startup could each create a different key.
let keyPromise: Promise<AESEncryptionKey> | null = null;

function getKey(): Promise<AESEncryptionKey> {
  keyPromise ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY_NAME, keychainOptions);
    if (stored) return AESEncryptionKey.import(stored, 'base64');

    const key = await AESEncryptionKey.generate(256);
    await SecureStore.setItemAsync(KEY_NAME, await key.encoded('base64'), keychainOptions);
    return key;
  })();
  // If loading failed, try again next time instead of caching the failure.
  keyPromise.catch(() => {
    keyPromise = null;
  });
  return keyPromise;
}

export const secureSessionStorage = {
  async getItem(name: string): Promise<string | null> {
    const sealed = await AsyncStorage.getItem(name);
    if (sealed === null) return null;
    try {
      const key = await getKey();
      const bytes = await aesDecryptAsync(AESSealedData.fromCombined(sealed), key, {
        // Ties each value to its name, so values can't be swapped between entries.
        additionalData: utf8Encode(name),
        output: 'bytes',
      });
      return utf8Decode(bytes);
    } catch {
      // Unreadable: tampered with, or the Keychain key is gone (e.g. restored
      // to a new phone). Throw it away; the user just signs in again.
      await AsyncStorage.removeItem(name);
      return null;
    }
  },

  async setItem(name: string, value: string): Promise<void> {
    const key = await getKey();
    const sealed = await aesEncryptAsync(utf8Encode(value), key, {
      additionalData: utf8Encode(name),
    });
    await AsyncStorage.setItem(name, await sealed.combined('base64'));
  },

  async removeItem(name: string): Promise<void> {
    await AsyncStorage.removeItem(name);
  },
};
