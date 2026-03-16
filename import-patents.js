require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const EPO_KEY    = '58hk5vyldNbyYr4AppFnGev8KeZ4yVoasQKvw251oGKdeZZF';
const EPO_SECRET = 'N0XN4WnC6V9WOz5v5JhfuzX9MYvAcFoCWhayPASqu0TW1b4oRZdtMZH1XmPP3jN9';
const EPO_BASE   = 'https://ops.epo.org/3.2';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SEARCH_TARGETS = [
  { keyword: 'battery',                 category: 'エネルギー',       count: 20 },
  { keyword: 'solar energy',            category: 'エネルギー',       count: 20 },
  { keyword: 'artificial intelligence', category: 'IT・ソフトウェア', count: 20 },
  { keyword: 'semiconductor',           category: 'IT・ソフトウェア', count: 20 },
  { keyword: 'medical diagnosis',       category: 'バイオ・医療',     count: 20 },
  { keyword: 'robot',                   category: '機械・製造',       count: 20 },
  { keyword: 'agriculture',             category: '農業・食品',       count: 15 },
  { keyword: 'material',                category: '素材・化学',       count: 15 },
];

async function getToken() {
  const creds = Buffer.from(EPO_KEY + ':' + EPO_SECRET).toString('base64');
  const res = await fetch(EPO_BASE + '/auth/accesstoken', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('EPO認証失敗: ' + res.status);
  return (await res.json()).access_token;
}

// 元の検索エンドポイント（20件取れていたやつ）
async function searchPatents(token, keyword, count) {
  const query = encodeURIComponent('ti="' + keyword + '" AND pn=JP');
  const res = await fetch(
    EPO_BASE + '/rest-services/published-data/search?q=' + query + '&Range=1-' + count,
    { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } }
  );
  if (!res.ok) return [];
  const d = await res.json();
  const refs = d?.['ops:world-patent-data']?.['ops:biblio-search']?.['ops:search-result']?.['ops:publication-reference'];
  if (!refs) return [];
  return Array.isArray(refs) ? refs : [refs];
}

// docdb形式でbiblio取得: JP.2025175089.A
async function fetchBiblio(token, country, num, kind) {
  const docdbId = country + '.' + num + '.' + kind;
  const res = await fetch(
    EPO_BASE + '/rest-services/published-data/publication/docdb/' + docdbId + '/biblio',
    { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } }
  );
  if (!res.ok) return null;
  return res.json();
}

function toPatentRow(biblio, category) {
  try {
    const doc = biblio?.['ops:world-patent-data']?.['exchange-documents']?.['exchange-document'];
    const d = Array.isArray(doc) ? doc[0] : doc;
    const bd = d?.['bibliographic-data'];
    if (!bd) return null;

    // タイトル（日本語優先）
    const titleRaw = bd?.['invention-title'];
    const titles = Array.isArray(titleRaw) ? titleRaw : (titleRaw ? [titleRaw] : []);
    const title =
      titles.find(t => t?.['@lang'] === 'ja')?.['$'] ||
      titles.find(t => t?.['@lang'] === 'en')?.['$'] ||
      titles[0]?.['$'] || null;
    if (!title) return null;

    // 出願人
    const appRaw = bd?.['parties']?.['applicants']?.['applicant'];
    const apps = Array.isArray(appRaw) ? appRaw : (appRaw ? [appRaw] : []);
    const ownerName = apps?.[0]?.['applicant-name']?.['name']?.['$'] || '不明';

    // 特許番号
    const pubRef = bd?.['publication-reference']?.['document-id'];
    const pubDocs = Array.isArray(pubRef) ? pubRef : [pubRef];
    const docdbRef = pubDocs?.find(x => x?.['@document-id-type'] === 'docdb') || pubDocs?.[0];
    const c = docdbRef?.['country']?.['$'] || 'JP';
    const n = docdbRef?.['doc-number']?.['$'] || '';
    const k = docdbRef?.['kind']?.['$'] || 'A';
    const patentNumber = n ? (c + n + k) : '';
    if (!patentNumber) return null;

    // IPC分類
    const ipcRaw = bd?.['classifications-ipcr']?.['classification-ipcr'];
    const ipcs = Array.isArray(ipcRaw) ? ipcRaw : (ipcRaw ? [ipcRaw] : []);
    const ipc = ipcs?.[0]?.['text']?.['$']?.trim() || '';

    const description = category + 'に関する特許。出願人：' + ownerName + '。技術分類：' + ipc;

    return {
      title, description,
      problem: null, usage: null, advantage: null,
      category, patent_number: patentNumber,
      price: 0, status: 'available', approval_status: 'approved',
      owner_id: null, owner_name: ownerName, image: null,
    };
  } catch (e) { return null; }
}

async function savePatent(row) {
  const { data: existing } = await supabase
    .from('patents').select('id').eq('patent_number', row.patent_number).maybeSingle();
  if (existing) return 'skip';
  const { error } = await supabase.from('patents').insert([row]);
  if (error) { console.error('  保存エラー:', error.message); return 'error'; }
  return 'saved';
}

async function main() {
  console.log('TechMatch 特許インポート v4 開始\n');
  const token = await getToken();
  console.log('✅ 認証成功\n');

  let totalSaved = 0, totalSkip = 0, totalError = 0;

  for (const target of SEARCH_TARGETS) {
    console.log('─────────────────────────────────────────────');
    console.log('🔍 「' + target.keyword + '」(' + target.category + ')');
    const refs = await searchPatents(token, target.keyword, target.count);
    console.log('   ' + refs.length + '件ヒット');

    for (const ref of refs) {
      const docId = ref?.['document-id'];
      const ids = Array.isArray(docId) ? docId : [docId];
      const docdbId = ids.find(i => i?.['@document-id-type'] === 'docdb');
      if (!docdbId) continue;

      const country = docdbId?.['country']?.['$'] || 'JP';
      const num     = docdbId?.['doc-number']?.['$'];
      const kind    = docdbId?.['kind']?.['$'] || 'A';
      if (!num) continue;

      const biblio = await fetchBiblio(token, country, num, kind);
      if (!biblio) continue;

      const row = toPatentRow(biblio, target.category);
      if (!row) continue;

      const result = await savePatent(row);
      if (result === 'saved') {
        totalSaved++;
        console.log('   ✅ ' + row.title.slice(0, 50));
      } else if (result === 'skip') {
        totalSkip++;
        process.stdout.write('.');
      } else {
        totalError++;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log('');
  }

  console.log('\n完了: 保存=' + totalSaved + ' スキップ=' + totalSkip + ' エラー=' + totalError);
}

main().catch(e => { console.error('エラー:', e.message); process.exit(1); });
