export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '../../../../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
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
 * [PREMIUM限定] おたより未処理アラートCronエンドポイント
 *
 * スキャンによって追加されたイベント（pendingReview: true）が
 * 24時間以上未確認のプレミアムグループに対して通知を送信する。
 * スパム防止のため、同一グループへの送信は48時間に1回に制限する。
 *
 * スケジュール: 毎日 UTC 11:00 (JST 20:00) — vercel.json で設定済み
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
    const now = new Date();

    // 2. プレミアムプランのユーザーを取得
    const premiumUsersSnapshot = await db.collection('users')
      .where('plan', '==', 'premium')
      .get();

    if (premiumUsersSnapshot.empty) {
      return NextResponse.json({ success: true, message: 'No premium users found.' });
    }

    // 3. グループオーナーID でデデュープ（同一グループに複数プレミアムメンバーがいる場合の重複処理を防ぐ）
    const processedGroupIds = new Set<string>();
    const results: any[] = [];
    let alertsSent = 0;
    let alertsSkipped = 0;

    for (const userDoc of premiumUsersSnapshot.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();

      // グループオーナーID を解決（未設定の場合は自分自身がオーナー）
      const groupOwnerId: string = userData.groupId || uid;

      // 同一グループへの重複処理をスキップ
      if (processedGroupIds.has(groupOwnerId)) {
        continue;
      }
      processedGroupIds.add(groupOwnerId);

      // 4. スパム防止: 直近 48 時間以内にアラートを送信済みならスキップ
      const ownerDoc = await db.collection('users').doc(groupOwnerId).get();
      const ownerData = ownerDoc.exists ? ownerDoc.data() : {};
      const lastAlertSentAt = ownerData?.lastUnreadAlertSentAt;

      if (lastAlertSentAt) {
        const lastAlertDate: Date = lastAlertSentAt.toDate ? lastAlertSentAt.toDate() : new Date(lastAlertSentAt);
        const hoursSinceLastAlert = (now.getTime() - lastAlertDate.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastAlert < 48) {
          console.log(`[send-unread-alerts] Skipping group ${groupOwnerId}: last alert sent ${hoursSinceLastAlert.toFixed(1)}h ago.`);
          alertsSkipped++;
          continue;
        }
      }

      // 5. pendingReview: true のイベントを取得（スキャン済み未確認イベント）
      let unreadEventsSnapshot: any;
      try {
        unreadEventsSnapshot = await db.collection('groups')
          .doc(groupOwnerId)
          .collection('events')
          .where('pendingReview', '==', true)
          .get();
      } catch (queryErr: any) {
        console.error(`[send-unread-alerts] Failed to query events for group ${groupOwnerId}:`, queryErr);
        continue;
      }

      if (unreadEventsSnapshot.empty) {
        results.push({ groupOwnerId, status: 'no_unread_events' });
        continue;
      }

      // 6. 24時間以上前に作成された未処理イベントのみ対象とする（追加直後のアラート送信を防ぐ）
      const cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const staleUnreadEvents = unreadEventsSnapshot.docs.filter((doc: any) => {
        const updatedAt = doc.data().updatedAt;
        if (!updatedAt) return false;
        const updatedDate = new Date(updatedAt);
        return updatedDate < cutoffTime;
      });

      if (staleUnreadEvents.length === 0) {
        results.push({ groupOwnerId, status: 'events_too_recent' });
        continue;
      }

      // 7. グループ全員のFCMトークンを収集
      const fcmTokens = await collectGroupFcmTokens(db, groupOwnerId);
      if (fcmTokens.length === 0) {
        results.push({ groupOwnerId, status: 'no_fcm_tokens' });
        continue;
      }

      // 8. 未処理アラート通知を送信
      const unreadCount = staleUnreadEvents.length;
      const notificationBody = unreadCount === 1
        ? `スキャンしたおたより「${staleUnreadEvents[0].data().title || '予定'}」がまだ未確認です。カレンダーを確認しましょう！`
        : `${unreadCount}件のスキャン済みおたよりがまだ未確認です。カレンダーを確認しましょう！`;

      try {
        const response = await messaging.sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: '📋 未確認のおたよりがあります【プレミアム通知】',
            body: notificationBody,
          },
          webpush: {
            headers: {
              Urgency: 'normal',
            },
            notification: {
              icon: '/favicon.ico',
              badge: '/favicon.ico',
              click_action: '/',
            },
          },
        });

        // 9. 送信後に lastUnreadAlertSentAt を更新してスパム防止
        await db.collection('users').doc(groupOwnerId).update({
          lastUnreadAlertSentAt: Timestamp.fromDate(now)
        });

        alertsSent++;
        results.push({
          groupOwnerId,
          status: 'sent',
          unreadCount,
          successCount: response.successCount,
          failureCount: response.failureCount,
        });

        console.log(`[send-unread-alerts] Sent alert to group ${groupOwnerId}: ${unreadCount} unread events, ${response.successCount} devices notified.`);

      } catch (sendError: any) {
        console.error(`[send-unread-alerts] Error sending to group ${groupOwnerId}:`, sendError);
        results.push({
          groupOwnerId,
          status: 'failed',
          error: sendError.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      processedGroups: processedGroupIds.size,
      alertsSent,
      alertsSkipped,
      details: results,
    });

  } catch (error: any) {
    console.error('[send-unread-alerts] Cron API error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
