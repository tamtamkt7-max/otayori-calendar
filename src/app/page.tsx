"use client";
import { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
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
import { trackEvent, GA_EVENTS } from '../lib/gtag';
import Link from 'next/link';
import { generateIcsString, downloadIcsFile } from '../lib/ics';

// Safari対策：ハイフン区切りの日付文字列("YYYY-MM-DD")をスラッシュ区切り("YYYY/MM/DD")に置換して安全にローカル時間でパースするヘルパー
const safeParseDate = (dateStr: string | null | undefined): Date => {
  if (!dateStr) return new Date();
  // すでに "2026/07/10" 形式、または ISO 形式の場合はそのまま、ハイフン区切りのみスラッシュに置換
  const sanitized = dateStr.includes('-') && !dateStr.includes('T')
    ? dateStr.replace(/-/g, '/')
    : dateStr;
  return new Date(sanitized);
};

export default function Home() {
  // --- 認証関連のState ---
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  
  // メールアドレス・パスワード認証用State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // --- カレンダー関連 of State ---
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [currentDate, setCurrentDate] = useState(today);
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayStr);
  const [events, setEvents] = useState<any[]>([]);
  const [isSettingModalOpen, setIsSettingModalOpen] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberColor, setNewMemberColor] = useState<'common' | 'father' | 'mother' | 'child'>('common');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'history'>('month');
  
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState<any[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState({ isPremium: false, remainingScans: 10, maxScans: 10, groupId: '', inviteCode: '' });
  const [isLimitModalOpen, setIsLimitModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);

  // Web Push (FCM) のStateとカスタムフック
  const { 
    permissionStatus, 
    requestPermission, 
    loading: fcmLoading, 
    error: fcmError,
    showIosPwaGuide,
    setShowIosPwaGuide
  } = useFcm(user?.uid);

  // ログイン状態の監視
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ログイン完了後のデータ同期 (Firestoreの認証確立を待つための別useEffect)
  useEffect(() => {
    if (isAuthLoading) return;

    const syncData = async () => {
      if (!user) {
        setEvents([]);
        return;
      }

      // Firestoreの認証状態が内部で確立されるのを確実に待つための遅延ガード (150ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      console.log("[syncData] Starting data sync. Auth states:", {
        currentUser: auth.currentUser ? { uid: auth.currentUser.uid, email: auth.currentUser.email } : null,
        userState: user ? { uid: user.uid, email: user.email } : null
      });

      setErrorMessage(null);
      try {
        const { getDoc, setDoc } = await import('firebase/firestore');
        
        console.log("[syncData] Fetching users profile document. Path:", `users/${user.uid}`);
        const userDocSnap = await getDoc(doc(db, 'users', user.uid));
        console.log("[syncData] User profile document fetch complete. Exists:", userDocSnap.exists());
        
        let currentGroupId = '';
        let currentInviteCode = '';
        let isPremium = false;
        let remainingScans = 10;
        
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          isPremium = userData.plan === 'premium';
          
          currentGroupId = userData.groupId || user.uid;
          currentInviteCode = userData.inviteCode || '';
          
          // 日本時間の現在年月を取得してリセット判定
          const now = new Date();
          const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
          const currentMonthStr = `${jstDate.getFullYear()}-${String(jstDate.getMonth() + 1).padStart(2, '0')}`;
          
          const lastScanMonth = userData.lastScanMonth || '';
          const scanCount = lastScanMonth === currentMonthStr ? (userData.scanCount || 0) : 0;
          remainingScans = isPremium ? 9999 : Math.max(0, 10 - scanCount);
          
          // もし groupId や inviteCode が未定義の場合は初期化して保存
          if (!userData.groupId || !userData.inviteCode) {
            const updates: any = {};
            if (!userData.groupId) {
              updates.groupId = user.uid;
              currentGroupId = user.uid;
            }
            if (!userData.inviteCode) {
              const code = Math.random().toString(36).substring(2, 10).toUpperCase();
              updates.inviteCode = code;
              currentInviteCode = code;
            }
            await setDoc(doc(db, 'users', user.uid), updates, { merge: true });
          }
        } else {
          // 新規ユーザーなどでドキュメントが存在しない場合、ドキュメントを初期作成する
          console.log("[syncData] Creating initial user profile since it does not exist in DB.");
          const code = Math.random().toString(36).substring(2, 10).toUpperCase();
          currentGroupId = user.uid;
          currentInviteCode = code;
          
          await setDoc(doc(db, 'users', user.uid), {
            plan: 'free',
            scanCount: 0,
            groupId: user.uid,
            inviteCode: code,
            createdAt: new Date().toISOString()
          });
        }

        // 強力な直列化ガード: プロファイルのgroupIdがまだ確定していない場合はカレンダー読み込みに進まない
        if (!currentGroupId) {
          console.warn("[syncData] groupId is empty. Skipping events query to prevent Permission Denied.");
          return;
        }
        
        // 2. 予定のフェッチ (groupIdの統一データストア)
        console.log("[syncData] Querying events collection. Path:", `groups/${currentGroupId}/events`);
        const querySnapshot = await getDocs(collection(db, `groups/${currentGroupId}/events`));
        console.log("[syncData] Event query completed. Size:", querySnapshot.size);
        const fetchedEvents: any[] = [];
        querySnapshot.forEach((doc) => {
          fetchedEvents.push({ id: doc.id, ...doc.data() });
        });
        setEvents(fetchedEvents);
        
        // 2-2. メンバーリストの取得と同期
        console.log("[syncData] Fetching group owner document for members sync. Path:", `users/${currentGroupId}`);
        const groupOwnerSnap = await getDoc(doc(db, 'users', currentGroupId));
        let groupMembers: any[] = [];
        let groupOwnerPlan = 'free';
        if (groupOwnerSnap.exists()) {
          const ownerData = groupOwnerSnap.data();
          groupMembers = ownerData.members || [];
          groupOwnerPlan = ownerData.plan || 'free';
        }
        if (groupMembers.length === 0) {
          groupMembers = [{ id: 'owner', name: '自分', color: 'common' }];
          await setDoc(doc(db, 'users', currentGroupId), { members: groupMembers }, { merge: true });
        }
        setMembers(groupMembers);

        // 閲覧専用モード (isReadOnly) の判定（パターンB）: 
        // 自分がグループオーナーではなく、かつグループ所有者がプレミアムプランでない場合に閲覧専用 (true) に設定
        const readOnlyState = (currentGroupId !== user.uid) && (groupOwnerPlan !== 'premium');
        setIsReadOnly(readOnlyState);
        console.log("[syncData] readOnlyState evaluated:", readOnlyState, { currentGroupId, userUid: user.uid, groupOwnerPlan });

        // Stateを同期
        setUserStatus({
          isPremium,
          remainingScans,
          maxScans: 10,
          groupId: currentGroupId,
          inviteCode: currentInviteCode
        });
      } catch (error: any) {
        console.error("[syncData] Critical data sync error details:", error, {
          code: error?.code,
          message: error?.message,
          stack: error?.stack,
          rawError: JSON.stringify(error)
        });
        const errCode = error?.code || '';
        const errMsg = error?.message || '';
        
        if (errCode === 'permission-denied' || errMsg.includes('permission-denied') || errMsg.includes('Missing or insufficient permissions')) {
          setErrorMessage("Firestoreのアクセス権限エラー（Permission Denied）が発生しました。Firebaseコンソールでセキュリティルールが適用（公開）されているかご確認ください。");
        } else if (errCode === 'unavailable' || errMsg.includes('offline')) {
          setErrorMessage("一時的にデータベースに接続できません。通信環境をご確認のうえ再読み込みしてください。");
        } else {
          setErrorMessage("データの読み込みに失敗しました。画面を再読み込みしてください。");
        }
      }
    };

    syncData();
  }, [user, isAuthLoading]);

  // userStatus変更のデバッグログ
  useEffect(() => {
    console.log("[Debug] userStatus changed state:", userStatus);
  }, [userStatus]);

  // Googleリダイレクトログイン結果のキャッチ
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          console.log("[Auth] Google Redirect login success:", result.user);
        }
      })
      .catch((error) => {
        console.error("[Auth] Google Redirect login error:", error);
        setAuthError(`Googleログインに失敗しました: ${error.message || 'ブラウザのCookie制限等のエラー'}`);
      });
  }, []);

  // Googleログイン処理
  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Googleログイン ポップアップ失敗:", error);
      
      // ポップアップがブロックされた、またはアプリ内ブラウザ等でポップアップがサポートされていない場合
      if (
        error.code === 'auth/popup-blocked' ||
        error.code === 'auth/cancelled-popup-request' ||
        error.message?.includes('popup')
      ) {
        try {
          console.log("ポップアップがブロックされたため、リダイレクト方式で再試行します...");
          await signInWithRedirect(auth, googleProvider);
        } catch (redirectErr: any) {
          console.error("Googleログイン リダイレクト失敗:", redirectErr);
          setAuthError("Googleログインに失敗しました。ブラウザのセキュリティ設定でポップアップが制限されているか、Cookieが無効になっている可能性があります。別ブラウザでお試しください。");
        }
      } else if (error.code === 'auth/popup-closed-by-user') {
        setAuthError("ログインがキャンセルされました。");
      } else {
        setAuthError(`Googleでのログインに失敗しました (${error.code || '未知のエラー'})。ポップアップをブロック解除するか、もう一度お試しください。`);
      }
    }
  };

  // メール/パスワード 登録・ログイン処理
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (isSignUpMode) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;
        const { setDoc } = await import('firebase/firestore');
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        await setDoc(doc(db, 'users', newUser.uid), {
          plan: 'free',
          scanCount: 0,
          groupId: newUser.uid,
          inviteCode: code,
          createdAt: new Date().toISOString()
        });
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
        groupId: userStatus.groupId || user.uid,
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

  // --- 家族共有連携処理 ---
  // 招待コードの入力による家族共有連携
  const handleLinkGroup = async (targetInviteCode: string) => {
    if (!user || !targetInviteCode) return;
    setLoading(true);
    try {
      const { collection, query, where, getDocs, doc, setDoc } = await import('firebase/firestore');
      const q = query(collection(db, 'users'), where('inviteCode', '==', targetInviteCode.trim().toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert("無効な招待コードです。コードを確認してください。");
        return;
      }
      
      const partnerDoc = querySnapshot.docs[0];
      const partnerData = partnerDoc.data();
      const partnerGroupId = partnerData.groupId || partnerDoc.id;
      
      // 家族共有の人数制限チェック（パターンB）
      const partnerPlan = partnerData.plan || 'free';
      const usersInGroupQuery = query(collection(db, 'users'), where('groupId', '==', partnerGroupId));
      const usersInGroupSnap = await getDocs(usersInGroupQuery);
      const currentMemberCount = usersInGroupSnap.size;

      if (partnerPlan !== 'premium') {
        // カレンダー所有者が無料プランの場合、招待可能人数は1名まで（グループ合計2名まで）
        if (currentMemberCount >= 2) {
          alert("共有先のカレンダー所有者が無料プランのため、これ以上共有メンバーを追加できません。\n3人以上で共有するには、カレンダー所有者がプレミアムプランに加入する必要があります。");
          return;
        }
        alert("カレンダー所有者が無料プランのため、「閲覧専用（読み取り専用）モード」として連携します。\n（予定の追加・変更・削除は行えません）");
      }
      
      if (partnerDoc.id === user.uid) {
        alert("自分自身の招待コードを入力することはできません。");
        return;
      }
      
      if (!confirm("指定されたユーザーのカレンダーと共有・同期しますか？\n（現在登録されている予定がマージされます）")) return;

      const myGroupId = userStatus.groupId || user.uid;
      
      if (myGroupId !== partnerGroupId) {
        const myEventsSnap = await getDocs(collection(db, `groups/${myGroupId}/events`));
        const { writeBatch } = await import('firebase/firestore');
        const batch = writeBatch(db);
        
        myEventsSnap.forEach((eventDoc) => {
          const targetRef = doc(db, `groups/${partnerGroupId}/events`, eventDoc.id);
          batch.set(targetRef, eventDoc.data(), { merge: true });
        });
        await batch.commit();
      }

      await setDoc(doc(db, 'users', user.uid), { groupId: partnerGroupId }, { merge: true });
      
      setUserStatus(prev => ({
        ...prev,
        groupId: partnerGroupId
      }));
      
      alert("家族カレンダーの共有連携に成功しました！🎉");
      window.location.reload();
    } catch (err) {
      console.error("Failed to link group:", err);
      alert("カレンダーの連携に失敗しました💦");
    } finally {
      setLoading(false);
    }
  };

  // 共有の解除
  const handleUnlinkGroup = async () => {
    if (!user) return;
    if (!confirm("家族カレンダーとの連携を解除して、個人のカレンダーに戻しますか？\n（今後は自分だけの予定が表示されるようになります）")) return;
    setLoading(true);
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', user.uid), { groupId: user.uid }, { merge: true });
      setUserStatus(prev => ({
        ...prev,
        groupId: user.uid
      }));
      alert("家族カレンダーとの連携を解除しました。");
      window.location.reload();
    } catch (err) {
      console.error("Failed to unlink group:", err);
      alert("連携解除に失敗しました💦");
    } finally {
      setLoading(false);
    }
  };

  // --- 家族メンバー管理処理（色分け・プレミアム制限） ---
  const handleAddMember = async (name: string, color: 'common' | 'father' | 'mother' | 'child') => {
    if (!user || !name.trim()) return;
    const isPremium = userStatus.isPremium;
    
    // 無料プランでは自分を含む「最大2名」まで
    if (!isPremium && members.length >= 2) {
      alert("無料プランではメンバー登録数は「2名まで」に制限されています。\nメンバーを3名以上登録して色分けするには、プレミアムプランへの加入が必要です。");
      setIsLimitModalOpen(true); // プレミアム勧誘モーダルを表示
      return;
    }
    
    const newMember = {
      id: `member-${Date.now()}`,
      name: name.trim(),
      color: color
    };
    
    const updatedMembers = [...members, newMember];
    const targetGroupId = userStatus.groupId || user.uid;
    
    setLoading(true);
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', targetGroupId), { members: updatedMembers }, { merge: true });
      setMembers(updatedMembers);
      setNewMemberName('');
      alert("家族メンバーを追加しました！🎉");
    } catch (err) {
      console.error("Failed to add member:", err);
      alert("メンバーの追加に失敗しました。💦");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!user || memberId === 'owner') return; // ownerのデフォルト（自分）は削除不可
    if (!confirm("このメンバーを削除しますか？\n（登録済みの予定は削除されず、色分けのみそのまま残ります）")) return;
    
    const updatedMembers = members.filter(m => m.id !== memberId);
    const targetGroupId = userStatus.groupId || user.uid;
    
    setLoading(true);
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', targetGroupId), { members: updatedMembers }, { merge: true });
      setMembers(updatedMembers);
      alert("メンバーを削除しました。");
    } catch (err) {
      console.error("Failed to remove member:", err);
      alert("メンバーの削除に失敗しました。💦");
    } finally {
      setLoading(false);
    }
  };

  // --- Stripe決済画面への遷移処理 ---
  const handleUpgrade = async () => {
    trackEvent(GA_EVENTS.UPGRADE_CLICK, 'payment', 'upgrade_premium_click');
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

      if (!response.ok) {
        let errMsg = '決済の準備に失敗しました。';
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
        } catch (_) {
          // HTMLエラーページが返却された場合のフォールバック
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      if (data.success === false || data.error) {
        throw new Error(data.error || '決済の準備に失敗しました。');
      }
      if (data.url) {
        if (!data.url.startsWith('https://')) {
          throw new Error('決済URLの形式が正しくありません。');
        }

        try {
          window.location.href = data.url;
        } catch (redirectErr: any) {
          console.warn("[Upgrade] Safari location.href redirect blocked, retrying with location.assign...", redirectErr);
          try {
            window.location.assign(data.url);
          } catch (assignErr) {
            console.error("[Upgrade] Both redirection attempts failed:", assignErr);
            const newWindow = window.open(data.url, '_blank');
            if (!newWindow) {
              throw new Error('ブラウザのセキュリティ設定により、決済画面への自動遷移がブロックされました。お手数ですが、通常のSafari/Chromeブラウザ（またはブラウザの標準タブ）から再度ログインして開き直してください。');
            }
          }
        }
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



  // --- .ics カレンダーエクスポート処理 ---
  // 個別予定の書き出し
  const handleExportSingleIcs = (event: any) => {
    if (!event) return;
    try {
      trackEvent('calendar_export_ics', 'ics', 'export_single');
      const icsString = generateIcsString({
        id: event.id,
        title: event.title || '無題の予定',
        date: event.date,
        details: event.details || ''
      });
      const filename = `${event.date}_${event.title || 'event'}.ics`;
      downloadIcsFile(filename, icsString);
    } catch (err) {
      console.error("Failed to export single .ics:", err);
      alert("カレンダーファイルの生成に失敗しました😢");
    }
  };

  // 複数予定（スキャン結果など）の一括書き出し
  const handleExportMultipleIcs = (eventsList: any[]) => {
    if (!eventsList || eventsList.length === 0) return;
    try {
      trackEvent('calendar_export_ics', 'ics', 'export_multiple');
      const formattedEvents = eventsList.map(ev => ({
        id: ev.id,
        title: ev.title || '無題の予定',
        date: ev.date,
        details: ev.details || ''
      }));
      const icsString = generateIcsString(formattedEvents);
      const filename = `otayori_events_${new Date().toISOString().slice(0,10)}.ics`;
      downloadIcsFile(filename, icsString);
    } catch (err) {
      console.error("Failed to export multiple .ics:", err);
      alert("カレンダーファイルの一括生成に失敗しました😢");
    }
  };

  // 週表示用の日付セルリスト生成
  const getWeekCells = () => {
    const selected = safeParseDate(selectedDateStr);
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

  // ブラウザ側で画像を最大長辺1600px、品質0.8のJPEGにリサイズ・圧縮するヘルパー
  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const maxLen = 1600;
        let width = img.width;
        let height = img.height;

        if (width > maxLen || height > maxLen) {
          if (width > height) {
            height = Math.round((height * maxLen) / width);
            width = maxLen;
          } else {
            width = Math.round((width * maxLen) / height);
            height = maxLen;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // image/jpeg 品質 0.8 で圧縮
          const compressed = canvas.toDataURL('image/jpeg', 0.8);
          resolve(compressed);
        } else {
          resolve(base64Str); // 失敗時は元の画像を返す
        }
      };
      img.onerror = () => {
        resolve(base64Str); // 失敗時は元の画像を返す
      };
    });
  };

  // --- AIスキャンロジック ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    trackEvent(GA_EVENTS.SCAN_START, 'ai_scan', file.name);
    setLoading(true);
    setScanResult(null);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const rawBase64 = reader.result as string;
      try {
        // 送信前に画像を自動リサイズ・圧縮し、ペイロードサイズを劇的に削減 (413エラー対策)
        const base64Image = await compressImage(rawBase64);
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

          trackEvent(GA_EVENTS.SCAN_SUCCESS, 'ai_scan', `events_found_${newEvents.length}`, newEvents.length);

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
            trackEvent(GA_EVENTS.SCAN_FAILURE, 'ai_scan', 'scan_limit_reached');
            setIsLimitModalOpen(true);
          } else {
            trackEvent(GA_EVENTS.SCAN_FAILURE, 'ai_scan', data.error || 'scan_api_error');
            setErrorMessage(data.error || "おたよりの読み込みに失敗しました😢");
          }
        }
      } catch (err: any) {
        trackEvent(GA_EVENTS.SCAN_FAILURE, 'ai_scan', 'network_error');
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
            groupId: userStatus.groupId || user.uid,
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
          {/* ログイン・新規登録トグルタブ */}
          <div className="flex border-b border-stone-100 mb-6">
            <button
              type="button"
              onClick={() => {
                setIsSignUpMode(false);
                setAuthError(null);
              }}
              className={`flex-1 pb-3 text-sm font-extrabold border-b-2 text-center transition-all ${!isSignUpMode ? 'border-orange-400 text-stone-800' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
            >
              ログイン
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignUpMode(true);
                setAuthError(null);
              }}
              className={`flex-1 pb-3 text-sm font-extrabold border-b-2 text-center transition-all ${isSignUpMode ? 'border-orange-400 text-stone-800' : 'border-transparent text-stone-400 hover:text-stone-600'}`}
            >
              新規登録
            </button>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl border border-rose-100 text-center leading-relaxed">
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
              {isSignUpMode ? '新規アカウントを作成' : 'ログイン'}
            </button>
          </form>

          <div className="relative flex items-center justify-center mb-6">
            <div className="border-t border-stone-200 w-full"></div>
            <span className="bg-white px-3 text-xs text-stone-400 absolute">または</span>
          </div>

          <button 
            type="button"
            onClick={handleGoogleLogin}
            className="w-full bg-white border border-stone-200 shadow-sm hover:bg-stone-50 hover:border-stone-300 text-stone-700 font-extrabold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-95 text-sm mb-2"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            <span>Googleで続ける</span>
          </button>
        </div>

        {/* 未ログインフッター */}
        <footer className="mt-8 text-center text-stone-400 text-[10px] space-x-2">
          <span>&copy; 2026 おたよりカレンダー</span>
          <span>|</span>
          <Link href="/terms" className="hover:text-orange-400 transition hover:underline">利用規約</Link>
          <span>|</span>
          <Link href="/privacy" className="hover:text-orange-400 transition hover:underline">プライバシーポリシー</Link>
        </footer>
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
            <button
              onClick={() => setIsSettingModalOpen(true)}
              className="p-1.5 hover:bg-stone-100 rounded-full transition text-stone-500 hover:text-stone-700 mr-0.5 text-base flex items-center justify-center border border-stone-200/50"
              title="設定・家族管理"
            >
              ⚙️
            </button>
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
                  {viewMode === 'month' && `${year}年 ${month + 1}月`}
                  {viewMode === 'week' && 'スケジュール'}
                  {viewMode === 'history' && 'おたよりスキャン履歴'}
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
                  <button
                    type="button"
                    onClick={() => setViewMode('history')}
                    className={`px-3 py-1 rounded-full transition-all ${viewMode === 'history' ? 'bg-white text-stone-700 shadow-sm' : 'text-stone-400'}`}
                  >
                    履歴一覧
                  </button>
                </div>
              </div>
              {viewMode !== 'history' && (
                <div className="flex gap-1 bg-[#FDFBF9] p-1 rounded-full border border-stone-100">
                <button 
                  onClick={() => {
                    if (viewMode === 'month') {
                      prevMonth();
                    } else {
                      const d = safeParseDate(selectedDateStr);
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
                      const d = safeParseDate(selectedDateStr);
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
              )}
            </div>
            {viewMode !== 'history' ? (
              <>
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
              </>
            ) : (
              <div>
                {events.filter(e => e.imageUrl).length === 0 ? (
                  <div className="py-16 text-center text-stone-450 bg-stone-50/50 rounded-2xl border border-dashed border-stone-200 p-6">
                    <span className="text-4xl block mb-3 opacity-40">📸</span>
                    <p className="text-xs font-extrabold text-stone-500">スキャンしたおたよりはありません</p>
                    <p className="text-[10px] text-stone-400 mt-1.5 leading-relaxed">
                      右側の「プリントを撮る」からおたよりをスキャンすると、画像と自動抽出された予定が履歴としてここに保存されます。
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {events
                      .filter(e => e.imageUrl)
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((ev) => (
                        <div key={ev.id} className="bg-stone-50/50 border border-stone-200/60 rounded-2xl overflow-hidden hover:border-orange-300 transition flex flex-col">
                          <div className="aspect-[4/3] bg-stone-100 relative group overflow-hidden border-b border-stone-150 cursor-pointer" onClick={() => setActiveImageUrl(ev.imageUrl)}>
                            <img src={ev.imageUrl} alt={ev.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                              <span className="text-white text-[10px] font-bold bg-black/60 px-2.5 py-1.5 rounded-full">🔍 拡大表示</span>
                            </div>
                          </div>
                          <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] text-orange-400 font-extrabold">{ev.date}</span>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${ev.category === 'school' ? 'bg-sky-50 text-sky-600' : ''} ${ev.category === 'event' ? 'bg-orange-50 text-orange-600' : ''} ${ev.category === 'medical' ? 'bg-rose-50 text-rose-500' : ''}`}>
                                  {ev.category === 'school' && '学校・園'}{ev.category === 'event' && '行事'}{ev.category === 'medical' && '保健'}
                                </span>
                              </div>
                              <h4 className="font-extrabold text-stone-700 text-xs mt-1.5 line-clamp-1">{ev.title}</h4>
                              <p className="text-[10px] text-stone-400 line-clamp-2 mt-1 leading-relaxed">{ev.details || '詳細はありません'}</p>
                            </div>
                            <button 
                              onClick={() => {
                                setEditingEvent({ ...ev });
                                setIsEventModalOpen(true);
                              }}
                              className="w-full py-2 bg-white hover:bg-stone-100 border border-stone-200 text-stone-600 font-extrabold rounded-xl text-[10px] transition active:scale-95 shadow-sm"
                            >
                              {isReadOnly ? '👁️ 予定の確認（閲覧のみ）' : '✍️ 予定の確認・編集'}
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
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
                      <select 
                        value={ev.memberId || 'owner'} 
                        onChange={(e) => {
                          const val = e.target.value;
                          const m = members.find(mem => mem.id === val);
                          if (m) {
                            handleUpdateEvent(ev.id, 'color', m.color);
                            handleUpdateEvent(ev.id, 'memberId', m.id);
                          }
                        }} 
                        className="text-xs bg-stone-50 text-stone-600 px-2.5 py-1.5 rounded-lg font-bold border-none focus:ring-1 focus:ring-teal-200"
                      >
                        {members.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
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
              <div className="pt-2 space-y-3">
                <AdBanner slot="scan-result-bottom" isPremium={userStatus.isPremium} />
                <div className="flex flex-col sm:flex-row gap-3">
                  <button 
                    onClick={() => handleExportMultipleIcs(scanResult)} 
                    className="flex-1 py-3.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-extrabold rounded-xl transition active:scale-95 text-xs shadow-sm flex items-center justify-center gap-1.5"
                  >
                    📅 カレンダー一括登録 (.ics)
                  </button>
                  <button 
                    onClick={() => setScanResult(null)} 
                    className="flex-1 py-3.5 bg-teal-400 hover:bg-teal-500 text-white font-extrabold rounded-xl transition active:scale-95 text-xs shadow-sm"
                  >
                    確認完了（閉じる）
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-3xl shadow-sm shadow-stone-100/50 border border-stone-100 p-5 text-center">
            {isReadOnly && (
              <div className="mb-3.5 p-3 bg-amber-50 border border-amber-100 rounded-2xl text-[10px] text-amber-800 font-bold leading-relaxed text-left">
                🔒 共有相手が無料プランのため「閲覧専用モード」です。新規登録や予定の編集・削除は行えません。共同編集するには、カレンダー所有者がプレミアムプランに加入する必要があります。
              </div>
            )}
            <h3 className="font-bold text-stone-500 text-xs text-left mb-3">かんたん登録</h3>
            <label 
              onClick={(e) => {
                if (isReadOnly) {
                  e.preventDefault();
                  alert("現在は「閲覧専用モード」のため、新しくおたよりをスキャンして予定を追加することはできません。");
                }
              }}
              className={`w-full py-7 px-4 bg-orange-200 hover:bg-orange-300 text-orange-900 rounded-3xl font-black text-base transition-all active:scale-95 flex flex-col items-center justify-center gap-2 group cursor-pointer ${isReadOnly ? 'opacity-55 cursor-not-allowed bg-stone-200 text-stone-500 hover:bg-stone-200' : ''}`}
            >
              <span className="text-3xl group-hover:scale-110 transition-transform opacity-80">📷</span>
              <div>
                <p className="text-sm font-bold">プリントを撮る</p>
                <p className="text-[10px] text-orange-700/80 font-medium mt-1">カメラ / フォルダから選ぶ</p>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={loading || isReadOnly} />
            </label>

            <button 
              onClick={() => {
                if (isReadOnly) {
                  alert("現在は「閲覧専用モード」のため、手動で予定を追加することはできません。");
                  return;
                }
                setEditingEvent({
                  title: "",
                  date: todayStr, // 開いた当日の現在日付をデフォルトに設定
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
              className={`w-full mt-3 py-3 bg-stone-50 hover:bg-stone-100 text-stone-600 font-bold rounded-2xl text-xs transition active:scale-95 border border-stone-200 ${isReadOnly ? 'opacity-50 cursor-not-allowed hover:bg-stone-50' : ''}`}
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

                  // メンバー情報の紐付けと表示テキスト生成
                  const matchedMember = members.find(m => m.id === ev.memberId);
                  const memberLabel = matchedMember ? matchedMember.name : (colorLabels[ev.color || 'common']);
                  const badgeColorClass = colorBadgeClasses[ev.color || 'common'];

                  return (
                    <div key={ev.id} className={`p-3.5 rounded-2xl border relative group transition-all duration-250 ${cardColorClass}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex flex-wrap gap-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ev.category === 'school' ? 'bg-sky-50 text-sky-600' : ''} ${ev.category === 'event' ? 'bg-orange-50 text-orange-600' : ''} ${ev.category === 'medical' ? 'bg-rose-50 text-rose-500' : ''}`}>
                            {ev.category === 'school' && '🏫 学校・園'}{ev.category === 'event' && '🎈 行事'}{ev.category === 'medical' && '🏥 保健'}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColorClass}`}>
                            {memberLabel}
                          </span>
                        </div>
                        <div className="flex gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => {
                              setEditingEvent(ev);
                              setIsEventModalOpen(true);
                            }}
                            className="text-stone-400 hover:text-orange-400 text-xs p-1"
                            title={isReadOnly ? "予定の詳細を表示" : "予定を編集"}
                          >
                            {isReadOnly ? '👁️' : '✏️'}
                          </button>
                          {!isReadOnly && (
                            <button 
                              onClick={() => handleDeleteEvent(ev.id)}
                              className="text-stone-400 hover:text-rose-400 text-xs p-1"
                              title="予定を削除"
                            >
                              🗑️
                            </button>
                          )}
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
              {isReadOnly ? '👁️ 予定を確認する（閲覧のみ）' : (editingEvent.id ? '✏️ 予定を編集する' : '✍️ 新しい予定を追加する')}
            </h3>
            
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">カテゴリ</label>
                <select 
                  value={editingEvent.category || 'school'} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, category: e.target.value })} 
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-600 font-bold disabled:opacity-80"
                >
                  <option value="school">🏫 学校・園</option>
                  <option value="event">🎈 行事・イベント</option>
                  <option value="medical">🏥 保健・病院</option>
                </select>
              </div>
 
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">予定の対象（メンバー）</label>
                <div className="flex gap-2.5 mt-1 flex-wrap">
                  {members.map(m => {
                    let btnColor = 'bg-orange-400';
                    if (m.color === 'father') btnColor = 'bg-sky-400';
                    if (m.color === 'mother') btnColor = 'bg-rose-400';
                    if (m.color === 'child') btnColor = 'bg-emerald-400';
                    
                    const isSelected = editingEvent.memberId === m.id || (!editingEvent.memberId && m.id === 'owner');
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          if (isReadOnly) return;
                          setEditingEvent({ ...editingEvent, color: m.color, memberId: m.id });
                        }}
                        disabled={isReadOnly}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-bold text-white transition active:scale-95 ${btnColor} ${isSelected ? 'ring-2 ring-stone-850 ring-offset-1 scale-105 shadow-sm' : 'opacity-70 hover:opacity-100'} disabled:opacity-85 disabled:cursor-not-allowed`}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
 
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">日付</label>
                <input 
                  type="date" 
                  required
                  value={editingEvent.date || ''} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })} 
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-600 font-bold disabled:opacity-80"
                />
              </div>
 
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">タイトル</label>
                <input 
                  type="text" 
                  required
                  value={editingEvent.title || ''} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })} 
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-700 font-bold disabled:opacity-80"
                />
              </div>
 
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">詳細（持ち物など）</label>
                <textarea 
                  value={editingEvent.details || ''} 
                  onChange={(e) => setEditingEvent({ ...editingEvent, details: e.target.value })} 
                  disabled={isReadOnly}
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-500 font-bold h-20 resize-none disabled:opacity-80"
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
                    disabled={isReadOnly}
                    className="rounded text-orange-400 focus:ring-orange-300 focus:ring-1 border-stone-200 disabled:opacity-80"
                  />
                  予定の3日前に通知 (19:00)
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600 font-bold cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={editingEvent.remindOneDay || false} 
                    onChange={(e) => setEditingEvent({ ...editingEvent, remindOneDay: e.target.checked })} 
                    disabled={isReadOnly}
                    className="rounded text-orange-400 focus:ring-orange-300 focus:ring-1 border-stone-200 disabled:opacity-80"
                  />
                  予定の前日に通知 (19:00)
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-600 font-bold cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={editingEvent.remindCustom || false} 
                    onChange={(e) => setEditingEvent({ ...editingEvent, remindCustom: e.target.checked })} 
                    disabled={isReadOnly}
                    className="rounded text-orange-400 focus:ring-orange-300 focus:ring-1 border-stone-200 disabled:opacity-80"
                  />
                  日時を指定して通知
                </label>
                {editingEvent.remindCustom && (
                  <input 
                    type="datetime-local" 
                    value={editingEvent.customRemindAt || ""} 
                    onChange={(e) => setEditingEvent({ ...editingEvent, customRemindAt: e.target.value })} 
                    disabled={isReadOnly}
                    className="w-full mt-1 px-3 py-2 text-xs bg-white border border-stone-200 rounded-xl focus:outline-none focus:border-orange-300 focus:ring-1 focus:ring-orange-300 transition text-stone-600 font-bold disabled:opacity-80"
                  />
                )}
              </div>
            </div>
 
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-2 w-full">
                {!isReadOnly ? (
                  <>
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
                  </>
                ) : (
                  <button 
                    type="button"
                    onClick={() => {
                      setIsEventModalOpen(false);
                      setEditingEvent(null);
                    }}
                    className="w-full bg-stone-200 hover:bg-stone-300 text-stone-700 font-bold py-3.5 rounded-xl text-xs transition active:scale-95 shadow-sm"
                  >
                    確認を閉じる
                  </button>
                )}
              </div>
              
              {editingEvent.id && (
                <button 
                  type="button"
                  onClick={() => handleExportSingleIcs(editingEvent)}
                  className="w-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-extrabold py-3.5 rounded-xl text-xs transition active:scale-95 shadow-sm flex items-center justify-center gap-1.5"
                >
                  📅 カレンダーに追加 (.ics)
                </button>
              )}
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

      {/* iOS PWA ホーム追加ガイドモーダル */}
      {showIosPwaGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-md animate-fadeIn" onClick={() => setShowIosPwaGuide(false)}>
          <div className="max-w-sm w-full bg-white rounded-3xl overflow-hidden shadow-2xl p-6 animate-scaleIn" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-16 h-16 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">📲</div>
              <h3 className="text-lg font-black text-stone-800 mb-2">iOSで通知を受け取るには</h3>
              <p className="text-xs text-stone-500 leading-relaxed mb-6">
                iPhone / iPad などの iOS 端末でプッシュ通知を利用するには、アプリをホーム画面に追加する必要があります。
              </p>
              
              <div className="space-y-4 text-left text-xs text-stone-600 mb-6 bg-stone-50 p-4 rounded-2xl border border-stone-100">
                <div className="flex gap-3 items-start">
                  <span className="w-5 h-5 bg-orange-400 text-white rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">1</span>
                  <span>Safariブラウザ下部（または上部）の<strong>「共有ボタン（正方形に上矢印のアイコン）」</strong>をクリックします。</span>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="w-5 h-5 bg-orange-400 text-white rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">2</span>
                  <span>メニュー内の<strong>「ホーム画面に追加」</strong>をタップします。</span>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="w-5 h-5 bg-orange-400 text-white rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">3</span>
                  <span>ホーム画面に作成されたアプリアイコンから<strong>起動し直し</strong>、通知をオンに設定してください。</span>
                </div>
              </div>

              <button 
                onClick={() => setShowIosPwaGuide(false)}
                className="w-full bg-orange-400 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl transition active:scale-95 shadow-sm text-sm"
              >
                了解しました
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 設定・家族管理モーダル */}
      {isSettingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-fadeIn" onClick={() => setIsSettingModalOpen(false)}>
          <div 
            className="bg-[#FDFBF9] border border-orange-100 rounded-3xl p-6 max-w-md w-full shadow-2xl animate-scaleIn text-left space-y-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200/50 pb-3">
              <h3 className="text-base font-extrabold text-stone-800 tracking-tight">⚙️ 設定・家族管理</h3>
              <button 
                onClick={() => setIsSettingModalOpen(false)} 
                className="text-stone-400 hover:text-stone-600 font-bold"
              >
                ✕
              </button>
            </div>

            {/* 👑 プランステータス */}
            <div className="bg-white p-4.5 rounded-2xl border border-stone-150/70 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-stone-400 block">現在のプラン</span>
                {userStatus.isPremium ? (
                  <span className="text-sm font-black text-amber-600 flex items-center gap-1 mt-0.5">👑 プレミアム会員（使い放題）</span>
                ) : (
                  <span className="text-sm font-black text-stone-600 flex items-center gap-1 mt-0.5">無料プラン（残りスキャン {userStatus.remainingScans}回）</span>
                )}
              </div>
              {!userStatus.isPremium && (
                <button 
                  onClick={() => {
                    setIsSettingModalOpen(false);
                    handleUpgrade();
                  }}
                  disabled={loading}
                  className="text-[10px] bg-gradient-to-r from-orange-400 to-amber-400 hover:from-orange-500 hover:to-amber-500 text-white px-3 py-2 rounded-xl font-extrabold shadow-sm transition active:scale-95 disabled:opacity-50"
                >
                  無制限にする
                </button>
              )}
            </div>

            {/* 👪 家族メンバー管理 */}
            <div className="space-y-3.5">
              <div>
                <h4 className="text-xs font-black text-stone-700">👪 メンバーの登録と色分け</h4>
                <p className="text-[10px] text-stone-400 leading-relaxed mt-0.5">
                  カレンダー上で予定を色分け表示するためのメンバーを登録します。（無料プラン：最大2名まで）
                </p>
              </div>

              {/* メンバー一覧リスト */}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {members.map(m => {
                  let badgeColor = 'bg-orange-400';
                  if (m.color === 'father') badgeColor = 'bg-sky-400';
                  if (m.color === 'mother') badgeColor = 'bg-rose-400';
                  if (m.color === 'child') badgeColor = 'bg-emerald-400';
                  return (
                    <div key={m.id} className="flex items-center justify-between bg-stone-50 border border-stone-150 p-2.5 rounded-xl text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${badgeColor}`}></span>
                        <span className="font-bold text-stone-700">{m.name}</span>
                      </div>
                      {m.id !== 'owner' && !isReadOnly ? (
                        <button 
                          onClick={() => handleRemoveMember(m.id)}
                          className="text-[10px] text-rose-500 hover:text-rose-700 font-bold px-2 py-1 bg-white border border-stone-200 rounded-lg transition shadow-sm"
                        >
                          削除
                        </button>
                      ) : (
                        <span className="text-[9px] text-stone-400 font-bold px-2 py-1 bg-stone-100 rounded-lg">
                          {m.id === 'owner' ? '管理者' : '閲覧のみ'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* メンバー追加フォーム */}
              {!isReadOnly ? (
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddMember(newMemberName, newMemberColor);
                  }} 
                  className="bg-white p-3.5 rounded-2xl border border-stone-100/80 shadow-sm space-y-3"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="text" 
                      placeholder="例: ママ、長男" 
                      required
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:border-orange-300 transition text-stone-700 font-bold w-full"
                    />
                    <select 
                      value={newMemberColor}
                      onChange={(e) => setNewMemberColor(e.target.value as any)}
                      className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:border-orange-300 transition text-stone-600 font-bold"
                    >
                      <option value="common">👪 共通（オレンジ）</option>
                      <option value="father">👨 パパ（青）</option>
                      <option value="mother">👩 ママ（赤）</option>
                      <option value="child">👶 子供（緑）</option>
                    </select>
                  </div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full py-2 bg-orange-400 hover:bg-orange-500 text-white font-extrabold text-[11px] rounded-xl transition active:scale-95 disabled:opacity-50 shadow-sm"
                  >
                    新しいメンバーを追加する
                  </button>
                </form>
              ) : (
                <div className="p-3 bg-amber-50/60 border border-amber-100 rounded-2xl text-[10px] text-amber-800 font-bold leading-relaxed text-center">
                  ⚠️ 「閲覧専用モード」のため、メンバーの追加・編集はカレンダー所有者側のみ行えます。
                </div>
              )}
            </div>

            {/* 🔗 家族カレンダー共有（アカウント連携） */}
            <div className="space-y-3.5 border-t border-stone-100 pt-4">
              <div>
                <h4 className="text-xs font-black text-stone-700">🔗 カレンダー共有（家族シェア）</h4>
                <p className="text-[10px] text-stone-400 leading-relaxed mt-0.5">
                  招待コードを用いてパートナーとカレンダーを同期します。（無料プランは閲覧専用として1名連携可能。共同編集にはカレンダー所有者のプレミアムプラン加入が必要）
                </p>
              </div>

              {user && userStatus.groupId && userStatus.groupId !== user.uid ? (
                <div className="space-y-3">
                  <div className="bg-teal-50 border border-teal-100 text-teal-800 text-[11px] p-3 rounded-2xl font-bold flex items-center justify-between shadow-sm">
                    <span>👪 家族共有モードで同期中</span>
                    <button 
                      onClick={() => {
                        setIsSettingModalOpen(false);
                        handleUnlinkGroup();
                      }}
                      className="text-[9px] text-stone-500 hover:text-rose-500 bg-white border border-stone-200 px-2 py-1 rounded-lg font-bold transition shadow-sm"
                    >
                      解除
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-stone-50 border border-stone-150 p-3.5 rounded-2xl flex items-center justify-between">
                    <div>
                      <p className="text-[9px] text-stone-400 font-bold">あなたの招待コード</p>
                      <span className="text-sm font-black text-stone-700 tracking-wider select-all mt-0.5 block">{userStatus.inviteCode || '生成中...'}</span>
                    </div>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(userStatus.inviteCode);
                        alert("招待コードをコピーしました！パートナーへ送信してください。");
                      }}
                      className="text-[10px] bg-white hover:bg-stone-100 border border-stone-200 text-stone-600 font-bold px-2.5 py-1.5 rounded-lg transition shadow-sm"
                    >
                      コピー
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-[9px] text-stone-400 font-bold">パートナーのコードを入力して連携</p>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const input = form.elements.namedItem('inviteCode') as HTMLInputElement;
                      setIsSettingModalOpen(false);
                      handleLinkGroup(input.value);
                    }} className="flex gap-2">
                      <input 
                        name="inviteCode"
                        type="text" 
                        placeholder="例: AB12CD34" 
                        required
                        className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs focus:outline-none focus:border-orange-300 transition font-bold"
                      />
                      <button 
                        type="submit"
                        disabled={loading}
                        className="bg-orange-400 hover:bg-orange-500 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl transition active:scale-95 disabled:opacity-50 shadow-sm"
                      >
                        連携
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>

            <button 
              onClick={() => setIsSettingModalOpen(false)}
              className="w-full bg-stone-100 hover:bg-stone-200 text-stone-600 font-extrabold py-3.5 rounded-xl text-xs transition active:scale-95"
            >
              設定を閉じる
            </button>
          </div>
        </div>
      )}

      {/* ログイン後共通フッター */}
      <footer className="w-full max-w-5xl mx-auto mt-16 px-4 py-8 border-t border-stone-100 text-center text-stone-400 text-xs space-x-4">
        <span>&copy; 2026 おたよりカレンダー</span>
        <Link href="/terms" className="hover:text-orange-400 transition hover:underline">利用規約</Link>
        <Link href="/privacy" className="hover:text-orange-400 transition hover:underline">プライバシーポリシー</Link>
      </footer>
    </div>
  );
}