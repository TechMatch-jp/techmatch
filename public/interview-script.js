// カテゴリー名のマッピング
const categoryNames = {
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

    const imageUrl = interview.featuredImage || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop';
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
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #7f8c8d;">インタビューはまだ投稿されていません。</p>';
        return;
    }

    interviewsToDisplay.forEach(interview => {
        grid.appendChild(createInterviewCard(interview));
    });
}

// Supabaseからインタビューデータを取得
async function loadInterviews() {
    const grid = document.getElementById('interviewGrid');
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #7f8c8d;">読み込み中...</p>';
    try {
        const response = await fetch('/api/interviews');
        if (response.ok) {
            allInterviews = await response.json();
            displayInterviews(allInterviews);
        } else {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #e74c3c;">インタビューの取得に失敗しました。</p>';
        }
    } catch (error) {
        console.error('インタビューデータの取得に失敗しました', error);
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #e74c3c;">エラーが発生しました。</p>';
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
    loadInterviews();

    const categoryButtons = document.querySelectorAll('.category-btn');
    categoryButtons.forEach(button => {
        button.addEventListener('click', function() {
            categoryButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            filterByCategory(this.getAttribute('data-category'));
        });
    });
});
