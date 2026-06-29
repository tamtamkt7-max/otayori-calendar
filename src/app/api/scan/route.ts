import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// firebase-admin の初期化 (シングルトンパターン)
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    initializeApp({
      credential: cert(serviceAccount)
    });
  } catch (initError) {
    console.error("firebase-admin initialization failed:", initError);
  }
}

const firestore = getFirestore();
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

    if (!firestore) {
      return NextResponse.json({ error: 'データベースに接続できませんでした' }, { status: 500 });
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
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // Gemini 1.5 Flash を呼び出し
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
    const events = JSON.parse(jsonStr);

    // 2. トランザクション処理による利用制限数のインクリメント
    let finalRemaining = 10;
    
    await firestore.runTransaction(async (transaction) => {
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

    return NextResponse.json({ success: true, events, remaining: finalRemaining });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "解析エラー" }, { status: 500 });
  }
}