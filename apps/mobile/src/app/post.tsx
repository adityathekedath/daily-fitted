import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/auth/session';
import { postOutfit } from '@/lib/api';
import { localDateString, preparePhoto, uploadPhoto } from '@/lib/photos';
import { Button } from '@/ui/button';
import { useTheme } from '@/ui/theme';

/**
 * Post flow, built for the "under 10 seconds" goal:
 *
 * 1. The camera opens immediately.
 * 2. As soon as the photo is taken, it's shrunk and uploaded in the
 *    background while you look at it (and maybe type a caption).
 * 3. Tapping Post only waits for whatever upload time is left, then saves
 *    the outfit. Item detection happens later on the server.
 */
export default function PostScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  // The in-flight upload. Starts right after capture; Post awaits it.
  const upload = useRef<Promise<string> | null>(null);
  const opened = useRef(false);

  async function takePhoto(source: 'camera' | 'library') {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow camera access in Settings, or pick a photo instead.');
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 1 };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) {
      // Backing out of the camera before any photo: close the post screen.
      if (!photoUri) router.back();
      return;
    }

    const asset = result.assets[0];
    setPhotoUri(asset.uri);
    const userId = session?.user.id;
    if (!userId) return;
    const pending = preparePhoto(asset.uri, asset.width).then((uri) => uploadPhoto(userId, uri));
    // Mark the error as handled here; Post reports it to the user.
    pending.catch(() => {});
    upload.current = pending;
  }

  useEffect(() => {
    // Open the camera once when the screen appears.
    if (!opened.current) {
      opened.current = true;
      takePhoto('camera');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post() {
    if (!upload.current) return;
    setPosting(true);
    try {
      const photoPath = await upload.current;
      await postOutfit({
        photo_path: photoPath,
        caption: caption.trim() || undefined,
        worn_on: localDateString(),
      });
      router.back();
    } catch (e) {
      setPosting(false);
      Alert.alert('Could not post', e instanceof Error ? e.message : 'Please try again.');
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
        style={styles.content}>
        {photoUri ? (
          <Image source={photoUri} style={styles.preview} contentFit="cover" />
        ) : (
          <View style={[styles.preview, styles.placeholder, { backgroundColor: theme.surface }]}>
            <Text style={{ color: theme.muted }}>No photo yet</Text>
          </View>
        )}

        <TextInput
          style={[styles.caption, { color: theme.text, borderColor: theme.border }]}
          placeholder="Add a caption (optional)"
          placeholderTextColor={theme.muted}
          value={caption}
          onChangeText={setCaption}
          maxLength={280}
        />

        <View style={styles.actions}>
          <Button title="Post" onPress={post} loading={posting} disabled={!photoUri} />
          <View style={styles.secondaryRow}>
            <View style={styles.flex}>
              <Button title="Retake" variant="secondary" onPress={() => takePhoto('camera')} disabled={posting} />
            </View>
            <View style={styles.flex}>
              <Button
                title="Camera roll"
                variant="secondary"
                onPress={() => takePhoto('library')}
                disabled={posting}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, padding: 16, gap: 12 },
  preview: { flex: 1, borderRadius: 16 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  caption: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    // Explicit, so iOS can't carry over the code input's wide spacing.
    letterSpacing: 0,
  },
  actions: { gap: 10 },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
