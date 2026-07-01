import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { encrypt } from '../../../../../lib/encryption';

function getFirestoreInstance() {
  if (!getApps().length) {
    try {
      const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!serviceAccountStr) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set in env variables.");
      }
      const serviceAccount = JSON.parse(serviceAccountStr);
      initializeApp({
        credential: cert(serviceAccount)
      });
    } catch (initError) {
      console.error("firebase-admin initialization failed in OAuth callback:", initError);
      return null;
    }
  }
  try {
    return getFirestore();
  } catch (dbError) {
    console.error("Failed to get Firestore instance in OAuth callback:", dbError);
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const userId = searchParams.get('state'); // 認証URL生成時に state に userId を設定した

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://otayori-calendar.vercel.app';

  if (!code || !userId) {
    console.error("Google OAuth Callback Error: Code or state (userId) missing.");
    return NextResponse.redirect(`${appUrl}/?google-sync=error&reason=missing_params`);
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${appUrl}/api/auth/google-calendar/callback`;

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // 認可コードをトークンに交換
    const { tokens } = await oauth2Client.getToken(code);
    
    const firestore = getFirestoreInstance();
    if (!firestore) {
      throw new Error("Failed to connect to database");
    }

    // トークン情報を暗号化
    const tokensStr = JSON.stringify(tokens);
    const encryptedTokens = encrypt(tokensStr);

    // Firestoreに保存
    const docRef = firestore.collection('users').doc(userId).collection('security').doc('googleOAuth');
    
    // 既存のトークンがある場合は、リフレッシュトークンが返ってこなかったときに上書きで失われないようにマージ
    let finalTokens = encryptedTokens;
    if (!tokens.refresh_token) {
      const existingDoc = await docRef.get();
      if (existingDoc.exists) {
        const existingData = existingDoc.data();
        const decryptedExistingStr = require('../../../../../lib/encryption').decrypt(existingData?.encryptedTokens || '');
        try {
          const existingTokens = JSON.parse(decryptedExistingStr);
          const mergedTokens = {
            ...existingTokens,
            ...tokens,
            refresh_token: existingTokens.refresh_token // 既存の refresh_token を維持
          };
          finalTokens = encrypt(JSON.stringify(mergedTokens));
        } catch (e) {
          console.error("Failed to parse existing tokens:", e);
        }
      }
    }

    await docRef.set({
      encryptedTokens: finalTokens,
      connectedAt: new Date().toISOString()
    }, { merge: true });

    // アプリのカレンダー連携ステータスも更新
    const userRef = firestore.collection('users').doc(userId);
    await userRef.set({
      googleCalendarConnected: true
    }, { merge: true });

    console.log(`[Google Calendar Sync] Successfully linked Google Account for user: ${userId}`);
    return NextResponse.redirect(`${appUrl}/?google-sync=success`);

  } catch (error: any) {
    console.error("Google OAuth Callback Exception:", error);
    return NextResponse.redirect(`${appUrl}/?google-sync=error&reason=${encodeURIComponent(error.message)}`);
  }
}
