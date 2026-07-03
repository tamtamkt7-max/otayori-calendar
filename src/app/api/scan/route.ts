export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { checkRateLimit } from '../../../lib/rateLimit';
import crypto from 'crypto';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { image, userId } = body;

    if (!image) {
      return NextResponse.json({ error: '画像がありません' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'ユーザーIDが必要です' }, { status: 400 });
    }

    const { getFirebaseAdmin } = await import('../../../lib/firebaseAdmin');
    const admin = getFirebaseAdmin();
    const firestore = admin?.db;
    if (admin.error || !firestore) {
      console.error("[scan API] Firebase Admin is unavailable:", admin.error);
      return NextResponse.json({ error: `データベース接続エラー: ${admin.error?.message || 'Unknown Firebase Admin error'}` }, { status: 500 });
    }

    // セキュリティ対策: レートリミット（1分間に最大5回、1日に最大30回）
    const clientIp = req.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = userId || clientIp;

    const minuteAllowed = await checkRateLimit({
      db: firestore,
      key: rateLimitKey,
      actionName: 'scan_minute',
      limit: 5,
      windowMs: 60000
    });

    if (!minuteAllowed) {
      return NextResponse.json({ error: 'リクエストが多すぎます。少し時間をおいてから再度お試しください。' }, { status: 429 });
    }

    const dayAllowed = await checkRateLimit({
      db: firestore,
      key: rateLimitKey,
      actionName: 'scan_day',
      limit: 30,
      windowMs: 86400000
    });

    if (!dayAllowed) {
      return NextResponse.json({ error: '1日のリクエスト上限に達しました。明日再度お試しください。' }, { status: 429 });
    }

    // 1. スキャン前の利用回数チェック
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    // 日本時間基準で現在の年月 (YYYY-MM) を取得
    const now = new Date();
    const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentMonthStr = `${jstDate.getFullYear()}-${String(jstDate.getMonth() + 1).padStart(2, '0')}`;

    let scanCount = 0;
    let lastScanMonth = '';
    let plan = 'free';

    if (userDoc.exists) {
      const userData = userDoc.data();
      scanCount = userData?.scanCount || 0;
      lastScanMonth = userData?.lastScanMonth || '';
      plan = userData?.plan || 'free';
    }

    // 月が変わっている場合は一時的にカウントを0として扱う (後段のトランザクションでリセット)
    const activeScanCount = lastScanMonth === currentMonthStr ? scanCount : 0;

    // 無料ユーザー（plan: 'free'）のチェック
    if (plan !== 'premium' && activeScanCount >= 10) {
      return NextResponse.json({ 
        error: '今月の無料スキャン上限（10回）に達しました😢' 
      }, { status: 403 });
    }

    // Base64データとMIMEタイプの抽出
    const mimeTypeMatch = image.match(/data:(.*?);base64,/);
    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';
 
    // セキュリティ対策: 画像MIMEタイプの制限 (拡張子制限に相当)
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(mimeType)) {
      return NextResponse.json({ error: '許可されていないファイル形式です。画像（JPEG/PNG/WEBP/GIF）のみアップロード可能です。' }, { status: 400 });
    }
 
    const base64Data = image.includes(',') ? image.split(',')[1] : image;
    const buffer = Buffer.from(base64Data, 'base64');
 
    // セキュリティ対策: ファイルサイズ制限 (10MB)
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (buffer.length > MAX_SIZE) {
      return NextResponse.json({ error: 'ファイルサイズが大きすぎます。10MB以下の画像を指定してください。' }, { status: 400 });
    }
 
    // Firebase Storageへおたより画像を保存
    let imageUrl: string | null = null;
    try {
      const { getStorage } = await import('firebase-admin/storage');
      const storage = getStorage();
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      if (!bucketName) {
        throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set");
      }
      const bucket = storage.bucket(bucketName);
      const filename = `users/${userId}/letters/${Date.now()}.jpg`;
      const file = bucket.file(filename);
 
      const downloadToken = crypto.randomUUID();
      await file.save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken
          }
        }
      });
 
      imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`;
      console.log("Successfully uploaded print image to Firebase Storage. URL:", imageUrl);
    } catch (storageError) {
      console.error("Firebase Storage upload error (skipping image link):", storageError);
    }
 
    // Gemini 3.5 Flash を呼び出し
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
 
    const prompt = `
    あなたは優秀な学校・園の予定管理アシスタントです。
    与えられた「おたより」の画像から、行事・イベントの予定を漏れなく全て抽出してください。
    以下のJSON配列フォーマットに完全に準拠して出力してください。Markdown（\`\`\`json 等）は不要です。
    [
      {
        "title": "行事名",
        "date": "YYYY-MM-DD",
        "details": "持ち物や詳細",
        "category": "school または event または medical"
      }
    ]
    `;
 
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: mimeType } }
    ]);
 
    const text = result.response.text();
    
    // JSON文字列のクリーンアップ（Markdown記法が混ざった場合の対策）
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    let events = [];
    try {
      events = JSON.parse(jsonStr);
    } catch (jsonError: any) {
      console.error("Gemini output JSON parse error:", jsonError, "Raw output:", text);
      return NextResponse.json({ error: "おたよりの解析データが正しいフォーマットではありませんでした。もう一度撮影・スキャンし直してください。", debug: text }, { status: 500 });
    }

    // 2. トランザクション処理による利用制限数のインクリメント
    let finalRemaining = 10;
    
    await firestore.runTransaction(async (transaction: any) => {
      const freshDoc = await transaction.get(userRef);
      let fScanCount = 0;
      let fLastScanMonth = '';
      let fPlan = 'free';

      if (freshDoc.exists) {
        const fData = freshDoc.data();
        fScanCount = fData?.scanCount || 0;
        fLastScanMonth = fData?.lastScanMonth || '';
        fPlan = fData?.plan || 'free';
      }

      if (fPlan === 'premium') {
        fScanCount += 1;
        finalRemaining = 9999; // プレミアムは実質無制限
        transaction.set(userRef, {
          scanCount: fScanCount,
          lastScanMonth: currentMonthStr
        }, { merge: true });
      } else {
        if (fLastScanMonth !== currentMonthStr) {
          fScanCount = 1;
          finalRemaining = 9;
          transaction.set(userRef, {
            scanCount: fScanCount,
            lastScanMonth: currentMonthStr
          }, { merge: true });
        } else {
          fScanCount += 1;
          finalRemaining = Math.max(0, 10 - fScanCount);
          transaction.set(userRef, {
            scanCount: fScanCount
          }, { merge: true });
        }
      }
    });

    return NextResponse.json({ success: true, events, remaining: finalRemaining, imageUrl });

  } catch (error: any) {
    console.error("API Error:", error);
    Sentry.captureException(error);
    return NextResponse.json({ error: error.message || "解析エラー" }, { status: 500 });
  }
}