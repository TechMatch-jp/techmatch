# TechMatch プロジェクト ステータスメモ
> このファイルはClaudeが読み書きするためのメモです。
> 作業開始時に必ず確認し、作業終了時に更新してください。

---

## プロジェクト概要
- **サービス名**: TechMatch（テックマッチ）
- **URL**: https://techmatch.jp
- **目的**: 特許保有者（大学・研究機関）と技術を求める企業をつなぐ知財マッチングプラットフォーム
- **収益モデル**: 特許掲載料（seller）＋問い合わせ課金（buyer）

---

## 技術スタック
| 項目 | 内容 |
|------|------|
| バックエンド | Node.js / Express（server.js） |
| フロントエンド | 静的HTML/CSS/JS（public/フォルダ） |
| DB | Supabase（PostgreSQL） |
| ホスティング | Render |
| AI要約 | Anthropic API（claude-haiku-4-5） |
| メール | Resend（noreply@techmatch.jp） |
| 特許データ取込 | BigQuery（patents-public-data.patents.publications） |
| アクセス解析 | GA4（G-47LCYNSVRP） |

---

## DBスキーマ（主要テーブル）
- **users**: id, email, password, name, user_type(seller/buyer/admin), organization
- **patents**: id, publication_number, title, description, problem, usage, advantage, category, patent_number, price, status, approval_status, owner_name, filing_date, publication_date, source, ai_summary, ai_use_cases, ai_generated_at
- **interests**: 興味表明（buyer → patent）
- **messages**: ユーザー間メッセージ
- **articles**: コラム・インタビュー記事（type: column/interview）
- **contacts**: お問い合わせフォーム

---

## 特許データの取込方法
```bash
# 認証（初回・期限切れ時）
gcloud auth application-default login

# 取込コマンド例
node import-patents-bigquery.js --category=1 --limit=1
# --category=1〜15（カテゴリ番号）、--limit=件数/キーワード
```

### カテゴリ番号一覧
1. AI・機械学習 / 2. IoT・センサー / 3. ソフトウェア・アプリ / 4. 半導体
5. 電子部品・回路 / 6. 医療機器 / 7. 医薬品・バイオ / 8. 機械・ロボット
9. エネルギー / 10. 環境・リサイクル / 11. 素材・材料 / 12. 農業・食品
13. 建設・土木 / 14. 店舗・サービス業 / 15. 生活・消費財

---

## 現在のDB状況
- 特許データ: **19件**（AI・機械学習カテゴリのみ、2026年3月取込）
- approval_status: 旧データはpending→approvedへSQLで一括更新済み
- owner_name: **NULLの状態**（import-patents-bigquery.jsのバグが原因）

---

## 既知のバグ・TODO

### 修正済み
- [x] import-patents-bigquery.js: `assignee`→`owner_name`に修正（CLAUDE_STATUS.md同梱の修正版を使うこと）
- [x] import-patents-bigquery.js: `approval_status: 'approved'`を追加

### 未対応（要対応）
- [ ] owner_nameがNULLの既存19件を再取込または手動UPDATE
- [ ] patent-detail.html: 要約下に「本文はこちら（Google Patents）」リンクを追加
- [ ] patent-detail.html: 類似特許セクションのプレースホルダーを非表示に
- [ ] patent-detail.html: 権利者・出願番号がNULLの場合は行を非表示に
- [ ] server.js: /api/admin/* エンドポイントにadminロールチェック未実装（セキュリティリスク）

### 将来対応
- [ ] 類似特許機能（同カテゴリから取得するAPIエンドポイント）
- [ ] 取込データ量を増やす（現状19件のみ）

---

## ファイル構成（重要ファイル）
```
/
├── server.js                    # バックエンド全体（Express）
├── supabase.js                  # Supabase接続
├── import-patents-bigquery.js   # BigQuery特許取込スクリプト
├── .env                         # 環境変数（SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, JWT_SECRET, RESEND_API_KEY）
└── public/
    ├── index.html               # トップ（特許一覧）
    ├── patent-detail.html       # 特許詳細
    ├── admin.html               # 管理者ダッシュボード
    ├── auth.html                # ログイン・登録
    ├── mypage.html / mypage-buyer.html / mypage-seller.html
    ├── column.html / column-detail.html
    ├── interview.html / interview-detail.html
    ├── contact.html
    └── stylish-common.css       # 共通スタイル（紫グラデ系・現行デザイン）
```

---

## 最終更新
- **日時**: 2026年3月
- **作業内容**: BigQueryからAI・機械学習カテゴリ19件取込、import-patents-bigquery.jsのバグ修正（owner_name / approval_status）
