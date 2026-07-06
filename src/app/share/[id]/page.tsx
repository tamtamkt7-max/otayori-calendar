import { getFirebaseAdmin } from "@/lib/firebaseAdmin";
import Link from "next/link";

interface PageProps {
  params: Promise<{ id: string }>;
}

const getJapaneseDateString = (dateStr: string) => {
  try {
    const d = new Date(dateStr.replace(/-/g, '/'));
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 (${weekdays[d.getDay()]})`;
  } catch (e) {
    return dateStr;
  }
};

export default async function SharePage({ params }: PageProps) {
  const { id } = await params;
  
  if (!id || !id.includes("_")) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex flex-col items-center justify-center font-sans text-stone-700 p-6 text-center">
        <span className="text-5xl mb-4">⚠️</span>
        <h1 className="text-xl font-bold text-stone-850 mb-2">無効な共有リンクです</h1>
        <p className="text-sm text-stone-500 mb-6">URLの形式が正しくないか、リンクが壊れている可能性があります。</p>
        <Link href="/" className="px-6 py-3 bg-orange-400 text-white rounded-xl font-extrabold text-xs shadow-sm hover:bg-orange-500 transition">
          トップページへ戻る
        </Link>
      </div>
    );
  }

  const [groupId, eventId] = id.split("_");

  const admin = await getFirebaseAdmin();
  const db = admin?.db;

  if (admin.error || !db) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex flex-col items-center justify-center font-sans text-stone-700 p-6 text-center">
        <span className="text-5xl mb-4">⚙️</span>
        <h1 className="text-xl font-bold text-stone-850 mb-2">データベース接続エラー</h1>
        <p className="text-sm text-stone-500 mb-6">一時的にカレンダー情報を取得できません。しばらく経ってから再度お試しください。</p>
      </div>
    );
  }

  let eventData: any = null;
  try {
    const docRef = db.collection("groups").doc(groupId).collection("events").doc(eventId);
    const snap = await docRef.get();
    if (snap.exists) {
      eventData = snap.data();
    }
  } catch (err) {
    console.error("Firestore fetch error in share page:", err);
  }

  if (!eventData) {
    return (
      <div className="min-h-screen bg-[#FDFBF9] flex flex-col items-center justify-center font-sans text-stone-700 p-6 text-center">
        <span className="text-5xl mb-4">📭</span>
        <h1 className="text-xl font-bold text-stone-850 mb-2">予定が見つかりません</h1>
        <p className="text-sm text-stone-500 mb-6">この予定はすでに削除されたか、公開が終了した可能性があります。</p>
        <Link href="/" className="px-6 py-3 bg-orange-400 text-white rounded-xl font-extrabold text-xs shadow-sm hover:bg-orange-500 transition">
          トップページへ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 flex flex-col items-center justify-between p-4 py-8">
      {/* ヘッダー */}
      <header className="w-full max-w-md flex items-center justify-between border-b border-stone-150 pb-4 mb-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 font-bold text-base shrink-0">お</div>
          <div>
            <h2 className="text-sm font-bold text-stone-850">おたよりカレンダー</h2>
            <p className="text-[9px] text-stone-400 font-medium -mt-0.5">家族のためのプリント共有ツール</p>
          </div>
        </div>
        <span className="text-[10px] bg-stone-100 border border-stone-200 text-stone-500 px-2 py-1 rounded-full font-bold">
          共有ページ
        </span>
      </header>

      {/* メイン予定カード */}
      <main className="w-full max-w-md flex-1 flex flex-col items-center">
        <div className="w-full bg-white border border-stone-150 rounded-3xl p-6 shadow-xl space-y-5">
          {/* 日付とカテゴリ */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full border border-orange-100/60">
              📅 {getJapaneseDateString(eventData.date)}
            </span>
            {eventData.category === "school" && (
              <span className="text-[10px] bg-blue-50 border border-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-bold">
                🏫 学校・園
              </span>
            )}
            {eventData.category === "event" && (
              <span className="text-[10px] bg-emerald-50 border border-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-bold">
                🎈 行事・イベント
              </span>
            )}
            {eventData.category === "medical" && (
              <span className="text-[10px] bg-rose-50 border border-rose-100 text-rose-700 px-2.5 py-1 rounded-full font-bold">
                🏥 病院・検診
              </span>
            )}
          </div>

          {/* タイトル */}
          <h1 className="text-xl font-extrabold text-stone-850 leading-tight">
            {eventData.title}
          </h1>

          {/* メモ */}
          {eventData.memo && (
            <div className="bg-stone-50 border border-stone-150 p-4 rounded-2xl space-y-1">
              <span className="text-[9px] font-black text-stone-400 tracking-wider block">MEMO</span>
              <p className="text-xs text-stone-600 font-bold whitespace-pre-wrap leading-relaxed">
                {eventData.memo}
              </p>
            </div>
          )}

          {/* 詳細 */}
          {eventData.details && (
            <div className="space-y-1">
              <span className="text-[9px] font-black text-stone-400 tracking-wider block">DETAILS</span>
              <p className="text-xs text-stone-600 whitespace-pre-wrap leading-relaxed">
                {eventData.details}
              </p>
            </div>
          )}

          {/* スキャン画像 */}
          {eventData.imageUrl && (
            <div className="pt-2 border-t border-stone-100 space-y-2">
              <span className="text-[9px] font-black text-stone-400 tracking-wider block">📷 添付されたおたよりプリント</span>
              <div className="relative w-full border border-stone-200 rounded-2xl overflow-hidden shadow-inner bg-stone-100 flex justify-center">
                <img
                  src={eventData.imageUrl}
                  alt="おたより画像"
                  className="max-h-[360px] w-auto object-contain rounded-2xl p-1"
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* バイラルCTA */}
      <section className="w-full max-w-md mt-8 bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/80 rounded-3xl p-6 text-center space-y-4 shadow-sm shrink-0">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-orange-850">🚀 園・学校のプリント管理でお悩みですか？</h3>
          <p className="text-xs text-stone-600 leading-relaxed max-w-sm mx-auto">
            「おたよりカレンダー」なら、プリントをパシャッと撮影するだけでAIが自動登録！家族全員へ前日リマインドが届くから、提出物の忘れ物も完全になくなります。
          </p>
        </div>
        <Link
          href="/"
          className="w-full inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-orange-400 to-amber-400 hover:from-orange-500 hover:to-amber-500 text-white font-extrabold rounded-2xl transition duration-200 text-xs shadow-md shadow-orange-500/10 active:scale-95"
        >
          ✨ 子育て世帯のための『おたよりカレンダー』を始める
        </Link>
      </section>

      {/* フッター */}
      <footer className="w-full text-center py-6 text-[10px] text-stone-400 mt-6 border-t border-stone-200/30">
        <p>&copy; {new Date().getFullYear()} おたよりカレンダー</p>
      </footer>
    </div>
  );
}
