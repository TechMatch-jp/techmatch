// カテゴリー名のマッピング
const categoryNames = {
    ai: "AI・機械学習",
    iot: "IoT",
    medical: "医療機器",
    manufacturing: "製造技術",
    energy: "エネルギー"
};

// ステータス名のマッピング
const statusNames = {
    available: "利用可能",
    negotiation: "交渉中"
};

let allPatents = [];
let currentCategory = '';
let currentSearchTerm = '';

// 特許カードを生成する関数
function createPatentCard(patent) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = 'pointer';
    
    const categoryEmoji = {
        'ai': '🤖',
        'iot': '🌾',
        'medical': '❤️',
        'manufacturing': '🏭',
        'energy': '☀️'
    };
    
    card.innerHTML = `
        <div class="card-header">${categoryEmoji[patent.category] || '📄'}</div>
        <div class="card-body">
            <h3 class="card-title">${patent.title}</h3>
            <p class="card-description">
                ${patent.description}
            </p>
            <div class="card-tags">
                <span class="tag">${categoryNames[patent.category] || patent.category}</span>
            </div>
            <div class="card-footer">
                <span class="status-badge status-${patent.status}">${statusNames[patent.status] || patent.status}</span>
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
