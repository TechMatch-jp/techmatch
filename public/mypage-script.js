let currentUser = null;

// ページ読み込み時の処理
document.addEventListener('DOMContentLoaded', async function() {
    await checkAuth();
    if (currentUser) {
        loadDashboard();
    }
});

// 認証チェック
async function checkAuth() {
    console.log('=== checkAuth 開始 (mypage-script.js) ===');
    try {
        const response = await fetch('/api/user');
        console.log('Response status:', response.status);
        if (response.ok) {
            const data = await response.json();
            console.log('User data received:', data);
            currentUser = data; // data.user ではなく data 自体がユーザー情報
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('welcomeName').textContent = currentUser.name;
        } else {
            console.error('Auth failed, redirecting to auth.html');
            window.location.href = 'auth.html';
        }
    } catch (error) {
        console.error('Auth error:', error);
        window.location.href = 'auth.html';
    }
}

// ダッシュボード読み込み
async function loadDashboard() {
    const myPatents = await fetchMyPatents();
    const myInterests = await fetchMyInterests();
    const receivedInterests = await fetchReceivedInterests();

    // ページによっては存在しない要素があるため、nullチェックしてから更新する
    const patentCountEl = document.getElementById('patentCount');
    if (patentCountEl) patentCountEl.textContent = myPatents.length;

    const interestCountEl = document.getElementById('interestCount');
    if (interestCountEl) interestCountEl.textContent = myInterests.length;

    const receivedInterestCountEl = document.getElementById('receivedInterestCount');
    if (receivedInterestCountEl) receivedInterestCountEl.textContent = receivedInterests.length;
}

// サイドバーナビゲーション
document.querySelectorAll('.sidebar-menu a').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        
        // アクティブクラスの切り替え
        document.querySelectorAll('.sidebar-menu a').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        
        // セクションの切り替え
        const sectionId = this.dataset.section;
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(sectionId).classList.add('active');
        
        // データ読み込み
        loadSectionData(sectionId);
    });
});

// セクションデータの読み込み
async function loadSectionData(sectionId) {
    switch(sectionId) {
        case 'dashboard':
            await loadDashboard();
            break;
        // 画面によって sectionId 名が違うので両方対応
        case 'my-patents':
        case 'patents':
            await loadMyPatents();
            break;
        case 'interests':
            await loadInterests();
            break;
        case 'received-interests':
            await loadReceivedInterests();
            break;
        case 'my-columns':
            await loadMyColumns();
            break;
    }
}

// 登録した特許を取得
async function fetchMyPatents() {
    try {
        // サーバー側に「自分の特許」専用APIがあるのでそれを使う
        const response = await fetch('/api/user/patents');
        if (!response.ok) return [];
        const patents = await response.json();
        return Array.isArray(patents) ? patents : [];
    } catch (error) {
        console.error('特許の取得に失敗しました', error);
    }
    return [];
}

// 登録した特許を表示
async function loadMyPatents() {
    const patents = await fetchMyPatents();

    // 画面によってコンテナIDが違うので両方対応
    const approvedOrAllContainer = document.getElementById('patentList') || document.getElementById('patentsList');
    const pendingContainer = document.getElementById('pendingPatentsList');
    const rejectedContainer = document.getElementById('rejectedPatentsList');

    // approval_status で分ける（無い場合は全部同じ扱い）
    const pending = patents.filter(p => (p.approval_status || p.approvalStatus) === 'pending');
    const approved = patents.filter(p => (p.approval_status || p.approvalStatus) === 'approved');
    const rejected = patents.filter(p => (p.approval_status || p.approvalStatus) === 'rejected');

    const renderLines = (container, items, emptyText) => {
        if (!container) return;
        if (!items || items.length === 0) {
            container.innerHTML = `<p style="color:#7f8c8d;">${emptyText}</p>`;
            return;
        }
        container.innerHTML = '';
        items.forEach(p => {
            const line = document.createElement('div');
            line.style.padding = '10px 0';
            line.style.borderBottom = '1px solid #ecf0f1';

            const num = p.patent_number || p.patentNumber || '';
            const title = p.title || '';
            const price = (p.price !== undefined && p.price !== null) ? Number(p.price).toLocaleString() : '';
            const status = (p.approval_status || p.approvalStatus || '').toString();

            // 1行テキスト表示（カードじゃなく）
            line.textContent = `${title}｜特許番号：${num}${price ? `｜価格：¥${price}` : ''}${status ? `｜状態：${status}` : ''}`;
            container.appendChild(line);
        });
    };

    // 既存UIに合わせて描画（sellerページは pending/approved/rejected を分ける）
    if (pendingContainer || rejectedContainer) {
        renderLines(pendingContainer, pending, '審査中の特許はありません');
        // sellerページ側の「承認済み・却下」は同じコンテナにしている場合があるので対応
        const approvedRejectedContainer = document.getElementById('approvedRejectedPatentsList') || approvedOrAllContainer;
        renderLines(approvedRejectedContainer, [...approved, ...rejected], '承認済み・却下の特許はありません');
        renderLines(rejectedContainer, rejected, '却下の特許はありません');
    } else {
        // 旧mypage.html系は1つの一覧だけ
        renderLines(approvedOrAllContainer, patents, 'まだ特許を登録していません。');
    }
}

// 特許カード作成
function createPatentCard(patent) {
    const card = document.createElement('div');
    card.className = 'patent-card';
    
    const categoryNames = {
        ai: 'AI・機械学習',
        iot: 'IoT',
        medical: '医療機器',
        manufacturing: '製造技術',
        energy: 'エネルギー'
    };
    
    const statusNames = {
        available: '利用可能',
        negotiation: '交渉中'
    };
    
    card.innerHTML = `
        <div class="card-image">🔬</div>
        <div class="card-content">
            <h4 class="card-title">${patent.title}</h4>
            <p class="card-description">${patent.description}</p>
            <div style="margin: 0.5rem 0;">
                <span class="card-category">${categoryNames[patent.category]}</span>
            </div>
            <div class="card-meta">
                <span>${patent.patentNumber}</span>
                <span class="card-status ${patent.status}">${statusNames[patent.status]}</span>
            </div>
            <div class="card-meta">
                <span>価格: ¥${patent.price.toLocaleString()}</span>
            </div>
        </div>
    `;
    
    return card;
}

// 興味表明を取得
async function fetchMyInterests() {
    try {
        const response = await fetch('/api/my-interests');
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('興味表明の取得に失敗しました', error);
    }
    return [];
}

// 興味表明を表示
async function loadInterests() {
    const interests = await fetchMyInterests();
    const container = document.getElementById('interestList');
    
    if (interests.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d;">まだ興味表明をしていません。</p>';
        return;
    }
    
    container.innerHTML = '';
    interests.forEach(interest => {
        const item = document.createElement('div');
        item.style.cssText = 'background: white; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
        item.innerHTML = `
            <h4>特許ID: ${interest.patentId}</h4>
            <p>${interest.message}</p>
            <small style="color: #7f8c8d;">ステータス: ${interest.status === 'pending' ? '保留中' : interest.status === 'accepted' ? '承認済み' : '却下'}</small>
        `;
        container.appendChild(item);
    });
}

// 受信した興味表明を取得
async function fetchReceivedInterests() {
    try {
        const response = await fetch('/api/patent-interests');
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('受信した興味表明の取得に失敗しました', error);
    }
    return [];
}

// 受信した興味表明を表示
async function loadReceivedInterests() {
    const interests = await fetchReceivedInterests();
    const container = document.getElementById('receivedInterestList');
    
    if (interests.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d;">まだ興味表明を受けていません。</p>';
        return;
    }
    
    container.innerHTML = '';
    interests.forEach(interest => {
        const item = document.createElement('div');
        item.style.cssText = 'background: white; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
        item.innerHTML = `
            <h4>${interest.userName}さんからの興味表明</h4>
            <p>特許ID: ${interest.patentId}</p>
            <p>${interest.message}</p>
            <small style="color: #7f8c8d;">${new Date(interest.createdAt).toLocaleDateString()}</small>
        `;
        container.appendChild(item);
    });
}

// 投稿したコラムを表示
async function loadMyColumns() {
    try {
        const response = await fetch('/api/columns');
        if (response.ok) {
            const allColumns = await response.json();
            const myColumns = allColumns.filter(c => c.authorId === currentUser.id);
            
            const container = document.getElementById('columnList');
            
            if (myColumns.length === 0) {
                container.innerHTML = '<p style="color: #7f8c8d;">まだコラムを投稿していません。</p>';
                return;
            }
            
            container.innerHTML = '';
            myColumns.forEach(column => {
                const card = createColumnCard(column);
                container.appendChild(card);
            });
        }
    } catch (error) {
        console.error('コラムの取得に失敗しました', error);
    }
}

// コラムカード作成
function createColumnCard(column) {
    const card = document.createElement('div');
    card.className = 'column-card';
    
    const categoryNames = {
        'patent-basics': '特許基礎知識',
        'technology-trend': '技術トレンド',
        'case-study': '活用事例',
        'legal': '法律・制度'
    };
    
    card.innerHTML = `
        <div class="card-image">📝</div>
        <div class="card-content">
            <h4 class="card-title">${column.title}</h4>
            <p class="card-description">${column.description}</p>
            <div style="margin: 0.5rem 0;">
                <span class="card-category">${categoryNames[column.category]}</span>
            </div>
            <div class="card-meta">
                <span>${column.author}</span>
                <span>${column.readTime}で読めます</span>
            </div>
        </div>
    `;
    
    return card;
}

// ログアウト
document.getElementById('logoutBtn').addEventListener('click', async function() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = 'index.html';
    } catch (error) {
        alert('ログアウトに失敗しました');
    }
});

// 特許登録モーダル
document.getElementById('addPatentBtn').addEventListener('click', () => openPatentModal());
document.getElementById('addPatentBtn2').addEventListener('click', () => openPatentModal());

function openPatentModal() {
    document.getElementById('patentModal').classList.add('active');
}

function closePatentModal() {
    document.getElementById('patentModal').classList.remove('active');
    document.getElementById('patentForm').reset();
}

// 特許登録フォーム送信
document.getElementById('patentForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = {
        title: document.getElementById('patentTitle').value,
        description: document.getElementById('patentDescription').value,
        category: document.getElementById('patentCategory').value,
        patentNumber: document.getElementById('patentNumber').value,
        price: document.getElementById('patentPrice').value
    };
    
    try {
        const response = await fetch('/api/patents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            alert('特許を登録しました');
            closePatentModal();
            loadMyPatents();
            loadDashboard();
        } else {
            const data = await response.json();
            alert(data.error || '登録に失敗しました');
        }
    } catch (error) {
        alert('通信エラーが発生しました');
    }
});

// コラム投稿モーダル
document.getElementById('addColumnBtn').addEventListener('click', () => openColumnModal());
document.getElementById('addColumnBtn2').addEventListener('click', () => openColumnModal());

function openColumnModal() {
    document.getElementById('columnModal').classList.add('active');
}

function closeColumnModal() {
    document.getElementById('columnModal').classList.remove('active');
    document.getElementById('columnForm').reset();
}

// コラム投稿フォーム送信
document.getElementById('columnForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = {
        title: document.getElementById('columnTitle').value,
        description: document.getElementById('columnDescription').value,
        category: document.getElementById('columnCategory').value,
        content: document.getElementById('columnContent').value
    };
    
    try {
        const response = await fetch('/api/columns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            alert('コラムを投稿しました');
            closeColumnModal();
            loadMyColumns();
            loadDashboard();
        } else {
            const data = await response.json();
            alert(data.error || '投稿に失敗しました');
        }
    } catch (error) {
        alert('通信エラーが発生しました');
    }
});
