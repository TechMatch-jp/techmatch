// カテゴリ別グラデーション背景
const categoryGradients = {
  'AI・機械学習':      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'IoT・センサー':     'linear-gradient(135deg, #0f6e56 0%, #1D9E75 100%)',
  'ソフトウェア・アプリ': 'linear-gradient(135deg, #185FA5 0%, #378ADD 100%)',
  '半導体':           'linear-gradient(135deg, #444441 0%, #888780 100%)',
  '電子部品・回路':   'linear-gradient(135deg, #533AB7 0%, #7F77DD 100%)',
  '医療機器':         'linear-gradient(135deg, #993556 0%, #D4537E 100%)',
  '医薬品・バイオ':   'linear-gradient(135deg, #D85A30 0%, #F0997B 100%)',
  '機械・ロボット':   'linear-gradient(135deg, #3B6D11 0%, #639922 100%)',
  'エネルギー':       'linear-gradient(135deg, #854F0B 0%, #EF9F27 100%)',
  '環境・リサイクル': 'linear-gradient(135deg, #085041 0%, #1D9E75 100%)',
  '素材・材料':       'linear-gradient(135deg, #5F5E5A 0%, #B4B2A9 100%)',
  '農業・食品':       'linear-gradient(135deg, #27500A 0%, #97C459 100%)',
  '建設・土木':       'linear-gradient(135deg, #633806 0%, #BA7517 100%)',
  '店舗・サービス業': 'linear-gradient(135deg, #993C1D 0%, #D85A30 100%)',
  '生活・消費財':     'linear-gradient(135deg, #72243E 0%, #ED93B1 100%)',
};
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
let displayedCount = 8;

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
    <div class="card-body">
      <div class="card-title">${patent.title}</div>
      <div class="card-description">${getCardDescription(patent)}</div>
      <div class="card-owner">${patent.owner_name || ''}</div>
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

// ローディング表示
function showLoading() {
  const grid = document.getElementById('patentGrid');
  grid.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 3rem 0; color: #667eea;">
      <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid rgba(102,126,234,0.2); border-top-color: #667eea; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
      <p style="margin-top: 1rem; font-size: 0.95rem; color: #6b7280;">特許データを読み込み中...</p>
    </div>
  `;
  // スピナーのアニメーション
  if (!document.getElementById('spinner-style')) {
    const style = document.createElement('style');
    style.id = 'spinner-style';
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
}

// 特許一覧を表示する関数
function displayPatents(patentsToDisplay) {
  const grid = document.getElementById('patentGrid');
  grid.innerHTML = '';

  // 既存の「もっと見る」ボタンを削除
  const existingBtn = document.getElementById('loadMoreBtn');
  if (existingBtn) existingBtn.remove();

  if (patentsToDisplay.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #7f8c8d;">該当する特許が見つかりませんでした。</p>';
    return;
  }

  // 最大8件表示
  const toShow = patentsToDisplay.slice(0, displayedCount);
  toShow.forEach(patent => {
    grid.appendChild(createPatentCard(patent));
  });

  // まだ残りがあれば「もっと見る」ボタンを表示
  if (patentsToDisplay.length > displayedCount) {
    const loadMoreWrapper = document.createElement('div');
    loadMoreWrapper.id = 'loadMoreBtn';
    loadMoreWrapper.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 1rem 0 2rem;';
    loadMoreWrapper.innerHTML = `
      <button onclick="loadMore()" style="
        background: white;
        color: #667eea;
        border: 2px solid #667eea;
        padding: 0.8rem 3rem;
        border-radius: 50px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
      " onmouseover="this.style.background='#667eea';this.style.color='white';"
         onmouseout="this.style.background='white';this.style.color='#667eea';">
        もっと見る
      </button>
    `;
    grid.after(loadMoreWrapper);
  }

  // フィルター後はカウントリセット用に現在の表示対象を保持
  grid._currentPatents = patentsToDisplay;
}

// もっと見るボタン押下
function loadMore() {
  const grid = document.getElementById('patentGrid');
  const patents = grid._currentPatents || allPatents;
  displayedCount += 8;
  displayPatents(patents);
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
   (patent.title || '').toLowerCase().includes(searchLower) || 
   (patent.description || '').toLowerCase().includes(searchLower) ||
   (patent.ai_summary || '').toLowerCase().includes(searchLower)
 );
 }
 
 displayedCount = 8; // フィルター変更時はリセット
 displayPatents(filtered);
}

// 特許データを取得
async function loadPatents() {
 try {
 console.log('特許データを取得中...');
 showLoading();
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
