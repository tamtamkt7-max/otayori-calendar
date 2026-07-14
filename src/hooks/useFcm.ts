import { useState, useEffect } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { auth, db, getFcmMessaging } from '../lib/firebase';
import { trackEvent, GA_EVENTS } from '../lib/gtag';

export const useFcm = (uid: string | undefined) => {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIosPwaGuide, setShowIosPwaGuide] = useState(false);
  const [isIosButNotStandalone, setIsIosButNotStandalone] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
      if (isIOS && !isStandalone) {
        setIsIosButNotStandalone(true);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermissionStatus(Notification.permission);
      
      // すでに許可されている場合はトークンを暗黙的に取得・同期する
      if (Notification.permission === 'granted' && uid) {
        getAndStoreToken(uid);
      }
    }
  }, [uid]);

  const getAndStoreToken = async (userId: string) => {
    try {
      const messaging = await getFcmMessaging();
      if (!messaging) return;
      
      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
      const token = await getToken(messaging, { vapidKey });
      
      if (token) {
        setFcmToken(token);
        // Firestore への書き込み前に Auth 確立を待つ遅延を挟む (150ms)
        await new Promise(resolve => setTimeout(resolve, 150));
        // さらに auth.currentUser がセットアップされているかダブルチェック
        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.uid !== userId) {
          console.warn("[FCM] Delaying Firestore sync: Auth is not fully ready or mismatch.");
          return;
        }

        // Firestore の users/{uid} ドキュメントに配列として保存
        // 物理的重複ブロック: DBに既に同一トークンが存在する場合は書き込みをスキップ
        const userRef = doc(db, 'users', userId);
        const existingDoc = await getDoc(userRef);
        const existingTokens: string[] = existingDoc.exists() ? (existingDoc.data()?.fcmTokens || []) : [];
        if (existingTokens.includes(token)) {
          console.log('[FCM] Token already exists in DB, skipping write to prevent duplication.');
          return;
        }
        await setDoc(userRef, { 
          fcmTokens: arrayUnion(token), 
          updatedAt: new Date().toISOString() 
        }, { merge: true });
      }
    } catch (err) {
      console.error('Failed to get FCM token implicitly:', err);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupForegroundListener = async () => {
      try {
        const messaging = await getFcmMessaging();
        if (messaging) {
          unsubscribe = onMessage(messaging, (payload) => {
            console.log('[useFcm] Received foreground message:', payload);
            
            // フォアグラウンドではOSのシステム通知を表示せず、アプリ内トーストやアラートUI（表示領域が見えている場合のみ）にて通知を知らせる
            if (payload.notification && typeof window !== 'undefined' && document.visibilityState === 'visible') {
              const title = payload.notification.title || 'おたよりカレンダー';
              const body = payload.notification.body || '';
              alert(`🔔 ${title}\n${body}`);
            }
          });
        }
      } catch (err) {
        console.error('[useFcm] Failed to setup foreground listener:', err);
      }
    };

    if (uid) {
      setupForegroundListener();
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [uid]);

  const requestPermission = async () => {
    if (!uid) return null;
    if (isIosButNotStandalone) {
      setShowIosPwaGuide(true);
      setError('iOS端末では「ホーム画面に追加」を行ってから通知をオンにしてください。');
      return null;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setError('このブラウザはプッシュ通知に対応していません。');
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);

      if (permission === 'granted') {
        const messaging = await getFcmMessaging();
        if (messaging) {
          const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
          const token = await getToken(messaging, { vapidKey });
          if (token) {
            setFcmToken(token);
            // Firestore の users/{uid} ドキュメントに配列として保存
            // 物理的重複ブロック: DBに既に同一トークンが存在する場合は書き込みをスキップ
            const userRef = doc(db, 'users', uid);
            const existingDoc = await getDoc(userRef);
            const existingTokens: string[] = existingDoc.exists() ? (existingDoc.data()?.fcmTokens || []) : [];
            if (!existingTokens.includes(token)) {
              await setDoc(userRef, {
                fcmTokens: arrayUnion(token),
                updatedAt: new Date().toISOString()
              }, { merge: true });
            } else {
              console.log('[FCM] Token already exists in DB, skipping write to prevent duplication.');
            }

            // GA4イベントトラッキング
            trackEvent(GA_EVENTS.NOTIFICATION_SUBSCRIBE, 'notification', 'subscribe_fcm_success');

            return token;
          } else {
            throw new Error('FCMトークンの取得に失敗しました。');
          }
        } else {
          throw new Error('FCM Messaging がサポートされていません。');
        }
      } else if (permission === 'denied') {
        setError('通知が拒否されました。ブラウザの設定から通知を許可してください。');
      }
    } catch (err: any) {
      console.error('FCM Token error:', err);
      setError(err.message || '通知の設定中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
    return null;
  };

  return { fcmToken, permissionStatus, requestPermission, loading, error, showIosPwaGuide, setShowIosPwaGuide };
};
