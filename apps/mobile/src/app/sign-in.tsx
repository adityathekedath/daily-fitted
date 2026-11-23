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

// Supabase's code length is a project setting (6 to 10 digits; this project
// uses 8). Accept any of them so a settings change can't break sign-in.
const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 10;

/**
 * Passwordless sign-in: enter your email, get a one-time code, type it in.
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
            <Text style={{ color: theme.muted }}>We sent a sign-in code to {trimmedEmail}.</Text>
            <TextInput
              style={[inputStyle, styles.codeInput]}
              placeholder="Code"
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={MAX_CODE_LENGTH}
              value={code}
              // Keep digits only (pasted codes can include spaces).
              onChangeText={(text) => setCode(text.replace(/\D/g, ''))}
              autoFocus
            />
            <Button
              title="Sign in"
              onPress={verifyCode}
              loading={busy}
              disabled={code.length < MIN_CODE_LENGTH}
            />
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
  // letterSpacing is set on every input on purpose: iOS reuses text inputs
  // between screens, and an unset value can carry over from another input.
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    letterSpacing: 0,
  },
  codeInput: { fontSize: 28, letterSpacing: 6, textAlign: 'center' },
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
