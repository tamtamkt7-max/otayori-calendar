export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { checkRateLimit } from '../../../lib/rateLimit';

/**
 * グループ（家族）全員のFCMトークンを収集するヘルパー関数
 */
async function collectGroupFcmTokens(db: any, groupOwnerId: string): Promise<string[]> {
  const allTokens = new Set<string>();
  try {
    const ownerDoc = await db.collection('users').doc(groupOwnerId).get();
    if (ownerDoc.exists) {
      const ownerTokens: string[] = ownerDoc.data()?.fcmTokens || [];
      ownerTokens.forEach((t: string) => allTokens.add(t));
    }
    const membersSnapshot = await db.collection('users')
      .where('groupId', '==', groupOwnerId)
      .get();
    membersSnapshot.forEach((memberDoc: any) => {
      const memberTokens: string[] = memberDoc.data()?.fcmTokens || [];
      memberTokens.forEach((t: string) => allTokens.add(t));
    });
  } catch (err) {
    console.warn(`[collectGroupFcmTokens] Failed to collect tokens for group ${groupOwnerId}:`, err);
  }
  return Array.from(allTokens);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, groupId, event, action } = body;

    if (!userId) {
      return NextResponse.json({ error: 'ユーザーIDが必要です' }, { status: 400 });
    }

    if (!event || !event.id) {
      return NextResponse.json({ error: 'イベント情報が正しくありません' }, { status: 400 });
    }

    // 1. Firebase Admin の動的インポートと遅延初期化
    const { getFirebaseAdmin } = await import('../../../lib/firebaseAdmin');
    const { Timestamp, FieldValue } = await import('firebase-admin/firestore');
    
    const admin = await getFirebaseAdmin();
    const db = admin?.db;
    if (admin.error || !db) {
      console.error("[events API] Firebase Admin is unavailable:", admin.error);
      return NextResponse.json({ error: `データベース接続エラー: ${admin.error?.message || 'Unknown Firebase Admin error'}` }, { status: 500 });
    }

    // 2. カレンダー共有制限（パターンB）: 
    // 共有されている側（userId !== targetGroupId）であり、かつカレンダー所有者（targetGroupId）がプレミアム会員ではない場合、書き込み（保存/削除）を拒否
    const targetGroupId = groupId || userId;
    if (userId !== targetGroupId) {
      const groupOwnerDoc = await db.collection('users').doc(targetGroupId).get();
      const groupOwnerPlan = groupOwnerDoc.exists ? (groupOwnerDoc.data()?.plan || 'free') : 'free';
      if (groupOwnerPlan !== 'premium') {
        return NextResponse.json({ 
          error: 'カレンダー所有者が無料プランのため、共有カレンダーは「閲覧専用（書き込み不可）」です。共同編集を利用するには、カレンダー所有者がプレミアムプランに加入する必要があります。' 
        }, { status: 403 });
      }
    }

    // セキュリティ対策: レートリミット（1分間に最大15回、1日に最大100回）
    const clientIp = req.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitKey = userId || clientIp;

    const minuteAllowed = await checkRateLimit({
      db: db,
      key: rateLimitKey,
      actionName: 'events_minute',
      limit: 15,
      windowMs: 60000
    });

    if (!minuteAllowed) {
      return NextResponse.json({ error: 'リクエストが多すぎます。少し時間をおいてから再度お試しください。' }, { status: 429 });
    }

    const dayAllowed = await checkRateLimit({
      db: db,
      key: rateLimitKey,
      actionName: 'events_day',
      limit: 100,
      windowMs: 86400000
    });

    if (!dayAllowed) {
      return NextResponse.json({ error: '1日のリクエスト上限に達しました。' }, { status: 429 });
    }

    const eventId = event.id;
    const userEventRef = db.collection('groups').doc(targetGroupId).collection('events').doc(eventId);

    const batch = db.batch();

    if (action === 'delete') {
      // 予定の削除
      batch.delete(userEventRef);
      // 該当イベント用のリマインダレコードがあれば念のため削除 (以前作成されたゴミデータの削除)
      try {
        const pendingRemindersQuery = await db.collection('reminders')
          .where('eventId', '==', eventId)
          .get();
        pendingRemindersQuery.forEach((doc: any) => {
          batch.delete(doc.ref);
        });
      } catch (err) {
        console.warn("Clean reminders error:", err);
      }
      await batch.commit();
      return NextResponse.json({ success: true });
    }

    // セキュリティ対策: 入力データのバリデーションと制限
    const title = (event.title || '').trim();
    const details = (event.details || '').trim();
    const memo = (event.memo || '').trim();
    const category = event.category || 'school';
    const color = event.color || 'common';
    const date = event.date || '';

    // 文字長制限
    if (title.length > 100) {
      return NextResponse.json({ error: 'タイトルは100文字以内で入力してください。' }, { status: 400 });
    }
    if (details.length > 1000) {
      return NextResponse.json({ error: '詳細は1000文字以内で入力してください。' }, { status: 400 });
    }
    if (memo.length > 1000) {
      return NextResponse.json({ error: 'メモは1000文字以内で入力してください。' }, { status: 400 });
    }

    // 特定のパラメータ値の制限 (ホワイトリスト)
    const allowedCategories = ['school', 'event', 'medical'];
    if (!allowedCategories.includes(category)) {
      return NextResponse.json({ error: '無効なカテゴリです。' }, { status: 400 });
    }

    const allowedColors = ['common', 'father', 'mother', 'child', 'orange', 'blue', 'red', 'green', 'yellow', 'purple', 'pink', 'gray'];
    if (!allowedColors.includes(color)) {
      return NextResponse.json({ error: '無効なカラーです。' }, { status: 400 });
    }

    // 日付フォーマット制限 (YYYY-MM-DD形式)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (date && !dateRegex.test(date)) {
      return NextResponse.json({ error: '無効な日付形式です。YYYY-MM-DDで指定してください。' }, { status: 400 });
    }

    // HTMLタグのサニタイズ (XSS攻撃の防止)
    const sanitizeHtml = (str: string) => str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cleanTitle = sanitizeHtml(title);
    const cleanDetails = sanitizeHtml(details);
    const cleanMemo = sanitizeHtml(memo);

    // 予定の保存 (新規作成 or 編集)
    const eventData = {
      title: cleanTitle,
      date: date,
      details: cleanDetails,
      memo: cleanMemo,
      category: category,
      color: color,
      imageUrl: event.imageUrl || null,
      isNotificationEnabled: event.isNotificationEnabled !== false, // オプトアウト設定（デフォルトON）
      updatedAt: new Date().toISOString()
    };
    batch.set(userEventRef, eventData, { merge: true });

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Save Event API Error:", error);
    Sentry.captureException(error);
    return NextResponse.json({ error: error.message || "予定の保存に失敗しました" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const groupId = searchParams.get('groupId');

    if (!groupId) {
      return new Response('groupId is required', { status: 400 });
    }

    // Firebase Admin の動的インポートと遅延初期化
    const { getFirebaseAdmin } = await import('../../../lib/firebaseAdmin');
    const admin = await getFirebaseAdmin();
    const db = admin?.db;
    if (admin.error || !db) {
      console.error("[events iCal API] Firebase Admin configuration error:", admin.error);
      return new Response('Database configuration error', { status: 500 });
    }

    // Firestore からイベント一覧を取得
    const eventsSnap = await db.collection('groups').doc(groupId).collection('events').get();
    const eventList: any[] = [];
    eventsSnap.forEach((doc: any) => {
      eventList.push({ id: doc.id, ...doc.data() });
    });

    const formatDate = (dateStr: string) => dateStr.replace(/-/g, '');
    const getEndDateStr = (startDateStr: string) => {
      const date = new Date(startDateStr);
      date.setDate(date.getDate() + 1);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}${m}${d}`;
    };
    const formatTimeStamp = (date: Date) => {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      const h = String(date.getUTCHours()).padStart(2, '0');
      const min = String(date.getUTCMinutes()).padStart(2, '0');
      const s = String(date.getUTCSeconds()).padStart(2, '0');
      return `${y}${m}${d}T${h}${min}${s}Z`;
    };

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Antigravity//Otayori Calendar//JP',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:おたよりカレンダー'
    ];

    const nowStamp = formatTimeStamp(new Date());

    eventList.forEach((event: any, index: number) => {
      if (!event.date) return;
      const uid = event.id || `${Date.now()}-${index}@otayori-calendar`;
      const startStr = formatDate(event.date);
      let endStr = startStr;
      try {
        endStr = getEndDateStr(event.date);
      } catch (_) {}
      
      const summary = (event.title || '予定')
        .replace(/\\/g, '\\\\')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
      const description = (event.details || '')
        .replace(/\\/g, '\\\\')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;')
        .replace(/\n/g, '\\n');

      ics.push('BEGIN:VEVENT');
      ics.push(`UID:${uid}`);
      ics.push(`DTSTAMP:${nowStamp}`);
      ics.push(`DTSTART;VALUE=DATE:${startStr}`);
      ics.push(`DTEND;VALUE=DATE:${endStr}`);
      ics.push(`SUMMARY:${summary}`);
      if (description) {
        ics.push(`DESCRIPTION:${description}`);
      }
      ics.push('END:VEVENT');
    });

    ics.push('END:VCALENDAR');
    const icsString = ics.join('\r\n');

    return new Response(icsString, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="calendar.ics"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    });

  } catch (error: any) {
    console.error("GET events iCal error:", error);
    Sentry.captureException(error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
