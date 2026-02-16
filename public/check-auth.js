// ログイン状態チェック（全ページ共通）
async function checkLoginStatus() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            const data = await response.json();
            // ログインリンクをマイページに変更
            const authLinks = document.querySelectorAll('a[href="auth.html"]');
            authLinks.forEach(link => {
                if (!link.closest('.main-footer')) { // フッター以外
                    link.textContent = 'マイページ';
                    link.href = 'mypage.html';
                }
            });
        }
    } catch (error) {
        // ログインしていない場合は何もしない
        console.log('Not logged in or error:', error);
    }
}

// ページ読み込み時に実行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkLoginStatus);
} else {
    checkLoginStatus();
}
