export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// プロセス例外トラップ
if (typeof process !== 'undefined') {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[checkout API] Standalone Unhandled Rejection:', promise, 'reason:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[checkout API] Standalone Uncaught Exception:', err);
  });
}

// 他の共通ヘルパーモジュールに依存せず、インポート時例外を 100% 遮断するためのインライン・サニタイザー
function localSanitize(val: string | undefined): string {
  if (!val) return '';
  return val.trim().replace(/[\r\n]/g, '').replace(/\\n/g, '\n');
}

export async function POST(req: Request) {
  try {
    console.log("[checkout API] Standalone Route execution started.");

    // 1. 環境変数の取得とサニタイズ（外部依存を完全排除し、POST関数内で実行）
    const rawStripeKey = process.env.STRIPE_SECRET_KEY;
    const stripeKey = localSanitize(rawStripeKey);
    const rawPriceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
    const priceId = localSanitize(rawPriceId);
    const rawFirebaseSecret = process.env.FIREBASE_SERVICE_ACCOUNT;
    const firebaseSecret = localSanitize(rawFirebaseSecret);

    if (!stripeKey || !priceId) {
      return NextResponse.json({
        success: false,
        error: "Missing required Stripe environment variables."
      }, { status: 200 });
    }

    // 2. Firebase Admin の遅延インライン初期化 (二重初期化の完全防止)
    let firebaseApp: any = null;
    let authObj: any = null;
    let dbObj: any = null;

    if (firebaseSecret) {
      try {
        const apps = getApps();
        if (apps.length > 0) {
          firebaseApp = apps[0];
        } else {
          // Base64 デコード処理のインライン内包化
          let decodedSecret = firebaseSecret;
          if (!firebaseSecret.startsWith('{')) {
            try {
              decodedSecret = Buffer.from(firebaseSecret, 'base64').toString('utf8');
            } catch (b64Err) {
              console.error("[checkout API] Standalone Base64 decoding failed:", b64Err);
            }
          }

          // JSON パース防衛
          let serviceAccount: any = null;
          try {
            serviceAccount = JSON.parse(decodedSecret);
          } catch (jsonErr1) {
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

          firebaseApp = initializeApp({
            credential: cert(serviceAccount)
          });
        }
        authObj = getAuth(firebaseApp);
        dbObj = getFirestore(firebaseApp);
      } catch (fe: any) {
        console.error("[checkout API] Standalone Firebase Init failed:", fe);
        // Firebase初期化エラーがあっても、Stripeのために即死はさせない
      }
    }

    // 3. ID Token の検証
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: '認証が必要です。' }, { status: 200 });
    }

    const idToken = authHeader.substring(7);
    let userId: string = 'unknown_user';
    let email: string | undefined = undefined;

    if (authObj) {
      try {
        const decodedToken = await authObj.verifyIdToken(idToken);
        userId = decodedToken.uid;
        email = decodedToken.email;
      } catch (authErr: any) {
        console.error("[checkout API] Token verification failed:", authErr);
        return NextResponse.json({
          success: false,
          error: '認証トークンが無効または期限切れです。',
          details: String(authErr.message || authErr)
        }, { status: 200 });
      }
    }

    // 4. レートリミットチェック (インライン化して外部インポート依存によるクラッシュを防止)
    if (dbObj) {
      try {
        const limitDocRef = dbObj.collection('rate_limits').doc(`${userId}_checkout`);
        const limitDoc = await limitDocRef.get();
        const now = Date.now();
        const windowMs = 60000;
        const limit = 3;

        if (limitDoc.exists) {
          const data = limitDoc.data();
          const timestamps: number[] = data?.timestamps || [];
          const validTimestamps = timestamps.filter((t: number) => now - t < windowMs);

          if (validTimestamps.length >= limit) {
            return NextResponse.json({
              success: false,
              error: 'リクエストが多すぎます。しばらく時間を置いてから再度お試しください。'
            }, { status: 200 });
          }

          validTimestamps.push(now);
          await limitDocRef.set({ timestamps: validTimestamps });
        } else {
          await limitDocRef.set({ timestamps: [now] });
        }
      } catch (rateErr) {
        console.error("[checkout API] Rate limit check failed (skipped for safety):", rateErr);
      }
    }

    // 5. Stripe クライアント初期化（POST 関数内部で実行）
    const stripe = new Stripe(stripeKey, {
      // @ts-ignore
      apiVersion: '2023-10-16'
    });

    const reqHeaders = new Headers(req.headers);
    const origin = reqHeaders.get('origin') || 'http://localhost:3000';
    const appUrl = localSanitize(process.env.NEXT_PUBLIC_APP_URL) || origin;

    // 6. Stripe Checkout セッション生成（本番価格 ID ダイレクト指定）
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        }
      ],
      mode: 'subscription',
      success_url: `${appUrl}/?session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancel_url: `${appUrl}/`,
      metadata: {
        userId: userId,
      },
      subscription_data: {
        metadata: {
          userId: userId,
        },
      },
      customer_email: email || undefined,
    });

    return NextResponse.json({ success: true, url: session.url });

  } catch (error: any) {
    console.error("[checkout API] Standalone Absolute Outer Catch:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? String(error.stack || '') : '';

    return NextResponse.json({
      success: false,
      error: `決済セッションの生成に失敗しました: ${errMsg}`,
      stack: errStack
    }, { status: 200 });
  }
}
