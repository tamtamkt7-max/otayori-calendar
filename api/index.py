import os
import json
import base64
from io import BytesIO
from http.server import BaseHTTPRequestHandler
import firebase_admin
from firebase_admin import credentials, auth, firestore
import google.generativeai as genai
from datetime import datetime
from PIL import Image

# 1. Firebase Admin SDKの初期化（環境変数からサービスアカウントJSONを動的ロード）
if not firebase_admin._apps:
    try:
        sa_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
        if sa_json:
            cred = credentials.Certificate(json.loads(sa_json))
            firebase_admin.initialize_app(cred)
        else:
            print("Warning: FIREBASE_SERVICE_ACCOUNT environment variable is missing.")
    except Exception as e:
        print(f"Firebase initialization critical error: {e}")

db = firestore.client() if firebase_admin._apps else None

# 2. Gemini APIの初期化（コスト最小・速度最大の3.5シリーズ/3.5-flashモデルを採用）
genai.configure(api_key=os.environ.get('GEMINI_API_KEY', ''))

# 無料ユーザーの月間最大スキャン制限数
FREE_MONTHLY_LIMIT = 10

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        # CORSプリフライトリクエストへの対応
        self._send_response(200, {}, is_options=True)

    def do_POST(self):
        try:
            # リクエストボディのパース
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            body = json.loads(post_data)
            
            image_base64_with_prefix = body.get('image') # フロントから送られるBase64文字列
            if not image_base64_with_prefix:
                self._send_response(400, {"error": "画像データ(Base64)が添付されていません。"})
                return

            # 3. Firebase Auth トークンの厳密な検証（※AI解析テスト用に一時バイパス中）
            # auth_header = self.headers.get('Authorization')
            # id_token = auth_header.split('Bearer ')[1]
            # decoded_token = auth.verify_id_token(id_token)
            uid = "test_user_123" # ダミーのユーザーIDを強制割り当て

            # 4. Firestoreを用いたユーザーのプラン状態および月間利用回数のチェック
            current_month = datetime.now().strftime('%Y-%m')
            user_ref = db.collection('users').document(uid)
            usage_ref = user_ref.collection('usage').document(current_month)
            
            user_doc = user_ref.get()
            user_data = user_doc.to_dict() if user_doc.exists else {}
            is_premium = user_data.get('is_premium', False) # サブスク会員フラグ

            usage_doc = usage_ref.get()
            current_count = usage_doc.to_dict().get('count', 0) if usage_doc.exists else 0

            # 無料ユーザーかつ制限に達している場合は403で即座に遮断（API破産防止の強固な壁）
            if not is_premium and current_count >= FREE_MONTHLY_LIMIT:
                self._send_response(403, {
                    "error": f"今月の無料スキャン上限（{FREE_MONTHLY_LIMIT}回）に達しました。プレミアムプラン（月額480円）に加入すると制限が解除されます。"
                })
                return

            # 5. Base64画像データのデコード処理
            if "," in image_base64_with_prefix:
                image_base64 = image_base64_with_prefix.split(",")[1]
            else:
                image_base64 = image_base64_with_prefix

            raw_image_bytes = base64.b64decode(image_base64)
            pil_image = Image.open(BytesIO(raw_image_bytes))

            # 6. Gemini 3.5 Flash による高度なおたより解析処理
            # response_mime_typeにjsonを指定することで、確実にパース可能なJSONのみを返却させる
            model = genai.GenerativeModel(
                model_name='gemini-3.5-flash',
                generation_config={"response_mime_type": "application/json"}
            )
            
            prompt = """
            あなたは優秀な学校・園の予定管理アシスタントです。
            与えられた「おたより」や「スケジュール表」の画像から、行事・イベントの予定を漏れなく全て抽出してください。
            以下のJSON配列フォーマットに完全に準拠して出力してください。
            Markdownの枠組み（```json 等）は一切不要です。純粋なJSON文字列だけを返してください。

            [
              {
                "title": "行事名（例: 🏊‍♂️ プール開き、🍱 遠足、🏫 授業参観）",
                "date": "開催日（必ず YYYY-MM-DD 形式に統一。年が不明な場合は2026年とする）",
                "details": "持ち物、集合時間、場所、提出期限などの詳細情報を詳しく要約",
                "category": "分類（'school', 'event', 'medical' のいずれかから最適のものを選択）"
              }
            ]
            """
            
            # 画像とプロンプトを投入
            response = model.generate_content([prompt, pil_image])
            
            # 7. 抽出結果の検証とFirestoreのインクリメント
            try:
                extracted_events = json.loads(response.text)
            except Exception as json_parse_err:
                # 万が一Geminiの出力が不適切な場合の安全弁
                self._send_response(500, {"error": "AIのデータ構造化に失敗しました。もう一度お試しください。"})
                return

            # 解析が完全に成功した段階でのみ、利用回数を+1する（ユーザーに不利益を与えない設計）
            new_count = current_count + 1
            usage_ref.set({'count': new_count}, merge=True)

            # フロントエンドへ完璧なデータと残り回数を返却
            self._send_response(200, {
                "success": True,
                "events": extracted_events,
                "remaining": FREE_MONTHLY_LIMIT - new_count if not is_premium else 999
            })

        except Exception as e:
            self._send_response(500, {"error": f"サーバー内部エラー: {str(e)}"})

    def _send_response(self, status, payload, is_options=False):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        # Vercelサーバーレス関数でのCORS問題を完全に回避するヘッダー定義
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        if not is_options:
            self.wfile.write(json.dumps(payload).encode('utf-8'))