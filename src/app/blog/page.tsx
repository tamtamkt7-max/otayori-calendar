import Link from "next/link";
import { BLOG_POSTS } from "./blogData";

export const metadata = {
  title: "おたより管理コラム & お役立ちブログ | おたよりカレンダー",
  description: "幼稚園・学校のプリント整理のコツや、共働き家庭のスケジュール共有方法など、育児と予定管理に役立つ情報を配信中！",
};

export default function BlogListPage() {
  return (
    <div className="min-h-screen bg-[#FDFBF9] font-sans text-stone-700 flex flex-col items-center p-4 py-8">
      {/* ヘッダー */}
      <header className="w-full max-w-2xl flex items-center justify-between border-b border-stone-150 pb-4 mb-8">
        <Link href="/" className="flex items-center gap-2 hover:opacity-85 transition">
          <div className="w-8 h-8 bg-orange-200 rounded-full flex items-center justify-center text-orange-700 font-bold text-base shrink-0">お</div>
          <div>
            <h1 className="text-sm font-bold text-stone-850">おたよりカレンダー</h1>
            <p className="text-[9px] text-stone-400 font-medium -mt-0.5">プリントを撮るだけ自動登録</p>
          </div>
        </Link>
        <Link href="/" className="text-xs font-bold text-stone-500 hover:text-stone-700 hover:underline">
          アプリに戻る
        </Link>
      </header>

      {/* メインコンテンツ */}
      <main className="w-full max-w-2xl flex-1 space-y-6">
        <div className="text-center space-y-2 mb-8">
          <h2 className="text-xl font-extrabold text-stone-850 tracking-tight sm:text-2xl">
            📚 おたより管理お役立ちコラム
          </h2>
          <p className="text-xs text-stone-500 max-w-md mx-auto leading-relaxed">
            園や学校の大量のプリント整理術、夫婦間でのスケジュール共有ルールなど、子育て世帯の毎日の負担を減らすヒントをお届けします。
          </p>
        </div>

        {/* 記事リスト */}
        <div className="space-y-6">
          {BLOG_POSTS.map((post) => (
            <article key={post.slug} className="bg-white border border-stone-150 rounded-3xl p-6 shadow-sm hover:shadow-md transition duration-200">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] bg-orange-50 border border-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">
                  {post.category}
                </span>
                <span className="text-[10px] text-stone-400 font-medium">
                  {post.date}
                </span>
                <span className="text-[10px] text-stone-400 font-medium">
                  ⏱️ 読了目安: {post.readTime}
                </span>
              </div>
              
              <Link href={`/blog/${post.slug}`} className="group block">
                <h3 className="text-base font-extrabold text-stone-850 group-hover:text-orange-500 transition leading-snug mb-2">
                  {post.title}
                </h3>
              </Link>
              
              <p className="text-xs text-stone-500 leading-relaxed mb-4">
                {post.excerpt}
              </p>
              
              <Link href={`/blog/${post.slug}`} className="inline-flex items-center text-xs font-black text-orange-500 hover:text-orange-600 gap-1 group">
                続きを読む
                <span className="transform group-hover:translate-x-0.5 transition duration-150">&rarr;</span>
              </Link>
            </article>
          ))}
        </div>
      </main>

      {/* フッター */}
      <footer className="w-full max-w-2xl text-center py-8 text-[10px] text-stone-400 mt-12 border-t border-stone-200/30">
        <p>&copy; {new Date().getFullYear()} おたよりカレンダー</p>
      </footer>
    </div>
  );
}
