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
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  where
} from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';
import { useFcm } from '../hooks/useFcm';
import AdBanner from '../components/ads/AdBanner';
import { trackEvent, GA_EVENTS } from '../lib/gtag';
import Link from 'next/link';
import { generateIcsString, downloadIcsFile } from '../lib/ics';

// Safari対策ヘルパー
const safeParseDate = (dateStr: string | null | undefined): Date => {
  if (!dateStr) return new Date();
  const sanitized = dateStr.includes('-') && !dateStr.includes('T')
    ? dateStr.replace(/-/g, '/')
    : dateStr;
  return new Date(sanitized);
};

export type MemberColor = 'orange' | 'blue' | 'red' | 'green' | 'yellow' | 'purple' | 'pink' | 'gray';
export const COLOR_PALETTE: { id: MemberColor; name: string; bgClass: string; textClass: string; badgeClass: string; cardClass: string; circleClass: string }[] = [
  { id: 'orange', name: 'オレンジ', bgClass: 'bg-orange-450 hover:bg-orange-500', textClass: 'text-orange-700', badgeClass: 'bg-orange-50 border-orange-100 text-orange-700', cardClass: 'bg-orange-50/15 border-orange-100/60', circleClass: 'bg-orange-400' },
  { id: 'blue', name: 'ブルー', bgClass: 'bg-sky-400 hover:bg-sky-500', textClass: 'text-sky-700', badgeClass: 'bg-sky-50 border-sky-100 text-sky-700', cardClass: 'bg-sky-50/20 border-sky-100/60', circleClass: 'bg-sky-400' },
  { id: 'red', name: 'レッド', bgClass: 'bg-rose-400 hover:bg-rose-500', textClass: 'text-rose-700', badgeClass: 'bg-rose-50 border-rose-100 text-rose-700', cardClass: 'bg-rose-50/20 border-rose-100/60', circleClass: 'bg-rose-455' },
  { id: 'green', name: 'グリーン', bgClass: 'bg-emerald-450 hover:bg-emerald-500', textClass: 'text-emerald-700', badgeClass: 'bg-emerald-50 border-emerald-100 text-emerald-700', cardClass: 'bg-emerald-50/20 border-emerald-100/60', circleClass: 'bg-emerald-400' },
  { id: 'yellow', name: 'イエロー', bgClass: 'bg-amber-400 hover:bg-amber-500', textClass: 'text-amber-700', badgeClass: 'bg-amber-50 border-amber-100 text-amber-700', cardClass: 'bg-amber-50/20 border-amber-100/60', circleClass: 'bg-amber-400' },
  { id: 'purple', name: 'パープル', bgClass: 'bg-violet-400 hover:bg-violet-500', textClass: 'text-violet-700', badgeClass: 'bg-violet-50 border-violet-100 text-violet-700', cardClass: 'bg-violet-50/20 border-violet-100/60', circleClass: 'bg-violet-400' },
  { id: 'pink', name: 'ピンク', bgClass: 'bg-pink-400 hover:bg-pink-500', textClass: 'text-pink-700', badgeClass: 'bg-pink-50 border-pink-100 text-pink-700', cardClass: 'bg-pink-50/20 border-pink-100/60', circleClass: 'bg-pink-400' },
  { id: 'gray', name: 'グレー', bgClass: 'bg-stone-400 hover:bg-stone-500', textClass: 'text-stone-700', badgeClass: 'bg-stone-50 border-stone-200 text-stone-700', cardClass: 'bg-stone-50/25 border-stone-200/60', circleClass: 'bg-stone-400' }
];

export default function Home() {
  // --- 認証関連のState ---
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // メールアドレス・パスワード認証用State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [joinInviteCode, setJoinInviteCode] = useState('');

  // --- カレンダー関連のState ---
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [currentDate, setCurrentDate] = useState(today);
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayStr);
  const [events, setEvents] = useState<any[]>([]);
  const [isSettingModalOpen, setIsSettingModalOpen] = useState(false);

  // メンバー管理関連のState
  const [members, setMembers] = useState<any[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberColor, setNewMemberColor] = useState<MemberColor>('orange');
  const [selectedMemberFilterId, setSelectedMemberFilterId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [editingMemberColor, setEditingMemberColor] = useState<MemberColor>('orange');

  const [isReadOnly, setIsReadOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'history'>('month');
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState<any[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState({ isPremium: false, remainingScans: 10, maxScans: 10, groupId: '', inviteCode: '', externalSyncEnabled: false, syncToken: '' });
  const [isLimitModalOpen, setIsLimitModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);
  const [isScanConfirmModalOpen, setIsScanConfirmModalOpen] = useState(false);
  const [newScannedEvents, setNewScannedEvents] = useState<any[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(true);

  const {
    permissionStatus,
    requestPermission,
    loading: fcmLoading,
    error: fcmError,
    showIosPwaGuide,
    setShowIosPwaGuide
  } = useFcm(user?.uid);

  // --- API連携および機能関数 ---
  const refetchEvents = async () => {
    if (!user) {
      setEvents([]);
      setIsEventsLoading(false);
      return;
    }
    try {
      const userDocSnap = await getDoc(doc(db, 'users', user.uid));
      let currentGroupId = '';
      let currentInviteCode = '';
      let isPremium = false;
      let remainingScans = 10;
      let externalSyncEnabled = false;
      let syncToken = '';

      if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        isPremium = userData.plan === 'premium';
        currentGroupId = userData.groupId || user.uid;
        currentInviteCode = userData.inviteCode || '';
        externalSyncEnabled = userData.externalSyncEnabled || false;
        syncToken = userData.syncToken || '';

        const now = new Date();
        const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const currentMonthStr = `${jstDate.getFullYear()}-${String(jstDate.getMonth() + 1).padStart(2, '0')}`;
        const lastScanMonth = userData.lastScanMonth || '';
        const scanCount = lastScanMonth === currentMonthStr ? (userData.scanCount || 0) : 0;
        remainingScans = isPremium ? 9999 : Math.max(0, 10 - scanCount);

        if (!syncToken) {
          syncToken = 'tok_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          await setDoc(doc(db, 'users', user.uid), { syncToken }, { merge: true });
        }

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
        let assignedGroupId = user.uid;
        const pendingInviteCode = localStorage.getItem('pendingInviteCode');

        if (pendingInviteCode) {
          try {
            const q = query(collection(db, 'users'), where('inviteCode', '==', pendingInviteCode));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
              const partnerDoc = querySnapshot.docs[0];
              assignedGroupId = partnerDoc.data().groupId || partnerDoc.id;
            }
          } catch (e) { console.error(e); }
          localStorage.removeItem('pendingInviteCode');
        }

        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        const generatedToken = 'tok_' + Math.random().toString(36).substring(2, 15);
        currentGroupId = assignedGroupId;
        currentInviteCode = code;
        syncToken = generatedToken;
        await setDoc(doc(db, 'users', user.uid), {
          plan: 'free',
          scanCount: 0,
          groupId: assignedGroupId,
          inviteCode: code,
          externalSyncEnabled: false,
          syncToken: generatedToken,
          createdAt: new Date().toISOString()
        });
      }

      if (!currentGroupId) {
        setIsEventsLoading(false);
        return;
      }

      const querySnapshot = await getDocs(collection(db, `groups/${currentGroupId}/events`));
      const fetchedEvents: any[] = [];
      querySnapshot.forEach((doc) => {
        fetchedEvents.push({ id: doc.id, ...doc.data() });
      });
      setEvents(fetchedEvents);

      const groupOwnerSnap = await getDoc(doc(db, 'users', currentGroupId));
      let groupMembers: any[] = [];
      let groupOwnerPlan = 'free';
      if (groupOwnerSnap.exists()) {
        const ownerData = groupOwnerSnap.data();
        groupMembers = ownerData.members || [];
        groupOwnerPlan = ownerData.plan || 'free';
      }
      if (groupMembers.length === 0) {
        groupMembers = [{ id: 'owner', name: 'パパ', color: 'orange' }];
        await setDoc(doc(db, 'users', currentGroupId), { members: groupMembers }, { merge: true });
      }
      setMembers(groupMembers);

      const readOnlyState = (currentGroupId !== user.uid) && (groupOwnerPlan !== 'premium');
      setIsReadOnly(readOnlyState);
      setUserStatus({
        isPremium,
        remainingScans,
        maxScans: 10,
        groupId: currentGroupId,
        inviteCode: currentInviteCode,
        externalSyncEnabled,
        syncToken
      });
      setIsEventsLoading(false);
    } catch (error: any) {
      console.error(error);
      setIsEventsLoading(false);
    }
  };

  const savePendingInviteCode = () => {
    if (inviteCodeInput.trim()) {
      localStorage.setItem('pendingInviteCode', inviteCodeInput.trim().toUpperCase());
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    savePendingInviteCode();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked' || error.message?.includes('popup')) {
        await signInWithRedirect(auth, googleProvider);
      } else {
        setAuthError("Googleでのログインに失敗しました。");
      }
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    savePendingInviteCode();
    try {
      if (isSignUpMode) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;
        let assignedGroupId = newUser.uid;
        if (inviteCodeInput.trim()) {
          const q = query(collection(db, 'users'), where('inviteCode', '==', inviteCodeInput.trim().toUpperCase()));
          const snap = await getDocs(q);
          if (!snap.empty) {
            assignedGroupId = snap.docs[0].data().groupId || snap.docs[0].id;
          }
        }
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        const generatedToken = 'tok_' + Math.random().toString(36).substring(2, 15);
        await setDoc(doc(db, 'users', newUser.uid), {
          plan: 'free',
          scanCount: 0,
          groupId: assignedGroupId,
          inviteCode: code,
          externalSyncEnabled: false,
          syncToken: generatedToken,
          createdAt: new Date().toISOString()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      setAuthError("認証に失敗しました。入力内容をご確認ください。");
    }
  };

  const handleToggleExternalSync = async (enabled: boolean) => {
    if (!user) return;
    try {
      setLoading(true);
      await setDoc(doc(db, 'users', user.uid), { externalSyncEnabled: enabled }, { merge: true });
      setUserStatus(prev => ({ ...prev, externalSyncEnabled: enabled }));
    } catch (err) {
      alert("カレンダー同期設定の変更に失敗しました💦");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (confirm("ログアウトしますか？")) {
      await signOut(auth);
      setEvents([]);
      setEmail('');
      setPassword('');
    }
  };

  const saveEventToBackend = async (evt: any) => {
    if (!user) return;
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.uid, groupId: userStatus.groupId || user.uid, action: 'save', event: evt })
    });
    if (!response.ok) throw new Error('予定の保存に失敗しました');
  };

  const handleSaveModalEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingEvent) return;
    try {
      setLoading(true);

      const eventsToSave: any[] = [];
      const isNewEvent = !editingEvent.id;
      const baseEventId = editingEvent.id || `manual-${Date.now()}`;

      // 基本の予定データを作成
      const baseEvent = {
        ...editingEvent,
        id: baseEventId,
        isNotificationEnabled: editingEvent.isNotificationEnabled !== false, // トグルの値を確実に反映
        memo: (editingEvent.memo || '').trim() // メモの値を確実に反映
      };
      
      eventsToSave.push(baseEvent);

      // 新規作成時かつ繰り返し設定がある場合
      if (
        isNewEvent &&
        editingEvent.recurrence &&
        editingEvent.recurrence !== 'none'
      ) {
        const count = editingEvent.recurrenceCount || 2;
        const interval = editingEvent.recurrence;
        const baseDate = new Date(editingEvent.date.replace(/-/g, '/'));

        for (let i = 1; i < count; i++) {
          const nextDate = new Date(baseDate);
          if (interval === 'daily') {
            nextDate.setDate(baseDate.getDate() + i);
          } else if (interval === 'weekly') {
            nextDate.setDate(baseDate.getDate() + i * 7);
          } else if (interval === 'monthly') {
            nextDate.setMonth(baseDate.getMonth() + i);
          }

          const y = nextDate.getFullYear();
          const m = String(nextDate.getMonth() + 1).padStart(2, '0');
          const d = String(nextDate.getDate()).padStart(2, '0');
          const nextDateStr = `${y}-${m}-${d}`;

          eventsToSave.push({
            ...baseEvent,
            id: `manual-${Date.now()}-${i}`,
            date: nextDateStr
          });
        }
      }

      // APIに送信して一括保存
      await Promise.all(eventsToSave.map(evt => saveEventToBackend(evt)));

      await refetchEvents();
      setIsEventModalOpen(false);
      setEditingEvent(null);
    } catch (err) {
      alert("予定の保存に失敗しました💦");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm("この予定を削除しますか？")) return;
    setEvents(prev => prev.filter(ev => ev.id !== id));
    if (user) {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, groupId: userStatus.groupId || user.uid, action: 'delete', event: { id } })
      });
      await refetchEvents();
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!user || memberId === 'owner') return;
    if (!confirm("このメンバーを削除しますか？")) return;
    const updatedMembers = members.filter(m => m.id !== memberId);
    setLoading(true);
    try {
      await setDoc(doc(db, 'users', userStatus.groupId || user.uid), { members: updatedMembers }, { merge: true });
      setMembers(updatedMembers);
      if (selectedMemberFilterId === memberId) setSelectedMemberFilterId(null);
      alert("メンバーを削除しました。");
    } catch (err) {
      alert("メンバーの削除に失敗しました。💦");
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (name: string, color: MemberColor) => {
    if (!user || !name.trim()) return;
    if (!userStatus.isPremium && members.length >= 2) {
      alert("無料プランではメンバー登録数は「2名まで」に制限されています。");
      setIsLimitModalOpen(true);
      return;
    }
    const newMember = { id: `member-${Date.now()}`, name: name.trim(), color: color };
    const updatedMembers = [...members, newMember];
    setLoading(true);
    try {
      await setDoc(doc(db, 'users', userStatus.groupId || user.uid), { members: updatedMembers }, { merge: true });
      setMembers(updatedMembers);
      setNewMemberName('');
      alert("家族メンバーを追加しました！🎉");
    } catch (err) {
      alert("メンバーの追加に失敗しました。💦");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEditedMember = async (memberId: string) => {
    if (!user || !editingMemberName.trim()) return;
    setLoading(true);
    try {
      const updatedMembers = members.map(m => m.id === memberId ? { ...m, name: editingMemberName.trim(), color: editingMemberColor } : m);
      await setDoc(doc(db, 'users', userStatus.groupId || user.uid), { members: updatedMembers }, { merge: true });
      setMembers(updatedMembers);
      setEditingMemberId(null);
      alert("メンバー情報を更新しました！✨");
    } catch (err) {
      alert("更新に失敗しました💦");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !joinInviteCode.trim()) return;

    setLoading(true);
    try {
      const targetCode = joinInviteCode.trim().toUpperCase();

      // 1. 自分自身の招待コードと同じ場合はエラー
      if (targetCode === userStatus.inviteCode) {
        alert("自分自身の招待コードは使用できません💦");
        setLoading(false);
        return;
      }

      // 2. 招待コードに一致するユーザーを検索
      const q = query(collection(db, 'users'), where('inviteCode', '==', targetCode));
      const snap = await getDocs(q);

      if (snap.empty) {
        alert("無効な招待コードです。入力内容をご確認ください😢");
        setLoading(false);
        return;
      }

      const partnerDoc = snap.docs[0];
      const partnerData = partnerDoc.data();
      const targetGroupId = partnerData.groupId || partnerDoc.id;

      // 3. 自分の groupId を更新
      await setDoc(doc(db, 'users', user.uid), { groupId: targetGroupId }, { merge: true });

      // 4. 元々持っていた孤立した空の初期グループデータ（旧 groupId = user.uid のイベントデータ）をクリーンアップ
      // ※ もし自分がすでにそのグループの所有者であり、かつ別のグループへ移行する場合、旧グループのイベントデータを削除する
      if (userStatus.groupId === user.uid && targetGroupId !== user.uid) {
        try {
          const oldEventsSnap = await getDocs(collection(db, `groups/${user.uid}/events`));
          const batch = writeBatch(db);
          oldEventsSnap.forEach((doc) => {
            batch.delete(doc.ref);
          });
          await batch.commit();
          console.log(`[handleJoinGroup] Cleaned up ${oldEventsSnap.size} events from old group ${user.uid}`);
        } catch (cleanErr) {
          console.error("[handleJoinGroup] Failed to clean up old events:", cleanErr);
        }
      }

      alert("家族のグループに参加しました！🎉");
      setJoinInviteCode('');
      setIsSettingModalOpen(false);

      // 最新のグループデータとカレンダーを再取得
      await refetchEvents();
    } catch (err: any) {
      console.error(err);
      alert("家族グループへの参加に失敗しました。時間をおいて再度お試しください💦");
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async () => {
    try {
      setLoading(true);
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログインしていません。');
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.url) window.location.href = data.url;
    } catch (error: any) {
      alert("Stripe決済画面の生成中にエラーが発生しました💦");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPortal = async () => {
    try {
      setLoading(true);
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログインしていません。');
      const response = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'ポータルの起動に失敗しました💦');
      }
    } catch (error: any) {
      alert('サブスクリプション管理画面の起動中にエラーが発生しました💦');
    } finally {
      setLoading(false);
    }
  };

  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const maxLen = 1600;
        let width = img.width;
        let height = img.height;
        if (width > maxLen || height > maxLen) {
          if (width > height) { height = Math.round((height * maxLen) / width); width = maxLen; }
          else { width = Math.round((width * maxLen) / height); height = maxLen; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } else {
          resolve(base64Str);
        }
      };
      img.onerror = () => resolve(base64Str);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const incomingCount = files.length;
    if (!userStatus.isPremium && incomingCount > userStatus.remainingScans) {
      alert(`選択された画像は ${incomingCount} 枚ですが、今月の残り可能枚数は ${userStatus.remainingScans} 枚です😢`);
      return;
    }

    setLoading(true);
    setScanResult(null);
    setNewScannedEvents([]);
    setErrorMessage(null);

    try {
      const base64Images: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
        });
        const compressed = await compressImage(base64);
        base64Images.push(compressed);
      }

      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: base64Images, userId: user?.uid }),
      });
      const data = await response.json();
      if (response.ok) {
        setNewScannedEvents(data.events || []);
        setIsScanConfirmModalOpen(true);
        setUserStatus(prev => ({ ...prev, remainingScans: data.remaining }));
      } else {
        if (response.status === 403) setIsLimitModalOpen(true);
        else setErrorMessage(data.error || "おたよりの読み込みに失敗しました😢");
      }
    } catch (err: any) {
      setErrorMessage("通信に失敗しました。再度お試しください💦");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;
    refetchEvents();
  }, [user, isAuthLoading]);

  useEffect(() => {
    getRedirectResult(auth).catch(() => {
      setAuthError("Googleログインに失敗しました。再度お試しください。");
    });
  }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarCells = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarCells.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarCells.push(new Date(year, month, i));

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const getWeekCells = () => {
    const selected = safeParseDate(selectedDateStr);
    const dayOfWeek = selected.getDay();
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

  const filteredEvents = events
    .filter(e => !selectedMemberFilterId || e.memberId === selectedMemberFilterId)
    .filter(e => e.date === selectedDateStr);

  const getSyncUrl = () => {
    if (typeof window === 'undefined' || !userStatus.syncToken) return '';
    return `${window.location.origin.replace(/^https:/, 'webcal:')}/api/calendar.ics?token=${userStatus.syncToken}`;
  };

  if (isAuthLoading) {
    return <div className="min-h-screen bg-[#FDFBF9] flex items-center justify-center font-sans text-stone-500">読み込み中...</div>;
  }

  // ==========================================
  // 未ログイン時画面（ログイン・バイラルUI）
  // ==========================================
  if (!user) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex flex-col items-center justify-center font-sans text-stone-700 p-4 py-10">
        <div className="w-20 h-20 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 font-bold text-4xl mb-6 shadow-sm">お</div>
        <h1 className="text-2xl font-extrabold text-stone-800 mb-2">おたよりカレンダー</h1>
        <p className="text-sm text-stone-500 mb-8 text-center max-w-xs leading-relaxed">
          園や学校のプリントをパシャッと撮るだけ。<br />AIが予定を自動でカレンダーに登録します。
        </p>

        <div className="w-full max-w-sm bg-white p-6 rounded-3xl shadow-sm border border-stone-100">
          <div className="flex border-b border-stone-100 mb-6">
            <button type="button" onClick={() => { setIsSignUpMode(false); setAuthError(null); }} className={`flex-1 pb-3 text-sm font-extrabold border-b-2 text-center transition-all ${!isSignUpMode ? 'border-orange-400 text-stone-800' : 'border-transparent text-stone-400 hover:text-stone-600'}`}>ログイン</button>
            <button type="button" onClick={() => { setIsSignUpMode(true); setAuthError(null); }} className={`flex-1 pb-3 text-sm font-extrabold border-b-2 text-center transition-all ${isSignUpMode ? 'border-orange-400 text-stone-800' : 'border-transparent text-stone-400 hover:text-stone-600'}`}>新規登録</button>
          </div>

          <div className="mb-6 bg-orange-50/50 p-3 rounded-xl border border-orange-100">
            <label className="text-[10px] font-bold text-orange-800 mb-1.5 block">👪 家族カレンダーに参加する（任意）</label>
            <input
              type="text"
              placeholder="招待コードを入力"
              value={inviteCodeInput}
              onChange={(e) => setInviteCodeInput(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-orange-200 rounded-lg text-sm focus:outline-none focus:border-orange-400 transition"
            />
            <p className="text-[9px] text-orange-600 mt-1">※コードを入力した状態で、下のボタンからログインしてください</p>
          </div>

          {authError && <div className="mb-4 p-3 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl border border-rose-100 text-center">{authError}</div>}

          <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
            <div><input type="email" placeholder="メールアドレス" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-orange-300 transition" /></div>
            <div><input type="password" placeholder="パスワード（6文字以上）" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-orange-300 transition" /></div>
            <button type="submit" className="w-full bg-orange-400 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl transition shadow-sm">
              {isSignUpMode ? '新規アカウントを作成' : 'ログイン'}
            </button>
          </form>

          <div className="relative flex items-center justify-center mb-6">
            <div className="border-t border-stone-200 w-full"></div>
            <span className="bg-white px-3 text-xs text-stone-400 absolute">または</span>
          </div>

          <button type="button" onClick={handleGoogleLogin} className="w-full bg-white border border-stone-200 shadow-sm hover:bg-stone-50 text-stone-700 font-extrabold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 transition text-sm mb-2">
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" /></svg>
            <span>Googleで続ける</span>
          </button>
        </div>

        {/* 料金案内 */}
        <div className="w-full max-w-sm mt-6 rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
          <div className="bg-stone-50 px-4 py-2 border-b border-stone-200">
            <p className="text-[10px] font-extrabold text-stone-500 text-center tracking-wider">📋 プラン比較</p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-stone-200">
            <div className="p-4 text-center space-y-1">
              <p className="text-[10px] font-extrabold text-stone-500">無料プラン</p>
              <p className="text-lg font-black text-stone-700">¥0</p>
              <p className="text-[9px] text-stone-400 leading-relaxed">月10枚まで<br />スキャン可能</p>
            </div>
            <div className="p-4 text-center space-y-1 bg-amber-50/60">
              <p className="text-[10px] font-extrabold text-amber-600">👑 プレミアム</p>
              <p className="text-lg font-black text-amber-700">¥300<span className="text-xs font-bold">/月</span></p>
              <p className="text-[9px] text-amber-600 leading-relaxed">スキャン無制限<br />家族共有・同期</p>
            </div>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 mt-4 text-center shadow-sm w-full max-w-sm">
          <p className="text-orange-800 font-bold text-sm mb-2">🚀 ユーザー増加でアプリ化決定!?</p>
          <p className="text-stone-600 text-xs mb-4 leading-relaxed">
            現在はWeb版のみですが、ご利用者が増えればiOS/Androidアプリの開発をスタートします！ぜひ周りの方にもシェアして応援してください📣
          </p>
          <div className="flex justify-center gap-3">
            {(() => {
              const viralText = `子どものプリント管理、限界じゃない？😂\n写真を撮るだけでAIがカレンダーに自動登録＆提出物をリマインドしてくれる神アプリ見つけた！📸📆\nhttps://otayori-calendar-owfg.vercel.app`;
              const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(viralText)}`;
              const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(viralText)}`;
              return (
                <>
                  <a href={twitterUrl} target="_blank" rel="noopener noreferrer" className="bg-black text-white px-4 py-2.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 hover:bg-stone-800 transition shadow-sm">
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                    𝕏 ポスト
                  </a>
                  <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="bg-[#06C755] text-white px-4 py-2.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 hover:bg-[#05b04a] transition shadow-sm">
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M22.5 10.1c0-4.3-4.1-7.8-9.2-7.8-5.1 0-9.2 3.5-9.2 7.8 0 3.8 2.6 7 6.3 7.6.2.1.6.2.7.5.1.2 0 .7 0 .7s-.2 1-.2 1.3c0 .3-.1 .7.4.9.4.1 1.7-.8 3.5-2.2 2.6-1.9 4-3.8 4.6-4.6.4-1 .8-2.3.8-3.7z" /></svg>
                    LINEで送る
                  </a>
                </>
              );
            })()}
          </div>
        </div>

        {/* フッター */}
        <footer className="w-full text-center py-6 text-[10px] text-stone-400 mt-10 border-t border-stone-200/40 space-x-3">
          <Link href="/about" className="hover:underline font-bold">運営者情報</Link>
          <span className="text-stone-300">|</span>
          <Link href="/contact" className="hover:underline font-bold">お問い合わせ</Link>
          <span className="text-stone-300">|</span>
          <Link href="/terms" className="hover:underline font-bold">利用規約</Link>
          <span className="text-stone-300">|</span>
          <Link href="/privacy" className="hover:underline font-bold">プライバシーポリシー</Link>
          <p className="mt-2 text-stone-300">&copy; {new Date().getFullYear()} おたよりカレンダー</p>
        </footer>
      </div>
    );
  }

  // ==========================================
  // メイン画面
  // ==========================================
  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-600 antialiased pb-24">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-100 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-9 h-9 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 font-bold text-lg shrink-0">お</div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-stone-700 tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">おたよりカレンダー</h1>
              <p className="text-[9px] sm:text-[10px] text-stone-400 font-medium -mt-0.5 whitespace-nowrap">プリントを撮るだけ自動登録</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-2">
            {!userStatus.isPremium ? (
              <button onClick={handleUpgrade} disabled={loading} className="text-[10px] bg-gradient-to-r from-orange-400 to-amber-400 text-white px-3 py-1.5 rounded-full font-extrabold shadow-sm transition active:scale-95 disabled:opacity-50">
                {loading ? '接続中...' : '👑 プレミアムにする'}
              </button>
            ) : (
              <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-600 px-2.5 py-1.5 rounded-full font-extrabold">👑 プレミアム会員</span>
            )}
            <button onClick={() => setIsSettingModalOpen(true)} className="p-1.5 hover:bg-stone-100 rounded-full transition text-stone-500 mr-0.5 text-base flex items-center justify-center border border-stone-200/50">⚙️</button>
            <div className="flex items-center gap-2 cursor-pointer group" onClick={handleLogout}>
              <div className="w-8 h-8 rounded-full border border-stone-200 overflow-hidden bg-stone-100 flex items-center justify-center">
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
          {/* プレミアム時は残枚数を非表示 */}
          {!userStatus.isPremium && (
            <div className="bg-stone-100/50 border border-stone-200/60 rounded-3xl p-5 relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[11px] font-bold text-stone-500 tracking-wider">今月の自動よみとり残枚数</h3>
                  <p className="text-lg font-bold text-stone-600 mt-0.5">あと <span className="text-orange-400 text-3xl font-black">{userStatus.remainingScans}</span> 枚</p>
                </div>
              </div>
              <div className="w-full bg-stone-200/50 h-2 rounded-full overflow-hidden">
                <div className="bg-orange-300 h-full transition-all duration-500 rounded-full" style={{ width: `${(userStatus.remainingScans / 10) * 100}%` }}></div>
              </div>
            </div>
          )}

          {/* 家族切り替え（フィルター）UI */}
          {members.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <button onClick={() => setSelectedMemberFilterId(null)} className={`px-3 py-1.5 rounded-full font-bold border transition shrink-0 ${!selectedMemberFilterId ? 'bg-stone-800 text-white border-stone-800 shadow-sm' : 'bg-white text-stone-500 border-stone-200'}`}>
                👥 全員の予定
              </button>
              {members.map(m => {
                const matchedPalette = COLOR_PALETTE.find(p => p.id === m.color) || COLOR_PALETTE[0];
                return (
                  <button key={m.id} onClick={() => setSelectedMemberFilterId(m.id)} className={`px-3 py-1.5 rounded-full font-bold border flex items-center gap-1 transition shrink-0 ${selectedMemberFilterId === m.id ? 'bg-stone-800 text-white border-stone-800 shadow-sm' : 'bg-white text-stone-500 border-stone-200'}`}>
                    <span className={`w-2 h-2 rounded-full ${matchedPalette.circleClass}`}></span>{m.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* この日の予定 */}
          <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-5 max-h-[350px] flex flex-col">
            <div className="border-b border-stone-100 pb-3 mb-4">
              <h3 className="font-bold text-stone-600 text-sm">この日の予定</h3>
              <p className="text-[11px] text-orange-400 font-bold mt-0.5">{selectedDateStr}</p>
            </div>
            {isEventsLoading ? (
              <div className="space-y-3.5 flex-1 animate-pulse"><div className="h-16 bg-stone-100 rounded-2xl" /></div>
            ) : filteredEvents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-stone-300 my-auto"><p className="text-[11px] font-bold">予定はありません</p></div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                {filteredEvents.map((ev) => {
                  const matchedMember = members.find(m => m.id === ev.memberId);
                  const matchedPalette = COLOR_PALETTE.find(p => p.id === (matchedMember ? matchedMember.color : (ev.color || 'orange'))) || COLOR_PALETTE[0];
                  return (
                    <div key={ev.id} className={`p-3.5 rounded-2xl border transition-all ${matchedPalette.cardClass}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${matchedPalette.badgeClass}`}>{matchedMember ? matchedMember.name : '共通'}</span>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => { setEditingEvent(ev); setIsEventModalOpen(true); }} className="text-stone-400 text-xs">✏️</button>
                          {!isReadOnly && <button onClick={() => handleDeleteEvent(ev.id)} className="text-stone-400 text-xs">🗑️</button>}
                        </div>
                      </div>
                      <h4 className="font-bold text-stone-700 text-sm mt-2">{ev.title}</h4>
                      <p className="text-[11px] text-stone-500 mt-1 whitespace-pre-wrap">{ev.details}</p>
                      {ev.memo && (
                        <p className="text-[11px] text-stone-400 mt-1.5 whitespace-pre-wrap pt-1.5 border-t border-dashed border-stone-100">📝 {ev.memo}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {errorMessage && <div className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-2xl text-sm font-bold">⚠️ {errorMessage}</div>}

          {/* カレンダー */}
          <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-6">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-extrabold text-stone-700">
                  {viewMode === 'month' && `${year}年 ${month + 1}月`}
                  {viewMode === 'week' && 'スケジュール'}
                  {viewMode === 'history' && 'おたより履歴'}
                </h2>
                <div className="flex rounded-full bg-stone-100 p-0.5 border text-[10px] font-bold">
                  <button type="button" onClick={() => setViewMode('month')} className={`px-3 py-1 rounded-full ${viewMode === 'month' ? 'bg-white text-stone-700 shadow-sm' : 'text-stone-400'}`}>月表示</button>
                  <button type="button" onClick={() => setViewMode('week')} className={`px-3 py-1 rounded-full ${viewMode === 'week' ? 'bg-white text-stone-700 shadow-sm' : 'text-stone-400'}`}>週表示</button>
                  <button type="button" onClick={() => setViewMode('history')} className={`px-3 py-1 rounded-full ${viewMode === 'history' ? 'bg-white text-stone-700 shadow-sm' : 'text-stone-400'}`}>履歴一覧</button>
                </div>
              </div>
              {viewMode !== 'history' && (
                <div className="flex gap-1 bg-[#FDFBF9] p-1 rounded-full border">
                  <button onClick={() => { if (viewMode === 'month') prevMonth(); else { const d = safeParseDate(selectedDateStr); d.setDate(d.getDate() - 7); setSelectedDateStr(d.toISOString().split('T')[0]); setCurrentDate(d); } }} className="p-2 text-stone-400 font-bold">◀</button>
                  <button onClick={() => { const today = new Date(); setCurrentDate(today); setSelectedDateStr(today.toISOString().split('T')[0]); }} className="text-[11px] px-3 font-bold text-stone-500">今日</button>
                  <button onClick={() => { if (viewMode === 'month') nextMonth(); else { const d = safeParseDate(selectedDateStr); d.setDate(d.getDate() + 7); setSelectedDateStr(d.toISOString().split('T')[0]); setCurrentDate(d); } }} className="p-2 text-stone-400 font-bold">▶</button>
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

                    // カレンダーのドットにもフィルターを適用
                    const dayEvents = events
                      .filter(e => !selectedMemberFilterId || e.memberId === selectedMemberFilterId)
                      .filter(e => e.date === dateStr);
                    const hasEvents = dayEvents.length > 0;
                    const uniqueColors = Array.from(new Set(dayEvents.map(e => {
                      const matchedMember = members.find(m => m.id === e.memberId);
                      return matchedMember ? matchedMember.color : (e.color || 'orange');
                    })));

                    return (
                      <button key={`day-${idx}`} onClick={() => setSelectedDateStr(dateStr)} className={`aspect-square rounded-2xl relative flex flex-col items-center justify-center font-bold text-sm transition-all ${isSelected ? 'bg-orange-200 text-orange-900 scale-105 z-10 shadow-sm border border-orange-300' : 'hover:bg-stone-50 text-stone-600'}`}>
                        <span className="z-10">{date.getDate()}</span>
                        {hasEvents && (
                          <div className="absolute bottom-1.5 flex gap-0.5 justify-center z-10">
                            {uniqueColors.map(col => {
                              const matchedPalette = COLOR_PALETTE.find(p => p.id === col);
                              return <span key={col as string} className={`w-1.5 h-1.5 rounded-full ${matchedPalette ? matchedPalette.circleClass : 'bg-orange-400'}`}></span>;
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
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {events.filter(e => e.imageUrl).sort((a, b) => b.date.localeCompare(a.date)).map((ev) => (
                      <div key={ev.id} className="bg-stone-50 border rounded-2xl overflow-hidden transition flex flex-col hover:border-orange-300">
                        <div className="aspect-[4/3] bg-stone-100 relative group overflow-hidden border-b border-stone-150 cursor-pointer" onClick={() => setActiveImageUrl(ev.imageUrl)}>
                          <img src={ev.imageUrl} alt={ev.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] text-orange-400 font-extrabold">{ev.date}</span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${ev.category === 'school' ? 'bg-sky-50 text-sky-600' : ''} ${ev.category === 'event' ? 'bg-orange-50 text-orange-600' : ''}`}>
                                {ev.category === 'school' && '学校・園'}{ev.category === 'event' && '行事'}
                              </span>
                            </div>
                            <h4 className="font-extrabold text-stone-700 text-xs mt-1.5 line-clamp-1">{ev.title}</h4>
                          </div>
                          <button
                            onClick={() => { setEditingEvent({ ...ev }); setIsEventModalOpen(true); }}
                            className="w-full py-2 font-extrabold rounded-xl text-[10px] transition bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
                          >
                            ✍️ 予定の確認・編集
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 欠損していたローディングUIを完全復活 */}
          {loading && (
            <div className="bg-stone-50 border-2 border-dashed border-stone-200 rounded-3xl p-8 text-center text-stone-500 font-bold text-sm">
              AIがおたよりを読みとって自動登録しています...
            </div>
          )}

          {/* 欠損していたスキャン確認モーダルを完全復活 */}
          {isScanConfirmModalOpen && newScannedEvents.length > 0 && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm">
              <div className="bg-[#FDFBF9] border border-orange-100 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center space-y-4">
                <div className="w-12 h-12 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto text-xl">✨</div>
                <h3 className="text-base font-extrabold text-stone-850">おたよりの解析が完了しました！</h3>
                <div className="bg-stone-50 border border-stone-150 rounded-2xl p-4 max-h-48 overflow-y-auto text-left space-y-2">
                  {newScannedEvents.map((ev) => (
                    <div key={ev.id} className="border-b pb-2 last:border-0">
                      <span className="text-[9px] bg-orange-100 text-orange-700 font-extrabold px-2 py-0.5 rounded-full mr-2">{ev.date}</span>
                      <span className="text-xs font-black text-stone-700">{ev.title}</span>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={async () => { setIsScanConfirmModalOpen(false); setNewScannedEvents([]); await refetchEvents(); }} className="w-full bg-orange-400 text-white font-extrabold py-3 rounded-xl text-xs shadow-sm">カレンダーに反映する</button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-3xl shadow-sm border border-stone-100 p-5 text-center">
            <label onClick={(e) => { if (isReadOnly) { e.preventDefault(); alert("閲覧専用です"); } }} className="w-full py-7 bg-orange-200 text-orange-900 rounded-3xl font-black text-base flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-orange-300 transition">
              <span className="text-3xl">📷</span><p className="text-sm font-bold">プリントを撮る</p>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={loading || isReadOnly} multiple />
            </label>
            <button onClick={() => { if (isReadOnly) return; setEditingEvent({ title: "", date: todayStr, details: "", category: "school", color: "orange", imageUrl: null }); setIsEventModalOpen(true); }} className="w-full mt-3 py-3 bg-stone-50 text-stone-600 font-bold hover:bg-stone-100 transition rounded-2xl text-xs border border-stone-200">✍️ 手動で予定を追加する</button>
          </div>
        </div>
      </main>

      {/* --- 以下モーダル類（予定編集、画像拡大、設定） --- */}
      {isEventModalOpen && editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm">
          <form onSubmit={handleSaveModalEvent} className="bg-[#FDFBF9] border border-orange-100 rounded-3xl p-6 max-w-sm w-full shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-extrabold text-stone-850">✍️ 予定の追加・編集</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">タイトル</label>
                <input type="text" required value={editingEvent.title || ''} onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })} className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl font-bold" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">日付</label>
                <input type="date" required value={editingEvent.date || ''} onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })} className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl font-bold" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">詳細</label>
                <textarea value={editingEvent.details || ''} onChange={(e) => setEditingEvent({ ...editingEvent, details: e.target.value })} className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl h-20 resize-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">メモ（通知に含まれます）</label>
                <textarea
                  value={editingEvent.memo || ''}
                  onChange={(e) => setEditingEvent({ ...editingEvent, memo: e.target.value })}
                  placeholder="持ち物などのメモを入力"
                  className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl h-16 resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-400 block mb-1">誰の予定？</label>
                <div className="flex gap-2 mt-1 flex-wrap font-sans">
                  {members.map(m => {
                    const isSelected = editingEvent.memberId === m.id || (!editingEvent.memberId && m.id === 'owner');
                    const matchedPalette = COLOR_PALETTE.find(p => p.id === m.color) || COLOR_PALETTE[0];
                    return <button key={m.id} type="button" onClick={() => setEditingEvent({ ...editingEvent, color: m.color, memberId: m.id })} className={`px-3 py-1.5 rounded-full text-[10px] font-bold text-white ${matchedPalette.circleClass} ${isSelected ? 'ring-2 ring-stone-800 scale-105' : 'opacity-60'}`}>{m.name}</button>;
                  })}
                </div>
              </div>

              {/* 通知ON/OFFトグル */}
              <div className="flex items-center justify-between p-3 bg-stone-50 rounded-2xl border border-stone-150">
                <div className="flex items-center gap-2">
                  <span className="text-base">🔔</span>
                  <div>
                    <p className="text-xs font-bold text-stone-700">前日にプッシュ通知する</p>
                    <p className="text-[9px] text-stone-400">JST 20:00頃に家族全員へリマインドします。</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingEvent.isNotificationEnabled !== false}
                    onChange={(e) => setEditingEvent({ ...editingEvent, isNotificationEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-stone-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-orange-400"></div>
                </label>
              </div>

              {/* 繰り返し設定 (新規追加時のみ) */}
              {!editingEvent.id && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-orange-50/40 rounded-2xl border border-orange-100/60">
                  <div>
                    <label className="text-[9px] font-bold text-orange-850 block mb-1">🔄 繰り返し</label>
                    <select
                      value={editingEvent.recurrence || 'none'}
                      onChange={(e) => setEditingEvent({ ...editingEvent, recurrence: e.target.value })}
                      className="w-full px-2 py-1.5 text-[11px] bg-white border border-orange-200 rounded-lg font-bold"
                    >
                      <option value="none">繰り返さない</option>
                      <option value="daily">毎日</option>
                      <option value="weekly">毎週</option>
                      <option value="monthly">毎月</option>
                    </select>
                  </div>
                  {editingEvent.recurrence && editingEvent.recurrence !== 'none' && (
                    <div>
                      <label className="text-[9px] font-bold text-orange-850 block mb-1">作成回数</label>
                      <select
                        value={editingEvent.recurrenceCount || 2}
                        onChange={(e) => setEditingEvent({ ...editingEvent, recurrenceCount: parseInt(e.target.value, 10) })}
                        className="w-full px-2 py-1.5 text-[11px] bg-white border border-orange-200 rounded-lg font-bold"
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(num => (
                          <option key={num} value={num}>{num}回</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={loading} className="flex-1 bg-orange-400 text-white font-bold py-3 rounded-xl text-xs shadow-sm disabled:opacity-50">
                {loading ? '保存中...' : '保存する'}
              </button>
              <button type="button" onClick={() => { setIsEventModalOpen(false); setEditingEvent(null); }} className="flex-1 bg-white text-stone-500 border font-bold py-3 rounded-xl text-xs">閉じる</button>
            </div>
          </form>
        </div>
      )}

      {activeImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-md" onClick={() => setActiveImageUrl(null)}>
          <div className="relative max-w-3xl w-full bg-white rounded-3xl overflow-hidden shadow-2xl p-2" onClick={e => e.stopPropagation()}>
            <button onClick={() => setActiveImageUrl(null)} className="absolute top-4 right-4 bg-stone-900/75 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold z-10">✕</button>
            <div className="max-h-[80vh] overflow-auto flex justify-center">
              <img src={activeImageUrl} alt="おたより画像" className="max-h-[80vh] w-auto object-contain rounded-2xl" />
            </div>
          </div>
        </div>
      )}

      {isSettingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm" onClick={() => setIsSettingModalOpen(false)}>
          <div className="bg-[#FDFBF9] border border-orange-100 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-3"><h3 className="text-base font-extrabold text-stone-800">⚙️ 設定・家族管理</h3><button onClick={() => setIsSettingModalOpen(false)} className="text-stone-400 font-bold">✕</button></div>

            <div className="bg-white p-4 rounded-2xl border flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-stone-400 block">現在のプラン</span>
                  <span className="text-sm font-black text-stone-600">{userStatus.isPremium ? "👑 プレミアム（使い放題）" : `無料プラン (残りスキャン ${userStatus.remainingScans}枚)`}</span>
                </div>
                {!userStatus.isPremium && (
                  <button onClick={() => { setIsSettingModalOpen(false); handleUpgrade(); }} className="text-[10px] bg-gradient-to-r from-orange-400 to-amber-400 text-white px-3 py-2 rounded-xl font-extrabold">無制限にする</button>
                )}
              </div>
              {/* プレミアム会員向け: サブスクリプション管理ポータル */}
              {userStatus.isPremium && (
                <button
                  onClick={() => { setIsSettingModalOpen(false); handleOpenPortal(); }}
                  disabled={loading}
                  className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 font-extrabold text-xs rounded-xl transition flex items-center justify-center gap-2 border border-stone-200 disabled:opacity-50"
                >
                  {loading ? (
                    <span className="animate-pulse">接続中...</span>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      サブスクリプションを管理する（解約・変更）
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="bg-white p-4 rounded-2xl border border-stone-150 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-stone-700">📅 スマホ標準カレンダーと常時自動同期</h4>
                  <p className="text-[9px] text-stone-400 leading-relaxed mt-0.5">iPhoneやGoogleカレンダーに予定を全自動でリアルタイム反映します。</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-2">
                  <input type="checkbox" checked={userStatus.externalSyncEnabled} onChange={(e) => handleToggleExternalSync(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-400"></div>
                </label>
              </div>
              {userStatus.externalSyncEnabled && (
                <div className="pt-3 border-t border-stone-100 space-y-3">
                  <div className="bg-orange-50/50 border border-orange-100 p-3 rounded-xl flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-[9px] text-orange-400 font-bold">あなた専用の同期URL（照会用）</p>
                      <span className="text-[10px] text-stone-600 font-mono block truncate select-all mt-0.5">{getSyncUrl()}</span>
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(getSyncUrl()); alert("同期URLをコピーしました！🌟\nカレンダーアプリの「照会・URLから追加」に登録してください。"); }} className="text-[9px] bg-white border px-2 py-1 rounded-lg text-stone-600 font-bold shadow-sm whitespace-nowrap">URLをコピー</button>
                  </div>
                  <div className="bg-stone-50 p-3 rounded-xl border border-stone-150 text-[10px] text-stone-500 space-y-1.5 leading-relaxed">
                    <p className="font-extrabold text-stone-600">💡 カレンダーアプリへの登録手順：</p>
                    <p><strong>・iPhone (標準カレンダー):</strong> 上記ボタンでURLをコピー ➔ iPhoneの「設定」アプリを開く ➔ 「カレンダー」 ➔ 「アカウントを追加」 ➔ 「あらかじめ照会したカレンダーを追加」 ➔ コピーしたURLをペーストして保存！</p>
                    <p><strong>・Android / Googleカレンダー:</strong> パソコン版のGoogleカレンダーを開く ➔ 左側の「他のカレンダー」の「＋」をクリック ➔ 「URLから追加」を選び、コピーしたURLを貼り付けて保存！</p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-black text-stone-700">👪 メンバーの管理・追加</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {members.map(m => {
                  const palette = COLOR_PALETTE.find(p => p.id === m.color) || COLOR_PALETTE[0];
                  const isEditingThisRow = editingMemberId === m.id;
                  return (
                    <div key={m.id} className="bg-stone-50 p-3 rounded-xl border border-stone-200 text-xs">
                      {isEditingThisRow ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editingMemberName}
                              onChange={(e) => setEditingMemberName(e.target.value)}
                              placeholder="メンバー名"
                              className="flex-1 px-2 py-1 bg-white border rounded-lg font-bold"
                            />
                            <button type="button" onClick={() => handleSaveEditedMember(m.id)} className="bg-stone-800 text-white px-2.5 py-1 rounded-lg font-bold text-[11px]">保存</button>
                            <button type="button" onClick={() => setEditingMemberId(null)} className="bg-white border text-stone-500 px-2.5 py-1 rounded-lg text-[11px]">戻る</button>
                          </div>
                          <div className="flex gap-1.5 flex-wrap p-1.5 bg-white border rounded-lg">
                            {COLOR_PALETTE.map(p => (
                              <button key={p.id} type="button" onClick={() => setEditingMemberColor(p.id)} className={`w-5 h-5 rounded-full ${p.circleClass} ${editingMemberColor === p.id ? 'ring-2 ring-stone-700 scale-105' : 'opacity-60'}`} />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-3 h-3 rounded-full ${palette.circleClass}`}></span>
                            <span className="font-bold text-stone-700">{m.name}</span>
                          </div>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => { setEditingMemberId(m.id); setEditingMemberName(m.name); setEditingMemberColor(m.color || 'orange'); }} className="text-[10px] text-stone-500 bg-white border px-2 py-0.5 rounded-lg shadow-sm">編集</button>
                            {m.id !== 'owner' && <button type="button" onClick={() => handleRemoveMember(m.id)} className="text-[10px] text-rose-500 bg-white border px-2 py-0.5 rounded-lg shadow-sm">削除</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!isReadOnly && (
                <form onSubmit={(e) => { e.preventDefault(); handleAddMember(newMemberName, newMemberColor); }} className="space-y-2 pt-2 border-t border-dashed">
                  <input type="text" placeholder="新しい家族のメンバー名" required value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} className="px-3 py-1.5 bg-stone-50 border rounded-xl text-xs w-full font-bold" />
                  <div className="flex gap-2 flex-wrap p-2 bg-stone-50 rounded-xl">
                    {COLOR_PALETTE.map(p => <button key={p.id} type="button" onClick={() => setNewMemberColor(p.id)} className={`w-6 h-6 rounded-full ${p.circleClass} ${newMemberColor === p.id ? 'ring-2 ring-stone-700' : 'opacity-60'}`} />)}
                  </div>
                  <button type="submit" className="w-full py-2 bg-orange-400 text-white font-extrabold text-xs rounded-xl">新しいメンバーを追加する</button>
                </form>
              )}
            </div>

            {/* 家族グループに合流（上書き同期） */}
            <div className="space-y-2 border-t pt-4">
              <h4 className="text-xs font-black text-stone-700">👪 家族のグループに参加する</h4>
              {userStatus.groupId !== user?.uid ? (
                <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3 text-center">
                  <p className="text-xs font-bold text-stone-600">現在、家族の共有グループに参加中です ✨</p>
                  <p className="text-[10px] text-stone-400 mt-0.5">※別のグループに再度参加し直す場合は、管理者にお問い合わせください。</p>
                </div>
              ) : (
                <form onSubmit={handleJoinGroup} className="space-y-2">
                  <p className="text-[10px] text-stone-400 leading-relaxed">
                    すでに「おたよりカレンダー」を利用している家族のグループに合流し、カレンダーを同期共有します。
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="家族の招待コードを入力"
                      required
                      value={joinInviteCode}
                      onChange={(e) => setJoinInviteCode(e.target.value)}
                      className="flex-1 px-3 py-2 bg-stone-50 border rounded-xl text-xs font-bold uppercase focus:outline-none focus:border-orange-400"
                    />
                    <button
                      type="submit"
                      disabled={loading || !joinInviteCode.trim()}
                      className="px-4 bg-orange-400 text-white font-extrabold text-xs rounded-xl shadow-sm hover:bg-orange-500 transition disabled:opacity-50"
                    >
                      {loading ? '参加中...' : '参加する'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <h4 className="text-xs font-black text-stone-700">🔗 家族招待コード</h4>
              <div className="bg-stone-50 p-3 rounded-2xl flex items-center justify-between border">
                <span className="text-sm font-black tracking-wider text-stone-700 font-mono">{userStatus.inviteCode || '生成中...'}</span>
                <button onClick={() => { navigator.clipboard.writeText(userStatus.inviteCode); alert("コピーしました！📋"); }} className="text-[10px] bg-white border p-1.5 rounded-lg font-bold shadow-sm">コピー</button>
              </div>
              <a
                href={`https://line.me/R/msg/text/?${encodeURIComponent(`「おたよりカレンダー」を一緒に使おう！\n下記の招待コードを入力してログインしてね✨\n\n招待コード：${userStatus.inviteCode || ''}\nアプリURL：https://otayori-calendar-owfg.vercel.app`)}`}
                target="_blank" rel="noopener noreferrer" className="w-full mt-2 py-2.5 bg-[#06C755] hover:bg-[#05b04a] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-sm"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M22.5 10.1c0-4.3-4.1-7.8-9.2-7.8-5.1 0-9.2 3.5-9.2 7.8 0 3.8 2.6 7 6.3 7.6.2.1.6.2.7.5.1.2 0 .7 0 .7s-.2 1-.2 1.3c0 .3-.1 .7.4.9.4.1 1.7-.8 3.5-2.2 2.6-1.9 4-3.8 4.6-4.6.4-1 .8-2.3.8-3.7z" /></svg>LINEで家族を招待する
              </a>
            </div>

            <div className="space-y-2 border-t pt-4">
              <h4 className="text-xs font-black text-stone-700">📢 パパ友・ママ友にアプリを教える</h4>
              <div className="flex gap-2 pt-1">
                {(() => {
                  const viralText = `子どものプリント管理、限界じゃない？😂\n写真を撮るだけでAIがカレンダーに自動登録＆提出物をリマインドしてくれる神アプリ見つけた！📸📆\nhttps://otayori-calendar-owfg.vercel.app`;
                  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(viralText)}`;
                  const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(viralText)}`;
                  return (
                    <>
                      <a href={twitterUrl} target="_blank" rel="noopener noreferrer" className="flex-1 bg-black text-white py-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-stone-800 transition shadow-sm">𝕏 ポスト</a>
                      <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="flex-1 bg-[#06C755] text-white py-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-[#05b04a] transition shadow-sm">LINEで教える</a>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="space-y-2 border-t pt-4">
              <h4 className="text-xs font-black text-stone-700">💬 ご意見・バグ報告</h4>
              <p className="text-[9px] text-stone-400 leading-relaxed">
                不具合のご報告・機能のご要望はフォームからお気軽にどうぞ。開発チームが直接確認します。
              </p>
              <a
                href="https://forms.gle/3JihgLJapykUsvbH7"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 bg-stone-800 hover:bg-stone-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-sm"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" /></svg>
                バグ報告・ご要望はこちら
              </a>
            </div>
            <button onClick={() => setIsSettingModalOpen(false)} className="w-full bg-stone-100 text-stone-600 font-extrabold py-3 rounded-xl text-xs mt-2">閉じる</button>
          </div>
        </div>
      )}

      {/* フッター */}
      <footer className="w-full text-center py-6 text-[10px] text-stone-400 mt-12 border-t border-stone-200/40 space-x-3">
        <Link href="/about" className="hover:underline font-bold">運営者情報</Link>
        <span className="text-stone-300">|</span>
        <Link href="/contact" className="hover:underline font-bold">お問い合わせ</Link>
        <span className="text-stone-300">|</span>
        <Link href="/terms" className="hover:underline font-bold">利用規約</Link>
        <span className="text-stone-300">|</span>
        <Link href="/privacy" className="hover:underline font-bold">プライバシーポリシー</Link>
        <p className="mt-2 text-stone-300">&copy; {new Date().getFullYear()} おたよりカレンダー</p>
      </footer>
    </div>
  );
}