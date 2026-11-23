import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { SessionProvider, useSession } from '@/auth/session';
import { useTheme } from '@/ui/theme';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <RootStack />
    </SessionProvider>
  );
}

function RootStack() {
  const { session, isLoading } = useSession();
  const theme = useTheme();

  // Wait until we know whether there's a saved session.
  if (isLoading) return null;

  const signedIn = session !== null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.background },
      }}>
      {/* Protected screens: Expo Router redirects away when the guard is false. */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'My fits' }} />
        <Stack.Screen name="post" options={{ title: "Today's fit", presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
