import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function getDecodedServiceAccountString(rawStr: string): string {
  const cleaned = rawStr.trim();
  // JSONの開始である { で始まっていない場合はBase64とみなしてデコード
  if (!cleaned.startsWith('{')) {
    console.log("[Firebase Admin Helper] Input does not start with '{'. Treating as Base64 encoded.");
    try {
      const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
      console.log("[Firebase Admin Helper] Base64 decoding successful. Preview:", decoded.substring(0, 30) + "...");
      return decoded;
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
    console.warn("[Firebase Admin Helper] Direct JSON.parse failed. Retrying with sanitization...", err1);
    try {
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
  let initError: any = null;
  if (!getApps().length) {
    try {
      const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!serviceAccountStr) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set in env variables.");
      }
      
      const decodedStr = getDecodedServiceAccountString(serviceAccountStr);
      const serviceAccount = parseFirebaseServiceAccount(decodedStr);
      if (serviceAccount && typeof serviceAccount.private_key === 'string') {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log("[Firebase Admin Helper] Firebase Admin initialized successfully.");
    } catch (err: any) {
      console.error("[Firebase Admin Helper] Initialization failed:", err);
      initError = err;
    }
  }
  
  try {
    if (getApps().length > 0) {
      return {
        db: getFirestore(),
        auth: getAuth(),
        error: null as any
      };
    }
  } catch (err: any) {
    console.error("[Firebase Admin Helper] Failed to get Firestore/Auth instance:", err);
    initError = err;
  }
  
  return {
    db: null as any,
    auth: null as any,
    error: initError || new Error("Unknown Firebase Admin Initialization Error")
  };
}
