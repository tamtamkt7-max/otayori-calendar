import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
  // @ts-ignore
  apiVersion: '2023-10-16'
});

export async function POST(req: Request) {
  try {
    const { userId, email } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'ユーザーIDが必要です' }, { status: 400 });
    }

    const reqHeaders = new Headers(req.headers);
    const origin = reqHeaders.get('origin') || 'http://localhost:3000';

    // Stripe Checkoutセッションの生成
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
    return NextResponse.json({ error: error.message || '決済セッションの生成に失敗しました' }, { status: 500 });
  }
}
