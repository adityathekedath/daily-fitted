import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listMyOutfits, type Outfit } from '@/lib/api';
import { signedPhotoUrls } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/button';
import { useTheme } from '@/ui/theme';

/** Your private outfit diary, newest first. */
export default function MyFitsScreen() {
  const theme = useTheme();
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await listMyOutfits();
      setPhotoUrls(await signedPhotoUrls(list.map((o) => o.photo_path)));
      setOutfits(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your fits');
    }
  }, []);

  // Reload whenever this screen comes back into view (e.g. after posting).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={() => supabase.auth.signOut()} hitSlop={12}>
              <Text style={{ color: theme.muted }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />

      {outfits === null && !error ? (
        <ActivityIndicator style={styles.center} color={theme.text} />
      ) : (
        <FlatList
          data={outfits ?? []}
          keyExtractor={(o) => o.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={
            error ? <Text style={[styles.message, { color: theme.danger }]}>{error}</Text> : undefined
          }
          ListEmptyComponent={
            error ? undefined : (
              <View style={styles.empty}>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No fits yet</Text>
                <Text style={{ color: theme.muted, textAlign: 'center' }}>
                  Post today&apos;s outfit to start your diary.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <Image
                source={photoUrls[item.photo_path]}
                style={[styles.photo, { backgroundColor: theme.surface }]}
                contentFit="cover"
                transition={150}
                accessibilityLabel={item.caption ?? `Outfit from ${item.worn_on}`}
              />
              <Text style={[styles.date, { color: theme.muted }]}>{formatDate(item.worn_on)}</Text>
            </View>
          )}
        />
      )}

      <View style={styles.footer}>
        <Button title="Post today's fit" onPress={() => router.push('/post')} />
      </View>
    </SafeAreaView>
  );
}

function formatDate(isoDate: string): string {
  // Parse as a local date ("2026-11-23" alone would be read as UTC midnight).
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1 },
  list: { padding: 16, gap: 16, flexGrow: 1 },
  row: { gap: 12 },
  cell: { flex: 1, maxWidth: '50%', gap: 6 },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 12 },
  date: { fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 120 },
  emptyTitle: { fontSize: 20, fontWeight: '600' },
  message: { marginBottom: 12 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
});
