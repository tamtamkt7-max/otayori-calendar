"use client";
import { useEffect, useState } from 'react';

interface AdBannerProps {
  slot: string;
  className?: string;
  isPremium?: boolean;
}

export default function AdBanner({ slot, className = "", isPremium = false }: AdBannerProps) {
  const [isLocal, setIsLocal] = useState(true);

  useEffect(() => {
    if (isPremium) return;

    if (typeof window !== 'undefined') {
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      setIsLocal(isLocalHost);

      const isProd = process.env.NODE_ENV === 'production';

      // 本番環境かつ非ローカルの場合のみ、Google AdSenseの広告読み込みを試みる
      if (isProd && !isLocalHost) {
        try {
          // @ts-ignore
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
          console.error("AdSense error:", e);
        }
      }
    }
  }, [isPremium]);

  // プレミアム会員の場合は広告を完全に非表示にする（コンポーネントをレンダリングしない）
  if (isPremium) {
    return null;
  }

  if (isLocal) {
    // 暖色系ペールトーンの可愛いダミー広告プレースホルダー
    return (
      <div className={`my-4 p-4 bg-orange-50/40 border border-dashed border-orange-200 rounded-3xl text-center select-none ${className}`}>
        <p className="text-[10px] text-orange-400 font-bold mb-2 tracking-wider">SPONSOR LINK (テスト用広告枠)</p>
        <div className="w-full min-h-[100px] flex flex-col items-center justify-center bg-white/60 border border-orange-100 rounded-2xl p-4">
          <span className="text-2xl mb-1 filter grayscale opacity-40">🎁</span>
          <p className="text-xs text-stone-400 font-bold">おたよりカレンダーを応援する</p>
          <p className="text-[9px] text-stone-400/80 font-medium mt-1">スロットID: {slot}</p>
        </div>
      </div>
    );
  }

  // 本番環境でのGoogle AdSenseコード
  const adClientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID || "ca-pub-5461809032953003";

  return (
    <div className={`my-4 text-center overflow-hidden ${className}`}>
      <span className="text-[9px] text-stone-400 block mb-1">スポンサーリンク</span>
      <ins className="adsbygoogle"
           style={{ display: 'block' }}
           data-ad-client={adClientId}
           data-ad-slot={slot}
           data-ad-format="auto"
           data-full-width-responsive="true"></ins>
    </div>
  );
}
