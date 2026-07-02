export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// 他の共通ヘルパーモジュールに依存せず、インポート時例外を 100% 遮断するためのインライン・サニタイザー
function localSanitize(val: string | undefined): string {
  if (!val) return '';
  return val.trim().replace(/[\r\n]/g, '').replace(/\\n/g, '\n');
}

export async function POST(req: Request) {
  try {
    console.log("[checkout API] Dynamic Import Route execution started.");

    // 1. 環境変数の取得とサニタイズ
    const rawStripeKey = process.env.STRIPE_SECRET_KEY;
    const stripeKey = localSanitize(rawStripeKey);
    const rawPriceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
    const priceId = localSanitize(rawPriceId);

    if (!stripeKey || !priceId) {
      return NextResponse.json({
        success: false,
        error: "Missing required Stripe environment variables."
      }, { status: 200 });
    }

    // 2. Firebase Admin の動的インポート (Dynamic Import) と遅延初期化
    const firebaseSecret = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
    let userId = 'unknown_user';
    let email: string | undefined = undefined;

    if (firebaseSecret) {
      try {
        // Firebase Admin SDK モジュールをインポートフェーズ（ロード時）ではなく、POST実行時に非同期ロード
        const { getApps, initializeApp, cert } = await import('firebase-admin/app');
        const { getAuth } = await import('firebase-admin/auth');

        let firebaseApp: any = null;
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

        const authObj = getAuth(firebaseApp);

        // ID Token の検証
        const authHeader = req.headers.get('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const idToken = authHeader.substring(7);
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
      } catch (fe: any) {
        console.error("[checkout API] Dynamic Firebase Loading/Initialization failed:", fe);
        // Firebase認証に失敗してもStripe画面へ遷移できるようにするため、警告は出すが処理は継続させる
      }
    }

    // 3. Stripe クライアント初期化
    const stripe = new Stripe(stripeKey, {
      // @ts-ignore
      apiVersion: '2023-10-16'
    });

    const reqHeaders = new Headers(req.headers);
    const origin = reqHeaders.get('origin') || 'http://localhost:3000';
    const appUrl = localSanitize(process.env.NEXT_PUBLIC_APP_URL) || origin;

    // 4. Stripe Checkout セッション生成（userId をメタデータに復元）
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
    console.error("[checkout API] Minimal Catch:", error);
    const errMsg = error instanceof Error ? error.message : String(error);

    return NextResponse.json({
      success: false,
      error: `決済セッションの生成に失敗しました: ${errMsg}`
    }, { status: 200 });
  }
}