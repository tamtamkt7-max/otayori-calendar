import { google } from 'googleapis';
import { Firestore } from 'firebase-admin/firestore';
import { decrypt, encrypt } from './encryption';

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://otayori-calendar.vercel.app';
  const redirectUri = `${appUrl}/api/auth/google-calendar/callback`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * ユーザーのGoogle OAuthトークンをFirestoreから取得し、認証済みOAuth2クライアントを返す。
 * 未連携の場合は null を返す。
 */
async function getAuthorizedClient(db: Firestore, userId: string) {
  const docRef = db.collection('users').doc(userId).collection('security').doc('googleOAuth');
  const doc = await docRef.get();

  if (!doc.exists) return null;

  const data = doc.data();
  const encryptedTokens = data?.encryptedTokens;
  if (!encryptedTokens) return null;

  const decryptedTokensStr = decrypt(encryptedTokens);
  let tokens;
  try {
    tokens = JSON.parse(decryptedTokensStr);
  } catch (err) {
    console.error("Failed to parse Google OAuth tokens JSON:", err);
    return null;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // トークンの期限切れチェックと自動リフレッシュ
  oauth2Client.on('tokens', async (newTokens) => {
    // 新しいトークンが発行されたら、暗号化してFirestoreに再保存
    console.log("[Google Calendar Sync] Tokens refreshed automatically, saving back to Firestore.");
    const mergedTokens = { ...tokens, ...newTokens };
    const encryptedMergedTokens = encrypt(JSON.stringify(mergedTokens));
    await docRef.set({
      encryptedTokens: encryptedMergedTokens,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  });

  return oauth2Client;
}

/**
 * Googleカレンダーに予定を追加、または既存の予定を更新する。
 * 成功時は Google カレンダーの event.id (string) を返す。
 */
export async function syncEventToGoogle(
  db: Firestore,
  userId: string,
  event: {
    id: string;
    title: string;
    date: string; // YYYY-MM-DD
    details?: string;
    googleEventId?: string | null;
  }
): Promise<string | null> {
  try {
    const authClient = await getAuthorizedClient(db, userId);
    if (!authClient) {
      console.log(`[Google Calendar Sync] User ${userId} is not connected to Google Calendar.`);
      return null;
    }

    const calendar = google.calendar({ version: 'v3', auth: authClient });

    // Google Calendar イベントのデータオブジェクト
    const calendarEvent: any = {
      summary: event.title,
      description: event.details || '',
      start: {
        date: event.date, // 終日イベント
        timeZone: 'Asia/Tokyo'
      },
      end: {
        date: event.date, // 終日イベント
        timeZone: 'Asia/Tokyo'
      }
    };

    // Google Calendar API では、終日イベントの `end.date` は開始日の「翌日」を指定する必要がある。
    if (event.date) {
      const startDate = new Date(event.date);
      startDate.setDate(startDate.getDate() + 1);
      const nextDayStr = startDate.toISOString().split('T')[0];
      calendarEvent.end.date = nextDayStr;
    }

    if (event.googleEventId) {
      // 既存のイベントを更新
      try {
        console.log(`[Google Calendar Sync] Updating existing event in Google Calendar: ${event.googleEventId}`);
        const response = await calendar.events.patch({
          calendarId: 'primary',
          eventId: event.googleEventId,
          requestBody: calendarEvent
        });
        return response.data.id || null;
      } catch (err: any) {
        if (err.status === 404 || err.status === 410) {
          // Googleカレンダー側で削除されていた場合、新しく作成し直す
          console.warn(`[Google Calendar Sync] Event ${event.googleEventId} not found (404/410), creating a new one.`);
          const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: calendarEvent
          });
          return response.data.id || null;
        }
        throw err;
      }
    } else {
      // 新規作成
      console.log(`[Google Calendar Sync] Creating new event in Google Calendar for user: ${userId}`);
      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: calendarEvent
      });
      return response.data.id || null;
    }
  } catch (error: any) {
    console.error("[Google Calendar Sync] Sync event error:", error.message);
    return null;
  }
}

/**
 * Googleカレンダーから予定を削除する。
 */
export async function deleteEventFromGoogle(
  db: Firestore,
  userId: string,
  googleEventId: string | null
): Promise<boolean> {
  if (!googleEventId) return false;

  try {
    const authClient = await getAuthorizedClient(db, userId);
    if (!authClient) return false;

    const calendar = google.calendar({ version: 'v3', auth: authClient });
    console.log(`[Google Calendar Sync] Deleting event ${googleEventId} from Google Calendar.`);
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: googleEventId
    });
    return true;
  } catch (error: any) {
    // すでに消えている場合は成功とみなす
    if (error.status === 410 || error.status === 404) {
      return true;
    }
    console.error("[Google Calendar Sync] Delete event error:", error.message);
    return false;
  }
}
