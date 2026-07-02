import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// firebase-adminの初期化ヘルパー
function initializeFirebaseAdmin() {
  if (!getApps().length) {
    try {
      const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!serviceAccountStr) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT is not set in env variables.");
      }
      const serviceAccount = JSON.parse(serviceAccountStr);
      initializeApp({
        credential: cert(serviceAccount)
      });
    } catch (initError) {
      console.error("firebase-admin initialization failed:", initError);
      return false;
    }
  }
  return true;
}

export async function GET(req: Request) {
  try {
    // 1. セキュリティ検証（CRON_SECRETのチェック）
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isDev = process.env.NODE_ENV === 'development';

    // 開発環境かつSECRET未設定の場合は開発支援のため警告付きでバイパスを許可
    if (!isDev && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn("Unauthorized attempt to access send-reminders API.");
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!initializeFirebaseAdmin()) {
      return NextResponse.json({ error: 'Database connection config error' }, { status: 500 });
    }

    const db = getFirestore();
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
      const { uid, title, body, eventId } = reminderData;
      let fcmTokens: string[] = reminderData.fcmTokens || [];

      // ユーザーの最新FCMトークンをデータベースから同期取得する (到達率向上のため)
      try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
          const latestTokens = userDoc.data()?.fcmTokens;
          if (Array.isArray(latestTokens) && latestTokens.length > 0) {
            fcmTokens = latestTokens;
          }
        }
      } catch (tokenSyncErr) {
        console.warn(`Failed to sync latest FCM tokens for user ${uid}, fallback to recorded tokens:`, tokenSyncErr);
      }

      if (fcmTokens.length === 0) {
        // トークンが無い場合はスキップ扱いに更新
        await docSnapshot.ref.update({
          status: 'skipped',
          skippedReason: 'No FCM tokens registered for user',
          updatedAt: Timestamp.fromDate(new Date())
        });
        results.push({ reminderId, status: 'skipped', reason: 'No tokens' });
        continue;
      }

      try {
        // FCMへ一括プッシュ送信 (sendEachForMulticast)
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
              icon: '/favicon.ico', // PWAアイコンの参照
              badge: '/favicon.ico',
              click_action: '/', // 通知タップ時にトップ画面へ
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
        if (tokensToRemove.length > 0) {
          const userRef = db.collection('users').doc(uid);
          await userRef.update({
            fcmTokens: FieldValue.arrayRemove(...tokensToRemove)
          });
          console.log(`Cleaned up ${tokensToRemove.length} invalid FCM tokens for user ${uid}`);
        }

        // リマインダードキュメントのステータスを送信完了に更新
        await docSnapshot.ref.update({
          status: 'sent',
          sentAt: Timestamp.fromDate(new Date()),
          successCount: response.successCount,
          failureCount: response.failureCount,
          updatedAt: Timestamp.fromDate(new Date())
        });

        results.push({
          reminderId,
          eventId,
          uid,
          status: 'sent',
          successCount: response.successCount,
          failureCount: response.failureCount,
          removedTokensCount: tokensToRemove.length
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
    console.error("Cron send-reminders API error:", error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
