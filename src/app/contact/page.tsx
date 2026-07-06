import Link from 'next/link';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 p-6 md:p-12">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-stone-100">
        <div className="mb-8 border-b border-stone-100 pb-6 text-center">
          <Link href="/" className="inline-block mb-4 text-xs font-bold text-orange-400 hover:underline">
            ← ホームに戻る
          </Link>
          <h1 className="text-2xl font-black text-stone-800 leading-tight">お問い合わせ</h1>
          <p className="text-xs text-stone-400 mt-2">ご意見・不具合報告・ご質問など</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-stone-600 text-center py-6">
          <p className="text-left text-stone-500">
            おたよりカレンダーをご利用いただきありがとうございます。
            アプリへのご要望、不具合のご報告、その他のお問い合わせは、以下のGoogleフォームからお気軽にご送信ください。
          </p>

          <div className="bg-orange-50/50 rounded-2xl border border-orange-100 p-6 max-w-md mx-auto space-y-4 shadow-sm">
            <span className="text-3xl block">✉️</span>
            <h3 className="font-extrabold text-stone-800 text-sm">お問い合わせ・ご要望フォーム</h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              送信いただいた内容は開発チームが直接確認し、サービスの改善に役立てさせていただきます。
            </p>
            <a
              href="https://forms.gle/3JihgLJapykUsvbH7"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block w-full py-3 bg-orange-400 hover:bg-orange-500 text-white font-extrabold text-xs rounded-xl transition shadow-sm"
            >
              Google フォームを開く
            </a>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-stone-100 text-center">
          <Link href="/" className="text-xs text-orange-400 font-bold hover:underline">
            ホームに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
