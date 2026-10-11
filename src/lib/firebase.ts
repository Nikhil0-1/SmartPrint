import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';

/**
 * Firebase client-side configuration for GITAM SMARTPRINT.
 * Uses environment variables when configured in Vercel / .env.local,
 * with standard project client defaults to guarantee smooth build prerendering.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDB_GmIxOCJwBXdxnUZHApJc3NGXgr1nfs',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'gitam-smartprint.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'gitam-smartprint',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'gitam-smartprint.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '826359068019',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:826359068019:web:2f841029c0780be53491ea',
};

let app: FirebaseApp;
let auth: Auth;

try {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (err) {
  console.warn('[FIREBASE] Client initialization warning:', err);
  // Safe fallback for SSR prerendering environments
  app = (getApps().length > 0 ? getApp() : {}) as FirebaseApp;
  try {
    auth = getAuth(app);
  } catch {
    auth = {} as Auth;
  }
}

export { app, auth };
export default app;
