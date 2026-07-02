import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 p-6 md:p-12">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-stone-100">
        <div className="mb-8 border-b border-stone-100 pb-6 text-center">
          <Link href="/" className="inline-block mb-4 text-xs font-bold text-orange-400 hover:underline">
            ← ホームに戻る
          </Link>
          <h1 className="text-2xl font-black text-stone-800 leading-tight">プライバシーポリシー</h1>
          <p className="text-xs text-stone-400 mt-2">最終改定日: 2026年7月2日</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-stone-600">
          <p>
            おたよりカレンダー運営（以下，「当運営」といいます。）は，本ウェブサイト上で提供するサービス（以下，「本サービス」といいます。）における，ユーザーの個人情報の取扱いについて，以下のとおりプライバシーポリシー（以下，「本ポリシー」といいます。）を定めます。
          </p>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第1条（個人情報の定義と収集）</h2>
            <p>当運営は，ユーザーから以下の個人情報および利用データを収集します。</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>アカウント登録時のメールアドレスおよびログイン認証情報</li>
              <li>ユーザーがアップロードしたおたより（プリント）の画像データ</li>
              <li>Google OAuth 連携時に取得する Google アカウント情報およびカレンダー予定データ</li>
              <li>本サービス内での行動履歴（Google Analytics を通じたイベントトラッキングデータ）</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第2条（個人情報の利用目的）</h2>
            <p>当運営は，収集した情報を以下の目的で利用します。</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>AI画像解析によるカレンダー予定の自動抽出および登録機能の提供</li>
              <li>ユーザーが設定した予定のGoogleカレンダーへの自動双方向同期</li>
              <li>予定の3日前・前日におけるプッシュ通知（リマインド）の送信</li>
              <li>Stripe決済を通じたプレミアムプラン購読管理</li>
              <li>本サービスの利用状況分析およびサービス改善（GA4による計測）</li>
            </ul>
          </section>

          <section className="bg-orange-50/50 p-5 rounded-2xl border border-orange-100">
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-400 pl-3 mb-2 text-base">第3条（Google APIに関する限定使用の開示）</h2>
            <p className="font-semibold text-stone-800 mb-2">
              当運営は、Google API（Google Calendar API 等）から取得したユーザーデータを保護するために最優先の対策を行っています。
            </p>
            <p className="mb-2">
              本サービスが Google API から受信した情報の使用および他のアプリへの移行は、限定使用要件（Google API Services User Data Policy, including the Limited Use requirements）を含む **Google API サービスユーザーデータポリシー** に厳格に準拠します。
            </p>
            <p>
              Googleカレンダーから取得したデータは、ユーザー自身のカレンダー表示およびアプリ内での双方向同期機能の提供以外の目的で利用（第三者への提供、広告目的への利用、AIのトレーニングなど）することは一切ありません。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第4条（個人情報の安全管理）</h2>
            <p>
              当運営は，収集した個人情報の漏洩，滅失または毀損の防止その他個人情報の安全管理のために，暗号化通信（HTTPS）、保存トークンのAES-256暗号化、アクセス権制限等、必要かつ適切なセキュリティ措置を講じます。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第5条（個人情報の第三者提供）</h2>
            <p>
              当運営は，個人情報保護法その他の法令で認められる場合を除き，あらかじめユーザーの同意を得ることなく，第三者に個人情報を提供することはありません。ただし，本サービスの決済処理に必要な範囲で外部決済代行業者（Stripe）に情報を提供する場合はこの限りではありません。
            </p>
          </section>

          <section>
            <h2 className="font-bold text-stone-800 border-l-4 border-orange-300 pl-3 mb-2 text-base">第6条（お問い合わせ窓口）</h2>
            <p>個人情報に関するお問い合わせは，本アプリ運営までお問い合わせフォームまたは登録メールアドレス経由でご連絡ください。</p>
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
