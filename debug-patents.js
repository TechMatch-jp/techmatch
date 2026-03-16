// デバッグ用：1件だけ取得して中身を確認する
require('dotenv').config();

const EPO_KEY    = '58hk5vyldNbyYr4AppFnGev8KeZ4yVoasQKvw251oGKdeZZF';
const EPO_SECRET = 'N0XN4WnC6V9WOz5v5JhfuzX9MYvAcFoCWhayPASqu0TW1b4oRZdtMZH1XmPP3jN9';
const EPO_BASE   = 'https://ops.epo.org/3.2';

async function getToken() {
  const creds = Buffer.from(`${EPO_KEY}:${EPO_SECRET}`).toString('base64');
  const res = await fetch(`${EPO_BASE}/auth/accesstoken`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const d = await res.json();
  return d.access_token;
}

async function main() {
  const token = await getToken();
  console.log('✅ 認証成功\n');

  // 検索
  const query = encodeURIComponent('ti="battery" AND pn=JP');
  const res = await fetch(
    `${EPO_BASE}/rest-services/published-data/search?q=${query}&Range=1-3`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
  );
  const d = await res.json();

  // 検索結果の生データを表示
  const refs = d?.['ops:world-patent-data']?.['ops:biblio-search']?.['ops:search-result']?.['ops:publication-reference'];
  console.log('=== 検索結果 refs ===');
  console.log(JSON.stringify(refs, null, 2));

  if (!refs) { console.log('refsがnull'); return; }

  const refArr = Array.isArray(refs) ? refs : [refs];
  const ref = refArr[0];
  console.log('\n=== 最初のref ===');
  console.log(JSON.stringify(ref, null, 2));

  // doc-numberを取得
  const docId = ref?.['document-id'];
  const ids = Array.isArray(docId) ? docId : [docId];
  console.log('\n=== document-id一覧 ===');
  console.log(JSON.stringify(ids, null, 2));

  const epodocId = ids.find(i => i?.['@document-id-type'] === 'epodoc');
  const docNumber = epodocId?.['doc-number']?.['$'];
  console.log('\n=== 取得したdocNumber ===', docNumber);

  if (!docNumber) { console.log('docNumberが取れない'); return; }

  // 書誌情報取得
  const biblioRes = await fetch(
    `${EPO_BASE}/rest-services/published-data/publication/epodoc/${docNumber}/biblio`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
  );
  console.log('\n=== biblioレスポンスステータス ===', biblioRes.status);
  const biblio = await biblioRes.json();
  console.log('\n=== biblio生データ（一部）===');
  console.log(JSON.stringify(biblio, null, 2).slice(0, 2000));
}

main().catch(e => console.error('エラー:', e.message));
