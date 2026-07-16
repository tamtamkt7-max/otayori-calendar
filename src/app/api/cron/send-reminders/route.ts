export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '../../../../lib/firebaseAdmin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * グループ（家族）全員のFCMトークンを収集するヘルパー関数
 * @param db Firestore インスタンス
 * @param groupOwnerId グループオーナーの UID
 * @returns 重複排除済みのFCMトークン配列
 */
async function collectGroupFcmTokens(db: any, groupOwnerId: string): Promise<string[]> {
  const allTokens = new Set<string>();

  try {
    // 1. グループオーナー自身のFCMトークンを取得
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

    // 2. このグループに所属する家族メンバー全員のFCMトークンを取得
    // （users コレクションで groupId == groupOwnerId のドキュメントを検索）
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

export async function GET(req: Request) {
  try {
    // 1. セキュリティ検証（CRON_SECRETの厳格チェック）
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isDev = process.env.NODE_ENV === 'development';

    // 本番環境では CRON_SECRET が設定されていない場合も含め、不正アクセスを拒否する
    // 開発環境（isDev）の場合のみシークレット未設定でも通過を許可
    if (!isDev) {
      if (!cronSecret) {
        console.error('[send-reminders] CRON_SECRET is not set in production environment. Denying request.');
        return NextResponse.json({ error: 'Server configuration error: CRON_SECRET not set.' }, { status: 500 });
      }
      if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[send-reminders] Unauthorized attempt to access API.');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const admin = await getFirebaseAdmin();
    const db = admin?.db;
    if (admin.error || !db) {
      console.error('[send-reminders] Firebase Admin is unavailable:', admin.error);
      return NextResponse.json({ error: `データベース接続エラー: ${admin.error?.message || 'Unknown Firebase Admin error'}` }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const daysParam = searchParams.get('days'); // "1" or "3"

    const messaging = getMessaging();
    const now = new Date();

    // days パラメータがある場合は 18:00 実行時に 19:00 のスケジュールを拾えるよう 2時間のバッファを設定
    const queryTime = daysParam ? new Date(now.getTime() + 2 * 60 * 60 * 1000) : now;

    // 2. status == 'pending' かつ scheduledAt <= 現在時刻 (またはバッファ込) のリマインダードキュメントを抽出
    const remindersQuerySnapshot = await db.collection('reminders')
      .where('status', '==', 'pending')
      .where('scheduledAt', '<=', Timestamp.fromDate(queryTime))
      .get();

    if (remindersQuerySnapshot.empty) {
      return NextResponse.json({ success: true, message: 'No pending reminders to send.' });
    }

    const results = [];
    let totalSent = 0;
    let totalFailed = 0;

    // 日本時間 (JST) での判定用日付文字列を生成
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    let targetDateStr: string | null = null;
    let expectedType: string | null = null;

    if (daysParam === '1') {
      const targetDate = new Date(jstNow);
      targetDate.setDate(jstNow.getDate() + 1);
      targetDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
      expectedType = 'one_day_ago';
    } else if (daysParam === '3') {
      const targetDate = new Date(jstNow);
      targetDate.setDate(jstNow.getDate() + 3);
      targetDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
      expectedType = 'three_days_ago';
    }

    // 重複送信防止用のSet（同一イベントが同一端末に複数回送られるのを防ぐ）
    const sentLog = new Set<string>();

    interface SendTask {
      reminderId: string;
      docSnapshot: any;
      eventId: string;
      uid: string;
      groupOwnerId: string;
      title: string;
      body: string;
      tokens: string[];
    }

    const sendTasks: SendTask[] = [];

    // 3. 各リマインダーについて通知送信の準備（ターゲット抽出・フィルタリング）を実行
    for (const docSnapshot of remindersQuerySnapshot.docs) {
      const reminderId = docSnapshot.id;
      let uid = '';
      let eventId = '';
      try {
        const reminderData = docSnapshot.data() || {};
        uid = reminderData.uid || '';
        eventId = reminderData.eventId || '';
        const { title, body, groupId: reminderGroupId, type: reminderType } = reminderData;

        // ユーザーのグループオーナーIDを解決する
        let groupOwnerId: string = reminderGroupId || uid;

        // groupId がリマインダーに未設定の場合は users/{uid} から動的取得（後方互換性）
        if (!reminderGroupId) {
          try {
            const userDoc = await db.collection('users').doc(uid).get();
            if (userDoc.exists) {
              groupOwnerId = userDoc.data()?.groupId || uid;
            }
          } catch (err) {
            console.warn(`[send-reminders] Could not resolve groupId for user ${uid}:`, err);
          }
        }

        // daysパラメータによるフィルタリング
        if (daysParam) {
          // 1. リマインダーの type によるフィルタリング
          if (expectedType && reminderType !== expectedType) {
            continue;
          }

          // 2. 実際のイベントの日付によるフィルタリング
          try {
            const eventDoc = await db.collection('groups').doc(groupOwnerId).collection('events').doc(eventId).get();
            if (!eventDoc.exists) {
              console.log(`[send-reminders] Event ${eventId} not found, skipping reminder ${reminderId}`);
              continue;
            }
            const eventData = eventDoc.data();

            // イベント自体の通知がオフになっている場合はスキップ
            if (eventData?.isNotificationEnabled === false) {
              await docSnapshot.ref.update({
                status: 'skipped',
                skippedReason: 'Notification disabled for this event',
                updatedAt: Timestamp.fromDate(new Date())
              });
              continue;
            }

            if (eventData?.date !== targetDateStr) {
              // 対象日のイベントではないためスキップ
              continue;
            }
          } catch (err) {
            console.warn(`[send-reminders] Failed to verify event ${eventId} for reminder ${reminderId}:`, err);
            continue; // 安全のためスキップ
          }
        }

        // グループ全員のFCMトークンを収集（家族全員へのマルチキャスト）
        let fcmTokens = await collectGroupFcmTokens(db, groupOwnerId);
        // 重複排除と無効なトークンの除去を徹底
        fcmTokens = Array.from(new Set(fcmTokens)).filter(token => token && typeof token === 'string' && token.trim() !== '');

        // 完全な重複送信の排除ロジック
        const filteredTokens: string[] = [];
        for (const token of fcmTokens) {
          const uniqueKey = `${token}-${eventId}`;
          if (sentLog.has(uniqueKey)) {
            console.log(`[send-reminders] Skipping duplicate notification for token ${token.substring(0, 10)}... and event ${eventId}`);
            continue;
          }
          filteredTokens.push(token);
          sentLog.add(uniqueKey);
        }

        if (filteredTokens.length === 0) {
          // すでにすべてのトークンに対して送信済みの場合、このリマインダーをスキップ扱いに更新
          await docSnapshot.ref.update({
            status: 'skipped',
            skippedReason: 'Notification already sent to all tokens for this event',
            updatedAt: Timestamp.fromDate(new Date())
          });
          results.push({ reminderId, status: 'skipped', reason: 'Duplicate event/token' });
          continue;
        }

        sendTasks.push({
          reminderId,
          docSnapshot,
          eventId,
          uid,
          groupOwnerId,
          title: title || '【おたよりリマインド】',
          body: body || '明日の予定をチェックしましょう。',
          tokens: filteredTokens,
        });

      } catch (itemError: any) {
        console.error(`Critical error preparing reminder ${reminderId}:`, itemError);

        try {
          await docSnapshot.ref.update({
            status: 'failed',
            errorMessage: itemError.message || 'Unknown sending error',
            updatedAt: Timestamp.fromDate(new Date())
          });
        } catch (dbUpdateError) {
          console.error(`Failed to update reminder status to failed for ${reminderId}:`, dbUpdateError);
        }

        results.push({
          reminderId,
          eventId,
          uid,
          status: 'failed',
          error: itemError.message
        });
      }
    }

    // 4. 重複が完全に排除されたクリーンなメッセージ配列に対してのみ、送信処理を実行
    for (const task of sendTasks) {
      const { reminderId, docSnapshot, eventId, uid, groupOwnerId, title, body, tokens: filteredTokens } = task;
      try {
        // FCMへ一括プッシュ送信 (sendEachForMulticast) - 家族全員のデバイスへ
        const response = await messaging.sendEachForMulticast({
          tokens: filteredTokens,
          notification: {
            title,
            body,
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

        totalSent += response.successCount;
        totalFailed += response.failureCount;

        // エラーが発生したトークンのうち、無効と判明したトークンを特定する
        const tokensToRemove: string[] = [];
        response.responses.forEach((res, idx) => {
          if (!res.success && res.error) {
            const errCode = res.error.code;
            console.error(`FCM send error [token index ${idx}]:`, res.error);

            // トークンが無効または未登録であるエラーコードの場合
            if (
              errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered' ||
              errCode === 'messaging/invalid-argument'
            ) {
              tokensToRemove.push(filteredTokens[idx]);
            }
          }
        });

        // 無効なFCMトークンがある場合はFirestoreのユーザー情報から削除 (クリーンアップ)
        // グループオーナーと全メンバー両方から無効トークンを削除する
        if (tokensToRemove.length > 0) {
          const batch = db.batch();
          // オーナーの無効トークンを削除
          const ownerRef = db.collection('users').doc(groupOwnerId);
          batch.update(ownerRef, {
            fcmTokens: FieldValue.arrayRemove(...tokensToRemove)
          });

          // メンバーの無効トークンも削除
          try {
            const membersSnapshot = await db.collection('users')
              .where('groupId', '==', groupOwnerId)
              .get();
            membersSnapshot.forEach((memberDoc: any) => {
              batch.update(memberDoc.ref, {
                fcmTokens: FieldValue.arrayRemove(...tokensToRemove)
              });
            });
          } catch (cleanupErr) {
            console.warn('[send-reminders] Failed to cleanup member tokens:', cleanupErr);
          }

          await batch.commit();
          console.log(`Cleaned up ${tokensToRemove.length} invalid FCM tokens for group ${groupOwnerId}`);
        }

        // リマインダードキュメントのステータスを送信完了に更新
        await docSnapshot.ref.update({
          status: 'sent',
          sentAt: Timestamp.fromDate(new Date()),
          successCount: response.successCount,
          failureCount: response.failureCount,
          groupOwnerId: groupOwnerId,
          updatedAt: Timestamp.fromDate(new Date())
        });

        results.push({
          reminderId,
          eventId,
          uid,
          groupOwnerId,
          status: 'sent',
          successCount: response.successCount,
          failureCount: response.failureCount,
          removedTokensCount: tokensToRemove.length,
          totalRecipients: filteredTokens.length,
        });

      } catch (itemError: any) {
        console.error(`Critical error processing reminder ${reminderId}:`, itemError);

        try {
          await docSnapshot.ref.update({
            status: 'failed',
            errorMessage: itemError.message || 'Unknown sending error',
            updatedAt: Timestamp.fromDate(new Date())
          });
        } catch (dbUpdateError) {
          console.error(`Failed to update reminder status to failed for ${reminderId}:`, dbUpdateError);
        }

        results.push({
          reminderId,
          eventId,
          uid,
          status: 'failed',
          error: itemError.message
        });
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: remindersQuerySnapshot.size,
      totalSent,
      totalFailed,
      details: results
    });

  } catch (error: any) {
    console.error('Cron send-reminders API error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
