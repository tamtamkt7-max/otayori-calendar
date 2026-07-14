// Web Push 用 Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// 読み取った環境変数値を埋め込む（※ APIキーは公開情報のためハードコード可能）
const firebaseConfig = {
  apiKey: "AIzaSyDyUWHFyvCrxOU_GFKwr1wJqKSyXN__ztI",
  authDomain: "otayori-calendar-ec173.firebaseapp.com",
  projectId: "otayori-calendar-ec173",
  storageBucket: "otayori-calendar-ec173.firebasestorage.app",
  messagingSenderId: "885855276298",
  appId: "1:885855276298:web:0e66c3c57b71eb35647ef3"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// バックグラウンド通知の処理
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  // payload.notification が存在する場合、Firebase SDKが自動で通知を表示するため、
  // 重複表示を防ぐために手動での showNotification 呼び出しをスキップします。
  if (payload.notification) {
    console.log('[firebase-messaging-sw.js] Firebase SDK will automatically display this notification. Skipping manual display.');
    return;
  }

  // payload.data のみの場合に手動で通知を表示する
  const notificationTitle = payload.data?.title || 'おたよりカレンダー';
  const notificationOptions = {
    body: payload.data?.body || '新しい通知があります。',
    icon: '/favicon.ico',
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
