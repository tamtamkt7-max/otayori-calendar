import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { sanitizeEnvVar } from './envSanitizer';

// グローバルスコープでのキャッシュ退避定義 (二重初期化の完全防止)
declare global {
  var firebaseAdminApp: App | undefined;
}

let db: Firestore = null as any;
let auth: Auth = null as any;
let initError: any = null;

function getDecodedServiceAccountString(rawStr: string): string {
  const cleaned = rawStr.trim();
  if (!cleaned.startsWith('{')) {
    try {
      return Buffer.from(cleaned, 'base64').toString('utf8');
    } catch (err) {
      console.error("[Firebase Admin Helper] Base64 decoding failed:", err);
    }
  }
  return cleaned;
}

function parseFirebaseServiceAccount(rawJson: string) {
  try {
    return JSON.parse(rawJson);
  } catch (err1) {
    try {
      const sanitized = rawJson
        .replace(/\\n/g, '\n')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      return JSON.parse(sanitized);
    } catch (err2: any) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT JSON parse failure: ${err2.message}`);
    }
  }
}

try {
  let app: App;
  
  if (global.firebaseAdminApp) {
    app = global.firebaseAdminApp;
    console.log("[Firebase Admin Helper] Reusing global Firebase Admin instance.");
  } else if (getApps().length > 0) {
    app = getApps()[0];
    global.firebaseAdminApp = app;
    console.log("[Firebase Admin Helper] Reusing existing SDK Firebase Admin instance.");
  } else {
    const serviceAccountStr = sanitizeEnvVar(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!serviceAccountStr) {
      console.warn("[Firebase Admin Helper] FIREBASE_SERVICE_ACCOUNT is not set in env variables. Skipping initialization during build/start.");
      initError = new Error("FIREBASE_SERVICE_ACCOUNT is not set in env variables.");
    } else {
      const decodedStr = getDecodedServiceAccountString(serviceAccountStr);
      const serviceAccount = parseFirebaseServiceAccount(decodedStr);
      if (serviceAccount && typeof serviceAccount.private_key === 'string') {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      
      app = initializeApp({
        credential: cert(serviceAccount)
      });
      global.firebaseAdminApp = app;
      console.log("[Firebase Admin Helper] Firebase Admin initialized and cached globally.");
      
      db = getFirestore();
      auth = getAuth();
    }
  }
} catch (err: any) {
  console.error("[Firebase Admin Helper] Initialization failed:", err);
  initError = err;
}

export function getFirebaseAdmin() {
  return {
    db: db as any,
    auth: auth as any,
    error: initError
  };
}
