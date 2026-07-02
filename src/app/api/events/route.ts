import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getFirebaseAdmin } from '../../../lib/firebaseAdmin';
import { checkRateLimit } from '../../../lib/rateLimit';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

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

    const admin = getFirebaseAdmin();
    const db = admin?.db;
    if (admin.error || !db) {
      console.error("[events API] Firebase Admin is unavailable:", admin.error);
      return NextResponse.json({ error: `データベース接続エラー: ${admin.error?.message || 'Unknown Firebase Admin error'}` }, { status: 500 });
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
    const targetGroupId = groupId || userId;
    const userEventRef = db.collection('groups').doc(targetGroupId).collection('events').doc(eventId);
    const remindersRef = db.collection('reminders');

    // 1. 既存の該当イベント用pendingリマインドの削除 (クリーンアップ)
    const pendingRemindersQuery = await remindersRef
      .where('uid', '==', userId)
      .where('eventId', '==', eventId)
      .where('status', '==', 'pending')
      .get();

    const batch = db.batch();
    pendingRemindersQuery.forEach((doc) => {
      batch.delete(doc.ref);
    });

    if (action === 'delete') {
      // 予定の削除
      batch.delete(userEventRef);
      await batch.commit();
      return NextResponse.json({ success: true });
    }

    // セキュリティ対策: 入力データのバリデーションと制限
    const title = (event.title || '').trim();
    const details = (event.details || '').trim();
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

    // 特定のパラメータ値の制限 (ホワイトリスト)
    const allowedCategories = ['school', 'event', 'medical'];
    if (!allowedCategories.includes(category)) {
      return NextResponse.json({ error: '無効なカテゴリです。' }, { status: 400 });
    }

    const allowedColors = ['common', 'father', 'mother', 'child'];
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

    // 予定の保存 (新規作成 or 編集)
    const eventData = {
      title: cleanTitle,
      date: date,
      details: cleanDetails,
      category: category,
      color: color,
      imageUrl: event.imageUrl || null,
      googleEventId: FieldValue.delete(), // カレンダー連携廃止に伴いフィールドを削除
      remindThreeDays: !!event.remindThreeDays,
      remindOneDay: !!event.remindOneDay,
      remindCustom: !!event.remindCustom,
      customRemindAt: event.customRemindAt || null,
      updatedAt: new Date().toISOString()
    };
    batch.set(userEventRef, eventData, { merge: true });

    // 最新のFCMトークンを取得
    const userDoc = await db.collection('users').doc(userId).get();
    const fcmTokens: string[] = userDoc.exists ? (userDoc.data()?.fcmTokens || []) : [];

    const now = new Date();

    // リマインド生成ヘルパー
    const createReminder = (type: string, scheduledDate: Date, bodyText: string) => {
      // 送信時刻が未来の場合のみ生成
      if (scheduledDate.getTime() > now.getTime()) {
        const reminderDocRef = remindersRef.doc();
        batch.set(reminderDocRef, {
          uid: userId,
          eventId: eventId,
          fcmTokens: fcmTokens,
          scheduledAt: Timestamp.fromDate(scheduledDate),
          title: '【おたよりリマインド】',
          body: bodyText,
          status: 'pending',
          type: type,
          createdAt: Timestamp.fromDate(now)
        });
      }
    };

    // YYYY-MM-DDをパースし、JSTの19:00のDateオブジェクトを作る関数
    const getJstDate19 = (dateStr: string, daysOffset: number): Date => {
      const [yearStr, monthStr, dayStr] = dateStr.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10) - 1; // 0-indexed month
      const d = parseInt(dayStr, 10) - daysOffset;
      // 日本時間 (JST) での指定日 19:00 のDateオブジェクトを作成する
      // UTC時間に変換: JST 19:00 は UTC 10:00 (19 - 9 = 10)
      return new Date(Date.UTC(y, m, d, 10, 0, 0));
    };

    if (eventData.date) {
      // 1. 3日前リマインド
      if (eventData.remindThreeDays) {
        const threeDaysAgoDate = getJstDate19(eventData.date, 3);
        const bodyText = `「${eventData.title}」の3日前です。準備物の用意はバッチリですか？確認してみましょう！`;
        createReminder('three_days_ago', threeDaysAgoDate, bodyText);
      }

      // 2. 1日前リマインド
      if (eventData.remindOneDay) {
        const oneDayAgoDate = getJstDate19(eventData.date, 1);
        const bodyText = `明日は「${eventData.title}」当日です。お忘れ物がないか、もう一度チェック！`;
        createReminder('one_day_ago', oneDayAgoDate, bodyText);
      }
    }

    // 3. カスタムリマインド
    if (eventData.remindCustom && eventData.customRemindAt) {
      const customDate = new Date(eventData.customRemindAt);
      const bodyText = `「${eventData.title}」のリマインドです。内容: ${eventData.details}`;
      createReminder('custom', customDate, bodyText);
    }

    await batch.commit();

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Save Event API Error:", error);
    Sentry.captureException(error);
    return NextResponse.json({ error: error.message || "予定の保存に失敗しました" }, { status: 500 });
  }
}
