import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
  // @ts-ignore
  apiVersion: '2023-10-16'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// firebase-admin をリクエスト時に初期化するヘルパー
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
      console.error("firebase-admin initialization failed in webhook:", initError);
      return null;
    }
  }
  try {
    return getFirestore();
  } catch (dbError) {
    console.error("Failed to get Firestore instance in webhook:", dbError);
    return null;
  }
}

export async function POST(req: Request) {
  const bodyText = await req.text();
  const sig = req.headers.get('stripe-signature') || '';

  let event: Stripe.Event;

  try {
    if (!webhookSecret) {
      // ローカルデバッグ用でシークレット未設定の場合は、検証をスキップして簡易パース（警告付き）
      console.warn("⚠️ STRIPE_WEBHOOK_SECRET is not set. Skipping signature verification (debug/test only).");
      event = JSON.parse(bodyText) as Stripe.Event;
    } else {
      event = stripe.webhooks.constructEvent(bodyText, sig, webhookSecret);
    }
  } catch (err: any) {
    console.error(`⚠️ Webhook signature verification failed:`, err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // 決済成功イベントを処理
  if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // metadata から userId を抽出
    const userId = session.metadata?.userId;

    if (userId) {
      const db = getFirestoreInstance();
      if (!db) {
        console.error("Database connection failed during webhook plan update");
        return NextResponse.json({ error: 'Database error' }, { status: 500 });
      }

      try {
        // 該当ユーザーのプランを premium に更新
        const userRef = db.collection('users').doc(userId);
        await userRef.set({
          plan: 'premium',
          premiumUpdatedAt: new Date().toISOString()
        }, { merge: true });

        console.log(`[Webhook] Successfully updated user ${userId} plan to premium`);
      } catch (dbErr: any) {
        console.error(`Failed to update user plan in Firestore:`, dbErr);
        return NextResponse.json({ error: 'Firestore update failed' }, { status: 500 });
      }
    } else {
      console.warn("[Webhook] userId not found in session metadata");
    }
  }

  return NextResponse.json({ received: true });
}
