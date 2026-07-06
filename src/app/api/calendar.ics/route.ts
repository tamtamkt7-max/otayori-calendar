export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const token = searchParams.get('token');

        if (!token) {
            return new NextResponse('Missing sync token', { status: 400 });
        }

        // 最新の安全な非同期Adminオブジェクトを取得してESM問題を100%回避
        const { getFirebaseAdmin } = await import('../../../lib/firebaseAdmin');
        const admin = await getFirebaseAdmin();
        const firestore = admin?.db;

        if (admin.error || !firestore) {
            return new NextResponse('Database connection error', { status: 500 });
        }

        // トークンが一致するユーザーを検索
        const usersSnapshot = await firestore
            .collection('users')
            .where('syncToken', '==', token)
            .limit(1)
            .get();

        if (usersSnapshot.empty) {
            return new NextResponse('Invalid or expired sync token', { status: 403 });
        }

        const userDoc = usersSnapshot.docs[0];
        const userData = userDoc.data();

        // 同期スイッチがOFFの場合は空のカレンダーを返す（セキュリティ対策）
        if (!userData.externalSyncEnabled) {
            return new NextResponse('Sync is disabled by user', { status: 403 });
        }

        const groupId = userData.groupId || userDoc.id;

        // Firestoreから全予定を取得
        const eventsSnapshot = await firestore
            .collection('groups')
            .doc(groupId)
            .collection('events')
            .get();

        // iCalendar (.ics) フォーマットのテキストを生成
        let icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//OtayoriCalendar//NONSGML v1.0//JA',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:おたよりカレンダー',
            'X-WR-TIMEZONE:Asia/Tokyo'
        ];

        // 🌟 修正箇所: (doc: any) と明記してTypeScriptのエラーを回避
        eventsSnapshot.forEach((doc: any) => {
            const ev = doc.data();
            if (!ev.date) return;

            // YYYY-MM-DD を YYYYMMDD フォーマットに変換
            const cleanDate = ev.date.replace(/-/g, '');
            const uid = ev.id || doc.id;
            const title = ev.title || '無題の予定';
            const description = ev.details ? ev.details.replace(/\n/g, '\\n') : '';

            icsContent.push(
                'BEGIN:VEVENT',
                `UID:${uid}@otayori-calendar`,
                `DTSTAMP:${cleanDate}T000000Z`,
                `DTSTART;VALUE=DATE:${cleanDate}`, // 終日イベント
                `SUMMARY:${title}`,
                `DESCRIPTION:${description}`,
                'END:VEVENT'
            );
        });

        icsContent.push('END:VCALENDAR');

        // 外部カレンダーアプリに「これはカレンダーデータですよ」と教えるヘッダーを設定
        return new NextResponse(icsContent.join('\r\n'), {
            status: 200,
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': `attachment; filename="otayori_calendar.ics"`,
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
            }
        });

    } catch (error: any) {
        console.error('[iCal API Error]:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}