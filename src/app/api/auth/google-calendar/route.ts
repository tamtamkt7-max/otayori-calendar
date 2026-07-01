import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'ユーザーIDが必要です' }, { status: 400 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://otayori-calendar.vercel.app';
    const redirectUri = `${appUrl}/api/auth/google-calendar/callback`;

    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'Google OAuth環境変数が設定されていません。管理者にお問い合わせください。' }, { status: 500 });
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // 認証URLの生成
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // リフレッシュトークンを常に取得するために必須
      prompt: 'consent',     // 常に同意画面を表示してリフレッシュトークンを確実に再取得
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state: userId // ユーザーIDを state に設定
    });

    return NextResponse.json({ url: authUrl });
  } catch (error: any) {
    console.error("Google OAuth Link Gen Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
