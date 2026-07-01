import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key');

// Resendの無料枠（Onboarding）では、送信元は「onboarding@resend.dev」を使用する必要があります
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

export async function sendWelcomeEmail(toEmail: string, userName?: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: `おたよりカレンダー <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: 'おたよりカレンダー プレミアムプランへようこそ！🎉',
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #ff8c00;">プレミアムプランへのご登録ありがとうございます！</h2>
          <p>${userName ? `${userName} 様` : 'ユーザー 様'}</p>
          <p>おたよりカレンダーのプレミアムプランへのアップグレードが完了いたしました。本日から以下の機能が無制限でご利用いただけます。</p>
          <ul style="line-height: 1.8;">
            <li><strong>おたより画像のスキャン解析 (無制限)</strong></li>
            <li>パートナーとの予定の同期共有</li>
            <li>広告の非表示</li>
          </ul>
          <p>早速おたよりをアップロードして、自動カレンダー登録の快適さをご体験ください！</p>
          <div style="margin: 30px 0; text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://otayori-calendar.vercel.app'}" style="background-color: #ff8c00; color: white; padding: 12px 24px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">アプリを開く</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #999;">※このメールは送信専用アドレスから配信されています。ご返信はいただけません。</p>
        </div>
      `,
    });

    if (error) {
      console.error("Failed to send welcome email via Resend:", error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err: any) {
    console.error("Welcome email exception:", err);
    return { success: false, error: err.message };
  }
}

export async function sendCancellationEmail(toEmail: string, userName?: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: `おたよりカレンダー <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: 'プレミアムプラン解約手続き完了のお知らせ',
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #666;">プレミアムプランの解約手続きが完了しました</h2>
          <p>${userName ? `${userName} 様` : 'ユーザー 様'}</p>
          <p>おたよりカレンダーをご利用いただきありがとうございました。</p>
          <p>プレミアムプランの解約（フリープランへの移行）が完了いたしました。次回更新日以降は、無料プラン（月間スキャン制限10回まで、広告表示等）が適用されます。</p>
          <p>またのご利用を心よりお待ちしております。</p>
          <div style="margin: 30px 0; text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://otayori-calendar.vercel.app'}" style="background-color: #ff8c00; color: white; padding: 12px 24px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">アプリを開く</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #999;">※このメールは送信専用アドレスから配信されています。ご返信はいただけません。</p>
        </div>
      `,
    });

    if (error) {
      console.error("Failed to send cancellation email via Resend:", error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err: any) {
    console.error("Cancellation email exception:", err);
    return { success: false, error: err.message };
  }
}
