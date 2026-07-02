export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import Stripe from 'stripe';
import { getFirebaseAdmin } from '../../../../lib/firebaseAdmin';
import { sendWelcomeEmail, sendCancellationEmail } from '../../../../lib/resend';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
  // @ts-ignore
  apiVersion: '2023-10-16'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ユーザーのプラン状態をFirestoreで更新するヘルパー
async function updateUserPlan(userId: string, plan: 'premium' | 'free') {
  const admin = getFirebaseAdmin();
  const db = admin?.db;
  if (admin.error || !db) {
    throw new Error(`Database connection failed during plan update: ${admin.error?.message || 'Unknown Firebase Admin error'}`);
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
      const email = session.customer_details?.email || session.customer_email;

      if (userId) {
        await updateUserPlan(userId, 'premium');
        if (email) {
          try {
            await sendWelcomeEmail(email);
          } catch (mailErr: any) {
            console.error("[Webhook] Failed to send welcome email:", mailErr.message);
          }
        }
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
        if (subscription.customer) {
          try {
            const customer = await stripe.customers.retrieve(subscription.customer as string);
            const email = (customer as any).email;
            if (email) {
              await sendCancellationEmail(email);
            }
          } catch (mailErr: any) {
            console.error("[Webhook] Failed to send cancellation email:", mailErr.message);
          }
        }
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
