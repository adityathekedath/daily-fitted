import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/button';
import { useTheme } from '@/ui/theme';

/**
 * Passwordless sign-in: enter your email, get a 6-digit code, type it in.
 * The same flow creates the account the first time. No passwords to store
 * or leak, and no links to open in a browser.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isAdult, setIsAdult] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim().toLowerCase();

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        shouldCreateUser: true,
        // Read by the database when it creates a new account. Sign-up is
        // refused without it (users must be 18+).
        data: { age_confirmed: true },
      },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
    } else {
      setStep('code');
    }
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: trimmedEmail, token: code, type: 'email' });
    setBusy(false);
    // On success the session listener switches to the signed-in screens.
    if (error) setError(error.message);
  }

  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface },
  ];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>Daily Fitted</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>
          One photo a day. Rank your best fits. Private by default.
        </Text>

        {step === 'email' ? (
          <View style={styles.form}>
            <TextInput
              style={inputStyle}
              placeholder="you@example.com"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isAdult }}
              onPress={() => setIsAdult((v) => !v)}
              style={styles.checkboxRow}>
              <View
                style={[
                  styles.checkbox,
                  { borderColor: theme.text, backgroundColor: isAdult ? theme.text : 'transparent' },
                ]}>
                {isAdult && <Text style={{ color: theme.background, fontWeight: '700' }}>✓</Text>}
              </View>
              <Text style={{ color: theme.text, flex: 1 }}>I&apos;m 18 or older</Text>
            </Pressable>
            <Button
              title="Email me a code"
              onPress={sendCode}
              loading={busy}
              disabled={!trimmedEmail.includes('@') || !isAdult}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={{ color: theme.muted }}>We sent a 6-digit code to {trimmedEmail}.</Text>
            <TextInput
              style={[inputStyle, styles.codeInput]}
              placeholder="123456"
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChangeText={setCode}
              autoFocus
            />
            <Button title="Sign in" onPress={verifyCode} loading={busy} disabled={code.length !== 6} />
            <Button
              title="Use a different email"
              variant="secondary"
              onPress={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            />
          </View>
        )}

        {error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 8 },
  title: { fontSize: 34, fontWeight: '700' },
  subtitle: { fontSize: 16, marginBottom: 24 },
  form: { gap: 14 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17 },
  codeInput: { fontSize: 28, letterSpacing: 8, textAlign: 'center' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { marginTop: 12 },
});
