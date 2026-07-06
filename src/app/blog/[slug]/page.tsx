import Link from "next/link";
import { notFound } from "next/navigation";
import { BLOG_POSTS } from "../blogData";

interface BlogPostProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({ params }: BlogPostProps) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) {
    return {
      title: "記事が見つかりません | おたよりカレンダー",
    };
  }
  return {
    title: `${post.title} | おたよりカレンダー ブログ`,
    description: post.excerpt,
  };
}

export default async function BlogPostPage({ params }: BlogPostProps) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  if (!post) {
    notFound();
  }

  // 簡単な段落分割ヘルパー
  const paragraphs = post.content.split("\n\n");

  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 flex flex-col items-center p-4 py-8">
      {/* ヘッダー */}
      <header className="w-full max-w-2xl flex items-center justify-between border-b border-stone-150 pb-4 mb-8">
        <Link href="/" className="flex items-center gap-2 hover:opacity-85 transition">
          <div className="w-8 h-8 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 font-bold text-base shrink-0">お</div>
          <div>
            <h2 className="text-sm font-bold text-stone-850">おたよりカレンダー</h2>
            <p className="text-[9px] text-stone-400 font-medium -mt-0.5">プリントを撮るだけ自動登録</p>
          </div>
        </Link>
        <Link href="/blog" className="text-xs font-bold text-stone-500 hover:text-stone-700 hover:underline">
          コラム一覧へ
        </Link>
      </header>

      {/* メイン記事 */}
      <main className="w-full max-w-2xl flex-1 bg-white border border-stone-150 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
        {/* メタデータ */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-orange-50 border border-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full font-bold">
            {post.category}
          </span>
          <span className="text-[10px] text-stone-400 font-medium">
            {post.date}
          </span>
          <span className="text-[10px] text-stone-400 font-medium">
            ⏱️ 読了目安: {post.readTime}
          </span>
        </div>

        {/* タイトル */}
        <h1 className="text-xl sm:text-2xl font-extrabold text-stone-850 leading-tight">
          {post.title}
        </h1>

        {/* 記事本文 */}
        <div className="text-sm sm:text-base text-stone-600 leading-relaxed space-y-6 pt-4 border-t border-stone-100 font-sans">
          {paragraphs.map((p, index) => {
            // 見出し（### ）の簡易パーサー
            if (p.startsWith("### ")) {
              return (
                <h3 key={index} className="text-base sm:text-lg font-black text-stone-850 pt-3 border-l-4 border-orange-400 pl-3">
                  {p.replace("### ", "")}
                </h3>
              );
            }
            // 箇条書き（* ）の簡易パーサー
            if (p.includes("\n* ")) {
              const lines = p.split("\n");
              const intro = lines[0].startsWith("* ") ? "" : lines[0];
              const listItems = lines.filter(line => line.startsWith("* ") || line.startsWith("- "));
              return (
                <div key={index} className="space-y-2">
                  {intro && <p>{intro}</p>}
                  <ul className="list-disc pl-5 space-y-1.5 text-stone-600">
                    {listItems.map((item, itemIndex) => (
                      <li key={itemIndex}>{item.substring(2)}</li>
                    ))}
                  </ul>
                </div>
              );
            }
            // 番号付きリスト（1. ）の簡易パーサー
            if (p.includes("\n1. ") || p.startsWith("1. ")) {
              const lines = p.split("\n");
              const intro = /^\d+\.\s/.test(lines[0]) ? "" : lines[0];
              const listItems = lines.filter(line => /^\d+\.\s/.test(line));
              return (
                <div key={index} className="space-y-2">
                  {intro && <p>{intro}</p>}
                  <ol className="list-decimal pl-5 space-y-1.5 text-stone-600">
                    {listItems.map((item, itemIndex) => (
                      <li key={itemIndex}>{item.replace(/^\d+\.\s/, "")}</li>
                    ))}
                  </ol>
                </div>
              );
            }

            return (
              <p key={index} className="whitespace-pre-line">
                {p}
              </p>
            );
          })}
        </div>

        {/* 記事内CTA */}
        <div className="mt-12 bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200/80 rounded-3xl p-6 text-center space-y-4">
          <div className="space-y-1">
            <h4 className="text-sm font-extrabold text-orange-850">📅 スマホでパシャッと撮るだけ自動スケジュール登録</h4>
            <p className="text-xs text-stone-600 leading-relaxed max-w-md mx-auto">
              「おたよりカレンダー」を使えば、園や学校のプリントに書かれた予定をAIが自動読み取りしてカレンダーに保存！家族間の共有や前日アラートも標準装備しています。
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-400 to-amber-400 hover:from-orange-500 hover:to-amber-500 text-white font-extrabold rounded-2xl transition duration-200 text-xs shadow-md shadow-orange-500/10 active:scale-95"
          >
            ✨ 『おたよりカレンダー』を無料で試してみる
          </Link>
        </div>
      </main>

      {/* フッター */}
      <footer className="w-full max-w-2xl text-center py-8 text-[10px] text-stone-400 mt-12 border-t border-stone-200/30">
        <p>&copy; {new Date().getFullYear()} おたよりカレンダー</p>
      </footer>
    </div>
  );
}
