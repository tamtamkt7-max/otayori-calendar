import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const countStr = searchParams.get('count') || '0';
    const count = parseInt(countStr, 10);

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            backgroundImage: 'radial-gradient(circle at 25px 25px, #f5f5f5 2%, transparent 0%), radial-gradient(circle at 75px 75px, #f5f5f5 2%, transparent 0%)',
            backgroundSize: '100px 100px',
            fontFamily: 'sans-serif',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#fff',
              border: '2px solid #f0f0f0',
              padding: '40px 60px',
              borderRadius: '30px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
            }}
          >
            {/* ロゴマーク */}
            <div
              style={{
                width: '70px',
                height: '70px',
                backgroundColor: '#fed7aa', // orange-200
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
                fontWeight: 'bold',
                color: '#c2410c', // orange-700
                marginBottom: '20px',
              }}
            >
              お
            </div>
            
            {/* メッセージ */}
            <div
              style={{
                fontSize: '28px',
                fontWeight: 'bold',
                color: '#57534e', // stone-600
                textAlign: 'center',
                lineHeight: '1.4',
              }}
            >
              AIでおたよりの予定を
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginTop: '10px',
                marginBottom: '15px',
              }}
            >
              <span
                style={{
                  fontSize: '64px',
                  fontWeight: 'black',
                  color: '#fb923c', // orange-400
                  marginRight: '10px',
                }}
              >
                {count}
              </span>
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: 'bold',
                  color: '#57534e',
                }}
              >
                件 自動化しました！
              </span>
            </div>
            <div
              style={{
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#a8a29e', // stone-400
              }}
            >
              おたよりカレンダー
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e: any) {
    console.error('Failed to generate OGP image:', e);
    return new Response(`Failed to generate the image`, {
      status: 500,
    });
  }
}
