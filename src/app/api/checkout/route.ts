import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
  // @ts-ignore
  apiVersion: '2023-10-16'
});

// firebase-admin 初期化ヘルパー
function getFirebaseAdmin() {
  if (!getApps().length) {
    try {
      const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!serviceAccountStr) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set.");
      }
      const serviceAccount = JSON.parse(serviceAccountStr);
      initializeApp({
        credential: cert(serviceAccount)
      });
    } catch (err) {
      console.error("Firebase Admin initialization failed in checkout API:", err);
      return null;
    }
  }
  return {
    auth: getAuth(),
    db: getFirestore()
  };
}

export async function POST(req: Request) {
  try {
    const admin = getFirebaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'サーバー内部エラーが発生しました。' }, { status: 500 });
    }

    // 1. Firebase ID Token の検証
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
    } catch (authErr) {
      console.error("ID Token verification failed:", authErr);
      return NextResponse.json({ error: '認証トークンが無効または期限切れです。' }, { status: 401 });
    }

    // 2. レートリミット（回数制限）チェック: 過去1分間に最大3回
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const rateLimitRef = admin.db.collection('users').doc(userId).collection('security').doc('checkoutLimits');

    let attempts: number[] = [];
    try {
      const doc = await rateLimitRef.get();
      if (doc.exists) {
        const data = doc.data();
        attempts = (data?.attempts || []).filter((timestamp: number) => timestamp > oneMinuteAgo);
      }
    } catch (dbErr) {
      console.error("Failed to fetch rate limit data:", dbErr);
    }

    if (attempts.length >= 3) {
      console.warn(`[Security Alert] Rate limit exceeded for user ${userId}. Requests: ${attempts.length}`);
      return NextResponse.json({ error: 'リクエストが多すぎます。しばらく時間を置いてから再度お試しください。' }, { status: 429 });
    }

    // 新しい試行を追加して保存
    attempts.push(now);
    try {
      await rateLimitRef.set({ attempts }, { merge: true });
    } catch (dbErr) {
      console.error("Failed to update rate limit data:", dbErr);
    }

    const reqHeaders = new Headers(req.headers);
    const origin = reqHeaders.get('origin') || 'http://localhost:3000';

    // 3. Stripe Checkoutセッションの生成
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
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
        },
      ],
      mode: 'subscription',
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancel_url: `${origin}/`,
      metadata: {
        userId: userId, // Webhookでユーザーを特定するために必須
      },
      customer_email: email || undefined, // ログイン中のメアドを自動入力
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe Session Creation Error:", error);
    // 安全性向上のため、エラー詳細を外部に漏らさず抽象的なメッセージで統一
    return NextResponse.json({ error: '決済セッションの生成に失敗しました。' }, { status: 500 });
  }
}
