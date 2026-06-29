import { useState, useEffect } from 'react';
import { getToken } from 'firebase/messaging';
import { doc, setDoc, arrayUnion } from 'firebase/firestore';
import { db, getFcmMessaging } from '../lib/firebase';

export const useFcm = (uid: string | undefined) => {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        // Firestore の users/{uid} ドキュメントに配列として保存
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, { 
          fcmTokens: arrayUnion(token), 
          updatedAt: new Date().toISOString() 
        }, { merge: true });
      }
    } catch (err) {
      console.error('Failed to get FCM token implicitly:', err);
    }
  };

  const requestPermission = async () => {
    if (!uid) return null;
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
            const userRef = doc(db, 'users', uid);
            await setDoc(userRef, {
              fcmTokens: arrayUnion(token),
              updatedAt: new Date().toISOString()
            }, { merge: true });
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

  return { fcmToken, permissionStatus, requestPermission, loading, error };
};
