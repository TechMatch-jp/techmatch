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
        const { name, company, email, phone, subject, message } = req.body;
        if (!name || !email || !phone || !subject || !message) {
            return res.status(400).json({ error: '必須項目を入力してください' });
        }
        const { error: dbError } = await supabase.from('contacts').insert([{
            name, company: company || null, email, phone, subject, message
        }]);
        if (dbError) return res.status(500).json({ error: 'データの保存に失敗しました: ' + dbError.message });
        const labelMap = { listing: '掲載申請', patent: '特許への問い合わせ', other: 'その他' };
        const subjectLabel = labelMap[subject] || subject;
        await resend.emails.send({
            from: 'TechMatch <noreply@techmatch.jp>',
            to: 'info@techmatch.jp',
            subject: `【お問い合わせ】${subjectLabel}`,
            html: `<p><strong>お問い合わせが届きました。</strong></p><table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:6px 16px 6px 0;color:#666">お名前</td><td>${name}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">会社名</td><td>${company || '―'}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">メール</td><td><a href="mailto:${email}">${email}</a></td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">電話</td><td>${phone}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">件名</td><td>${subjectLabel}</td></tr></table><hr style="margin:16px 0;border:none;border-top:1px solid #eee"><p style="white-space:pre-wrap;font-size:14px">${message}</p>`
        });
        await resend.emails.send({
            from: 'TechMatch <noreply@techmatch.jp>',
            to: email,
            subject: 'お問い合わせを受け付けました - TechMatch',
            html: `<p>${name} 様</p><p>この度はTechMatchへお問い合わせいただき、誠にありがとうございます。以下の内容で受け付けました。</p><table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:6px 16px 6px 0;color:#666">お名前</td><td>${name}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">会社名</td><td>${company || '―'}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">電話</td><td>${phone}</td></tr><tr><td style="padding:6px 16px 6px 0;color:#666">件名</td><td>${subjectLabel}</td></tr></table><hr style="margin:16px 0;border:none;border-top:1px solid #eee"><p style="white-space:pre-wrap;font-size:14px">${message}</p><hr style="margin:16px 0;border:none;border-top:1px solid #eee"><p style="font-size:13px;color:#666">通常、2営業日以内に担当者よりご返信いたします。お急ぎの場合は <a href="mailto:info@techmatch.jp">info@techmatch.jp</a> まで直接ご連絡ください。</p><p style="font-size:13px;color:#999">─<br>TechMatch 運営事務局<br>https://techmatch.jp</p>`
        });
        res.json({ message: '送信が完了しました' });
    } catch (e) {
        console.error('Contact error:', e);
        res.status(500).json({ error: '送信に失敗しました: ' + e.message });
    }
});

// ============ サイトマップ ============
app.get('/sitemap.xml', (req, res) => {
    const baseUrl = 'https://techmatch.jp';
    const pages = [
        { url: '/', priority: '1.0', changefreq: 'weekly' },
        { url: '/patents.html', priority: '0.9', changefreq: 'daily' },
        { url: '/column.html', priority: '0.7', changefreq: 'weekly' },
        { url: '/interview.html', priority: '0.7', changefreq: 'weekly' },
        { url: '/contact.html', priority: '0.5', changefreq: 'monthly' },
        { url: '/auth.html', priority: '0.5', changefreq: 'monthly' },
    ];
    const today = new Date().toISOString().split('T')[0];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${baseUrl}${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

// ============ サーバー起動 ============
app.listen(PORT, () => {
    console.log(`✅ TechMatch server started on http://localhost:${PORT}`);
    console.log(`📊 Database: Supabase PostgreSQL`);
});
