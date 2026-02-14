const { createClient } = require('@supabase/supabase-js');

// 環境変数チェック
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ 環境変数が設定されていません');
    console.error('必要な環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY');
    process.exit(1);
}

// Supabaseクライアント作成（service_roleキー使用）
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

module.exports = { supabase };
