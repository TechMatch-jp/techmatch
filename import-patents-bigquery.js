// ============================================
// TechMatch 特許インポート（BigQuery版）
// 実行: node import-patents-bigquery.js
// ============================================

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const { createClient } = require('@supabase/supabase-js');

const bigquery = new BigQuery({
  projectId: 'graceful-fold-489809-s5',
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// カテゴリとキーワードの定義（15カテゴリ × 20キーワード）
const CATEGORIES = [
  { name: 'AI・機械学習', keywords: [
    '人工知能', '機械学習', 'ディープラーニング', 'ニューラルネットワーク',
    '画像認識', '自然言語処理', '強化学習', '予測モデル', '異常検知', '音声認識',
    '生成AI', '大規模言語モデル', '物体検出', 'データ分析', 'パターン認識',
    '推薦システム', 'チャットボット', '顔認証', '感情認識', '自動翻訳',
  ]},
  { name: 'IoT・センサー', keywords: [
    'IoT', 'センサー', '無線通信', 'RFID', '遠隔監視',
    'スマートデバイス', '組込みシステム', '位置情報', 'Bluetooth', 'データ収集',
    '加速度センサー', '温度センサー', '圧力センサー', 'スマートホーム',
    'ウェアラブル', 'M2M', 'エッジコンピューティング', '赤外線', 'GPS', '振動センサー',
  ]},
  { name: 'ソフトウェア・アプリ', keywords: [
    'ソフトウェア', '情報処理', 'アプリケーション', 'データベース', 'セキュリティ',
    'クラウド', 'UI', '認証', '検索システム', 'プログラム',
    '暗号化', 'ブロックチェーン', 'API', '仮想化', 'コンテナ',
    'ユーザーインターフェース', 'ファイル管理', 'ネットワーク管理', 'バックアップ', 'ログ管理',
  ]},
  { name: '半導体', keywords: [
    '半導体', '集積回路', 'トランジスタ', 'ウェーハ', '半導体製造',
    'DRAM', 'フラッシュメモリ', 'パワー半導体', 'エッチング', 'フォトリソグラフィ',
    'シリコン', '半導体素子', '半導体パッケージ', '半導体基板', '酸化膜',
    'イオン注入', 'CVD', 'スパッタリング', '半導体検査', '半導体冷却',
  ]},
  { name: '電子部品・回路', keywords: [
    '電子回路', 'コンデンサ', '抵抗', 'プリント基板', '電子部品',
    'インダクタ', 'トランス', 'スイッチング電源', 'アンテナ', 'モーター',
    'コイル', 'リレー', '発振器', 'フィルタ回路', '増幅回路',
    '整流回路', '電源回路', 'ノイズ対策', '放熱', '実装技術',
  ]},
  { name: '医療機器', keywords: [
    '医療機器', '内視鏡', '手術', '診断装置', '画像診断',
    'カテーテル', 'ステント', '人工関節', '超音波', '放射線',
    'MRI', 'CT', '手術支援', '補聴器', '義肢',
    '心電図', '血圧計', '血糖値', '医療用ロボット', '滅菌',
  ]},
  { name: '医薬品・バイオ', keywords: [
    '医薬品', '薬剤', 'バイオ', '抗体', '創薬',
    'ワクチン', '遺伝子', 'タンパク質', '細胞培養', '製剤',
    '抗がん剤', '免疫', '核酸', '酵素', '微生物',
    'バイオマーカー', '再生医療', '幹細胞', 'iPS細胞', 'ゲノム',
  ]},
  { name: '機械・ロボット', keywords: [
    'ロボット', '製造装置', '加工機械', '自動化', '精密機械',
    '工作機械', 'プレス', '溶接', '搬送装置', 'アーム',
    '切削', '研削', '射出成形', '金型', '旋盤',
    '産業用ロボット', '協働ロボット', '無人搬送', 'クレーン', '油圧',
  ]},
  { name: 'エネルギー', keywords: [
    '電池', '太陽電池', '燃料電池', '発電', '蓄電',
    'リチウムイオン', '風力', '水素', '変電', '送電',
    '全固体電池', '太陽光パネル', '蓄電池', '電力制御', 'インバータ',
    '地熱', '潮力', 'バイオマス', 'スマートグリッド', '充電',
  ]},
  { name: '環境・リサイクル', keywords: [
    '廃棄物', 'リサイクル', '排水処理', '大気浄化', '省エネ',
    '脱炭素', 'CO2', '汚水', '焼却', '浄化',
    '廃プラスチック', '有害物質', '土壌汚染', '排ガス', 'オゾン',
    '水処理', 'フィルタ', '吸着', '分解', '環境測定',
  ]},
  { name: '素材・材料', keywords: [
    '樹脂', '金属', '合金', 'セラミック', '複合材料',
    'ガラス', '繊維', 'コーティング', '接着剤', 'フィルム',
    'カーボンファイバー', 'チタン', 'アルミニウム', 'ポリマー', 'ナノ材料',
    '耐熱材料', '導電性材料', '磁性材料', '光学材料', '生分解性',
  ]},
  { name: '農業・食品', keywords: [
    '農業', '食品', '栽培', '農薬', '加工食品',
    '肥料', '収穫', '発酵', '保存', '品種改良',
    'スマート農業', '灌漑', '植物工場', '乳製品', '水産',
    '飼料', '畜産', '食品安全', '冷凍食品', '機能性食品',
  ]},
  { name: '建設・土木', keywords: [
    '建設', '土木', 'コンクリート', '橋梁', '基礎工事',
    '耐震', 'トンネル', '舗装', '杭', '建材',
    '免震', '制振', '鉄筋', '足場', '仮設',
    '防水', '断熱', '窓', '外壁', '地盤改良',
  ]},
  { name: '店舗・サービス業', keywords: [
    '厨房機器', '飲食店', '調理設備', 'POSシステム', '陳列',
    'レジ', '自動販売機', '券売機', '接客', '配膳',
    '冷蔵ショーケース', '包装機', '食器洗浄', '換気', '厨房排水',
    'サービスロボット', '宅配', '物流', '店舗設備', '看板',
  ]},
  { name: '生活・消費財', keywords: [
    '日用品', '家具', '収納', '調理器具', '文具',
    '玩具', 'ファッション', '衣類', '美容', '化粧品',
    '寝具', '清掃用具', '照明', 'インテリア', 'アクセサリー',
    'スポーツ用品', 'アウトドア', 'ペット用品', '育児用品', 'バッグ',
  ]},
];

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith("--limit=") || a === "--limit");
const LIMIT_PER_KEYWORD = limitArg
  ? parseInt(limitArg.startsWith("--limit=") ? limitArg.split("=")[1] : args[args.indexOf("--limit") + 1]) || 5
  : 5;

// --category 1 で1カテゴリ目だけ、--category 1-3 で1〜3カテゴリ
const categoryArg = args.find(a => a.startsWith("--category=") || a === "--category");
let TARGET_CATEGORIES = CATEGORIES;
if (categoryArg) {
  const val = categoryArg.startsWith("--category=")
    ? categoryArg.split("=")[1]
    : args[args.indexOf("--category") + 1];
  if (val && val.includes("-")) {
    const [start, end] = val.split("-").map(Number);
    TARGET_CATEGORIES = CATEGORIES.slice(start - 1, end);
  } else if (val) {
    const n = parseInt(val);
    TARGET_CATEGORIES = CATEGORIES.slice(n - 1, n);
  }
}

async function fetchPatentsByKeyword(keyword, category) {
  const query = `
    SELECT
      publication_number,
      (SELECT tl.text FROM UNNEST(title_localized) tl WHERE tl.language = 'ja' LIMIT 1) AS title_ja,
      (SELECT al.text FROM UNNEST(abstract_localized) al WHERE al.language = 'ja' LIMIT 1) AS abstract_ja,
      (SELECT a.name FROM UNNEST(assignee_harmonized) a LIMIT 1) AS assignee_harmonized_name,
      assignee AS assignee_raw,
      filing_date,
      publication_date
    FROM \`patents-public-data.patents.publications\`
    WHERE country_code = 'JP'
      AND filing_date >= 20150101
      AND (
        EXISTS (
          SELECT 1 FROM UNNEST(title_localized) tl
          WHERE tl.language = 'ja' AND tl.text LIKE '%${keyword}%'
        )
        OR EXISTS (
          SELECT 1 FROM UNNEST(abstract_localized) al
          WHERE al.language = 'ja' AND al.text LIKE '%${keyword}%'
        )
      )
    LIMIT ${LIMIT_PER_KEYWORD}
  `;

  const [rows] = await bigquery.query({ query });

  function toDateStr(d) {
    if (!d) return null;
    const s = String(d.value ?? d);
    if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return null;
  }

  return rows.map(row => {
    // assignee_rawから日本語の出願人名を優先して取得
    const owner_name = (() => {
      if (row.assignee_raw) {
        const raw = String(row.assignee_raw);
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const jaLine = lines.find(l => /[\u3000-\u9fff]/.test(l));
        if (jaLine) return jaLine;
        if (lines[0]) return lines[0];
      }
      return row.assignee_harmonized_name || null;
    })();

    return {
      publication_number: row.publication_number,
      title: row.title_ja || '（タイトル不明）',
      description: row.abstract_ja || null,
      owner_name,                  // ← 修正: DBのカラム名 owner_name に統一
      filing_date: toDateStr(row.filing_date),
      publication_date: toDateStr(row.publication_date),
      category,
      source: 'google_patents',
      status: 'available',
      approval_status: 'approved', // ← 修正: 取込時に自動承認
    };
  });
}

async function saveToSupabase(patents) {
  let saved = 0;
  let skipped = 0;
  let errors = 0;

  for (const patent of patents) {
    const { data: existing } = await supabase
      .from('patents')
      .select('id')
      .eq('publication_number', patent.publication_number)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from('patents').insert(patent);
    if (error) {
      console.error(`  ❌ エラー: ${patent.publication_number} - ${error.message}`);
      errors++;
    } else {
      saved++;
    }
  }

  return { saved, skipped, errors };
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  TechMatch 特許インポート（BigQuery版）  ║');
  console.log(`║  対象: ${TARGET_CATEGORIES.length}カテゴリ × 20キーワード × ${LIMIT_PER_KEYWORD}件/キーワード`);
  console.log('╚══════════════════════════════════════════╝\n');

  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const category of TARGET_CATEGORIES) {
    console.log(`\n📂 カテゴリ: ${category.name}`);

    for (const keyword of category.keywords) {
      process.stdout.write(`  🔍 「${keyword}」を検索中...`);

      try {
        const patents = await fetchPatentsByKeyword(keyword, category.name);
        process.stdout.write(` ${patents.length}件取得\n`);

        const { saved, skipped, errors } = await saveToSupabase(patents);
        totalSaved += saved;
        totalSkipped += skipped;
        totalErrors += errors;
        console.log(`     ✅ 保存: ${saved}件 / スキップ: ${skipped}件`);

        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        console.error(`\n  ❌ 検索エラー: ${err.message}`);
      }
    }
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║  完了: 保存=${totalSaved} スキップ=${totalSkipped} エラー=${totalErrors}`);
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(console.error);
