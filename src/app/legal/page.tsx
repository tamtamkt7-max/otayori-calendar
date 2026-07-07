import Link from 'next/link';

export default function LegalPage() {
  const sellerName = process.env.NEXT_PUBLIC_LEGAL_SELLER_NAME || "おたよりカレンダー運営事務局";
  const ownerName = process.env.NEXT_PUBLIC_LEGAL_OWNER_NAME || "[運営責任者の氏名]";
  const address = process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "[運営者の所在地]";
  const phoneNumber = process.env.NEXT_PUBLIC_LEGAL_PHONE || "[運営者の電話番号]";
  const email = process.env.NEXT_PUBLIC_LEGAL_EMAIL || "support@otayori-calendar-owfg.vercel.app";

  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 p-6 md:p-12">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-stone-100">
        <div className="mb-8 border-b border-stone-100 pb-6 text-center">
          <Link href="/" className="inline-block mb-4 text-xs font-bold text-orange-400 hover:underline">
            ← ホームに戻る
          </Link>
          <h1 className="text-2xl font-black text-stone-850 leading-tight">特定商取引法に基づく表記</h1>
          <p className="text-xs text-stone-400 mt-2">最終更新日: 2026年7月8日</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse text-stone-600">
            <tbody>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">販売業者の名称</th>
                <td className="py-4 text-stone-600 align-top">
                  {sellerName}<br />
                  <span className="text-xs text-stone-400">※請求があれば遅滞なく開示します</span>
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">運営責任者</th>
                <td className="py-4 text-stone-600 align-top">
                  {ownerName}<br />
                  <span className="text-xs text-stone-400">※請求があれば遅滞なく開示します</span>
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">所在地</th>
                <td className="py-4 text-stone-600 align-top">
                  {address}<br />
                  <span className="text-xs text-stone-400">※請求があれば遅滞なく開示します</span>
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">電話番号</th>
                <td className="py-4 text-stone-600 align-top">
                  {phoneNumber}<br />
                  <span className="text-xs text-stone-400">※請求があれば遅滞なく開示します</span>
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">メールアドレス</th>
                <td className="py-4 text-stone-600 align-top">
                  <span className="block">{email}</span>
                  <Link href="/contact" className="text-orange-400 hover:underline font-bold text-xs mt-1 inline-block">
                    ↳ お問い合わせフォーム
                  </Link>
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">販売価格</th>
                <td className="py-4 text-stone-600 align-top">
                  アプリ内の購入画面（着せ替え選択画面）に表示される金額（月額/年額プラン等）
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">商品代金以外の必要料金</th>
                <td className="py-4 text-stone-600 align-top">
                  インターネット接続料金その他の電気通信回線の通信料金（接続環境により異なります）
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">代金の支払方法</th>
                <td className="py-4 text-stone-600 align-top">
                  クレジットカード決済（Stripe）
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">代金の支払時期</th>
                <td className="py-4 text-stone-600 align-top">
                  ご利用になる決済手段の引き落とし時期に準じます。
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">役務の提供時期</th>
                <td className="py-4 text-stone-600 align-top">
                  決済手続き完了後、即時にご利用可能となります。
                </td>
              </tr>
              <tr className="border-b border-stone-100">
                <th className="py-4 pr-4 font-bold text-stone-800 text-left w-1/3 align-top">返品・返金について</th>
                <td className="py-4 text-stone-600 align-top">
                  デジタルコンテンツおよびサービスの性質上、決済完了後のキャンセル・返品・返金はできません。
                </td>
              </tr>
            </tbody>
          </table>
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
