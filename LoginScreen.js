// ============================================================
// LoginScreen.js — Phone number registration / login flow
// ============================================================
// Two-step:
//   1. User types a phone number → tap "Send code"
//   2. User types the 6-digit OTP from SMS → tap "Verify"
//   3. On success, Firebase Auth state changes and App.js shows the dashboard.
//
// Behavior by platform:
//   - Web:  Real reCAPTCHA + real SMS (works out of the box)
//   - Expo Go on phone: requires a "test phone number" configured in
//                       Firebase Console (no real SMS sent)
//
// For real SMS on Android/iOS native, use a dev build (npx expo prebuild + run)
// with the @react-native-firebase/auth module instead. This file uses the
// plain firebase JS SDK so it works inside Expo Go.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {
  signInWithPhoneNumber,
  PhoneAuthProvider,
  signInWithCredential,
  RecaptchaVerifier,
} from 'firebase/auth';

import { getAuthInstance, isConfigured } from './firebase';

const COLORS = {
  bg:     '#0b1a0b',
  panel:  'rgba(255,255,255,0.04)',
  border: 'rgba(74,222,128,0.2)',
  green:  '#4ade80',
  greenL: '#86efac',
  text:   '#d1fae5',
  red:    '#f87171',
  amber:  '#fbbf24',
};

export default function LoginScreen() {
  const [phone,       setPhone]       = useState('+975');
  const [code,        setCode]        = useState('');
  const [stage,       setStage]       = useState('phone');  // 'phone' | 'otp'
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState(null);
  const [confirmation, setConfirmation] = useState(null);  // { verificationId } on native, { confirm } on web

  const recaptchaRef = useRef(null);

  // Web only: create an invisible reCAPTCHA on the page so Firebase can
  // verify the request before sending an SMS.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const auth = getAuthInstance();
    if (!auth) return;
    if (recaptchaRef.current) return;

    try {
      recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    } catch (e) {
      console.warn('reCAPTCHA init failed:', e.message);
    }
  }, []);

  const sendCode = async () => {
    setError(null);
    if (!/^\+\d{6,15}$/.test(phone)) {
      setError('Use international format, e.g. +97517000000');
      return;
    }
    if (!isConfigured()) {
      setError('Firebase is not configured. Fill in EXPO_PUBLIC_FIREBASE_* in .env');
      return;
    }
    const auth = getAuthInstance();

    setBusy(true);
    try {
      // On web, pass the reCAPTCHA verifier.
      // On native (Expo Go) Firebase will reject unless this number is a
      // configured "test phone number" in the Firebase Console.
      const verifier = Platform.OS === 'web' ? recaptchaRef.current : undefined;
      const result   = await signInWithPhoneNumber(auth, phone, verifier);
      setConfirmation(result);
      setStage('otp');
    } catch (e) {
      setError(translateFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your SMS.');
      return;
    }
    setBusy(true);
    try {
      // signInWithPhoneNumber returns a ConfirmationResult on web AND native
      // for the JS SDK, so .confirm() works on both.
      await confirmation.confirm(code);
      // On success, onAuthStateChanged in App.js fires and hides this screen.
    } catch (e) {
      setError(translateFirebaseError(e));
    } finally {
      setBusy(false);
    }
  };

  const resetToPhone = () => {
    setStage('phone');
    setCode('');
    setConfirmation(null);
    setError(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, paddingTop: 80, paddingHorizontal: 24 }}>
      <View style={{ alignItems: 'center', marginBottom: 28 }}>
        <Text style={{ fontSize: 44 }}>🌾</Text>
        <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.green, marginTop: 6 }}>
          Smart Crop AI
        </Text>
        <Text style={{ fontSize: 12, color: COLORS.greenL, opacity: 0.7, marginTop: 4 }}>
          {stage === 'phone' ? 'Sign in with your phone number' : 'Enter the verification code'}
        </Text>
      </View>

      {/* Phone input */}
      {stage === 'phone' && (
        <View>
          <Text style={{ fontSize: 11, color: COLORS.green, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 }}>
            PHONE NUMBER
          </Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+975 17 000 000"
            placeholderTextColor="rgba(134,239,172,0.4)"
            keyboardType="phone-pad"
            autoComplete="tel"
            style={inputStyle}
          />
          <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.6, marginTop: 6 }}>
            Use international format (start with +975 for Bhutan).
          </Text>

          <Pressable
            onPress={sendCode}
            disabled={busy}
            style={({ pressed }) => ({
              ...primaryBtn,
              opacity: busy ? 0.5 : pressed ? 0.85 : 1,
              marginTop: 22,
            })}>
            {busy
              ? <ActivityIndicator color="#052e16" />
              : <Text style={primaryBtnText}>📩 Send Code</Text>}
          </Pressable>
        </View>
      )}

      {/* OTP input */}
      {stage === 'otp' && (
        <View>
          <Text style={{ fontSize: 11, color: COLORS.green, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 }}>
            6-DIGIT CODE
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor="rgba(134,239,172,0.4)"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="sms-otp"
            style={{ ...inputStyle, letterSpacing: 8, textAlign: 'center', fontSize: 22 }}
          />
          <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.6, marginTop: 6 }}>
            Sent to {phone}.{' '}
            <Text onPress={resetToPhone} style={{ color: COLORS.green }}>Change number</Text>
          </Text>

          <Pressable
            onPress={verifyCode}
            disabled={busy}
            style={({ pressed }) => ({
              ...primaryBtn,
              opacity: busy ? 0.5 : pressed ? 0.85 : 1,
              marginTop: 22,
            })}>
            {busy
              ? <ActivityIndicator color="#052e16" />
              : <Text style={primaryBtnText}>✅ Verify & Sign In</Text>}
          </Pressable>
        </View>
      )}

      {/* Error banner */}
      {error ? (
        <View style={{
          marginTop: 18,
          backgroundColor: 'rgba(248,113,113,0.1)',
          borderWidth: 1,
          borderColor: COLORS.red,
          borderRadius: 10,
          padding: 12,
        }}>
          <Text style={{ color: '#fca5a5', fontSize: 12 }}>⚠️ {error}</Text>
        </View>
      ) : null}

      {/* Web reCAPTCHA host — must be a real DOM element on web.
          react-native-web renders View as a div, so this works. */}
      {Platform.OS === 'web' ? <View nativeID="recaptcha-container" /> : null}

      {/* Footer help */}
      <View style={{ marginTop: 'auto', paddingBottom: 24, alignItems: 'center' }}>
        <Text style={{ fontSize: 10, color: COLORS.greenL, opacity: 0.5, textAlign: 'center' }}>
          {Platform.OS === 'web'
            ? 'A real SMS will be sent via Firebase.'
            : 'Expo Go uses Firebase test numbers (no real SMS).\nConfigure them in Firebase Console → Authentication.'}
        </Text>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────
const inputStyle = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 10,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: COLORS.text,
  fontSize: 16,
};

const primaryBtn = {
  backgroundColor: 'rgba(74,222,128,0.85)',
  borderRadius: 10,
  paddingVertical: 14,
  alignItems: 'center',
};

const primaryBtnText = {
  color: '#052e16',
  fontWeight: '700',
  fontSize: 15,
};

// ── Helpers ────────────────────────────────────────────────
function translateFirebaseError(e) {
  const code = e?.code ?? '';
  switch (code) {
    case 'auth/invalid-phone-number':       return 'That phone number isn\'t valid.';
    case 'auth/missing-phone-number':       return 'Please enter a phone number.';
    case 'auth/quota-exceeded':             return 'SMS quota exceeded — try again tomorrow.';
    case 'auth/too-many-requests':          return 'Too many attempts. Wait a few minutes.';
    case 'auth/invalid-verification-code':  return 'Wrong code. Check the digits and try again.';
    case 'auth/code-expired':               return 'Code expired. Request a new one.';
    case 'auth/captcha-check-failed':       return 'reCAPTCHA failed — refresh the page.';
    case 'auth/operation-not-allowed':      return 'Phone Auth is not enabled in Firebase Console.';
    default: return e?.message ?? 'Sign-in failed. Check your connection.';
  }
}
