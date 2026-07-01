import { Firestore } from 'firebase-admin/firestore';

interface RateLimitConfig {
  db: Firestore;
  key: string;       // レートリミットを識別するキー (例: userId, または clientIp)
  actionName: string; // 制限対象のアクション (例: 'scan', 'checkout', 'events')
  limit: number;     // 最大リクエスト数
  windowMs: number;  // 判定時間枠 (ミリ秒)
}

/**
 * Firestoreを利用したレートリミットチェック。
 * 制限を超えていなければ true、制限超過していれば false を返す。
 */
export async function checkRateLimit(config: RateLimitConfig): Promise<boolean> {
  const { db, key, actionName, limit, windowMs } = config;
  const now = Date.now();
  const cutoffTime = now - windowMs;

  // セキュリティ対策：キー内の特殊文字やパス区切りをサニタイズ
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const docRef = db.collection('rateLimits').doc(`${actionName}_${safeKey}`);

  try {
    const doc = await docRef.get();
    let attempts: number[] = [];

    if (doc.exists) {
      const data = doc.data();
      attempts = (data?.attempts || []).filter((timestamp: number) => timestamp > cutoffTime);
    }

    if (attempts.length >= limit) {
      console.warn(`[Security Alert] Rate limit exceeded for key: ${key} on action: ${actionName}. Count: ${attempts.length}`);
      return false;
    }

    attempts.push(now);
    await docRef.set({ attempts }, { merge: true });
    return true;
  } catch (error) {
    console.error("Rate limit check failed, failing open (allowing request) to prevent service block:", error);
    return true; // データベースエラー時はフェイルセーフでアクセスを許容
  }
}
