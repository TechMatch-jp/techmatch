-- ========================================
-- TechMatch データベーススキーマ
-- ========================================

-- 既存のテーブルを削除（クリーンインストール用）
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS interests CASCADE;
DROP TABLE IF EXISTS patents CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ========================================
-- 1. ユーザーテーブル
-- ========================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    user_type TEXT NOT NULL CHECK (user_type IN ('seller', 'buyer', 'admin')),
    organization TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 2. 特許テーブル
-- ========================================
CREATE TABLE patents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    problem TEXT,
    usage TEXT,
    advantage TEXT,
    category TEXT NOT NULL,
    patent_number TEXT,
    price NUMERIC(12, 2) DEFAULT 0,
    status TEXT DEFAULT 'available' CHECK (status IN ('available', 'sold', 'reserved')),
    approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    image TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 3. 興味表明テーブル
-- ========================================
CREATE TABLE interests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patent_id UUID REFERENCES patents(id) ON DELETE CASCADE,
    buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- 4. メッセージテーブル
-- ========================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
    patent_id UUID REFERENCES patents(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- インデックス作成（パフォーマンス最適化）
-- ========================================
CREATE INDEX idx_patents_owner_id ON patents(owner_id);
CREATE INDEX idx_patents_approval_status ON patents(approval_status);
CREATE INDEX idx_patents_category ON patents(category);
CREATE INDEX idx_interests_patent_id ON interests(patent_id);
CREATE INDEX idx_interests_buyer_id ON interests(buyer_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX idx_messages_patent_id ON messages(patent_id);

-- ========================================
-- Row Level Security (RLS) 設定
-- ========================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patents ENABLE ROW LEVEL SECURITY;
ALTER TABLE interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- service_roleキー使用時は全アクセス可能
CREATE POLICY "Service role has full access to users" ON users FOR ALL USING (true);
CREATE POLICY "Service role has full access to patents" ON patents FOR ALL USING (true);
CREATE POLICY "Service role has full access to interests" ON interests FOR ALL USING (true);
CREATE POLICY "Service role has full access to messages" ON messages FOR ALL USING (true);

-- ========================================
-- 5. 記事テーブル（コラム / インタビュー）
-- ========================================
CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('column', 'interview')),
    title TEXT NOT NULL,
    excerpt TEXT,
    content TEXT,
    category TEXT,
    author TEXT,
    researcher TEXT,
    affiliation TEXT,
    featured_image TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 更新日時の自動更新（Supabase側でtriggerを用意する場合もあるが、ここではアプリ側更新でもOK）

CREATE INDEX IF NOT EXISTS idx_articles_type ON articles(type);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to articles" ON articles FOR ALL USING (true);
