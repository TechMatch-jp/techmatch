-- ========================================
-- マイグレーション: articlesテーブルが既に存在する場合はこちらを実行
-- ========================================

-- articles テーブルに不足カラムを追加（既にある場合はエラーになるので個別に実行）
ALTER TABLE articles ADD COLUMN IF NOT EXISTS researcher TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS affiliation TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- interests テーブルに buyer_name, buyer_email を追加
ALTER TABLE interests ADD COLUMN IF NOT EXISTS buyer_name TEXT;
ALTER TABLE interests ADD COLUMN IF NOT EXISTS buyer_email TEXT;

-- patents テーブルに owner_name を追加
ALTER TABLE patents ADD COLUMN IF NOT EXISTS owner_name TEXT;

-- articlesテーブルのRLSが未設定の場合
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to articles" ON articles;
CREATE POLICY "Service role full access articles" ON articles FOR ALL USING (true);
