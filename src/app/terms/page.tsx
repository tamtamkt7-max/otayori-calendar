import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 p-6 md:p-12">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-stone-100">
        <div className="mb-8 border-b border-stone-100 pb-6 text-center">
          <Link href="/" className="inline-block mb-4 text-xs font-bold text-orange-400 hover:underline">
            ← ホームに戻る
          </Link>
          <h1 className="text-2xl font-black text-stone-800 leading-tight">利用規約</h1>
          <p className="text-xs text-stone-400 mt-2">最終改定日: 2026年7月2日</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-stone-600">
          <p>
            この利用規約（以下，「本規約」といいます。）は，おたよりカレンダー運営（以下，「当運営」といいます。）がこのウェブサイト上で提供するサービス（以下，「本サービス」といいます。）の利用条件を定めるものです。登録ユーザーの皆様（以下，「ユーザー」といいます。）には，本規約に従って，本サービスをご利用いただきます。
          </p>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第1条（適用）</h2>
            <p>本規約は，ユーザーと当運営との間の本サービスの利用に関わる一切の関係に適用されるものとします。</p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第2条（利用登録）</h2>
            <p>本サービスにおいては，登録希望者が本規約に同意の上，当運営の定める方法によって利用登録を申請し，当運営がこれを承認することによって，利用登録が完了するものとします。</p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第3条（アカウント情報の管理）</h2>
            <p>
              ユーザーは，自己の責任において，本サービスのアカウント情報のメールアドレスおよびパスワードを適切に管理するものとします。ユーザーは，いかなる場合にも，アカウント情報を第三者に譲渡または貸与することはできません。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第4条（利用料金および支払方法）</h2>
            <p>
              ユーザーは，本サービスの有料プラン（プレミアムプラン）の対価として，当運営が定め，ウェブサイトに表示する利用料金を，当運営が指定する支払方法（Stripeを通じたクレジットカード等決済）により支払うものとします。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第5条（禁止事項）</h2>
            <p>ユーザーは，本サービスの利用にあたり，以下の行為をしてはなりません。</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>法令または公序良俗に違反する行為</li>
              <li>犯罪行為に関連する行為</li>
              <li>本サービスの内容等，本サービスに含まれる著作権，商標権ほか知的財産権を侵害する行為</li>
              <li>当運営，ほかのユーザー，またはその他第三者のサーバーまたはネットワークの機能を破壊したり，妨害したりする行為</li>
              <li>本サービスによって得られた情報を商業的に利用する行為</li>
              <li>当運営のサービスの運営を妨害するおそれのある行為</li>
              <li>他のユーザーになりすます行為</li>
              <li>その他，当運営が不適切と判断する行為</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第6条（免責事項）</h2>
            <p>
              当運営は，本サービスに事実上または法律上の瑕疵（安全性，信頼性，正確性，完全性，有効性，特定の目的への適合性，セキュリティ等に関する欠陥，エラーやバグ，権利侵害などを含みます。）がないことを明示的にも黙示的にも保証しておりません。当運営は，本サービスに起因してユーザーに生じたあらゆる損害について一切の責任を負いません。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第7条（利用規約の変更）</h2>
            <p>当運営は，必要と判断した場合には，ユーザーに通知することなくいつでも本規約を変更することができるものとします。本規約の変更後，本サービスの利用を開始した場合には，ユーザーは変更後の規約に同意したものとみなします。</p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第8条（準拠法・裁判管轄）</h2>
            <p>本規約の解釈にあたっては，日本法を準拠法とします。本サービスに関して紛争が生じた場合には，当運営の所在地を管轄する裁判所を専属的合意管轄とします。</p>
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
