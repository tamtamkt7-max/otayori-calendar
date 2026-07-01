import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
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

// ユーザーのプラン状態をFirestoreで更新するヘルパー
async function updateUserPlan(userId: string, plan: 'premium' | 'free') {
  const db = getFirestoreInstance();
  if (!db) {
    throw new Error("Database connection failed during plan update");
  }
  const userRef = db.collection('users').doc(userId);
  await userRef.set({
    plan: plan,
    premiumUpdatedAt: new Date().toISOString()
  }, { merge: true });
  console.log(`[Webhook] Successfully updated user ${userId} plan to ${plan}`);
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

  // 各決済・契約関連イベントを処理
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;

      if (userId) {
        await updateUserPlan(userId, 'premium');
      } else {
        console.warn("[Webhook] userId not found in session metadata");
      }
    } 
    
    else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      let userId = invoice.metadata?.userId;

      // もしInvoiceのメタデータにない場合、関連するサブスクリプションから取得
      const subscriptionId = (invoice as any).subscription as string | undefined;
      if (!userId && subscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          userId = subscription.metadata?.userId;
        } catch (err: any) {
          console.error(`[Webhook] Failed to retrieve subscription details:`, err.message);
        }
      }

      if (userId) {
        await updateUserPlan(userId, 'premium');
      } else {
        console.warn("[Webhook] userId not found in invoice or subscription metadata");
      }
    } 
    
    else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;

      if (userId) {
        await updateUserPlan(userId, 'free');
      } else {
        console.warn("[Webhook] userId not found in subscription metadata on cancellation");
      }
    }
  } catch (err: any) {
    console.error(`[Webhook] Error processing event ${event.type}:`, err.message);
    Sentry.captureException(err);
    return NextResponse.json({ error: `Processing failed: ${err.message}` }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
