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
      const ownerTokens: string[] = ownerDoc.data()?.fcmTokens || [];
      ownerTokens.forEach((t) => allTokens.add(t));
    }

    // 2. このグループに所属する家族メンバー全員のFCMトークンを取得
    // （users コレクションで groupId == groupOwnerId のドキュメントを検索）
    const membersSnapshot = await db.collection('users')
      .where('groupId', '==', groupOwnerId)
      .get();

    membersSnapshot.forEach((memberDoc: any) => {
      const memberTokens: string[] = memberDoc.data()?.fcmTokens || [];
      memberTokens.forEach((t) => allTokens.add(t));
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

    const messaging = getMessaging();
    const now = new Date();

    // 2. status == 'pending' かつ scheduledAt <= 現在時刻 のリマインダードキュメントを抽出
    const remindersQuerySnapshot = await db.collection('reminders')
      .where('status', '==', 'pending')
      .where('scheduledAt', '<=', Timestamp.fromDate(now))
      .get();

    if (remindersQuerySnapshot.empty) {
      return NextResponse.json({ success: true, message: 'No pending reminders to send.' });
    }

    const results = [];
    let totalSent = 0;
    let totalFailed = 0;

    // 3. 各リマインダーについて通知送信処理を実行
    for (const docSnapshot of remindersQuerySnapshot.docs) {
      const reminderId = docSnapshot.id;
      const reminderData = docSnapshot.data();
      const { uid, title, body, eventId, groupId: reminderGroupId } = reminderData;

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

      // グループ全員のFCMトークンを収集（家族全員へのマルチキャスト）
      let fcmTokens = await collectGroupFcmTokens(db, groupOwnerId);
      // 重複排除と無効なトークンの除去を徹底
      fcmTokens = Array.from(new Set(fcmTokens)).filter(token => token && typeof token === 'string' && token.trim() !== '');

      if (fcmTokens.length === 0) {
        // トークンが無い場合はスキップ扱いに更新
        await docSnapshot.ref.update({
          status: 'skipped',
          skippedReason: 'No FCM tokens registered for group',
          updatedAt: Timestamp.fromDate(new Date())
        });
        results.push({ reminderId, status: 'skipped', reason: 'No tokens' });
        continue;
      }

      try {
        // FCMへ一括プッシュ送信 (sendEachForMulticast) - 家族全員のデバイスへ
        const response = await messaging.sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: title || '【おたよりリマインド】',
            body: body || '明日の予定をチェックしましょう。',
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
              tokensToRemove.push(fcmTokens[idx]);
            }
          }
        });

        // 4. 無効なFCMトークンがある場合はFirestoreのユーザー情報から削除 (クリーンアップ)
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
          totalRecipients: fcmTokens.length,
        });

      } catch (sendError: any) {
        console.error(`Critical error sending reminder ${reminderId}:`, sendError);

        await docSnapshot.ref.update({
          status: 'failed',
          errorMessage: sendError.message || 'Unknown sending error',
          updatedAt: Timestamp.fromDate(new Date())
        });

        results.push({
          reminderId,
          eventId,
          uid,
          status: 'failed',
          error: sendError.message
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
