"use client";
import { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  writeBatch 
} from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';
import { useFcm } from '../hooks/useFcm';
import AdBanner from '../components/ads/AdBanner';

export default function Home() {
  // --- 認証関連のState ---
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  
  // メールアドレス・パスワード認証用State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // --- カレンダー関連のState ---
  const [currentDate, setCurrentDate] = useState(new Date(2026, 6, 1));
  const [selectedDateStr, setSelectedDateStr] = useState<string>("2026-07-10");
  const [events, setEvents] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [isGoogleLinked, setIsGoogleLinked] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState<any[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState({ isPremium: false, remainingScans: 10, maxScans: 10 });
  const [isLimitModalOpen, setIsLimitModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);

  // Web Push (FCM) のStateとカスタムフック
  const { 
    permissionStatus, 
    requestPermission, 
    loading: fcmLoading, 
    error: fcmError 
  } = useFcm(user?.uid);

  // ログイン状態の監視とデータ同期
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        // Firestoreから予定とユーザーステータスを取得
        try {
          // 1. 予定のフェッチ
          const querySnapshot = await getDocs(collection(db, `users/${currentUser.uid}/events`));
          const fetchedEvents: any[] = [];
          querySnapshot.forEach((doc) => {
            fetchedEvents.push({ id: doc.id, ...doc.data() });
          });
          setEvents(fetchedEvents);

          // 2. ユーザーステータス（プラン・スキャン回数・Googleカレンダー連携）の同期
          const { getDoc } = await import('firebase/firestore');
          const userDocSnap = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const isPremium = userData.plan === 'premium';
            setIsGoogleLinked(!!userData.googleCalendarConnected);
            
            // 日本時間の現在年月を取得してリセット判定
            const now = new Date();
            const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
            const currentMonthStr = `${jstDate.getFullYear()}-${String(jstDate.getMonth() + 1).padStart(2, '0')}`;
            
            const lastScanMonth = userData.lastScanMonth || '';
            const scanCount = lastScanMonth === currentMonthStr ? (userData.scanCount || 0) : 0;
            const remainingScans = isPremium ? 9999 : Math.max(0, 10 - scanCount);
            
            setUserStatus({
              isPremium,
              remainingScans,
              maxScans: 10
            });
          }
        } catch (error) {
          console.error("データ同期エラー:", error);
          setErrorMessage("データの読み込みに失敗しました。画面を再読み込みしてください。");
        }
      } else {
        setEvents([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // URLクエリパラメータの処理 (Googleカレンダー連携の成否判定など)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const syncStatus = params.get('google-sync');
    const reason = params.get('reason');

    if (syncStatus === 'success') {
      alert("Googleカレンダーとの連携に成功しました！🎉\n今後追加・更新された予定は自動的にGoogleカレンダーにも同期されます。");
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsGoogleLinked(true);
    } else if (syncStatus === 'error') {
      alert(`Googleカレンダーとの連携に失敗しました😢\n理由: ${reason || '不明なエラー'}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Googleログイン処理
  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Googleログインエラー:", error);
      setAuthError("Googleでのログインに失敗しました。");
    }
  };

  // メール/パスワード 登録・ログイン処理
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (isSignUpMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      console.error("メール認証エラー:", error);
      if (error.code === 'auth/email-already-in-use') {
        setAuthError("このメールアドレスは既に登録されています。");
      } else if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        setAuthError("メールアドレスまたはパスワードが間違っています。");
      } else if (error.code === 'auth/weak-password') {
        setAuthError("パスワードは6文字以上で設定してください。");
      } else {
        setAuthError("認証に失敗しました。入力内容をご確認ください。");
      }
    }
  };

  // ログアウト処理
  const handleLogout = async () => {
    if (confirm("ログアウトしますか？")) {
      await signOut(auth);
      setEvents([]); // ログアウト時にデータをクリア
      setEmail('');
      setPassword('');
    }
  };

  // --- カレンダー描画ロジック ---
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarCells = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarCells.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarCells.push(new Date(year, month, i));

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const filteredEvents = events.filter(e => e.date === selectedDateStr);

  // --- API経由で予定を保存するヘルパー関数 (通知予約の自動生成を伴う) ---
  const saveEventToBackend = async (evt: any) => {
    if (!user) return;
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.uid,
        action: 'save',
        event: evt
      })
    });
    if (!response.ok) {
      throw new Error('予定の保存に失敗しました');
    }
  };

  const handleSaveModalEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingEvent) return;
    
    try {
      setLoading(true);
      const isNew = !editingEvent.id;
      const finalEvent = {
        ...editingEvent,
        id: editingEvent.id || `manual-${Date.now()}`
      };
      
      await saveEventToBackend(finalEvent);
      
      if (isNew) {
        setEvents(prev => [...prev, finalEvent]);
      } else {
        setEvents(prev => prev.map(ev => ev.id === finalEvent.id ? finalEvent : ev));
      }
      setIsEventModalOpen(false);
      setEditingEvent(null);
    } catch (err) {
      console.error("予定の保存に失敗しました:", err);
      alert("予定の保存に失敗しました💦");
    } finally {
      setLoading(false);
    }
  };

  // --- Stripe決済画面への遷移処理 ---
  const handleUpgrade = async () => {
    try {
      setLoading(true);
      const token = await user?.getIdToken();
      if (!token) {
        throw new Error('ログインしていません。ログイン後に再度お試しください。');
      }

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (response.ok && data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || '決済の準備に失敗しました。');
      }
    } catch (error: any) {
      console.error("Stripe Checkout Error:", error);
      alert(error.message || "Stripe決済画面の生成中にエラーが発生しました💦");
    } finally {
      setLoading(false);
    }
  };

  // --- Googleカレンダー連携処理 ---
  const handleGoogleCalendarLink = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/auth/google-calendar?userId=${user.uid}`);
      const data = await response.json();
      if (response.ok && data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || '連携URLの取得に失敗しました。');
      }
    } catch (err: any) {
      console.error("Google Calendar Link Error:", err);
      alert(err.message || "Googleカレンダー連携画面の生成中にエラーが発生しました💦");
    } finally {
      setLoading(false);
    }
  };

  // Google連携解除処理
  const handleDisconnectGoogle = async () => {
    if (!confirm("Googleカレンダーとの連携を解除しますか？")) return;
    try {
      setLoading(true);
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', user!.uid), { googleCalendarConnected: false }, { merge: true });
      setIsGoogleLinked(false);
      alert("Googleカレンダーとの連携を解除しました。");
    } catch (err) {
      console.error("Disconnect Google Error:", err);
      alert("解除に失敗しました💦");
    } finally {
      setLoading(false);
    }
  };

  // 週表示用の日付セルリスト生成
  const getWeekCells = () => {
    const selected = new Date(selectedDateStr);
    const dayOfWeek = selected.getDay(); // 0:日 ~ 6:土
    const startOfWeek = new Date(selected);
    startOfWeek.setDate(selected.getDate() - dayOfWeek);

    const weekCells = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      weekCells.push(day);
    }
    return weekCells;
  };

  // --- AIスキャンロジック ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setScanResult(null);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64Image = reader.result as string;
      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            image: base64Image,
            userId: user?.uid
          }),
        });

        const data = await response.json();
        if (response.ok) {
          const newEvents = data.events.map((ev: any, idx: number) => ({
            ...ev,
            id: `ai-scan-${Date.now()}-${idx}`,
            imageUrl: data.imageUrl || null
          }));

          // API経由でFirestoreに解析結果とリマインド設定を保存
          if (user) {
            try {
              for (const ev of newEvents) {
                await saveEventToBackend({
                  ...ev,
                  remindThreeDays: true, // デフォルトで3日前と1日前の通知をON
                  remindOneDay: true
                });
              }
            } catch (fsError) {
              console.error("予定の保存エラー:", fsError);
              setErrorMessage("おたよりは解析されましたが、予定の保存に失敗しました💦");
            }
          }

          setEvents(prev => [...prev, ...newEvents]);
          if (newEvents.length > 0) setSelectedDateStr(newEvents[0].date);
          setScanResult(newEvents.map((ev: any) => ({ ...ev, remindThreeDays: true, remindOneDay: true, imageUrl: data.imageUrl || null })));
          setUserStatus(prev => ({ ...prev, remainingScans: data.remaining }));
        } else {
          if (response.status === 403) {
            setIsLimitModalOpen(true);
          } else {
            setErrorMessage(data.error || "おたよりの読み込みに失敗しました😢");
          }
        }
      } catch (err: any) {
        setErrorMessage("通信に失敗しました。電波の良いところで再度お試しください💦");
      } finally {
        setLoading(false);
      }
    };
  };

  const handleUpdateEvent = async (id: string, field: string, value: any) => {
    // 楽観的アップデート（UIの即時更新）
    setScanResult(prev => prev?.map(ev => ev.id === id ? { ...ev, [field]: value } : ev) || null);
    setEvents(prev => prev.map(ev => ev.id === id ? { ...ev, [field]: value } : ev));

    // バックエンドAPI経由で予定を更新
    const targetEv = events.find(ev => ev.id === id) || scanResult?.find(ev => ev.id === id);
    if (targetEv && user) {
      try {
        await saveEventToBackend({
          ...targetEv,
          [field]: value
        });
      } catch (error) {
        console.error("予定の更新エラー:", error);
        setErrorMessage("変更内容の保存に失敗しました。電波の良い環境で再度お試しください💦");
      }
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm("この予定を削除しますか？")) return;

    // 楽観的アップデート
    setEvents(prev => prev.filter(ev => ev.id !== id));
    setScanResult(prev => prev ? prev.filter(ev => ev.id !== id) : null);

    if (user) {
      try {
        const response = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            action: 'delete',
            event: { id }
          })
        });
        if (!response.ok) {
          throw new Error();
        }
      } catch (error) {
        console.error("予定の削除エラー:", error);
        setErrorMessage("予定の削除に失敗しました。再度お試しください💦");
      }
    }
  };

  // ---------------------------------------------
  // 画面レンダリングの分岐
  // ---------------------------------------------

  if (isAuthLoading) {
    return <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center font-sans text-stone-500">読み込み中...</div>;
  }

  // 【未ログイン時】のLP兼ログイン画面（メール・パスワード対応）
  if (!user) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex flex-col items-center justify-center font-sans text-stone-700 p-4">
        <div className="w-20 h-20 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 font-bold text-4xl mb-6 shadow-sm">お</div>
        <h1 className="text-2xl font-extrabold text-stone-800 mb-2">おたよりカレンダー</h1>
        <p className="text-sm text-stone-500 mb-8 text-center max-w-xs leading-relaxed">
          園や学校のプリントをパシャッと撮るだけ。<br/>AIが予定を自動でカレンダーに登録します。
        </p>

        <div className="w-full max-w-sm bg-white p-6 rounded-3xl shadow-sm border border-stone-100">
          <h2 className="text-lg font-bold text-stone-700 mb-4 text-center">
            {isSignUpMode ? '新規アカウント登録' : 'ログインして始める'}
          </h2>

          {authError && (
            <div className="mb-4 p-3 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl border border-rose-100 text-center">
              {authError}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
            <div>
              <input 
                type="email" 
                placeholder="メールアドレス" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition"
              />
            </div>
            <div>
              <input 
                type="password" 
                placeholder="パスワード（6文字以上）" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition"
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-orange-400 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl transition active:scale-95 shadow-sm"
            >
              {isSignUpMode ? 'メールアドレスで登録' : 'ログイン'}
            </button>
          </form>

          <div className="relative flex items-center justify-center mb-6">
            <div className="border-t border-stone-200 w-full"></div>
            <span className="bg-white px-3 text-xs text-stone-400 absolute">または</span>
          </div>

          <button 
            onClick={handleGoogleLogin}
            className="w-full bg-white border border-stone-200 shadow-sm hover:bg-stone-50 text-stone-600 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-3 transition active:scale-95 text-sm mb-4"
          >
            <span className="text-lg">G</span> Googleで続ける
          </button>

          <div className="text-center mt-6">
            <button 
              onClick={() => {
                setIsSignUpMode(!isSignUpMode);
                setAuthError(null);
              }}
              className="text-xs text-stone-500 hover:text-orange-500 font-bold underline-offset-2 hover:underline transition"
            >
              {isSignUpMode ? 'すでにアカウントをお持ちの方はこちら' : 'アカウントをお持ちでない方はこちら'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 【ログイン済み】のメインアプリ画面
  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-600 antialiased pb-24">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-100 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 font-bold text-lg">お</div>
            <div>
              <h1 className="text-base font-bold text-stone-700 tracking-tight">おたよりカレンダー</h1>
              <p className="text-[10px] text-stone-400 font-medium -mt-0.5">プリントを撮るだけ自動登録</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isGoogleLinked ? (
              <button 
                onClick={handleDisconnectGoogle}
                className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-full font-extrabold flex items-center gap-1 shadow-sm transition active:scale-95"
                title="クリックでGoogle連携を解除"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Google同期中
              </button>
            ) : (
              <button 
                onClick={handleGoogleCalendarLink}
                disabled={loading}
                className="text-[10px] bg-white border border-stone-200 text-stone-600 hover:bg-stone-50 px-3 py-1.5 rounded-full font-extrabold flex items-center gap-1 shadow-sm transition active:scale-95"
              >
                📅 Google連携
              </button>
            )}
            {!userStatus.isPremium ? (
              <button 
                onClick={handleUpgrade}
                disabled={loading}
                className="text-[10px] bg-gradient-to-r from-orange-400 to-amber-400 hover:from-orange-500 hover:to-amber-500 text-white px-3 py-1.5 rounded-full font-extrabold shadow-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? '接続中...' : '👑 プレミアムにする'}
              </button>
            ) : (
              <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-600 px-2.5 py-1.5 rounded-full font-extrabold">👑 プレミアム会員</span>
            )}
            <div className="flex items-center gap-2 cursor-pointer group" onClick={handleLogout} title="クリックでログアウト">
              <div className="w-8 h-8 rounded-full border border-stone-200 overflow-hidden bg-stone-100 flex items-center justify-center group-hover:border-orange-300 transition">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="icon" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-stone-400">{user.email?.charAt(0).toUpperCase()}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-stone-100/50 border border-stone-200/60 rounded-3xl p-5 relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[11px] font-bold text-stone-500 tracking-wider">今月の自動よみとり残回数</h3>
                <p className="text-lg font-bold text-stone-600 mt-0.5">あと <span className="text-orange-400 text-3xl font-black">{userStatus.remainingScans}</span> 回</p>
              </div>
              {!userStatus.isPremium && (
                <button 
                  onClick={handleUpgrade}
                  disabled={loading}
                  className="bg-gradient-to-r from-orange-400 to-amber-400 hover:from-orange-500 hover:to-amber-500 text-white font-bold text-xs px-4 py-2.5 rounded-full transition active:scale-95 shadow-sm disabled:opacity-50"
                >
                  {loading ? '接続中...' : '無制限にする'}
                </button>
              )}
            </div>
            <div className="w-full bg-stone-200/50 h-2 rounded-full overflow-hidden">
              <div className="bg-orange-300 h-full transition-all duration-500 rounded-full" style={{ width: `${(userStatus.remainingScans / userStatus.maxScans) * 100}%` }}></div>
            </div>
          </div>

          {errorMessage && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-2xl text-sm font-bold flex items-center gap-2">
              ⚠️ {errorMessage}
            </div>
          )}

          {fcmError && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-2xl text-xs font-bold flex items-center gap-2">
              ⚠️ {fcmError}
            </div>
          )}

          {user && permissionStatus === 'default' && (
            <div className="bg-amber-50/70 border border-amber-100 rounded-3xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 animate-fadeIn">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔔</span>
                <div className="text-left">
                  <h4 className="text-sm font-bold text-amber-900">大切な予定の前日におお知らせを受け取りますか？</h4>
                  <p className="text-xs text-amber-700/80 font-medium mt-0.5">プッシュ通知をオンにすると、登録した予定のリマインドが届きます。</p>
                </div>
              </div>
              <button 
                onClick={requestPermission}
                disabled={fcmLoading}
                className="bg-amber-400 hover:bg-amber-500 text-white font-bold text-xs px-5 py-3 rounded-full transition active:scale-95 shadow-sm whitespace-nowrap disabled:opacity-50"
              >
                {fcmLoading ? '設定中...' : '通知をオンにする'}
              </button>
            </div>
          )}

          <div className="bg-white rounded-3xl shadow-sm shadow-stone-100/50 border border-stone-100 p-6">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-extrabold text-stone-700">
                  {viewMode === 'month' ? `${year}年 ${month + 1}月` : 'スケジュール'}
                </h2>
                <div className="flex rounded-full bg-stone-100 p-0.5 border border-stone-200/50 text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setViewMode('month')}
                    className={`px-3 py-1 rounded-full transition-all ${viewMode === 'month' ? 'bg-white text-stone-700 shadow-sm' : 'text-stone-400'}`}
                  >
                    月表示
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('week')}
                    className={`px-3 py-1 rounded-full transition-all ${viewMode === 'week' ? 'bg-white text-stone-700 shadow-sm' : 'text-stone-400'}`}
                  >
                    週表示
                  </button>
                </div>
              </div>
              <div className="flex gap-1 bg-[#FDFBF9] p-1 rounded-full border border-stone-100">
                <button 
                  onClick={() => {
                    if (viewMode === 'month') {
                      prevMonth();
                    } else {
                      const d = new Date(selectedDateStr);
                      d.setDate(d.getDate() - 7);
                      setSelectedDateStr(d.toISOString().split('T')[0]);
                      setCurrentDate(d);
                    }
                  }} 
                  className="p-2 hover:bg-white rounded-full transition text-stone-400 font-bold"
                >
                  ◀
                </button>
                <button onClick={() => {
                  const today = new Date();
                  setCurrentDate(today);
                  setSelectedDateStr(today.toISOString().split('T')[0]);
                }} className="text-[11px] px-3 font-bold text-stone-500 hover:bg-white rounded-full transition">今日</button>
                <button 
                  onClick={() => {
                    if (viewMode === 'month') {
                      nextMonth();
                    } else {
                      const d = new Date(selectedDateStr);
                      d.setDate(d.getDate() + 7);
                      setSelectedDateStr(d.toISOString().split('T')[0]);
                      setCurrentDate(d);
                    }
                  }} 
                  className="p-2 hover:bg-white rounded-full transition text-stone-400 font-bold"
                >
                  ▶
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] font-bold text-stone-400 mb-3">
              <div className="text-rose-300">日</div><div>月</div><div>火</div><div>水</div><div>木</div><div>金</div><div className="text-sky-300">土</div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {(viewMode === 'month' ? calendarCells : getWeekCells()).map((date, idx) => {
                if (!date) return <div key={`empty-${idx}`} className="aspect-square"></div>;
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const isSelected = dateStr === selectedDateStr;
                const dayEvents = events.filter(e => e.date === dateStr);
                const hasEvents = dayEvents.length > 0;
                const uniqueColors = Array.from(new Set(dayEvents.map(e => e.color || 'common')));
                return (
                  <button key={`day-${idx}`} onClick={() => setSelectedDateStr(dateStr)} className={`aspect-square rounded-2xl relative flex flex-col items-center justify-center font-bold text-sm transition-all ${isSelected ? 'bg-orange-200 text-orange-900 scale-105 z-10 shadow-sm border border-orange-300/30' : 'hover:bg-stone-50 text-stone-600'}`}>
                    <span className="z-10">{date.getDate()}</span>
                    {hasEvents && (
                      <div className="absolute bottom-1.5 flex gap-0.5 justify-center z-10">
                        {uniqueColors.map(col => {
                          let dotColor = 'bg-orange-400';
                          if (col === 'father') dotColor = 'bg-sky-400';
                          if (col === 'mother') dotColor = 'bg-rose-400';
                          if (col === 'child') dotColor = 'bg-emerald-400';
                          return <span key={col} className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>;
                        })}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <AdBanner slot="calendar-bottom" isPremium={userStatus.isPremium} />

          {loading && (
            <div className="bg-stone-50 border-2 border-dashed border-stone-200 rounded-3xl p-8 text-center space-y-4 animate-pulse">
              <div className="w-14 h-14 bg-white shadow-sm text-stone-400 rounded-full flex items-center justify-center mx-auto text-2xl animate-bounce">📷</div>
              <p className="text-stone-500 font-bold text-sm">AIがおたよりを読みとって、自動登録しています...</p>
            </div>
          )}

          {scanResult && (
            <div className="bg-[#F8FAF9] border border-teal-100/50 rounded-3xl p-6 shadow-sm space-y-5 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-stone-200/50 pb-3">
                <div>
                  <h3 className="font-bold text-teal-600 text-base flex items-center gap-2"><span>✨</span> カレンダーに自動登録しました！</h3>
                  <p className="text-xs text-stone-400 mt-1">以下の内容で登録しました。ここから直接修正も可能です。</p>
                </div>
              </div>
              <div className="space-y-3">
                {scanResult.map((ev) => (
                  <div key={ev.id} className="bg-white p-4 rounded-2xl border border-stone-100 focus-within:border-teal-300 focus-within:shadow-sm transition-all space-y-3">
                    <div className="flex gap-2 flex-wrap">
                      <input type="text" value={ev.date} onChange={(e) => handleUpdateEvent(ev.id, 'date', e.target.value)} className="text-xs bg-stone-50 text-stone-600 px-2.5 py-1.5 rounded-lg font-bold border-none w-28 focus:ring-1 focus:ring-teal-200" />
                      <select value={ev.category} onChange={(e) => handleUpdateEvent(ev.id, 'category', e.target.value)} className="text-xs bg-stone-50 text-stone-600 px-2.5 py-1.5 rounded-lg font-bold border-none focus:ring-1 focus:ring-teal-200">
                        <option value="school">🏫 学校・園</option><option value="event">🎈 行事</option><option value="medical">🏥 保健</option>
                      </select>
                      <select value={ev.color || 'common'} onChange={(e) => handleUpdateEvent(ev.id, 'color', e.target.value)} className="text-xs bg-stone-50 text-stone-600 px-2.5 py-1.5 rounded-lg font-bold border-none focus:ring-1 focus:ring-teal-200">
                        <option value="common">👪 共通</option>
                        <option value="father">👨 パパ</option>
                        <option value="mother">👩 ママ</option>
                        <option value="child">👶 子供</option>
                      </select>
                    </div>
                    <input type="text" value={ev.title} onChange={(e) => handleUpdateEvent(ev.id, 'title', e.target.value)} className="w-full font-bold text-stone-700 border-b border-stone-100 p-1 text-sm focus:border-teal-300 focus:ring-0" />
                    <textarea value={ev.details} onChange={(e) => handleUpdateEvent(ev.id, 'details', e.target.value)} className="w-full text-[11px] text-stone-500 border-none p-2 resize-none h-14 bg-stone-50 rounded-xl focus:ring-1 focus:ring-teal-200" />
                    
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 text-[10px] text-stone-500 font-bold border-t border-stone-100/50">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={ev.remindThreeDays || false} onChange={(e) => handleUpdateEvent(ev.id, 'remindThreeDays', e.target.checked)} className="rounded text-teal-400 focus:ring-teal-300 focus:ring-1 border-stone-200 scale-90" />
                        3日前通知
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={ev.remindOneDay || false} onChange={(e) => handleUpdateEvent(ev.id, 'remindOneDay', e.target.checked)} className="rounded text-teal-400 focus:ring-teal-300 focus:ring-1 border-stone-200 scale-90" />
                        1日前通知
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2">
                <button onClick={() => setScanResult(null)} className="w-full py-3.5 bg-teal-400 hover:bg-teal-500 text-white font-bold rounded-full transition active:scale-95 text-sm shadow-sm">確認完了（閉じる）</button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-3xl shadow-sm shadow-stone-100/50 border border-stone-100 p-5 text-center">
            <h3 className="font-bold text-stone-500 text-xs text-left mb-3">かんたん登録</h3>
            <label className="w-full py-7 px-4 bg-orange-200 hover:bg-orange-300 text-orange-900 rounded-3xl font-black text-base transition-all active:scale-95 flex flex-col items-center justify-center gap-2 group cursor-pointer">
              <span className="text-3xl group-hover:scale-110 transition-transform opacity-80">📷</span>
              <div>
                <p className="text-sm font-bold">プリントを撮る</p>
                <p className="text-[10px] text-orange-700/80 font-medium mt-1">カメラ / フォルダから選ぶ</p>
              </div>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} disabled={loading} />
            </label>

            <button 
              onClick={() => {
                setEditingEvent({
                  title: "",
                  date: selectedDateStr,
                  details: "",
                  category: "school",
                  color: "common",
                  imageUrl: null,
                  remindThreeDays: true,
                  remindOneDay: true,
                  remindCustom: false,
                  customRemindAt: ""
                });
                setIsEventModalOpen(true);
              }}
              className="w-full mt-3 py-3 bg-stone-50 hover:bg-stone-100 text-stone-600 font-bold rounded-2xl text-xs transition active:scale-95 border border-stone-200"
            >
              ✍️ 手動で予定を追加する
            </button>
          </div>

          <div className="bg-white rounded-3xl shadow-sm shadow-stone-100/50 border border-stone-100 p-5 flex-1 min-h-[300px] flex flex-col">
            <div className="border-b border-stone-100 pb-3 mb-4 flex items-center justify-between">
              <div><h3 className="font-bold text-stone-600 text-sm">この日の予定</h3><p className="text-[11px] text-orange-400 font-bold mt-0.5">{selectedDateStr}</p></div>
            </div>
            {filteredEvents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-stone-300 my-auto"><span className="text-3xl mb-2 opacity-30">☕</span><p className="text-[11px] font-bold">予定はありません</p></div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto">
                {filteredEvents.map((ev) => {
                  let cardColorClass = 'bg-[#FDFBF9] border-stone-100';
                  if (ev.color === 'father') cardColorClass = 'bg-sky-50/40 border-sky-100/70';
                  if (ev.color === 'mother') cardColorClass = 'bg-rose-50/40 border-rose-100/70';
                  if (ev.color === 'child') cardColorClass = 'bg-emerald-50/40 border-emerald-100/70';

                  const colorLabels: Record<string, string> = {
                    common: '共通',
                    father: 'パパ',
                    mother: 'ママ',
                    child: '子供'
                  };
                  const colorBadgeClasses: Record<string, string> = {
                    common: 'bg-orange-100 text-orange-700',
                    father: 'bg-sky-100 text-sky-700',
                    mother: 'bg-rose-100 text-rose-700',
                    child: 'bg-emerald-100 text-emerald-700'
                  };

                  return (
                    <div key={ev.id} className={`p-3.5 rounded-2xl border relative group transition-all duration-250 ${cardColorClass}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex flex-wrap gap-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ev.category === 'school' ? 'bg-sky-50 text-sky-600' : ''} ${ev.category === 'event' ? 'bg-orange-50 text-orange-600' : ''} ${ev.category === 'medical' ? 'bg-rose-50 text-rose-500' : ''}`}>
                            {ev.category === 'school' && '🏫 学校・園'}{ev.category === 'event' && '🎈 行事'}{ev.category === 'medical' && '🏥 保健'}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${colorBadgeClasses[ev.color || 'common']}`}>
                            {colorLabels[ev.color || 'common']}
                          </span>
                        </div>
                        <div className="flex gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => {
                              setEditingEvent(ev);
                              setIsEventModalOpen(true);
                            }}
                            className="text-stone-400 hover:text-orange-400 text-xs p-1"
                            title="予定を編集"
                          >
                            ✏️
                          </button>
                          <button 
                            onClick={() => handleDeleteEvent(ev.id)}
                            className="text-stone-400 hover:text-rose-400 text-xs p-1"
                            title="予定を削除"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <h4 className="font-bold text-stone-700 text-sm mt-2.5">{ev.title}</h4>
                      <p className="text-[11px] text-stone-500 mt-1.5 leading-relaxed whitespace-pre-wrap">{ev.details}</p>
                      
                      {ev.imageUrl && (
                        <button 
                          type="button"
                          onClick={() => setActiveImageUrl(ev.imageUrl)}
                          className="mt-3 w-full py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 font-bold rounded-xl text-[10px] transition flex items-center justify-center gap-1 border border-stone-200/50"
                        >
                          📷 おたより画像を表示
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <AdBanner slot="sidebar-bottom" isPremium={userStatus.isPremium} />
        </div>
      </main>

      {/* スキャン上限到達モーダル */}
      {isLimitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[#FDFBF9] border border-orange-100 rounded-3xl p-6 max-w-sm w-full shadow-xl animate-scaleIn text-center relative overflow-hidden">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto text-3xl mb-4 text-orange-600">
              🔔
            </div>
            <h3 className="text-lg font-black text-stone-800 mb-3">今月のよみとり上限に達しました</h3>
            <p className="text-xs text-stone-500 leading-relaxed mb-6">
              いつもおたよりカレンダーをご利用いただきありがとうございます。無料プランでの今月のスキャン上限（10回）に達しました。月額480円のプレミアムプランに登録すると、残り回数を気にせず何枚でもスキャンできるようになります！
            </p>
            <div className="space-y-2.5">
              <button 
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full bg-orange-400 hover:bg-orange-500 text-white font-bold py-3 px-4 rounded-xl text-xs transition active:scale-95 shadow-sm disabled:opacity-50"
              >
                {loading ? '接続中...' : 'プレミアム会員にアップグレード (月額480円)'}
              </button>
              <button 
                onClick={() => setIsLimitModalOpen(false)}
                className="w-full bg-white hover:bg-stone-50 text-stone-500 border border-stone-200 font-bold py-3 px-4 rounded-xl text-xs transition active:scale-95"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 予定の追加・編集モーダル */}
      {isEventModalOpen && editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-fadeIn">
          <form 
            onSubmit={handleSaveModalEvent}
            className="bg-[#FDFBF9] border border-orange-100 rounded-3xl p-6 max-w-sm w-full shadow-xl animate-scaleIn text-left space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-base font-extrabold text-stone-800 tracking-tight">
              {editingEvent.id ? '✏️ 予定を編集する' : '✍️ 新しい予定を追加する'}
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">カテゴリ</label>
                <select 
                  value={editingEvent.category || 'school'} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, category: e.target.value })} 
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-600 font-bold"
                >
                  <option value="school">🏫 学校・園</option>
                  <option value="event">🎈 行事・イベント</option>
                  <option value="medical">🏥 保健・病院</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">カラー</label>
                <div className="flex gap-2.5 mt-1">
                  {[
                    { key: 'common', color: 'bg-orange-400', label: '共通' },
                    { key: 'father', color: 'bg-sky-400', label: 'パパ' },
                    { key: 'mother', color: 'bg-rose-400', label: 'ママ' },
                    { key: 'child', color: 'bg-emerald-400', label: '子供' }
                  ].map(c => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setEditingEvent({ ...editingEvent, color: c.key })}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-bold text-white transition active:scale-95 ${c.color} ${editingEvent.color === c.key ? 'ring-2 ring-stone-800 ring-offset-1 scale-105' : 'opacity-85'}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">日付</label>
                <input 
                  type="date" 
                  required
                  value={editingEvent.date || ''} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })} 
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-600 font-bold"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">タイトル</label>
                <input 
                  type="text" 
                  required
                  value={editingEvent.title || ''} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })} 
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-700 font-bold"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">詳細（持ち物など）</label>
                <textarea 
                  value={editingEvent.details || ''} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, details: e.target.value })} 
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-500 font-bold h-20 resize-none"
                />
              </div>

              {/* リマインド通知設定 */}
              <div className="space-y-2 p-3 bg-stone-100/50 rounded-2xl border border-stone-200/50">
                <p className="text-[10px] font-bold text-stone-500 tracking-wider">🔔 リマインド通知設定</p>
                <label className="flex items-center gap-2 text-xs text-stone-600 font-bold cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={editingEvent.remindThreeDays || false} 
                    onChange={(e) => setEditingEvent({ ...editingEvent, remindThreeDays: e.target.checked })} 
                    className="rounded text-orange-400 focus:ring-orange-300 focus:ring-1 border-stone-200"
                  />
                  予定の3日前に通知 (19:00)
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600 font-bold cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={editingEvent.remindOneDay || false} 
                    onChange={(e) => setEditingEvent({ ...editingEvent, remindOneDay: e.target.checked })} 
                    className="rounded text-orange-400 focus:ring-orange-300 focus:ring-1 border-stone-200"
                  />
                  予定の前日に通知 (19:00)
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600 font-bold cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={editingEvent.remindCustom || false} 
                    onChange={(e) => setEditingEvent({ ...editingEvent, remindCustom: e.target.checked })} 
                    className="rounded text-orange-400 focus:ring-orange-300 focus:ring-1 border-stone-200"
                  />
                  日時を指定して通知
                </label>
                {editingEvent.remindCustom && (
                  <input 
                    type="datetime-local" 
                    value={editingEvent.customRemindAt || ""} 
                    onChange={(e) => setEditingEvent({ ...editingEvent, customRemindAt: e.target.value })} 
                    className="w-full mt-1 px-3 py-2 text-xs bg-white border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-600 font-bold"
                  />
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button 
                type="submit"
                className="flex-1 bg-orange-400 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl text-xs transition active:scale-95 shadow-sm"
              >
                保存する
              </button>
              <button 
                type="button"
                onClick={() => {
                  setIsEventModalOpen(false);
                  setEditingEvent(null);
                }}
                className="flex-1 bg-white hover:bg-stone-50 text-stone-500 border border-stone-200 font-bold py-3.5 rounded-xl text-xs transition active:scale-95"
              >
                キャンセル
              </button>
            </div>
          </form>
        </div>
      )}

      {/* おたより画像拡大モーダル */}
      {activeImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-md animate-fadeIn" onClick={() => setActiveImageUrl(null)}>
          <div className="relative max-w-3xl w-full bg-white rounded-3xl overflow-hidden shadow-2xl p-2 animate-scaleIn" onClick={e => e.stopPropagation()}>
            <button onClick={() => setActiveImageUrl(null)} className="absolute top-4 right-4 bg-stone-900/75 hover:bg-stone-900 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold transition active:scale-95 shadow-md z-10">✕</button>
            <div className="max-h-[80vh] overflow-auto flex justify-center">
              <img src={activeImageUrl} alt="おたより画像" className="max-h-[80vh] w-auto object-contain rounded-2xl" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}