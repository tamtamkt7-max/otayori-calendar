import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'おたよりカレンダー',
    short_name: 'おたより',
    description: '園や学校のプリントをAIで自動カレンダー登録するアプリ',
    start_url: '/',
    display: 'standalone',
    background_color: '#FDFBF9',
    theme_color: '#FB923C', // orange-400
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
