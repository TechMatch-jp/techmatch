-- ========================================
-- contacts テーブル（お問い合わせ）
-- ========================================

CREATE TABLE IF NOT EXISTS contacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    company      TEXT,
    email        TEXT NOT NULL,
    subject      TEXT NOT NULL,
    message      TEXT NOT NULL,
    status       TEXT DEFAULT 'new' CHECK (status IN ('new', 'replied', 'closed')),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- RLS：管理者のみ参照可（匿名ユーザーは INSERT のみ）
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_insert_anon" ON contacts
    FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "contacts_select_admin" ON contacts
    FOR SELECT USING (auth.role() = 'authenticated');
