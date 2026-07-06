import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 p-6 md:p-12">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-stone-100">
        <div className="mb-8 border-b border-stone-100 pb-6 text-center">
          <Link href="/" className="inline-block mb-4 text-xs font-bold text-orange-400 hover:underline">
            ← ホームに戻る
          </Link>
          <h1 className="text-2xl font-black text-stone-800 leading-tight">運営者情報</h1>
          <p className="text-xs text-stone-400 mt-2">おたよりカレンダーの運営について</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-stone-600">
          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">運営元</h2>
            <p>おたよりカレンダー開発プロジェクト</p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">活動内容</h2>
            <p>
              子育て世代の日常生活および学校・園プリントのデジタル管理をサポートするWebツールの開発・運営を行っています。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">連絡先</h2>
            <p>
              不具合のご報告や機能のご要望は，
              <Link href="/contact" className="text-orange-400 hover:underline font-bold mx-1">
                お問い合わせフォーム
              </Link>
              よりご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">各種規約</h2>
            <div className="flex gap-4 pt-1 font-bold">
              <Link href="/terms" className="text-orange-400 hover:underline">
                利用規約
              </Link>
              <span className="text-stone-300">|</span>
              <Link href="/privacy" className="text-orange-400 hover:underline">
                プライバシーポリシー
              </Link>
            </div>
          </section>
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
