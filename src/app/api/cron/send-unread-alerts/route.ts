export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '../../../../lib/firebaseAdmin';
import { getMessaging } from 'firebase-admin/messaging';

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

/**
 * 明日の予定お知らせCronエンドポイント
 *
 * 明日が予定日（date == YYYY-MM-DD）かつ通知がOFFではない（isNotificationEnabled !== false）
 * イベントを抽出し、家族全員にプッシュ通知を送信する。
 *
 * スケジュール: 毎日 JST 20:00 (vercel.json にて設定)
 */
export async function GET(req: Request) {
  try {
    // 1. セキュリティ検証
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isDev = process.env.NODE_ENV === 'development';

    if (!isDev) {
      if (!cronSecret) {
        console.error('[send-unread-alerts] CRON_SECRET is not set in production environment.');
        return NextResponse.json({ error: 'Server configuration error: CRON_SECRET not set.' }, { status: 500 });
      }
      if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[send-unread-alerts] Unauthorized attempt to access API.');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const admin = await getFirebaseAdmin();
    const db = admin?.db;
    if (admin.error || !db) {
      console.error('[send-unread-alerts] Firebase Admin is unavailable:', admin.error);
      return NextResponse.json({ error: `データベース接続エラー: ${admin.error?.message || 'Unknown Firebase Admin error'}` }, { status: 500 });
    }

    const messaging = getMessaging();

    // 2. 日本時間 (JST) で「明日」の日付文字列を計算 (UTC+9時間に24時間を足す)
    const now = new Date();
    const jstTomorrow = new Date(now.getTime() + (9 + 24) * 60 * 60 * 1000);
    const tomorrowStr = `${jstTomorrow.getFullYear()}-${String(jstTomorrow.getMonth() + 1).padStart(2, '0')}-${String(jstTomorrow.getDate()).padStart(2, '0')}`;

    console.log(`[send-unread-alerts] Scanning events for tomorrow: ${tomorrowStr}`);

    // 3. コレクショングループクエリで明日の予定を取得
    const tomorrowEventsSnapshot = await db.collectionGroup('events')
      .where('date', '==', tomorrowStr)
      .get();

    if (tomorrowEventsSnapshot.empty) {
      return NextResponse.json({ success: true, message: 'No events tomorrow.' });
    }

    // 4. グループ（家族）ごとにイベントを分類し、通知OFFのものを除外
    const groupEventsMap = new Map<string, any[]>();
    tomorrowEventsSnapshot.forEach((doc: any) => {
      const eventData = doc.data();
      // 通知OFFのイベントはスキップ
      if (eventData.isNotificationEnabled === false) {
        return;
      }
      
      // doc.ref.parent.parent.id で所属する groupId (親ドキュメントID) を取得
      const groupId = doc.ref.parent?.parent?.id;
      if (groupId) {
        if (!groupEventsMap.has(groupId)) {
          groupEventsMap.set(groupId, []);
        }
        groupEventsMap.get(groupId)?.push(eventData);
      }
    });

    if (groupEventsMap.size === 0) {
      return NextResponse.json({ success: true, message: 'No notification-enabled events tomorrow.' });
    }

    let notificationsSent = 0;
    const results: any[] = [];

    // 5. グループごとにプッシュ通知をマルチキャスト送信
    for (const [groupId, events] of groupEventsMap.entries()) {
      const fcmTokens = await collectGroupFcmTokens(db, groupId);
      if (fcmTokens.length === 0) {
        results.push({ groupId, status: 'skipped_no_tokens' });
        continue;
      }

      // 通知テキストの作成
      let bodyText = '';
      if (events.length === 1) {
        const ev = events[0];
        bodyText = `明日は「${ev.title}」の日です。`;
        if (ev.memo && ev.memo.trim()) {
          bodyText += `（メモ: ${ev.memo.trim()}）`;
        }
      } else {
        // 複数予定の場合
        bodyText = `明日は「${events[0].title}」など ${events.length} 件の予定があります。`;
        const detailsArr = events
          .map(ev => `・${ev.title}${ev.memo ? ` (${ev.memo})` : ''}`)
          .join('\n');
        bodyText += `\n${detailsArr}`;
      }

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: '⏰ 明日の予定のお知らせ',
            body: bodyText,
          },
          webpush: {
            headers: {
              Urgency: 'high',
            },
            notification: {
              icon: '/favicon.ico',
              badge: '/favicon.ico',
              click_action: '/',
            },
          },
        });

        notificationsSent++;
        results.push({
          groupId,
          status: 'sent',
          devicesNotified: response.successCount,
          devicesFailed: response.failureCount
        });
      } catch (sendErr: any) {
        console.error(`[send-unread-alerts] Send error for group ${groupId}:`, sendErr);
        results.push({ groupId, status: 'failed', error: sendErr.message });
      }
    }

    return NextResponse.json({
      success: true,
      processedGroups: groupEventsMap.size,
      notificationsSent,
      details: results,
    });

  } catch (error: any) {
    console.error('[send-unread-alerts] Cron API error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
