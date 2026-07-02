/**
 * 環境変数の文字列から、コピペミスやインフラ由来の先頭・末尾のスペース、
 * 目に見えない改行コード（\r, \n）およびタブ等を自動サニタイズして除去する。
 */
export function sanitizeEnvVar(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/[\r\n\t]/g, '');
}
