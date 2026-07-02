export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getFirebaseAdmin } from '../../../lib/firebaseAdmin';
import { checkRateLimit } from '../../../lib/rateLimit';
import { sanitizeEnvVar } from '../../../lib/envSanitizer';

let stripeInstance: Stripe | null = null;

// Stripe SDK インスタンスの遅延・安全初期化ヘルパー
function getStripeClient(): Stripe {
  if (stripeInstance) return stripeInstance;

  const rawKey = process.env.STRIPE_SECRET_KEY;
  const sanitizedKey = sanitizeEnvVar(rawKey);

  if (!sanitizedKey) {
    throw new Error("STRIPE_SECRET_KEY is not defined or empty in environment variables.");
  }

  stripeInstance = new Stripe(sanitizedKey, {
    // @ts-ignore
    apiVersion: '2023-10-16'
  });
  return stripeInstance;
}

export async function POST(req: Request) {
  try {
    console.log("[checkout API] Received request. Running environmental validation.");

    // 1. Firebase Admin インスタンスの取得
    const admin = getFirebaseAdmin();
    if (admin.error || !admin.db) {
      console.error("[checkout API] Firebase Admin is unavailable:", admin.error);
      return NextResponse.json({ 
        error: `データベース接続エラー: ${admin.error?.message || 'Unknown Firebase Admin error'}`,
        stack: admin.error?.stack || null
      }, { status: 500 });
    }

    // 2. Stripe クライアントの安全ロード（例外を POST 内で確実にキャッチ）
    let stripe: Stripe;
    try {
      stripe = getStripeClient();
    } catch (stripeInitErr: any) {
      console.error("[checkout API] Stripe Client initialization failed:", stripeInitErr);
      return NextResponse.json({ 
        error: `Stripe初期化エラー: ${stripeInitErr.message}`,
        stack: stripeInitErr.stack || null
      }, { status: 500 });
    }

    // 3. Firebase ID Token の検証
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: '認証が必要です。' }, { status: 401 });
    }

    const idToken = authHeader.substring(7);
    let userId: string;
    let email: string | undefined;

    try {
      const decodedToken = await admin.auth.verifyIdToken(idToken);
      userId = decodedToken.uid;
      email = decodedToken.email;
    } catch (authErr: any) {
      console.error("ID Token verification failed:", authErr);
      return NextResponse.json({ 
        error: '認証トークンが無効または期限切れです。',
        details: authErr.message
      }, { status: 401 });
    }

    // 4. レートリミットチェック (過去1分間に最大3回)
    const isAllowed = await checkRateLimit({
      db: admin.db,
      key: userId,
      actionName: 'checkout',
      limit: 3,
      windowMs: 60000
    });

    if (!isAllowed) {
      return NextResponse.json({ error: 'リクエストが多すぎます。しばらく時間を置いてから再度お試しください。' }, { status: 429 });
    }

    const reqHeaders = new Headers(req.headers);
    const origin = reqHeaders.get('origin') || 'http://localhost:3000';

    // 5. Price IDの厳格な取得とサニタイズ
    const rawPriceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
    const priceId = sanitizeEnvVar(rawPriceId);
    
    console.log("[checkout API] Sanitized Price ID verification:", {
      originalLength: rawPriceId ? rawPriceId.length : 0,
      sanitizedLength: priceId.length,
      startsWithPrice: priceId.startsWith('price_')
    });

    const isPriceIdValid = priceId && priceId.startsWith('price_');
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = isPriceIdValid
      ? { price: priceId, quantity: 1 }
      : {
          price_data: {
            currency: 'jpy',
            product_data: {
              name: 'おたよりカレンダー プレミアムプラン',
              description: '月額スキャン無制限、パートナー同期共有、広告非表示',
            },
            unit_amount: 480,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        };

    // 6. Stripe Checkout セッション生成
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [lineItem],
      mode: 'subscription',
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancel_url: `${origin}/`,
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

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("[checkout API] Ultimate Safe Wrap Catch:", error);
    return NextResponse.json({ 
      error: `決済セッションの生成に失敗しました: ${error?.message || 'Unknown Stripe Error'}`,
      stack: error?.stack || null
    }, { status: 500 });
  }
}
