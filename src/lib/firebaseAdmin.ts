if (typeof process !== 'undefined') {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Firebase Admin Helper] Unhandled Rejection at Promise:', promise, 'reason:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[Firebase Admin Helper] Uncaught Exception thrown:', err);
  });
}

import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { sanitizeEnvVar } from './envSanitizer';

// グローバルスコープでのキャッシュ退避定義 (二重初期化の完全防止)
declare global {
  var firebaseAdminApp: App | undefined;
  var firebaseAdminDb: Firestore | undefined;
  var firebaseAdminAuth: Auth | undefined;
  var firebaseAdminError: any | undefined;
}

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

// 実行時に初めて呼ばれる、安全な初期化ゲッター（トップレベルでの初期化を廃止し、ロード時クラッシュを根絶）
export function getFirebaseAdmin() {
  try {
    // 1. キャッシュが存在すれば即座に再利用
    if (global.firebaseAdminApp && global.firebaseAdminDb && global.firebaseAdminAuth) {
      return {
        db: global.firebaseAdminDb,
        auth: global.firebaseAdminAuth,
        error: global.firebaseAdminError || null
      };
    }

    let app: App;

    // 2. SDK 側の二重初期化チェック
    if (getApps().length > 0) {
      app = getApps()[0];
      global.firebaseAdminApp = app;
      console.log("[Firebase Admin Helper] Reusing existing SDK Firebase Admin instance.");
    } else {
      // 3. 環境変数の取得とサニタイズ
      const serviceAccountStr = sanitizeEnvVar(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (!serviceAccountStr) {
        console.warn("[Firebase Admin Helper] FIREBASE_SERVICE_ACCOUNT is not set in env variables. Skipping initialization during build/start.");
        global.firebaseAdminError = new Error("FIREBASE_SERVICE_ACCOUNT is not set in env variables.");
        return {
          db: null as any,
          auth: null as any,
          error: global.firebaseAdminError
        };
      }

      // 4. パースとデコード
      const decodedStr = getDecodedServiceAccountString(serviceAccountStr);
      const serviceAccount = parseFirebaseServiceAccount(decodedStr);
      if (serviceAccount && typeof serviceAccount.private_key === 'string') {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      // 5. Firebase 初期化
      app = initializeApp({
        credential: cert(serviceAccount)
      });
      global.firebaseAdminApp = app;
      console.log("[Firebase Admin Helper] Firebase Admin initialized and cached globally (lazy loaded).");
    }

    // 6. DB と Auth のインスタンス取得・キャッシュ
    global.firebaseAdminDb = getFirestore();
    global.firebaseAdminAuth = getAuth();
    global.firebaseAdminError = null;

    return {
      db: global.firebaseAdminDb,
      auth: global.firebaseAdminAuth,
      error: null
    };

  } catch (err: any) {
    console.error("[Firebase Admin Helper] Critical Lazy Initialization Failure:", err);
    global.firebaseAdminError = err;
    return {
      db: null as any,
      auth: null as any,
      error: err
    };
  }
}
