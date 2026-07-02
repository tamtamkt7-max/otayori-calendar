export const runtime = 'nodejs';

import { NextResponse } from "next/server";
import Stripe from "stripe";

// Firebase-adminのインポートを完全に抹消（インポート時のクラッシュを防ぐため）

// インライン・サニタイザー
function localSanitize(val: string | undefined): string {
  if (!val) return '';
  return val.trim().replace(/[\r\n]/g, '').replace(/\\n/g, '\n');
}

export async function POST(req: Request) {
  try {
    console.log("[checkout API] Minimal Route execution started.");

    // 1. 環境変数の取得とサニタイズ
    const rawStripeKey = process.env.STRIPE_SECRET_KEY;
    const stripeKey = localSanitize(rawStripeKey);
    const rawPriceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
    const priceId = localSanitize(rawPriceId);

    if (!stripeKey || !priceId) {
      return NextResponse.json({
        success: false,
        error: "Missing required Stripe environment variables."
      }, { status: 200 }); // エラーでも200を返し、画面に表示させる
    }

    // 2. Stripe クライアント初期化
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16' as any
    });

    const reqHeaders = new Headers(req.headers);
    const origin = reqHeaders.get('origin') || 'http://localhost:3000';
    const appUrl = localSanitize(process.env.NEXT_PUBLIC_APP_URL) || origin;

    // 3. Stripe Checkout セッション生成（Firebase関連のメタデータは一旦削除）
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