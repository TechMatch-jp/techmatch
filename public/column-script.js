// カテゴリー名のマッピング
const categoryNames = {
    "tech-column": "技術コラム",
    "patent-basics": "特許基礎知識",
    "technology-trend": "技術トレンド",
    "case-study": "活用事例",
    "legal": "法律・制度"
};

let allColumns = [];

// コラムカードを生成する関数
function createColumnCard(column) {
    const card = document.createElement('div');
    card.className = 'column-card';
    card.style.cursor = 'pointer';
    
    // 画像URLを取得（WordPressのアイキャッチ画像またはデフォルト画像）
    const imageUrl = column.featuredImage || 'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=800&auto=format&fit=crop';
    
    // カテゴリー名をマッピング
    const categoryDisplayName = categoryNames[column.category] || column.category;
    
    card.innerHTML = `
        <div class="card-image-container">
            <img src="${imageUrl}" alt="${column.title}" class="card-image-photo">
        </div>
        <div class="card-content">
            <div style="margin-bottom: 0.75rem;">
                <span class="card-category-badge">${categoryDisplayName}</span>
            </div>
            <h4 class="card-title">${column.title}</h4>
            <p class="card-description">${column.description}</p>
        </div>
    `;
    
    // クリックでコラム詳細ページに遷移
    card.addEventListener('click', () => {
        window.location.href = `column-detail.html?id=${column.id}`;
    });
    
    return card;
}

// コラム一覧を表示する関数
function displayColumns(columnsToDisplay) {
    const grid = document.getElementById('columnGrid');
    grid.innerHTML = '';
    
    if (columnsToDisplay.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #7f8c8d;">該当するコラムが見つかりませんでした。</p>';
        return;
    }
    
    columnsToDisplay.forEach(column => {
        grid.appendChild(createColumnCard(column));
    });
}

// コラムデータを取得（技術コラムカテゴリーのみ）
async function loadColumns() {
    try {
        const response = await fetch('/api/columns?category=tech-column');
        if (response.ok) {
            allColumns = await response.json();
            displayColumns(allColumns);
        }
    } catch (error) {
        console.error('コラムデータの取得に失敗しました', error);
    }
}

// カテゴリーフィルター処理
function filterByCategory(category) {
    if (category === 'all') {
        displayColumns(allColumns);
    } else {
        const filtered = allColumns.filter(column => column.category === category);
        displayColumns(filtered);
    }
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', function() {
    // 初期表示
    loadColumns();
    
    // カテゴリーボタンのクリックイベント
    const categoryButtons = document.querySelectorAll('.category-btn');
    categoryButtons.forEach(button => {
        button.addEventListener('click', function() {
            // すべてのボタンからactiveクラスを削除
            categoryButtons.forEach(btn => btn.classList.remove('active'));
            // クリックされたボタンにactiveクラスを追加
            this.classList.add('active');
            // フィルター実行
            const category = this.getAttribute('data-category');
            filterByCategory(category);
        });
    });
});
