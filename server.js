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
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'techmatch-secret-key-2026';

app.use(express.static('public'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

app.get('/api/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage });

function authenticateToken(req, res, next) {
    if (String(process.env.SKIP_AUTH || '').toLowerCase() === 'true') {
        req.user = { id: 'dev', email: 'dev@local', name: 'Dev User', userType: process.env.SKIP_AUTH_TYPE || 'seller' };
        return next();
    }
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'ログインが必要です' });
    try {
        req.user = jwt.verify(token, SECRET_KEY);
        next();
    } catch {
        return res.status(403).json({ error: '無効なトークンです' });
    }
}

function estimateReadTime(content) {
    const text = String(content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    return Math.max(1, Math.round(text.length / 350)) + '分';
}

// ============ 認証 ============
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name, userType, organization } = req.body;
        const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
        if (existing) return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const { data: newUser, error } = await supabase.from('users').insert([{ email, password: hashedPassword, name, user_type: userType, organization }]).select().single();
        if (error) return res.status(500).json({ error: '登録に失敗しました: ' + error.message });
        res.json({ message: '登録が完了しました', userId: newUser.id });
    } catch (e) { res.status(500).json({ error: '登録に失敗しました: ' + e.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();
        if (error || !user) return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name, userType: user.user_type }, SECRET_KEY, { expiresIn: '7d' });
        const isProd = process.env.NODE_ENV === 'production';
        res.cookie('token', token, { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ message: 'ログインに成功しました', user: { id: user.id, email: user.email, name: user.name, userType: user.user_type } });
    } catch (e) { res.status(500).json({ error: 'ログインに失敗しました' }); }
});

app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ message: 'ログアウトしました' }); });

app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        if (String(process.env.SKIP_AUTH || '').toLowerCase() === 'true')
            return res.json({ id: req.user.id, email: req.user.email, name: req.user.name, userType: req.user.userType, organization: '', createdAt: new Date().toISOString() });
        const { data: user, error } = await supabase.from('users').select('id, email, name, user_type, organization, created_at').eq('id', req.user.id).single();
        if (error || !user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
        res.json({ id: user.id, email: user.email, name: user.name, userType: user.user_type, organization: user.organization, createdAt: user.created_at });
    } catch (e) { res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' }); }
});

// ============ 特許 ============
app.get('/api/patents', async (req, res) => {
    try {
        const { category, status, search, owner } = req.query;
        const buildQuery = (baseQuery) => {
            if (category && category !== 'all') baseQuery = baseQuery.eq('category', category);
            if (status) baseQuery = baseQuery.eq('status', status);
            return baseQuery;
        };
        const applySearch = (patents) => {
            if (!search) return patents;
            const s = search.toLowerCase();
            return patents.filter(p => p.title?.toLowerCase().includes(s) || p.description?.toLowerCase().includes(s));
        };

        if (owner === 'all') {
            return authenticateToken(req, res, async () => {
                const { data, error } = await buildQuery(supabase.from('patents').select('*').order('created_at', { ascending: false }));
                if (error) return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
                res.json(applySearch(data || []));
            });
        }
        if (owner === 'me') {
            return authenticateToken(req, res, async () => {
                const { data, error } = await buildQuery(supabase.from('patents').select('*').or(`owner_id.eq.${req.user.id},owner_id.is.null`).order('created_at', { ascending: false }));
                if (error) return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
                res.json(applySearch(data || []));
            });
        }
        const { data, error } = await buildQuery(supabase.from('patents').select('*').eq('approval_status', 'approved').order('created_at', { ascending: false }));
        if (error) return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
        res.json(applySearch(data || []));
    } catch (e) { res.status(500).json({ error: '特許一覧の取得に失敗しました' }); }
});

app.get('/api/patents/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('patents').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: '特許が見つかりません' });
        res.json(data);
    } catch (e) { res.status(500).json({ error: '特許詳細の取得に失敗しました' }); }
});

app.post('/api/patents', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const { title, description, problem, usage, advantage, category, patentNumber, price } = req.body;
        const { data, error } = await supabase.from('patents').insert([{
            title, description, problem, usage, advantage, category,
            patent_number: patentNumber, price: parseFloat(price) || 0,
            status: 'available', approval_status: 'pending',
            owner_id: req.user.id, owner_name: req.user.name,
            image: req.file ? `/uploads/${req.file.filename}` : null
        }]).select().single();
        if (error) return res.status(500).json({ error: '特許の登録に失敗しました' });
        res.json({ message: '特許を登録しました。管理者の承認後に公開されます。', patent: data });
    } catch (e) { res.status(500).json({ error: '特許の登録に失敗しました' }); }
});

app.put('/api/patents/:id', authenticateToken, async (req, res) => {
    try {
        const { data: patent, error: fe } = await supabase.from('patents').select('*').eq('id', req.params.id).single();
        if (fe || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        if (patent.owner_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { title, description, problem, usage, advantage, category, patentNumber, price, status } = req.body;
        const { data, error } = await supabase.from('patents').update({ title, description, problem, usage, advantage, category, patent_number: patentNumber, price: parseFloat(price), status }).eq('id', req.params.id).select().single();
        if (error) return res.status(500).json({ error: '特許の更新に失敗しました' });
        res.json({ message: '特許を更新しました', patent: data });
    } catch (e) { res.status(500).json({ error: '特許の更新に失敗しました' }); }
});

app.delete('/api/patents/:id', authenticateToken, async (req, res) => {
    try {
        const { data: patent, error: fe } = await supabase.from('patents').select('*').eq('id', req.params.id).single();
        if (fe || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        if (patent.owner_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { error } = await supabase.from('patents').delete().eq('id', req.params.id);
        if (error) return res.status(500).json({ error: '特許の削除に失敗しました' });
        if (patent.image) { const p = path.join(__dirname, 'public', patent.image); if (fs.existsSync(p)) fs.unlinkSync(p); }
        res.json({ message: '特許を削除しました' });
    } catch (e) { res.status(500).json({ error: '特許の削除に失敗しました' }); }
});

app.get('/api/user/patents', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('patents').select('*').eq('owner_id', req.user.id).order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: '特許取得に失敗しました' });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: '特許取得に失敗しました' }); }
});

// ============ 興味表明 ============
app.get('/api/my-interests', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('interests').select('*').eq('buyer_id', req.user.id).order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: '興味表明の取得に失敗しました' }); }
});

app.get('/api/patent-interests', authenticateToken, async (req, res) => {
    try {
        const { data: myPatents, error: pe } = await supabase.from('patents').select('id,title,owner_id').or(`owner_id.eq.${req.user.id},owner_id.is.null`).order('created_at', { ascending: false });
        if (pe) return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        const ids = (myPatents || []).map(p => p.id).filter(Boolean);
        if (!ids.length) return res.json([]);
        const { data: interests, error: ie } = await supabase.from('interests').select('*').in('patent_id', ids).order('created_at', { ascending: false });
        if (ie) return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        const titleById = new Map((myPatents || []).map(p => [p.id, p.title]));
        res.json((interests || []).map(it => ({
            id: it.id, patentId: it.patent_id, patentTitle: titleById.get(it.patent_id) || it.patent_id,
            userName: it.buyer_name || it.buyer_email || '購入者', message: it.message || '', createdAt: it.created_at
        })));
    } catch (e) { res.status(500).json({ error: '興味表明の取得に失敗しました' }); }
});

app.post('/api/interests', authenticateToken, async (req, res) => {
    try {
        const { patentId, message } = req.body;
        const { data: patent, error: pe } = await supabase.from('patents').select('*').eq('id', patentId).single();
        if (pe || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        const { data, error } = await supabase.from('interests').insert([{
            patent_id: patentId, buyer_id: req.user.id, buyer_name: req.user.name, buyer_email: req.user.email, message, status: 'pending'
        }]).select().single();
        if (error) return res.status(500).json({ error: '興味表明の送信に失敗しました' });
        res.json({ message: '興味表明を送信しました', interest: data });
    } catch (e) { res.status(500).json({ error: '興味表明の送信に失敗しました' }); }
});

app.get('/api/user/interests', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('interests').select('*, patents (*)').eq('buyer_id', req.user.id).order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: '興味表明の取得に失敗しました' }); }
});

app.get('/api/patents/:patentId/interests', authenticateToken, async (req, res) => {
    try {
        const { data: patent, error: pe } = await supabase.from('patents').select('*').eq('id', req.params.patentId).single();
        if (pe || !patent) return res.status(404).json({ error: '特許が見つかりません' });
        if (patent.owner_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { data, error } = await supabase.from('interests').select('*').eq('patent_id', req.params.patentId).order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: '興味表明の取得に失敗しました' });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: '興味表明の取得に失敗しました' }); }
});

// ============ メッセージ ============
app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { receiverId, patentId, subject, content } = req.body;
        const { data, error } = await supabase.from('messages').insert([{ sender_id: req.user.id, receiver_id: receiverId, patent_id: patentId || null, subject, content, is_read: false }]).select().single();
        if (error) return res.status(500).json({ error: 'メッセージの送信に失敗しました' });
        res.json({ message: 'メッセージを送信しました', messageData: data });
    } catch (e) { res.status(500).json({ error: 'メッセージの送信に失敗しました' }); }
});

app.get('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('messages').select('*').or(`sender_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`).order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: 'メッセージの取得に失敗しました' });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: 'メッセージの取得に失敗しました' }); }
});

app.put('/api/messages/:id/read', authenticateToken, async (req, res) => {
    try {
        const { data: msg, error: fe } = await supabase.from('messages').select('*').eq('id', req.params.id).single();
        if (fe || !msg) return res.status(404).json({ error: 'メッセージが見つかりません' });
        if (msg.receiver_id !== req.user.id) return res.status(403).json({ error: '権限がありません' });
        const { error } = await supabase.from('messages').update({ is_read: true }).eq('id', req.params.id);
        if (error) return res.status(500).json({ error: 'メッセージの更新に失敗しました' });
        res.json({ message: 'メッセージを既読にしました' });
    } catch (e) { res.status(500).json({ error: 'メッセージの更新に失敗しました' }); }
});

// ============ コラム・インタビュー API（公開用） ============
function articleToColumn(a) {
    return { id: a.id, title: a.title, description: a.excerpt || '', content: a.content || '', category: a.category || 'patent-basics', author: a.author || '編集部', createdAt: a.created_at, readTime: estimateReadTime(a.content), featuredImage: a.featured_image || null };
}
function articleToInterview(a) {
    return { id: a.id, title: a.title, description: a.excerpt || '', content: a.content || '', category: a.category || '', categorySlug: a.category || '', interviewer: a.author || '編集部', researcher: a.researcher || '', affiliation: a.affiliation || '', createdAt: a.created_at, readTime: estimateReadTime(a.content), featuredImage: a.featured_image || null };
}

app.get('/api/columns', async (req, res) => {
    try {
        const { data, error } = await supabase.from('articles').select('*').eq('type', 'column').eq('status', 'published').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: 'コラムの取得に失敗しました' });
        res.json((data || []).map(articleToColumn));
    } catch (e) { res.status(500).json({ error: 'コラムの取得に失敗しました' }); }
});

app.get('/api/columns/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('articles').select('*').eq('id', req.params.id).eq('type', 'column').single();
        if (error || !data) return res.status(404).json({ error: 'コラムが見つかりません' });
        res.json(articleToColumn(data));
    } catch (e) { res.status(500).json({ error: 'コラム詳細の取得に失敗しました' }); }
});

app.get('/api/interviews', async (req, res) => {
    try {
        const { data, error } = await supabase.from('articles').select('*').eq('type', 'interview').eq('status', 'published').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: 'インタビューの取得に失敗しました' });
        res.json((data || []).map(articleToInterview));
    } catch (e) { res.status(500).json({ error: 'インタビューの取得に失敗しました' }); }
});

app.get('/api/interviews/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('articles').select('*').eq('id', req.params.id).eq('type', 'interview').single();
        if (error || !data) return res.status(404).json({ error: 'インタビューが見つかりません' });
        res.json(articleToInterview(data));
    } catch (e) { res.status(500).json({ error: 'インタビュー詳細の取得に失敗しました' }); }
});

// ============ 管理者 API - 特許 ============
app.get('/api/admin/patents/pending', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('patents').select('*, users!owner_id (name, email, organization)').eq('approval_status', 'pending').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: '承認待ち特許の取得に失敗しました' });
        res.json((data || []).map(p => ({ ...p, owner_name: p.users ? (p.users.name || p.users.email) : '不明' })));
    } catch (e) { res.status(500).json({ error: '承認待ち特許の取得に失敗しました' }); }
});

app.get('/api/admin/patents', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('patents').select('*').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: '特許一覧の取得に失敗しました' });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: '特許一覧の取得に失敗しました' }); }
});

app.put('/api/admin/patents/:id/approve', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase.from('patents').update({ approval_status: 'approved' }).eq('id', req.params.id);
        if (error) return res.status(500).json({ error: '特許の承認に失敗しました' });
        res.json({ message: '特許を承認しました' });
    } catch (e) { res.status(500).json({ error: '特許の承認に失敗しました' }); }
});

app.put('/api/admin/patents/:id/reject', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase.from('patents').update({ approval_status: 'rejected' }).eq('id', req.params.id);
        if (error) return res.status(500).json({ error: '特許の却下に失敗しました' });
        res.json({ message: '特許を却下しました' });
    } catch (e) { res.status(500).json({ error: '特許の却下に失敗しました' }); }
});

// ============ 管理者 API - 記事（コラム・インタビュー） ============
app.get('/api/admin/articles', authenticateToken, async (req, res) => {
    try {
        const { type } = req.query;
        let q = supabase.from('articles').select('*').order('created_at', { ascending: false });
        if (type) q = q.eq('type', type);
        const { data, error } = await q;
        if (error) return res.status(500).json({ error: '記事一覧の取得に失敗しました' });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: '記事一覧の取得に失敗しました' }); }
});

app.get('/api/admin/articles/:id', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('articles').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: '記事が見つかりません' });
        res.json(data);
    } catch (e) { res.status(500).json({ error: '記事詳細の取得に失敗しました' }); }
});

app.post('/api/admin/articles', authenticateToken, async (req, res) => {
    try {
        const { type, title, excerpt, content, category, author, researcher, affiliation, featured_image, status } = req.body;
        if (!type || !title) return res.status(400).json({ error: 'type と title は必須です' });
        const { data, error } = await supabase.from('articles').insert([{
            type, title, excerpt: excerpt || '', content: content || '',
            category: category || '', author: author || '編集部',
            researcher: researcher || '', affiliation: affiliation || '',
            featured_image: featured_image || null, status: status || 'published'
        }]).select().single();
        if (error) return res.status(500).json({ error: '記事の作成に失敗しました: ' + error.message });
        res.json({ message: '記事を投稿しました', article: data });
    } catch (e) { res.status(500).json({ error: '記事の作成に失敗しました' }); }
});

app.put('/api/admin/articles/:id', authenticateToken, async (req, res) => {
    try {
        const { type, title, excerpt, content, category, author, researcher, affiliation, featured_image, status } = req.body;
        const { data, error } = await supabase.from('articles').update({
            type, title, excerpt: excerpt || '', content: content || '',
            category: category || '', author: author || '編集部',
            researcher: researcher || '', affiliation: affiliation || '',
            featured_image: featured_image || null, status: status || 'published',
            updated_at: new Date().toISOString()
        }).eq('id', req.params.id).select().single();
        if (error) return res.status(500).json({ error: '記事の更新に失敗しました: ' + error.message });
        res.json({ message: '記事を更新しました', article: data });
    } catch (e) { res.status(500).json({ error: '記事の更新に失敗しました' }); }
});

app.delete('/api/admin/articles/:id', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase.from('articles').delete().eq('id', req.params.id);
        if (error) return res.status(500).json({ error: '記事の削除に失敗しました' });
        res.json({ message: '記事を削除しました' });
    } catch (e) { res.status(500).json({ error: '記事の削除に失敗しました' }); }
});

// ============ お問い合わせ ============
app.post('/api/contact', async (req, res) => {
    try {
        const { name, company, email, subject, message } = req.body;
        if (!name || !email || !subject || !message) {
            return res.status(400).json({ error: '必須項目を入力してください' });
        }
        const { error: dbError } = await supabase.from('contacts').insert([{
            name, company: company || null, email, subject, message
        }]);
        if (dbError) return res.status(500).json({ error: 'データの保存に失敗しました: ' + dbError.message });
        const labelMap = { listing: '掲載申請', patent: '特許への問い合わせ', other: 'その他' };
        const subjectLabel = labelMap[subject] || subject;
        await resend.emails.send({
            from: 'TechMatch <noreply@techmatch.jp>',
            to: 'info@techmatch.jp',
            subject: `【お問い合わせ】${subjectLabel}`,
            html: `<p><strong>お問い合わせが届きました。</strong></p><table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:6px 16px 6px 0;color:#666">お名前</td><td>${name}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">会社名</td><td>${company || '―'}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">メール</td><td><a href="mailto:${email}">${email}</a></td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">件名</td><td>${subjectLabel}</td></tr></table><hr style="margin:16px 0;border:none;border-top:1px solid #eee"><p style="white-space:pre-wrap;font-size:14px">${message}</p>`
        });
        await resend.emails.send({
            from: 'TechMatch <noreply@techmatch.jp>',
            to: email,
            subject: 'お問い合わせを受け付けました - TechMatch',
            html: `<p>${name} 様</p><p>この度はTechMatchへお問い合わせいただき、誠にありがとうございます。以下の内容で受け付けました。</p><table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:6px 16px 6px 0;color:#666">お名前</td><td>${name}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">会社名</td><td>${company || '―'}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">件名</td><td>${subjectLabel}</td></tr></table><hr style="margin:16px 0;border:none;border-top:1px solid #eee"><p style="white-space:pre-wrap;font-size:14px">${message}</p><hr style="margin:16px 0;border:none;border-top:1px solid #eee"><p style="font-size:13px;color:#666">通常、2営業日以内に担当者よりご返信いたします。お急ぎの場合は <a href="mailto:info@techmatch.jp">info@techmatch.jp</a> まで直接ご連絡ください。</p><p style="font-size:13px;color:#999">─<br>TechMatch 運営事務局<br>https://techmatch.jp</p>`
        });
        res.json({ message: '送信が完了しました' });
    } catch (e) {
        console.error('Contact error:', e);
        res.status(500).json({ error: '送信に失敗しました: ' + e.message });
    }
});

// ============ AI 要約・活用提案 ============
app.get('/api/patents/:id/ai', async (req, res) => {
    try {
        const { data: patent, error } = await supabase
            .from('patents')
            .select('id, title, description, problem, usage, advantage, category, ai_summary, ai_use_cases, ai_generated_at')
            .eq('id', req.params.id)
            .single();

        if (error || !patent) return res.status(404).json({ error: '特許が見つかりません' });

        // キャッシュがあればそのまま返す
        if (patent.ai_summary && patent.ai_use_cases) {
            return res.json({ summary: patent.ai_summary, use_cases: patent.ai_use_cases, cached: true });
        }

        // Anthropic API で生成
        const prompt = `以下は日本の特許情報です。この特許について、企業の事業開発担当者が読んでわかりやすい形で2点を生成してください。

【特許タイトル】${patent.title || '不明'}
【技術分野】${patent.category || '不明'}
【課題】${patent.problem || ''}
【説明】${patent.description || ''}
【活用方法】${patent.usage || ''}
【効果・利点】${patent.advantage || ''}

以下のJSON形式のみで返答してください（マークダウン不要）:
{
  "summary": "この特許を技術に詳しくない人にもわかるように説明した日本語の要約。以下のルールを守ること：①1文を20〜30字以内の短文にする ②5〜7文で構成する ③専門用語は使わず、身近な言葉に置き換える ④「何ができるのか」「何が便利になるのか」を中心に書く ⑤体言止め・名詞止めで締める。例：AIが顔の表情をリアルタイムで読み取る技術。カメラ映像だけで感情を自動判定。怒り・喜び・不安など複数の感情を同時に認識可能。接客や医療の現場での活用を想定。人の手を介さず、瞬時に感情データを収集・分析。",
  "use_cases": [
    { "title": "活用場面のタイトル（10字以内）", "description": "具体的な活用方法（40〜60字、体言止め）" },
    { "title": "活用場面のタイトル（10字以内）", "description": "具体的な活用方法（40〜60字、体言止め）" },
    { "title": "活用場面のタイトル（10字以内）", "description": "具体的な活用方法（40〜60字、体言止め）" }
  ]
}`;

        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        });

        const rawText = message.content[0]?.text || '';
        let parsed;
        try {
            parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
        } catch {
            console.error('AI parse error:', rawText);
            return res.status(500).json({ error: 'AI応答の解析に失敗しました' });
        }

        // Supabase にキャッシュ保存
        await supabase.from('patents').update({
            ai_summary: parsed.summary,
            ai_use_cases: parsed.use_cases,
            ai_generated_at: new Date().toISOString(),
        }).eq('id', req.params.id);

        res.json({ summary: parsed.summary, use_cases: parsed.use_cases, cached: false });

    } catch (e) {
        console.error('AI endpoint error:', e);
        res.status(500).json({ error: 'AI生成に失敗しました: ' + e.message });
    }
});

// ============ 類似特許 AI ============
app.get('/api/patents/:id/similar', async (req, res) => {
    try {
        // 対象特許を取得
        const { data: base, error: be } = await supabase
            .from('patents')
            .select('id, title, description, category, ai_similar')
            .eq('id', req.params.id)
            .single();

        if (be || !base) return res.status(404).json({ error: '特許が見つかりません' });

        // キャッシュがあれば返す
        if (base.ai_similar) {
            return res.json({ similar: base.ai_similar, cached: true });
        }

        // 同カテゴリの他の特許を最大10件取得
        const { data: candidates } = await supabase
            .from('patents')
            .select('id, title, description, owner_name')
            .eq('category', base.category)
            .eq('approval_status', 'approved')
            .neq('id', req.params.id)
            .limit(10);

        if (!candidates || candidates.length === 0) {
            return res.json({ similar: [], cached: false });
        }

        // Claude APIで関係性を生成
        const candidateList = candidates.map((p, i) =>
            `[${i + 1}] タイトル：${p.title}\n    説明：${(p.description || '').slice(0, 100)}`
        ).join('\n\n');

        const prompt = `以下は「${base.title}」という特許です。
説明：${(base.description || '').slice(0, 200)}

この特許と、以下の候補特許との技術的な関係を分析してください。

${candidateList}

各候補について、技術的観点からの関連度（高・中・低）と、具体的にどのような技術的共通点や補完関係があるかを1文で説明してください。
関連度が「低」のものは除外して、「高」「中」のものだけを関連度順に最大3件選んでください。

以下のJSON形式のみで返答してください（マークダウン不要）:
[
  { "index": 候補番号(1始まり), "relation": "技術的な関係を具体的に説明した1文（30〜50字）" },
  ...
]
関連度が高いものがなければ空配列 [] を返してください。`;

        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            messages: [{ role: 'user', content: prompt }],
        });

        const rawText = message.content[0]?.text || '';
        let parsed;
        try {
            parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim());
        } catch {
            console.error('Similar AI parse error:', rawText);
            return res.json({ similar: [], cached: false });
        }

        // 結果を整形
        const result = parsed.map(item => {
            const candidate = candidates[item.index - 1];
            if (!candidate) return null;
            return {
                id: candidate.id,
                title: candidate.title,
                owner_name: candidate.owner_name,
                relation: item.relation,
            };
        }).filter(Boolean);

        // Supabaseにキャッシュ保存
        await supabase.from('patents').update({
            ai_similar: result,
        }).eq('id', req.params.id);

        res.json({ similar: result, cached: false });

    } catch (e) {
        console.error('Similar endpoint error:', e);
        res.status(500).json({ error: '類似特許の取得に失敗しました: ' + e.message });
    }
});

// ============ サーバー起動 ============
app.listen(PORT, () => {
    console.log(`✅ TechMatch server started on http://localhost:${PORT}`);
    console.log(`📊 Database: Supabase PostgreSQL`);
});

