import * as admin from 'firebase-admin';

let db: any;
let auth: any;
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
  if (!(admin as any).apps.length) {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is not set in env variables.");
    }
    
    const decodedStr = getDecodedServiceAccountString(serviceAccountStr);
    const serviceAccount = parseFirebaseServiceAccount(decodedStr);
    if (serviceAccount && typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("[Firebase Admin Helper] Firebase Admin initialized successfully.");
  }
  
  db = admin.firestore();
  auth = admin.auth();
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
