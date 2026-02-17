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

// ============ ユーティリティ ============
function stripHtml(html) {
    return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function estimateReadTimeMinutes(text) {
    const chars = String(text || '').replace(/\s+/g, '').length;
    const minutes = Math.max(1, Math.round(chars / 350));
    return `${minutes}分`;
}

// ============ Express設定 ============
app.use('/blog', createProxyMiddleware({
  target: 'http://www3050.sakura.ne.jp',
  changeOrigin: true,
  headers: { host: 'techmatch.jp' }
}));
app.use(express.static('public'));
  target: 'http://www3050.sakura.ne.jp',
  changeOrigin: true,
  xfwd: true,
  ws: true,
  logLevel: 'warn',
}));

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// 動作確認用
app.get('/api/ping', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
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

        if (owner === 'me') {
            return authenticateToken(req, res, async () => {
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

app.get('/api/patent-interests', authenticateToken, async (req, res) => {
    try {
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

// ============ 記事 API（コラム・インタビュー / Supabase版） ============

// ---- コラム一覧（公開用） ----
app.get('/api/columns', async (req, res) => {
    const { category, per_page = 20, exclude } = req.query;
    try {
        let query = supabase
            .from('articles')
            .select('id, type, title, excerpt, category, author, featured_image, created_at')
            .eq('type', 'column')
            .eq('status', 'published')
            .order('created_at', { ascending: false });

        if (category && category !== 'all') query = query.eq('category', category);
        if (exclude) query = query.neq('id', exclude);
        if (per_page) query = query.limit(Number(per_page));

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });

        const columns = (data || []).map(a => ({
            id: a.id,
            title: a.title,
            description: a.excerpt || '',
            category: a.category,
            author: a.author || '編集部',
            featuredImage: a.featured_image || null,
            createdAt: a.created_at,
            readTime: estimateReadTimeMinutes(a.excerpt || '')
        }));
        res.json(columns);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- コラム詳細（公開用） ----
app.get('/api/columns/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('articles')
            .select('*')
            .eq('id', req.params.id)
            .eq('type', 'column')
            .single();

        if (error || !data) return res.status(404).json({ error: 'コラムが見つかりません' });

        res.json({
            id: data.id,
            title: data.title,
            description: data.excerpt || '',
            content: data.content || '',
            category: data.category,
            author: data.author || '編集部',
            featuredImage: data.featured_image || null,
            createdAt: data.created_at,
            readTime: estimateReadTimeMinutes(data.content || '')
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- インタビュー一覧（公開用） ----
app.get('/api/interviews', async (req, res) => {
    const { category, per_page = 20 } = req.query;
    try {
        let query = supabase
            .from('articles')
            .select('id, type, title, excerpt, category, researcher, affiliation, featured_image, created_at')
            .eq('type', 'interview')
            .eq('status', 'published')
            .order('created_at', { ascending: false });

        if (category && category !== 'all') query = query.eq('category', category);
        if (per_page) query = query.limit(Number(per_page));

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });

        const interviews = (data || []).map(a => ({
            id: a.id,
            title: a.title,
            description: a.excerpt || '',
            category: a.category,
            researcher: a.researcher || '',
            affiliation: a.affiliation || '',
            featuredImage: a.featured_image || null,
            createdAt: a.created_at,
            readTime: estimateReadTimeMinutes(a.excerpt || '')
        }));
        res.json(interviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- インタビュー詳細（公開用） ----
app.get('/api/interviews/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('articles')
            .select('*')
            .eq('id', req.params.id)
            .eq('type', 'interview')
            .single();

        if (error || !data) return res.status(404).json({ error: 'インタビューが見つかりません' });

        res.json({
            id: data.id,
            title: data.title,
            description: data.excerpt || '',
            content: data.content || '',
            category: data.category,
            researcher: data.researcher || '',
            affiliation: data.affiliation || '',
            featuredImage: data.featured_image || null,
            createdAt: data.created_at,
            readTime: estimateReadTimeMinutes(data.content || '')
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- 管理者：記事一覧（下書き含む） ----
app.get('/api/admin/articles', authenticateToken, async (req, res) => {
    try {
        const { type } = req.query;
        let query = supabase
            .from('articles')
            .select('id, type, title, excerpt, category, author, researcher, affiliation, status, created_at, updated_at')
            .order('created_at', { ascending: false });

        if (type) query = query.eq('type', type);

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- 管理者：記事1件取得（編集用） ----
app.get('/api/admin/articles/:id', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('articles')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !data) return res.status(404).json({ error: '記事が見つかりません' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- 管理者：記事投稿 ----
app.post('/api/admin/articles', authenticateToken, async (req, res) => {
    try {
        const { type, title, excerpt, content, category, author, researcher, affiliation, featured_image, status } = req.body;

        if (!type || !title || !category) {
            return res.status(400).json({ error: 'type・title・category は必須です' });
        }

        const { data, error } = await supabase
            .from('articles')
            .insert([{ type, title, excerpt, content, category, author, researcher, affiliation, featured_image, status: status || 'published' }])
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        res.json({ message: '記事を保存しました', article: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- 管理者：記事更新 ----
app.put('/api/admin/articles/:id', authenticateToken, async (req, res) => {
    try {
        const { title, excerpt, content, category, author, researcher, affiliation, featured_image, status } = req.body;

        const { data, error } = await supabase
            .from('articles')
            .update({ title, excerpt, content, category, author, researcher, affiliation, featured_image, status })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        res.json({ message: '記事を更新しました', article: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- 管理者：記事削除 ----
app.delete('/api/admin/articles/:id', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase
            .from('articles')
            .delete()
            .eq('id', req.params.id);

        if (error) return res.status(500).json({ error: error.message });
        res.json({ message: '記事を削除しました' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ 管理者：特許 API ============
app.get('/api/admin/patents/pending', authenticateToken, async (req, res) => {
    try {
        const { data: patents, error } = await supabase
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
});
