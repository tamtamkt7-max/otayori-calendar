import { sendGAEvent } from '@next/third-parties/google';

/**
 * Google Analytics 4 にカスタムイベントを送信する汎用ヘルパー
 */
export function trackEvent(action: string, category: string, label?: string, value?: number) {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      // 開発・テスト環境ではログに出力して動作確認を支援
      console.log(`[GA4 Event Tracker] Action: "${action}" | Category: "${category}" | Label: "${label || 'none'}" | Value: ${value || 0}`);
      return;
    }

    sendGAEvent({
      event: action,
      event_category: category,
      event_label: label,
      value: value
    });
  } catch (err) {
    console.error("Failed to send GA4 event:", err);
  }
}

// トラッキング対象の主要イベント一覧
export const GA_EVENTS = {
  SCAN_START: 'scan_start',
  SCAN_SUCCESS: 'scan_success',
  SCAN_FAILURE: 'scan_failure',
  UPGRADE_CLICK: 'upgrade_click',
  NOTIFICATION_SUBSCRIBE: 'notification_subscribe',
  GOOGLE_CALENDAR_LINK: 'google_calendar_link',
  GOOGLE_CALENDAR_DISCONNECT: 'google_calendar_disconnect',
};
