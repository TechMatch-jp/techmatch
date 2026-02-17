const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { supabase } = require('./supabase');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'techmatch-secret-key-2026';

// ============ Headless WordPress設定 ============
// 末尾スラッシュを除去して正規化
const WP_BASE_URL = (process.env.WP_BASE_URL || 'http://techmatch.jp/blog').replace(/\/+$/, '');
let wpCategoryCache = { loadedAt: 0, map: new Map() };
const WP_CATEGORY_CACHE_TTL_MS = 10 * 60 * 1000;

// WordPress REST API の複数 URL 形式に対応
// 順に試行: 1) wp-json  2) ?rest_route=  3) index.php?rest_route=
const WP_REST_URL_FORMATS = [
    (ep, qs) => `${WP_BASE_URL}/wp-json/wp/v2/${ep}${qs ? '?' + qs : ''}`,
    (ep, qs) => `${WP_BASE_URL}/?rest_route=/wp/v2/${ep}${qs ? '&' + qs : ''}`,
    (ep, qs) => `${WP_BASE_URL}/index.php?rest_route=/wp/v2/${ep}${qs ? '&' + qs : ''}`
];
let wpRestUrlFormatIndex = process.env.WP_REST_FORMAT ? parseInt(process.env.WP_REST_FORMAT, 10) : -1;

async function wpFetchJson(endpoint, params = {}) {
    const headers = { 'Accept': 'application/json', 'User-Agent': 'TechMatch/1.0 (WordPress Integration)' };
    const qs = new URLSearchParams(params).toString();
    const formatsToTry = wpRestUrlFormatIndex >= 0
        ? [WP_REST_URL_FORMATS[wpRestUrlFormatIndex]]
        : WP_REST_URL_FORMATS;
    let lastResp = null;
    for (let i = 0; i < formatsToTry.length; i++) {
        const url = formatsToTry[i](endpoint, qs);
        const resp = await fetch(url, { headers });
        lastResp = resp;
        if (resp.ok) {
            wpRestUrlFormatIndex = wpRestUrlFormatIndex >= 0 ? wpRestUrlFormatIndex : WP_REST_URL_FORMATS.indexOf(formatsToTry[i]);
            return resp.json();
        }
    }
    const err = new Error(`WP fetch failed: ${lastResp?.status || '?'} ${lastResp?.statusText || ''}`);
    err.status = lastResp?.status;
    err.body = await lastResp?.text().catch(() => '');
    throw err;
}

function stripHtml(html) {
    return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function estimateReadTimeMinutes(text) {
    const chars = String(text || '').replace(/\s+/g, '').length;
    const minutes = Math.max(1, Math.round(chars / 350));
    return `${minutes}分`;
}

function wpPostToColumn(post) {
    const embeddedTerms = (post && post._embedded && post._embedded['wp:term']) || [];
    const categories = (embeddedTerms[0] || []).filter(t => t && t.taxonomy === 'category');
    const primaryCat = categories[0] || null;
    const title = stripHtml(post.title && post.title.rendered);
    const description = stripHtml(post.excerpt && post.excerpt.rendered);
    const contentHtml = (post.content && post.content.rendered) || '';
    let featuredImage = null;
    if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]) {
        featuredImage = post._embedded['wp:featuredmedia'][0].source_url || null;
    }
    return {
        id: String(post.id),
        title,
        description,
        content: contentHtml,
        category: primaryCat ? primaryCat.slug : 'all',
        author: (post._embedded && post._embedded.author && post._embedded.author[0] && post._embedded.author[0].name) || '編集部',
        createdAt: post.date,
        readTime: estimateReadTimeMinutes(stripHtml(contentHtml)),
        featuredImage
    };
}

function wpPostToInterview(post) {
    const embeddedTerms = (post && post._embedded && post._embedded['wp:term']) || [];
    const categories = (embeddedTerms[0] || []).filter(t => t && t.taxonomy === 'category');
    const primaryCat = categories[0] || null;
    const title = stripHtml(post.title && post.title.rendered);
    const description = stripHtml(post.excerpt && post.excerpt.rendered);
    const contentHtml = (post.content && post.content.rendered) || '';
    let featuredImage = null;
    if (post._embedded && post._embedded['wp:featuredmedia'] && post._embedded['wp:featuredmedia'][0]) {
        featuredImage = post._embedded['wp:featuredmedia'][0].source_url || null;
    }
    return {
        id: String(post.id),
        title,
        description,
        content: contentHtml,
        category: primaryCat ? primaryCat.name : '',
        categorySlug: primaryCat ? primaryCat.slug : '',
        interviewer: (post._embedded && post._embedded.author && post._embedded.author[0] && post._embedded.author[0].name) || '編集部',
        createdAt: post.date,
        readTime: estimateReadTimeMinutes(stripHtml(contentHtml)),
        featuredImage
    };
}

// カテゴリ名の別名マッピング（slug などで検索できるように）
const CATEGORY_ALIASES = {
    '技術コラム': ['技術コラム', 'tech-column', 'gijutsu-koramu'],
    '研究者インタビュー': ['研究者インタビュー', 'researcher-interview', 'kenkyusha-interview']
};

async function getCategoryIdByName(categoryName) {
    const now = Date.now();
    if (now - wpCategoryCache.loadedAt > WP_CATEGORY_CACHE_TTL_MS) {
        wpCategoryCache.map.clear();
        wpCategoryCache.loadedAt = now;
    }
    const aliases = CATEGORY_ALIASES[categoryName] || [categoryName];
    for (const alias of aliases) {
        if (wpCategoryCache.map.has(alias)) {
            return wpCategoryCache.map.get(alias);
        }
    }
    try {
        const cats = await wpFetchJson('categories', { per_page: 100 });
        for (const c of cats) {
            wpCategoryCache.map.set(String(c.name).trim(), c.id);
            wpCategoryCache.map.set(String(c.slug).trim(), c.id);
        }
        for (const alias of aliases) {
            const id = wpCategoryCache.map.get(alias);
            if (id) return id;
        }
        return wpCategoryCache.map.get(categoryName) || null;
    } catch (err) {
        console.error('カテゴリ取得エラー:', err.message, 'URL:', `${WP_BASE_URL}/wp-json/wp/v2/categories`);
        return null;
    }
}

// ============ Express設定 ============
app.use('/blog', createProxyMiddleware({
    target: 'http://www3050.sakura.ne.jp',
    changeOrigin: true,
    headers: { host: 'techmatch.jp' }
}));
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// 動作確認用（ブラウザで http://localhost:3000/api/ping を開く）
app.get('/api/ping', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

// WordPress接続確認用（http://localhost:3000/api/wp-status でデバッグ）
app.get('/api/wp-status', async (req, res) => {
    const urls = [
        `${WP_BASE_URL}/wp-json/wp/v2/categories`,
        `${WP_BASE_URL}/?rest_route=/wp/v2/categories`,
        `${WP_BASE_URL}/index.php?rest_route=/wp/v2/categories`
    ];
    const result = {
        wpBaseUrl: WP_BASE_URL,
        testedUrls: urls,
        testResults: [],
        workingFormat: null,
        postsReachable: false,
        categoriesReachable: false,
        totalCategories: 0,
        columnCategoryId: null,
        interviewCategoryId: null,
        categories: [],
        hint: null
    };
    const headers = { 'Accept': 'application/json', 'User-Agent': 'TechMatch/1.0' };
    for (let i = 0; i < urls.length; i++) {
        const tr = { url: urls[i], status: null, error: null };
        try {
            const r = await fetch(urls[i], { headers, signal: AbortSignal.timeout(10000) });
            tr.status = r.status;
            if (r.ok) {
                result.workingFormat = i;
                result.categoriesReachable = true;
                const cats = await r.json();
                result.totalCategories = Array.isArray(cats) ? cats.length : 0;
                result.categories = (Array.isArray(cats) ? cats : []).slice(0, 20).map(c => ({ id: c.id, name: c.name, slug: c.slug }));
                wpRestUrlFormatIndex = i;
                result.columnCategoryId = await getCategoryIdByName('技術コラム');
                result.interviewCategoryId = await getCategoryIdByName('研究者インタビュー');
                const sep = urls[i].includes('?') ? '&' : '?';
                const postsUrl = urls[i].replace('/categories', '/posts') + sep + 'per_page=1';
                try {
                    const pr = await fetch(postsUrl, { headers });
                    result.postsReachable = pr.ok;
                } catch (_) {}
                result.testResults.push(tr);
                return res.json(result);
            }
        } catch (e) {
            tr.error = e.cause?.code || e.message || String(e);
        }
        result.testResults.push(tr);
    }
    const all404 = result.testResults.every(t => t.status === 404);
    const allError = result.testResults.every(t => t.error);
    result.hint = all404
        ? 'WordPressのREST APIが無効か、パーマリンク設定を再保存してください。（管理画面→設定→パーマリンク→変更を保存）'
        : allError
            ? 'techmatch.jp に接続できません。hosts ファイルで techmatch.jp が 127.0.0.1 になっていないか確認してください。'
            : '接続に失敗しました。';
    res.json(result);
});

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, UPLOAD_DIR); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

function authenticateToken(req, res, next) {
    // 開発用: 環境変数で認証スキップできるようにする
    // 例) Windows(PowerShell):  $env:SKIP_AUTH='true'; npm start
    //     Mac/Linux:           SKIP_AUTH=true npm start
    if (String(process.env.SKIP_AUTH || '').toLowerCase() === 'true') {
        req.user = { id: 'dev', email: 'dev@local', name: 'Dev', userType: 'admin' };
        return next();
    }
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'ログインが必要です' });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: '無効なトークンです' });
    }
}

// ============ ユーザー認証 API ============
app.post('/api/register', async (req, res) => {
    console.log('=== ユーザー登録リクエスト受信 ===');
    console.log('Request body:', req.body);
    try {
        const { email, password, name, userType, organization } = req.body;
        console.log('1. データ抽出完了:', { email, name, userType, organization });
        
        console.log('2. 既存ユーザーチェック中...');
        const { data: existingUser, error: checkError } = await supabase.from('users').select('id').eq('email', email).single();
        console.log('既存ユーザーチェック結果:', { existingUser, checkError });
        
        if (existingUser) {
            console.log('エラー: メールアドレス重複');
            return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
        }
        
        console.log('3. パスワードハッシュ化中...');
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('パスワードハッシュ化完了');
        
        console.log('4. Supabaseに挿入中...');
        const insertData = {
            email, 
            password: hashedPassword, 
            name, 
            user_type: userType, 
            organization
        };
        console.log('挿入データ:', insertData);
        
        const { data: newUser, error } = await supabase.from('users').insert([insertData]).select().single();
        
        console.log('5. 挿入結果:', { newUser, error });
        
        if (error) {
            console.error('❌ Supabase insert error:', error);
            console.error('Error details:', JSON.stringify(error, null, 2));
            return res.status(500).json({ error: '登録に失敗しました: ' + error.message });
        }
        
        console.log('✅ 登録成功:', newUser.id);
        res.json({ message: '登録が完了しました', userId: newUser.id });
    } catch (error) {
        console.error('❌ Registration error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: '登録に失敗しました: ' + error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();
        if (error || !user) return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name, userType: user.user_type },
            SECRET_KEY,
            { expiresIn: '7d' }
        );
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ message: 'ログインに成功しました', user: { id: user.id, email: user.email, name: user.name, userType: user.user_type } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'ログインに失敗しました' });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'ログアウトしました' });
});

app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase.from('users').select('id, email, name, user_type, organization, created_at').eq('id', req.user.id).single();
        if (error || !user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
        res.json({ id: user.id, email: user.email, name: user.name, userType: user.user_type, organization: user.organization, createdAt: user.created_at });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' });
    }
});


// ============ 特許 API ============
app.get('/api/patents', async (req, res) => {
    try {
        const { category, status, search, owner } = req.query;

        // owner=all の場合は「全件」を返す（管理画面の統計用）
        if (owner === 'all') {
            return authenticateToken(req, res, async () => {
                let query = supabase
                    .from('patents')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (category && category !== 'all') query = query.eq('category', category);
                if (status) query = query.eq('status', status);

                const { data: patents, error } = await query;
                if (error) {
                    console.error('All patents fetch error:', error);
                    return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
                }

                let filteredPatents = patents || [];
                if (search) {
                    const searchLower = search.toLowerCase();
                    filteredPatents = filteredPatents.filter(p =>
                        p.title?.toLowerCase().includes(searchLower) ||
                        p.description?.toLowerCase().includes(searchLower) ||
                        p.category?.toLowerCase().includes(searchLower)
                    );
                }
                return res.json(filteredPatents);
            });
        }

        // owner=me の場合は「自分が登録した特許」を返す（審査中/承認済/却下すべて含む）
        if (owner === 'me') {
            // 認証必須（SKIP_AUTH=true のときは authenticateToken が通す）
            return authenticateToken(req, res, async () => {
                // NOTE: 既存データが手動投入で owner_id が入っていないケースでも
                // 開発中に画面確認できるよう、owner_id が NULL のものも拾う（owner=me のみ）。
                let query = supabase
                    .from('patents')
                    .select('*')
                    .or(`owner_id.eq.${req.user.id},owner_id.is.null`)
                    .order('created_at', { ascending: false });

                if (category && category !== 'all') query = query.eq('category', category);
                if (status) query = query.eq('status', status);

                const { data: patents, error } = await query;
                if (error) {
                    console.error('My patents fetch error:', error);
                    return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
                }

                let filteredPatents = patents || [];
                if (search) {
                    const searchLower = search.toLowerCase();
                    filteredPatents = filteredPatents.filter(p =>
                        p.title?.toLowerCase().includes(searchLower) ||
                        p.description?.toLowerCase().includes(searchLower) ||
                        p.category?.toLowerCase().includes(searchLower)
                    );
                }
                return res.json(filteredPatents);
            });
        }

        // 公開一覧（承認済みのみ）
        let query = supabase
            .from('patents')
            .select('*')
            .eq('approval_status', 'approved')
            .order('created_at', { ascending: false });

        if (category && category !== 'all') query = query.eq('category', category);
        if (status) query = query.eq('status', status);

        const { data: patents, error } = await query;
        if (error) {
            console.error('Patents fetch error:', error);
            return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
        }

        let filteredPatents = patents || [];
        if (search) {
            const searchLower = search.toLowerCase();
            filteredPatents = filteredPatents.filter(p =>
                p.title?.toLowerCase().includes(searchLower) ||
                p.description?.toLowerCase().includes(searchLower) ||
                p.category?.toLowerCase().includes(searchLower)
            );
        }
        res.json(filteredPatents);
    } catch (error) {
        console.error('Get patents error:', error);
        res.status(500).json({ error: '特許一覧の取得に失敗しました' });
    }
});


app.get('/api/patents/:id', async (req, res) => {
    try {
        const { data: patent, error } = await supabase.from('patents').select('*').eq('id', req.params.id).single();
        if (error || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        res.json(patent);
    } catch (error) {
        console.error('Get patent detail error:', error);
        res.status(500).json({ error: '特許詳細の取得に失敗しました' });
    }
});

app.post('/api/patents', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const { title, description, problem, usage, advantage, category, patentNumber, price } = req.body;
        const { data: newPatent, error } = await supabase.from('patents').insert([{
            title, description, problem, usage, advantage, category,
            patent_number: patentNumber,
            price: parseFloat(price) || 0,
            status: 'available',
            approval_status: 'pending',
            owner_id: req.user.id,
            owner_name: req.user.name,
            image: req.file ? `/uploads/${req.file.filename}` : null
        }]).select().single();
        if (error) {
            console.error('Patent insert error:', error);
            return res.status(500).json({ error: '特許の登録に失敗しました' });
        }
        res.json({ message: '特許を登録しました。管理者の承認後に公開されます。', patent: newPatent });
    } catch (error) {
        console.error('Create patent error:', error);
        res.status(500).json({ error: '特許の登録に失敗しました' });
    }
});

app.put('/api/patents/:id', authenticateToken, async (req, res) => {
    try {
        const { data: patent, error: fetchError } = await supabase.from('patents').select('*').eq('id', req.params.id).single();
        if (fetchError || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        if (patent.owner_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { title, description, problem, usage, advantage, category, patentNumber, price, status } = req.body;
        const { data: updatedPatent, error: updateError } = await supabase.from('patents').update({
            title, description, problem, usage, advantage, category,
            patent_number: patentNumber,
            price: parseFloat(price),
            status
        }).eq('id', req.params.id).select().single();
        if (updateError) {
            console.error('Patent update error:', updateError);
            return res.status(500).json({ error: '特許の更新に失敗しました' });
        }
        res.json({ message: '特許を更新しました', patent: updatedPatent });
    } catch (error) {
        console.error('Update patent error:', error);
        res.status(500).json({ error: '特許の更新に失敗しました' });
    }
});

app.delete('/api/patents/:id', authenticateToken, async (req, res) => {
    try {
        const { data: patent, error: fetchError } = await supabase.from('patents').select('*').eq('id', req.params.id).single();
        if (fetchError || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        if (patent.owner_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { error: deleteError } = await supabase.from('patents').delete().eq('id', req.params.id);
        if (deleteError) {
            console.error('Patent delete error:', deleteError);
            return res.status(500).json({ error: '特許の削除に失敗しました' });
        }
        if (patent.image) {
            const imagePath = path.join(__dirname, 'public', patent.image);
            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        }
        res.json({ message: '特許を削除しました' });
    } catch (error) {
        console.error('Delete patent error:', error);
        res.status(500).json({ error: '特許の削除に失敗しました' });
    }
});

app.get('/api/user/patents', authenticateToken, async (req, res) => {
    try {
        const { data: patents, error } = await supabase.from('patents').select('*').eq('owner_id', req.user.id).order('created_at', { ascending: false });
        if (error) {
            console.error('User patents fetch error:', error);
            return res.status(500).json({ error: 'ユーザーの特許取得に失敗しました' });
        }
        res.json(patents || []);
    } catch (error) {
        console.error('Get user patents error:', error);
        res.status(500).json({ error: 'ユーザーの特許取得に失敗しました' });
    }
});


// ============ 興味表明 API ============
// 自分が送った興味表明（購入者側）
app.get('/api/my-interests', authenticateToken, async (req, res) => {
    try {
        const { data: interests, error } = await supabase
            .from('interests')
            .select('*')
            .eq('buyer_id', req.user.id)
            .order('created_at', { ascending: false });
        if (error) {
            console.error('My interests fetch error:', error);
            return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        }
        res.json(interests || []);
    } catch (err) {
        console.error('Get my interests error:', err);
        res.status(500).json({ error: '興味表明の取得に失敗しました' });
    }
});

// 自分の特許に届いた興味表明（研究機関ユーザー側）
// 既存UI(mypage-seller.html)が期待する形に整形して返す
app.get('/api/patent-interests', authenticateToken, async (req, res) => {
    try {
        // 自分の特許ID一覧
        const { data: myPatents, error: pErr } = await supabase
            .from('patents')
            .select('id,title,owner_id')
            .or(`owner_id.eq.${req.user.id},owner_id.is.null`)
            .order('created_at', { ascending: false });
        if (pErr) {
            console.error('Patents (for interests) fetch error:', pErr);
            return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        }
        const patentIds = (myPatents || []).map(p => p.id).filter(Boolean);
        if (patentIds.length === 0) return res.json([]);

        const { data: interests, error: iErr } = await supabase
            .from('interests')
            .select('*')
            .in('patent_id', patentIds)
            .order('created_at', { ascending: false });
        if (iErr) {
            console.error('Patent interests fetch error:', iErr);
            return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        }

        // 整形（UI互換）
        const titleById = new Map((myPatents || []).map(p => [p.id, p.title]));
        const normalized = (interests || []).map(it => ({
            id: it.id,
            patentId: it.patent_id,
            patentTitle: titleById.get(it.patent_id) || it.patent_id,
            userName: it.buyer_name || it.buyer_email || '購入者',
            message: it.message || '',
            createdAt: it.created_at
        }));
        res.json(normalized);
    } catch (err) {
        console.error('Get patent interests error:', err);
        res.status(500).json({ error: '興味表明の取得に失敗しました' });
    }
});

app.post('/api/interests', authenticateToken, async (req, res) => {
    try {
        const { patentId, message } = req.body;
        const { data: patent, error: patentError } = await supabase.from('patents').select('*').eq('id', patentId).single();
        if (patentError || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        const { data: newInterest, error } = await supabase.from('interests').insert([{
            patent_id: patentId,
            buyer_id: req.user.id,
            buyer_name: req.user.name,
            buyer_email: req.user.email,
            message: message,
            status: 'pending'
        }]).select().single();
        if (error) {
            console.error('Interest insert error:', error);
            return res.status(500).json({ error: '興味表明の送信に失敗しました' });
        }
        res.json({ message: '興味表明を送信しました', interest: newInterest });
    } catch (error) {
        console.error('Create interest error:', error);
        res.status(500).json({ error: '興味表明の送信に失敗しました' });
    }
});

app.get('/api/user/interests', authenticateToken, async (req, res) => {
    try {
        const { data: interests, error } = await supabase.from('interests').select(`
            *,
            patents (*)
        `).eq('buyer_id', req.user.id).order('created_at', { ascending: false });
        if (error) {
            console.error('User interests fetch error:', error);
            return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        }
        res.json(interests || []);
    } catch (error) {
        console.error('Get user interests error:', error);
        res.status(500).json({ error: '興味表明の取得に失敗しました' });
    }
});

app.get('/api/patents/:patentId/interests', authenticateToken, async (req, res) => {
    try {
        const { data: patent, error: patentError } = await supabase.from('patents').select('*').eq('id', req.params.patentId).single();
        if (patentError || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        if (patent.owner_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { data: interests, error } = await supabase.from('interests').select('*').eq('patent_id', req.params.patentId).order('created_at', { ascending: false });
        if (error) {
            console.error('Patent interests fetch error:', error);
            return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        }
        res.json(interests || []);
    } catch (error) {
        console.error('Get patent interests error:', error);
        res.status(500).json({ error: '興味表明の取得に失敗しました' });
    }
});

// ============ メッセージ API ============
app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { receiverId, patentId, subject, content } = req.body;
        const { data: newMessage, error } = await supabase.from('messages').insert([{
            sender_id: req.user.id,
            receiver_id: receiverId,
            patent_id: patentId || null,
            subject,
            content,
            is_read: false
        }]).select().single();
        if (error) {
            console.error('Message insert error:', error);
            return res.status(500).json({ error: 'メッセージの送信に失敗しました' });
        }
        res.json({ message: 'メッセージを送信しました', messageData: newMessage });
    } catch (error) {
        console.error('Create message error:', error);
        res.status(500).json({ error: 'メッセージの送信に失敗しました' });
    }
});

app.get('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { data: messages, error } = await supabase.from('messages').select('*').or(`sender_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`).order('created_at', { ascending: false });
        if (error) {
            console.error('Messages fetch error:', error);
            return res.status(500).json({ error: 'メッセージの取得に失敗しました' });
        }
        res.json(messages || []);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'メッセージの取得に失敗しました' });
    }
});

app.put('/api/messages/:id/read', authenticateToken, async (req, res) => {
    try {
        const { data: message, error: fetchError } = await supabase.from('messages').select('*').eq('id', req.params.id).single();
        if (fetchError || !message) return res.status(404).json({ error: 'メッセージが見つかりません' });
        if (message.receiver_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { error: updateError } = await supabase.from('messages').update({ is_read: true }).eq('id', req.params.id);
        if (updateError) {
            console.error('Message update error:', updateError);
            return res.status(500).json({ error: 'メッセージの更新に失敗しました' });
        }
        res.json({ message: 'メッセージを既読にしました' });
    } catch (error) {
        console.error('Mark message as read error:', error);
        res.status(500).json({ error: 'メッセージの更新に失敗しました' });
    }
});

// ============ WordPress連携 API（フォールバック付き） ============
// WordPress取得失敗時用のサンプルコラム
const SAMPLE_COLUMNS = [
    { id: '1', title: '特許の基礎知識〜初心者向けガイド', description: '特許とは何か、どう活用するかを分かりやすく解説します。', content: '<p>特許とは、発明を保護するための権利です。登録することで一定期間、独占的にその技術を利用できます。</p><p>本コラムでは、特許の基本から実務的な活用方法まで、初心者の方にも分かりやすくお伝えします。</p>', category: 'patent-basics', author: '編集部', createdAt: '2026-01-15T10:00:00', readTime: '3分', featuredImage: null },
    { id: '2', title: '2026年 注目の技術トレンド', description: 'AI、量子コンピュータ、環境技術など、今年注目すべき技術動向をまとめました。', content: '<p>2026年も技術革新は加速しています。AIと特許の関係、サステナブル技術の台頭など、押さえておくべきトレンドをご紹介します。</p>', category: 'technology-trend', author: '編集部', createdAt: '2026-02-01T10:00:00', readTime: '5分', featuredImage: null },
    { id: '3', title: '大学発特許の企業活用事例', description: '産学連携で生まれた特許が、どのように社会で活かされているかを紹介します。', content: '<p>大学の研究成果を企業が実用化し、製品化に至った成功事例を詳しく解説します。産学連携のポイントもお伝えします。</p>', category: 'case-study', author: '編集部', createdAt: '2026-02-10T10:00:00', readTime: '4分', featuredImage: null }
];

// WordPress取得失敗時用のサンプルインタビュー
const SAMPLE_INTERVIEWS = [
    { id: '1', title: '大学研究者インタビュー： AI研究と特許の未来', description: '最先端のAI研究を行う大学教員に、研究と特許活用についてお話を伺いました。', content: '<p>AI技術の研究は日々進化しています。この分野で特許をどのように活用しているか、実体験を交えてお話しします。</p>', category: 'university-researcher', categorySlug: 'university-researcher', interviewer: '編集部', createdAt: '2026-01-20T10:00:00', readTime: '6分', featuredImage: null },
    { id: '2', title: '企業研究者が語る オープンイノベーション', description: '大企業の研究開発部門で、社外連携と特許マッチングに取り組む研究者へのインタビュー。', content: '<p>オープンイノベーションにおいて、特許マッチングプラットフォームがどのような役割を果たすのか。現場の視点からお伝えします。</p>', category: 'corporate-researcher', categorySlug: 'corporate-researcher', interviewer: '編集部', createdAt: '2026-02-05T10:00:00', readTime: '7分', featuredImage: null }
];

app.get('/api/columns', async (req, res) => {
    try {
        const catName = '技術コラム';
        const catId = await getCategoryIdByName(catName);
        if (!catId) {
            console.warn('WordPress未接続のためサンプルコラムを表示します');
            return res.json(SAMPLE_COLUMNS);
        }
        const posts = await wpFetchJson('posts', { categories: catId, per_page: 100, _embed: '' });
        const columns = posts.map(wpPostToColumn);
        res.json(columns.length > 0 ? columns : SAMPLE_COLUMNS);
    } catch (err) {
        console.warn('Columns fetch error (フォールバック使用):', err.message);
        res.json(SAMPLE_COLUMNS);
    }
});

app.get('/api/columns/:id', async (req, res) => {
    try {
        const post = await wpFetchJson(`posts/${req.params.id}`, { _embed: '' });
        const column = wpPostToColumn(post);
        res.json(column);
    } catch (err) {
        const fallback = SAMPLE_COLUMNS.find(c => String(c.id) === String(req.params.id));
        if (fallback) {
            return res.json(fallback);
        }
        res.status(404).json({ error: 'コラム詳細の取得に失敗しました' });
    }
});

app.get('/api/interviews', async (req, res) => {
    try {
        const catName = '研究者インタビュー';
        const catId = await getCategoryIdByName(catName);
        if (!catId) {
            console.warn('WordPress未接続のためサンプルインタビューを表示します');
            return res.json(SAMPLE_INTERVIEWS);
        }
        const posts = await wpFetchJson('posts', { categories: catId, per_page: 100, _embed: '' });
        const interviews = posts.map(wpPostToInterview);
        res.json(interviews.length > 0 ? interviews : SAMPLE_INTERVIEWS);
    } catch (err) {
        console.warn('Interviews fetch error (フォールバック使用):', err.message);
        res.json(SAMPLE_INTERVIEWS);
    }
});

app.get('/api/interviews/:id', async (req, res) => {
    try {
        const post = await wpFetchJson(`posts/${req.params.id}`, { _embed: '' });
        const interview = wpPostToInterview(post);
        res.json(interview);
    } catch (err) {
        const fallback = SAMPLE_INTERVIEWS.find(i => String(i.id) === String(req.params.id));
        if (fallback) {
            return res.json(fallback);
        }
        res.status(404).json({ error: 'インタビュー詳細の取得に失敗しました' });
    }
});

// ============ 管理者 API ============
// 承認待ち特許の取得
app.get('/api/admin/patents/pending', authenticateToken, async (req, res) => {
    try {
        const { data: patents, error} = await supabase
            .from('patents')
            .select(`
                *,
                users!owner_id (
                    name,
                    email,
                    organization
                )
            `)
            .eq('approval_status', 'pending')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error('Admin pending patents fetch error:', error);
            return res.status(500).json({ error: '承認待ち特許の取得に失敗しました' });
        }
        
        // owner_nameを追加
        const patentsWithOwnerName = (patents || []).map(patent => ({
            ...patent,
            owner_name: patent.users ? (patent.users.name || patent.users.email) : '不明'
        }));
        
        res.json(patentsWithOwnerName);
    } catch (error) {
        console.error('Get admin pending patents error:', error);
        res.status(500).json({ error: '承認待ち特許の取得に失敗しました' });
    }
});

app.get('/api/admin/patents', authenticateToken, async (req, res) => {
    try {
        const { data: patents, error } = await supabase.from('patents').select('*').order('created_at', { ascending: false });
        if (error) {
            console.error('Admin patents fetch error:', error);
            return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
        }
        res.json(patents || []);
    } catch (error) {
        console.error('Get admin patents error:', error);
        res.status(500).json({ error: '特許一覧の取得に失敗しました' });
    }
});

app.put('/api/admin/patents/:id/approve', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase.from('patents').update({ approval_status: 'approved' }).eq('id', req.params.id);
        if (error) {
            console.error('Patent approval error:', error);
            return res.status(500).json({ error: '特許の承認に失敗しました' });
        }
        res.json({ message: '特許を承認しました' });
    } catch (error) {
        console.error('Approve patent error:', error);
        res.status(500).json({ error: '特許の承認に失敗しました' });
    }
});

app.put('/api/admin/patents/:id/reject', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase.from('patents').update({ approval_status: 'rejected' }).eq('id', req.params.id);
        if (error) {
            console.error('Patent rejection error:', error);
            return res.status(500).json({ error: '特許の却下に失敗しました' });
        }
        res.json({ message: '特許を却下しました' });
    } catch (error) {
        console.error('Reject patent error:', error);
        res.status(500).json({ error: '特許の却下に失敗しました' });
    }
});

// ============ サーバー起動 ============
app.listen(PORT, () => {
    console.log(`✅ TechMatch server (Supabase版) started on http://localhost:${PORT}`);
    console.log(`📊 Database: Supabase PostgreSQL`);
    console.log(`📝 WordPress: ${WP_BASE_URL}`);
});

