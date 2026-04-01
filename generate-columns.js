require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ========== コラム定義 ==========
const COLUMNS = [
  // 既存3本（半分に圧縮）
  {
    title: '休眠特許を使ってビジネスを始めよう！活用方法と新規事業の作り方を解説',
    category: 'case-study',
    excerpt: '企業や大学に眠る「休眠特許」を活用して新規事業を立ち上げる方法を解説します。',
    instruction: '「休眠特許を活用した新規事業の作り方」について、1500〜1800字の解説記事を書いてください。休眠特許の定義、なぜ眠っているのか、活用するメリット、具体的な活用ステップ（特許を探す→ライセンス交渉→事業化）を説明してください。読者は特許の初心者で新規事業に興味がある経営者や起業家です。',
  },
  {
    title: '研究者の特許をライセンスして起業できる？技術を"借りて"事業をつくる仕組みを解説',
    category: 'case-study',
    excerpt: '大学や研究機関の特許をライセンスして起業する方法を、技術移転の仕組みとともに解説します。',
    instruction: '「大学・研究機関の特許をライセンスして起業する方法」について、1500〜1800字の解説記事を書いてください。TLO（技術移転機関）の役割、ライセンス契約の流れ、費用感、成功のポイントを説明してください。読者は起業や新規事業に興味がある経営者・ビジネスパーソンです。',
  },
  {
    title: '特許出願にかかる費用とは？課題から解決策まで詳しく解説',
    category: 'patent-basics',
    excerpt: '特許出願にかかる費用の内訳と、費用を抑えるための方法を詳しく解説します。',
    instruction: '「特許出願にかかる費用」について、1500〜1800字の解説記事を書いてください。出願費用・審査請求費用・維持費用の内訳、弁理士費用の相場、費用を抑えるポイント（自己出願など）を説明してください。読者は特許出願を検討している中小企業の経営者や個人発明家です。',
  },
  // 新規7本
  {
    title: '特許とは何か？初心者向けにわかりやすく解説',
    category: 'patent-basics',
    excerpt: '特許制度の基本的な仕組みや目的、取得するメリットをわかりやすく解説します。',
    instruction: '「特許とは何か」について、1500〜2000字の入門解説記事を書いてください。特許の定義、発明の保護期間（20年）、独占権の意味、実用新案・意匠との違い、特許を取るメリット・デメリットをわかりやすく説明してください。読者は特許について何も知らない初心者です。',
  },
  {
    title: '特許の出願から取得までの流れと期間',
    category: 'patent-basics',
    excerpt: '特許を出願してから権利として認められるまでの流れと、各ステップにかかる期間を解説します。',
    instruction: '「特許の出願から取得までの流れ」について、1500〜2000字の解説記事を書いてください。①発明の完成②先行技術調査③明細書作成④出願⑤審査請求⑥審査⑦登録までのステップ、各段階の期間（全体で平均2〜3年）を説明してください。読者は初めて特許出願を検討している人です。',
  },
  {
    title: '特許のライセンス契約とは？種類と注意点を解説',
    category: 'legal',
    excerpt: '特許ライセンス契約の種類（独占・非独占）や契約時の注意点を実務的な視点から解説します。',
    instruction: '「特許のライセンス契約」について、1500〜2000字の解説記事を書いてください。ライセンスの定義、独占的ライセンスと非独占的ライセンスの違い、ロイヤリティの決め方、契約時の注意点（契約範囲・改良発明の帰属・契約解除条項）を説明してください。読者は特許のライセンス活用を検討している企業担当者です。',
  },
  {
    title: '特許侵害とは？リスクと対策を解説',
    category: 'legal',
    excerpt: '特許侵害のリスクと、事業を始める前に確認すべき特許調査の方法を解説します。',
    instruction: '「特許侵害のリスクと対策」について、1500〜2000字の解説記事を書いてください。特許侵害の定義、侵害した場合のリスク（差し止め・損害賠償）、特許侵害を防ぐための事前調査方法（J-PlatPat活用など）、侵害を指摘された場合の対応を説明してください。読者は新製品開発や新規事業を検討している企業担当者です。',
  },
  {
    title: '中小企業が特許を活用して収益化する方法',
    category: 'case-study',
    excerpt: '自社特許を持て余している中小企業が、ライセンス収入や技術売却で収益化するための具体的な方法を解説します。',
    instruction: '「中小企業の特許収益化」について、1500〜2000字の解説記事を書いてください。自社活用・ライセンス・売却の3パターンの比較、ライセンス先の探し方、価格交渉のポイント、特許マッチングプラットフォームの活用を説明してください。読者は自社特許を持て余している中小企業の経営者です。',
  },
  {
    title: '大学の特許はなぜ活用されないのか？技術移転の現状と課題',
    category: 'case-study',
    excerpt: '日本の大学に眠る膨大な特許が活用されない理由と、技術移転を成功させるためのポイントを解説します。',
    instruction: '「日本の大学特許が活用されない理由と技術移転の現状」について、1500〜2000字の解説記事を書いてください。日本の大学特許の現状（出願数と活用率のギャップ）、活用されない理由（情報の非対称性・交渉コスト・リスク意識）、TLOの役割と課題、技術移転を成功させるポイントを説明してください。読者は技術活用に関心のあるビジネスパーソンです。',
  },
  {
    title: '特許を購入・導入したい企業が知っておくべき基礎知識',
    category: 'patent-basics',
    excerpt: '他社の特許を購入またはライセンスして事業に活用したい企業向けに、必要な知識と手順を解説します。',
    instruction: '「特許を購入・ライセンス導入したい企業向けの基礎知識」について、1500〜2000字の解説記事を書いてください。特許購入とライセンスの違い、必要な特許を探す方法（J-PlatPat・特許マッチングサービス）、デューデリジェンスのポイント（権利範囲・有効性確認）、交渉から契約までの流れを説明してください。読者は特許の買い手側企業の担当者です。',
  },
];

// ========== 記事生成 ==========
async function generateContent(column) {
  console.log(`  生成中: ${column.title.slice(0, 40)}...`);
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `あなたはTechMatch（特許マッチングプラットフォーム）の技術コラム執筆者です。
以下の指示に従って、HTMLの記事本文を生成してください。

【指示】
${column.instruction}

【出力形式】
- HTML形式（<h2>、<h3>、<p>、<ul>/<li>タグを使用）
- <body>や<html>タグは不要、本文のみ
- 見出しは<h2>（大見出し）と<h3>（小見出し）を適切に使う
- 文章は<p>タグで囲む
- リストは<ul><li>を使う
- マークダウン記法は使わない
- 本文のみを出力し、前置きや説明文は一切不要`
    }]
  });
  return message.content[0].text
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// ========== メイン処理 ==========
async function main() {
  console.log('TechMatch コラム一括生成・投入スクリプト\n');

  // 既存コラムを全削除
  console.log('既存コラムを削除中...');
  const { error: deleteError } = await supabase
    .from('articles')
    .delete()
    .eq('type', 'column');
  if (deleteError) {
    console.error('削除エラー:', deleteError.message);
    process.exit(1);
  }
  console.log('削除完了\n');

  let success = 0;
  for (let i = 0; i < COLUMNS.length; i++) {
    const col = COLUMNS[i];
    console.log(`[${i + 1}/${COLUMNS.length}] ${col.title.slice(0, 45)}...`);

    try {
      const content = await generateContent(col);

      const { error } = await supabase.from('articles').insert([{
        type: 'column',
        title: col.title,
        excerpt: col.excerpt,
        content: content,
        category: col.category,
        author: 'TechMatch編集部',
        status: 'published',
        created_at: new Date(Date.now() - (COLUMNS.length - i) * 24 * 60 * 60 * 1000).toISOString(),
      }]);

      if (error) {
        console.error(`  ❌ 保存エラー: ${error.message}`);
      } else {
        console.log(`  ✅ 完了`);
        success++;
      }

      // API制限対策で少し待機
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error(`  ❌ 生成エラー: ${e.message}`);
    }
  }

  console.log(`\n完了: ${success}/${COLUMNS.length}本 投入成功`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
