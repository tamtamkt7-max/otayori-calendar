export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { checkRateLimit } from '../../../lib/rateLimit';
import crypto from 'crypto';

/**
 * グループ（家族）全員のFCMトークンを収集するヘルパー関数
 */
async function collectGroupFcmTokens(db: any, groupOwnerId: string): Promise<string[]> {
  const allTokens = new Set<string>();
  try {
    const ownerDoc = await db.collection('users').doc(groupOwnerId).get();
    if (ownerDoc.exists) {
      const ownerData = ownerDoc.data();
      const tokens = ownerData?.fcmTokens || [];
      if (!Array.isArray(tokens)) {
        console.warn(`[collectGroupFcmTokens] fcmTokens for owner ${groupOwnerId} is not an array`);
      } else {
        const uniqueTokens = Array.from(new Set(tokens.filter((t: any) => t && typeof t === 'string' && t.trim() !== '')));
        uniqueTokens.forEach((t) => allTokens.add(t));
      }
    }
    const membersSnapshot = await db.collection('users')
      .where('groupId', '==', groupOwnerId)
      .get();
    membersSnapshot.forEach((memberDoc: any) => {
      const memberData = memberDoc.data();
      const tokens = memberData?.fcmTokens || [];
      if (!Array.isArray(tokens)) {
        return; // Skip if not an array
      }
      const uniqueTokens = Array.from(new Set(tokens.filter((t: any) => t && typeof t === 'string' && t.trim() !== '')));
      uniqueTokens.forEach((t) => allTokens.add(t));
    });
  } catch (err) {
    console.warn(`[collectGroupFcmTokens] Failed to collect tokens for group ${groupOwnerId}:`, err);
  }
  return Array.from(allTokens);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { image, images, userId, targetMemberId } = body;

    const base64Images: string[] = images || (image ? [image] : []);

    if (base64Images.length === 0) {
      return NextResponse.json({ error: '画像がありません' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'ユーザーIDが必要です' }, { status: 400 });
    }

    const { getFirebaseAdmin } = await import('../../../lib/firebaseAdmin');
    const admin = await getFirebaseAdmin();
    const firestore = admin?.db;
    if (admin.error || !firestore) {
      console.error("[scan API] Firebase Admin is unavailable:", admin.error);
      return NextResponse.json({ error: `データベース接続エラー: ${admin.error?.message || 'Unknown Firebase Admin error'}` }, { status: 500 });
    }

    // セキュリティ対策: レートリミット（1分間に最大15回、1日に最大100回）
    const clientIp = req.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = userId || clientIp;

    const minuteAllowed = await checkRateLimit({
      db: firestore,
      key: rateLimitKey,
      actionName: 'scan_minute',
      limit: 15,
      windowMs: 60000
    });

    if (!minuteAllowed) {
      return NextResponse.json({ error: 'リクエストが多すぎます。少し時間をおいてから再度お試しください。' }, { status: 429 });
    }

    const dayAllowed = await checkRateLimit({
      db: firestore,
      key: rateLimitKey,
      actionName: 'scan_day',
      limit: 100,
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
    let userGroupId = userId;

    if (userDoc.exists) {
      const userData = userDoc.data();
      scanCount = userData?.scanCount || 0;
      lastScanMonth = userData?.lastScanMonth || '';
      plan = userData?.plan || 'free';
      userGroupId = userData?.groupId || userId;
    }

    const activeScanCount = lastScanMonth === currentMonthStr ? scanCount : 0;
    const incomingCount = base64Images.length;

    if (plan !== 'premium' && activeScanCount + incomingCount > 10) {
      return NextResponse.json({
        error: `今月の無料スキャン上限（残り ${Math.max(0, 10 - activeScanCount)}枚）を超えています😢`
      }, { status: 403 });
    }

    const currentGroupId = userGroupId;
    const groupOwnerSnap = await firestore.collection('users').doc(currentGroupId).get();
    let groupMembers: any[] = [];
    if (groupOwnerSnap.exists) {
      groupMembers = groupOwnerSnap.data()?.members || [];
    }
    if (groupMembers.length === 0) {
      groupMembers = [{ id: 'owner', name: '共通', color: 'orange' }];
    }

    const batch = firestore.batch();
    const processedEvents: any[] = [];

    const normalizeDate = (dateStr: string): string => {
      if (!dateStr) return currentMonthStr + '-01';
      let clean = dateStr
        .replace(/年|月/g, '-')
        .replace(/日/g, '')
        .replace(/\//g, '-')
        .replace(/\./g, '-')
        .trim();

      const parts = clean.split('-');
      if (parts.length === 3) {
        const y = parts[0].padStart(4, '20');
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        const formatted = `${y}-${m}-${d}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
          return formatted;
        }
      } else if (parts.length === 2) {
        const m = parts[0].padStart(2, '0');
        const d = parts[1].padStart(2, '0');
        return `${jstDate.getFullYear()}-${m}-${d}`;
      }
      return currentMonthStr + '-01';
    };

    // 各画像について処理
    for (let imgIdx = 0; imgIdx < base64Images.length; imgIdx++) {
      const currentImage = base64Images[imgIdx];
      const mimeTypeMatch = currentImage.match(/data:(.*?);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';

      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedMimeTypes.includes(mimeType)) {
        return NextResponse.json({ error: '許可されていないファイル形式です。画像（JPEG/PNG/WEBP/GIF）のみアップロード可能です。' }, { status: 400 });
      }

      const base64Data = currentImage.includes(',') ? currentImage.split(',')[1] : currentImage;
      const buffer = Buffer.from(base64Data, 'base64');

      const MAX_SIZE = 10 * 1024 * 1024;
      if (buffer.length > MAX_SIZE) {
        return NextResponse.json({ error: 'ファイルサイズが大きすぎます。10MB以下の画像を指定してください。' }, { status: 400 });
      }

      let imageUrl: string | null = null;
      try {
        const { getStorage } = await import('firebase-admin/storage');
        const storage = getStorage();
        const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
        if (!bucketName) {
          throw new Error("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set");
        }
        const bucket = storage.bucket(bucketName);
        const filename = `users/${userId}/letters/${Date.now()}-${imgIdx}.jpg`;
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
      } catch (storageError) {
        console.error("Firebase Storage upload error:", storageError);
      }

      // Gemini 3.5 Flash を呼び出し
      const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

      const prompt = `
      あなたは優秀な学校・園の予定管理アシスタントです。
      与えられた「おたより」の画像から、行事・イベントの予定を漏れなく全て抽出してください。
      画像内の上部やヘッダーにあるタイトル情報（例：「7月スケジュール」「2026年」など）を注意深く読み取り、何年何月の予定であるかを正しく特定した上で、各マスのイベントの日付を確定させてください。
      
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
      const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
      let events = [];
      try {
        events = JSON.parse(jsonStr);
      } catch (jsonError: any) {
        console.error("Gemini output JSON parse error:", jsonError, "Raw output:", text);
        return NextResponse.json({ error: "おたよりの解析データが正しいフォーマットではありませんでした。もう一度スキャンし直してください。" }, { status: 500 });
      }

      for (let idx = 0; idx < events.length; idx++) {
        const ev = events[idx];
        const eventId = `ai-scan-${Date.now()}-${imgIdx}-${idx}`;
        const titleText = (ev.title || '').trim();
        const detailsText = (ev.details || '').trim();

        const cleanTitle = titleText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const cleanDetails = detailsText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        let finalMember = null;
        if (targetMemberId && targetMemberId !== 'all') {
          finalMember = groupMembers.find(m => m.id === targetMemberId);
        }

        if (!finalMember) {
          let matchedMember = groupMembers.find(m =>
            (m.name && (cleanTitle.includes(m.name) || cleanDetails.includes(m.name)))
          );

          if (!matchedMember) {
            matchedMember = groupMembers.find(m => {
              const name = m.name || '';
              if (name.includes('パパ') && (cleanTitle.includes('パパ') || cleanDetails.includes('パパ') || cleanTitle.includes('父') || cleanDetails.includes('父'))) return true;
              if (name.includes('ママ') && (cleanTitle.includes('ママ') || cleanDetails.includes('ママ') || cleanTitle.includes('母') || cleanDetails.includes('母'))) return true;
              if (name.includes('子') && (cleanTitle.includes('子') || cleanDetails.includes('子') || cleanTitle.includes('園児') || cleanDetails.includes('児童'))) return true;
              return false;
            });
          }
          finalMember = matchedMember || groupMembers[0];
        }

        const eventData = {
          id: eventId,
          title: cleanTitle || '無題の予定',
          date: normalizeDate(ev.date),
          details: cleanDetails,
          category: ev.category || 'school',
          color: (finalMember && finalMember.color) ? finalMember.color : 'orange',
          memberId: (finalMember && finalMember.id) ? finalMember.id : 'owner',
          imageUrl: imageUrl,
          isNotificationEnabled: true, // オプトアウト通知用の新規フィールド（デフォルトON）
          updatedAt: new Date().toISOString()
        };

        processedEvents.push(eventData);

        const evRef = firestore.collection('groups').doc(currentGroupId).collection('events').doc(eventId);
        batch.set(evRef, eventData, { merge: true });
      }
    }

    let fScanCount = scanCount;
    if (lastScanMonth !== currentMonthStr) {
      fScanCount = incomingCount;
    } else {
      fScanCount += incomingCount;
    }

    batch.set(userRef, {
      scanCount: fScanCount,
      lastScanMonth: currentMonthStr
    }, { merge: true });

    await batch.commit();

    return NextResponse.json({ success: true, events: processedEvents, remaining: Math.max(0, 10 - fScanCount) });

  } catch (error: any) {
    console.error("API Error:", error);
    Sentry.captureException(error);
    return NextResponse.json({ error: error.message || "解析エラー" }, { status: 500 });
  }
}