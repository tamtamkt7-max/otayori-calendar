import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function parseFirebaseServiceAccount(rawJson: string) {
  try {
    return JSON.parse(rawJson);
  } catch (err1) {
    console.warn("[Firebase Admin Helper] Direct JSON.parse failed. Retrying with sanitization...", err1);
    try {
      // ダブルクォーテーション内の改行コードや、ダブルエスケープされた改行文字を安全に置換する
      const sanitized = rawJson
        .replace(/\\n/g, '\n') // 一旦エスケープを外す
        .replace(/\n/g, '\\n') // 改行文字を文字としての \n に再定義
        .replace(/\r/g, '\\r');
      return JSON.parse(sanitized);
    } catch (err2: any) {
      console.error("[Firebase Admin Helper] Sanitized JSON.parse failed too:", err2);
      throw new Error(`FIREBASE_SERVICE_ACCOUNT JSON parse failure: ${err2.message}`);
    }
  }
}

export function getFirebaseAdmin() {
  if (!getApps().length) {
    try {
      const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!serviceAccountStr) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set in env variables.");
      }
      
      const serviceAccount = parseFirebaseServiceAccount(serviceAccountStr);
      if (serviceAccount && typeof serviceAccount.private_key === 'string') {
        // cert() が正しくパースできるように、秘密鍵のエスケープされた \n を実際の改行に変換する
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log("[Firebase Admin Helper] Firebase Admin initialized successfully.");
    } catch (err) {
      console.error("[Firebase Admin Helper] Initialization failed:", err);
      return null;
    }
  }
  
  try {
    return {
      db: getFirestore(),
      auth: getAuth()
    };
  } catch (err) {
    console.error("[Firebase Admin Helper] Failed to get Firestore/Auth instance:", err);
    return null;
  }
}
