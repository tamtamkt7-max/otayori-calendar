export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// checkout/route.ts と同じインライン・サニタイザー
function localSanitize(val: string | undefined): string {
  if (!val) return '';
  return val.trim().replace(/[\r\n]/g, '').replace(/\\n/g, '\n');
}

export async function POST(req: Request) {
  try {
    console.log('[create-portal-session] Route execution started.');

    // 1. 環境変数の取得
    const rawStripeKey = process.env.STRIPE_SECRET_KEY;
    const stripeKey = localSanitize(rawStripeKey);

    if (!stripeKey) {
      return NextResponse.json(
        { success: false, error: 'Missing STRIPE_SECRET_KEY environment variable.' },
        { status: 200 }
      );
    }

    // 2. Firebase Admin 動的インポートでユーザーID取得
    const firebaseSecret = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    let userId = '';

    if (firebaseSecret) {
      try {
        const { getApps, initializeApp, cert } = await import('firebase-admin/app');
        const { getAuth } = await import('firebase-admin/auth');

        let firebaseApp: any = null;
        const apps = getApps();
        if (apps.length > 0) {
          firebaseApp = apps[0];
        } else {
          let decodedSecret = firebaseSecret;
          if (!firebaseSecret.startsWith('{')) {
            try {
              decodedSecret = Buffer.from(firebaseSecret, 'base64').toString('utf8');
            } catch (b64Err) {
              console.error('[create-portal-session] Base64 decoding failed:', b64Err);
            }
          }

          let serviceAccount: any = null;
          try {
            serviceAccount = JSON.parse(decodedSecret);
          } catch {
            try {
              const sanitizedJson = decodedSecret
                .replace(/\\n/g, '\n')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r');
              serviceAccount = JSON.parse(sanitizedJson);
            } catch (jsonErr2: any) {
              throw new Error(`FIREBASE_SERVICE_ACCOUNT JSON parse failure: ${jsonErr2.message}`);
            }
          }

          if (serviceAccount && typeof serviceAccount.private_key === 'string') {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
          }

          firebaseApp = initializeApp({ credential: cert(serviceAccount) });
        }

        const authObj = getAuth(firebaseApp);
        const authHeader = req.headers.get('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const idToken = authHeader.substring(7);
          try {
            const decodedToken = await authObj.verifyIdToken(idToken);
            userId = decodedToken.uid;
          } catch (authErr: any) {
            console.error('[create-portal-session] Token verification failed:', authErr);
            return NextResponse.json(
              { success: false, error: '認証トークンが無効または期限切れです。' },
              { status: 200 }
            );
          }
        }
      } catch (fe: any) {
        console.error('[create-portal-session] Firebase initialization failed:', fe);
      }
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'ユーザーIDを取得できませんでした。再ログインしてください。' },
        { status: 200 }
      );
    }

    // 3. Stripe 初期化
    const stripe = new Stripe(stripeKey, {
      // @ts-ignore
      apiVersion: '2023-10-16',
    });

    // 4. FirestoreからstripeCustomerIdを取得
    let stripeCustomerId: string | null = null;
    try {
      const { getFirestore } = await import('firebase-admin/firestore');
      const { getApp } = await import('firebase-admin/app');
      const db = getFirestore(getApp());
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        stripeCustomerId = userDoc.data()?.stripeCustomerId || null;
      }
    } catch (dbErr: any) {
      console.error('[create-portal-session] Firestore fetch failed:', dbErr);
    }

    // 5. stripeCustomerIdがない場合はCheckoutセッションから取得を試みる
    if (!stripeCustomerId) {
      // サブスクリプションをメタデータのuserIdで検索
      try {
        const subscriptions = await stripe.subscriptions.list({
          limit: 10,
        });
        const matched = subscriptions.data.find(
          (sub) => sub.metadata?.userId === userId
        );
        if (matched && matched.customer) {
          stripeCustomerId = typeof matched.customer === 'string'
            ? matched.customer
            : matched.customer.id;
        }
      } catch (subErr: any) {
        console.error('[create-portal-session] Subscription search failed:', subErr);
      }
    }

    if (!stripeCustomerId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Stripeの顧客情報が見つかりませんでした。サポートにお問い合わせください。',
        },
        { status: 200 }
      );
    }

    // 6. return_url の決定
    const reqHeaders = new Headers(req.headers);
    const origin = reqHeaders.get('origin') || 'https://otayori-calendar-owfg.vercel.app';
    const appUrl = localSanitize(process.env.NEXT_PUBLIC_APP_URL) || origin;
    const returnUrl = `${appUrl}/`;

    // 7. カスタマーポータルセッション生成
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    console.log('[create-portal-session] Portal session created:', portalSession.url);
    return NextResponse.json({ success: true, url: portalSession.url });

  } catch (error: any) {
    console.error('[create-portal-session] Error:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `ポータルセッションの生成に失敗しました: ${errMsg}` },
      { status: 200 }
    );
  }
}
