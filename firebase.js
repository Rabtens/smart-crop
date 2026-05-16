// ============================================================
// firebase.js — Firebase Auth initialization
// ============================================================
// Provides:
//   - `auth`     : a Firebase Auth instance (platform-aware persistence)
//   - `isConfigured()` : returns true once the .env keys are filled in
//
// Setup (do this once):
//   1. console.firebase.google.com → create project
//   2. Authentication → Sign-in method → enable "Phone"
//   3. Project settings → General → Your apps → register a Web app
//      → copy the firebaseConfig values into .env (EXPO_PUBLIC_FIREBASE_*)
//   4. (For Expo Go testing) Authentication → Sign-in method → Phone →
//      "Phone numbers for testing" → add e.g.  +97517000000 / 123456
// ============================================================

import { Platform } from 'react-native';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const isConfigured = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// Lazy init: only build the auth instance once the env is filled in,
// so the app doesn't crash on first load when .env is still empty.
let _auth = null;
export function getAuthInstance() {
  if (_auth) return _auth;
  if (!isConfigured()) return null;

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  if (Platform.OS === 'web') {
    _auth = getAuth(app);
  } else {
    // React Native needs explicit AsyncStorage persistence — without this,
    // the user is logged out on every app reload.
    _auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  }
  return _auth;
}
