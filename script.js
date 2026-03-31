// カテゴリー名のマッピング（DBの値をそのまま使用）
const categoryNames = {
 'AI・機械学習': 'AI・機械学習',
 'IoT・センサー': 'IoT・センサー',
 'ソフトウェア・アプリ': 'ソフトウェア・アプリ',
 '半導体': '半導体',
 '電子部品・回路': '電子部品・回路',
 '医療機器': '医療機器',
 '医薬品・バイオ': '医薬品・バイオ',
 '機械・ロボット': '機械・ロボット',
 'エネルギー': 'エネルギー',
 '環境・リサイクル': '環境・リサイクル',
 '素材・材料': '素材・材料',
 '農業・食品': '農業・食品',
 '建設・土木': '建設・土木',
 '店舗・サービス業': '店舗・サービス業',
 '生活・消費財': '生活・消費財',
};

// ステータス名のマッピング
const statusNames = {
 available: "利用可能",
 negotiation: "交渉中"
};

let allPatents = [];
let currentCategory = '';
let currentSearchTerm = '';

// 概要文を取得（AI要約があればそれを使い、なければ特許文のマークアップを除去して短縮）
function getCardDescription(patent) {
  if (patent.ai_summary) {
    return patent.ai_summary.slice(0, 80) + (patent.ai_summary.length > 80 ? '...' : '');
  }
  const cleaned = (patent.description || '')
    .replace(/【[^】]+】/g, '')  // 【課題】【解決手段】などを除去
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80) + (cleaned.length > 80 ? '...' : '');
}

// 特許カードを生成する関数
function createPatentCard(patent) {
 const card = document.createElement('div');
 card.className = 'card';
 card.style.cursor = 'pointer';
 
 const categoryEmoji = {
 'AI・機械学習': '',
 'IoT・センサー': '',
 'ソフトウェア・アプリ': '',
 '半導体': '',
 '電子部品・回路': '',
 '医療機器': '️',
 '医薬品・バイオ': '',
 '機械・ロボット': '',
 'エネルギー': '️',
 '環境・リサイクル': '️',
 '素材・材料': '',
 '農業・食品': '',
 '建設・土木': '️',
 '店舗・サービス業': '',
 '生活・消費財': '️',
 };
 
 card.innerHTML = `
    <div class="card-header">${categoryEmoji[patent.category] || ''}</div>
    <div class="card-body">
      <h3 class="card-title">${patent.title}</h3>
      <p class="card-description">${getCardDescription(patent)}</p>
      <div class="card-tags">
        <span class="tag">${categoryNames[patent.category] || patent.category}</span>
      </div>
    </div>
  `;
 
 // クリックで詳細ページに遷移
 card.addEventListener('click', () => {
 window.location.href = `patent-detail.html?id=${patent.id}`;
 });
 
 return card;
}

// 特許一覧を表示する関数（最大6件）
function displayPatents(patentsToDisplay) {
 const grid = document.getElementById('patentGrid');
 grid.innerHTML = '';
 
 if (patentsToDisplay.length === 0) {
 grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #7f8c8d;">該当する特許が見つかりませんでした。</p>';
 return;
 }
 
 // 最大6件まで表示
 const limitedPatents = patentsToDisplay.slice(0, 6);
 
 limitedPatents.forEach(patent => {
 grid.appendChild(createPatentCard(patent));
 });
}

// フィルター処理
function filterPatents() {
 let filtered = allPatents;
 
 // カテゴリーフィルター
 if (currentCategory) {
 filtered = filtered.filter(patent => patent.category === currentCategory);
 }
 
 // 検索ワードフィルター
 if (currentSearchTerm) {
 const searchLower = currentSearchTerm.toLowerCase();
 filtered = filtered.filter(patent => 
 patent.title.toLowerCase().includes(searchLower) || 
 patent.description.toLowerCase().includes(searchLower)
 );
 }
 
 displayPatents(filtered);
}

// 特許データを取得
async function loadPatents() {
 try {
 console.log('特許データを取得中...');
 const response = await fetch('/api/patents');
 console.log('Response status:', response.status);
 
 if (response.ok) {
 allPatents = await response.json();
 console.log('取得した特許数:', allPatents.length);
 console.log('特許データ:', allPatents);
 displayPatents(allPatents);
 } else {
 console.error('特許取得失敗:', response.statusText);
 }
 } catch (error) {
 console.error('特許データの取得に失敗しました', error);
 document.getElementById('patentGrid').innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #e74c3c;">データの読み込みに失敗しました。</p>';
 }
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', function() {
 // 初期表示
 loadPatents();
 
 // 検索ボタン
 const searchBtn = document.getElementById('searchBtn');
 if (searchBtn) {
 searchBtn.addEventListener('click', () => {
 currentSearchTerm = document.getElementById('searchInput').value;
 filterPatents();
 });
 }
 
 // Enterキーでも検索
 const searchInput = document.getElementById('searchInput');
 if (searchInput) {
 searchInput.addEventListener('keypress', function(e) {
 if (e.key === 'Enter') {
 currentSearchTerm = this.value;
 filterPatents();
 }
 });
 }
 
 // カテゴリーチップのクリック
 document.querySelectorAll('.chip').forEach(chip => {
 chip.addEventListener('click', function() {
 // アクティブ状態の切り替え
 document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
 this.classList.add('active');
 
 // カテゴリーフィルター
 currentCategory = this.dataset.category || '';
 filterPatents();
 });
 });
});
