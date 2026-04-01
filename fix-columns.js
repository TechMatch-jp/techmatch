require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function cleanContent(content) {
  if (!content) return content;
  // マークダウンのコードフェンスを除去
  return content
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function main() {
  console.log('コラムのマークダウン除去を開始...\n');

  const { data: columns, error } = await supabase
    .from('articles')
    .select('id, title, content')
    .eq('type', 'column');

  if (error) {
    console.error('取得エラー:', error.message);
    process.exit(1);
  }

  let fixed = 0;
  for (const col of columns) {
    const cleaned = cleanContent(col.content);
    if (cleaned !== col.content) {
      const { error: updateError } = await supabase
        .from('articles')
        .update({ content: cleaned })
        .eq('id', col.id);

      if (updateError) {
        console.error(`❌ ${col.title.slice(0, 40)}: ${updateError.message}`);
      } else {
        console.log(`✅ 修正: ${col.title.slice(0, 40)}`);
        fixed++;
      }
    } else {
      console.log(`  スキップ: ${col.title.slice(0, 40)}`);
    }
  }

  console.log(`\n完了: ${fixed}件修正`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
