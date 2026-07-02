export interface IcsEvent {
  id?: string;
  title: string;
  date: string; // YYYY-MM-DD
  details?: string;
}

/**
 * 予定データから .ics フォーマットのテキストを生成します
 */
export function generateIcsString(events: IcsEvent | IcsEvent[]): string {
  const eventList = Array.isArray(events) ? events : [events];
  
  const formatDate = (dateStr: string) => {
    // YYYY-MM-DD -> YYYYMMDD
    return dateStr.replace(/-/g, '');
  };

  const getEndDateStr = (startDateStr: string) => {
    // 翌日の日付を取得 (終日予定の終了日は翌日の00:00となる仕様のため)
    const date = new Date(startDateStr);
    date.setDate(date.getDate() + 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  };

  const formatTimeStamp = (date: Date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const s = String(date.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${d}T${h}${min}${s}Z`;
  };

  // iCalendarの標準改行コードは CRLF
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Antigravity//Otayori Calendar//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  const nowStamp = formatTimeStamp(new Date());

  eventList.forEach((event, index) => {
    const uid = event.id || `${Date.now()}-${index}@otayori-calendar`;
    const startStr = formatDate(event.date);
    const endStr = getEndDateStr(event.date);
    
    // 文字列のiCalendar用エスケープ処理
    const summary = (event.title || '予定')
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
    const description = (event.details || '')
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\n/g, '\\n');

    ics.push('BEGIN:VEVENT');
    ics.push(`UID:${uid}`);
    ics.push(`DTSTAMP:${nowStamp}`);
    ics.push(`DTSTART;VALUE=DATE:${startStr}`);
    ics.push(`DTEND;VALUE=DATE:${endStr}`);
    ics.push(`SUMMARY:${summary}`);
    if (description) {
      ics.push(`DESCRIPTION:${description}`);
    }
    ics.push('END:VEVENT');
  });

  ics.push('END:VCALENDAR');

  return ics.join('\r\n');
}

/**
 * ブラウザ上で .ics ファイルのダウンロードを実行します
 */
export function downloadIcsFile(filename: string, icsString: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
