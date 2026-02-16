// カテゴリー名のマッピング
const categoryNames = {
    'researcher-interview': "研究者インタビュー",
    'university-researcher': "大学研究者",
    'corporate-researcher': "企業研究者",
    'startup': "スタートアップ"
};

let allInterviews = [];

// インタビューカードを生成する関数
function createInterviewCard(interview) {
    const card = document.createElement('div');
    card.className = 'interview-card';
    card.style.cursor = 'pointer';
    
    // 画像URLを取得（WordPressのアイキャッチ画像またはデフォルト画像）
    const imageUrl = interview.featuredImage || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop';
    
    // カテゴリー名をマッピング
    const categoryDisplayName = categoryNames[interview.category] || interview.category;
    
    card.innerHTML = `
        <div class="card-image-container">
            <img src="${imageUrl}" alt="${interview.title}" class="card-image-photo">
        </div>
        <div class="card-content">
            <div style="margin-bottom: 0.75rem;">
                <span class="card-category-badge">${categoryDisplayName}</span>
            </div>
            <h4 class="card-title">${interview.title}</h4>
            <p class="card-description">${interview.description}</p>
        </div>
    `;
    
    // クリックでインタビュー詳細ページに遷移
    card.addEventListener('click', () => {
        window.location.href = `interview-detail.html?id=${interview.id}`;
    });
    
    return card;
}

// インタビュー一覧を表示する関数
function displayInterviews(interviewsToDisplay) {
    const grid = document.getElementById('interviewGrid');
    grid.innerHTML = '';
    
    if (interviewsToDisplay.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #7f8c8d;">該当するインタビューが見つかりませんでした。</p>';
        return;
    }
    
    interviewsToDisplay.forEach(interview => {
        grid.appendChild(createInterviewCard(interview));
    });
}

// インタビューデータを取得（研究者インタビューカテゴリーのみ）
async function loadInterviews() {
    try {
        const response = await fetch('/api/interviews?category=researcher-interview');
        if (response.ok) {
            allInterviews = await response.json();
            displayInterviews(allInterviews);
        }
    } catch (error) {
        console.error('インタビューデータの取得に失敗しました', error);
    }
}

// カテゴリーフィルター処理
function filterByCategory(category) {
    if (category === 'all') {
        displayInterviews(allInterviews);
    } else {
        const filtered = allInterviews.filter(interview => interview.category === category);
        displayInterviews(filtered);
    }
}

// イベントリスナーの設定
document.addEventListener('DOMContentLoaded', function() {
    // 初期表示
    loadInterviews();
    
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
