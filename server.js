const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// !! برای واقعی کردن سایت، این رمز رو با یه متغیر محیطی (Environment Variable) عوض کن !!
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-123';

// ---------- پایگاه داده ----------
const dbPath = path.join(__dirname, 'data', 'songs.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'عمومی',
    filename TEXT NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- تنظیمات آپلود ----------
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // ۳۰ مگابایت سقف هر فایل
  fileFilter: (req, file, cb) => {
    const ok = ['.mp3', '.wav', '.m4a'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('فقط فایل‌های mp3, wav, m4a مجازن'), ok);
  }
});

// ---------- میان‌افزارها ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'ava-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // ۸ ساعت
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir)); // پخش مستقیم فایل صوتی برای پلیر

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'نیاز به ورود ادمین' });
}

// ---------- API عمومی ----------

// لیست آهنگ‌ها + جستجو + دسته‌بندی
app.get('/api/songs', (req, res) => {
  const { q, category } = req.query;
  let sql = 'SELECT id, title, artist, category, filename, downloads, created_at FROM songs';
  const clauses = [];
  const params = [];

  if (q) {
    clauses.push('(title LIKE ? OR artist LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category && category !== 'همه') {
    clauses.push('category = ?');
    params.push(category);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// لیست دسته‌بندی‌های موجود
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT category FROM songs ORDER BY category').all();
  res.json(rows.map(r => r.category));
});

// دانلود فایل + شمارش دانلود
app.get('/api/download/:id', (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).json({ error: 'آهنگ پیدا نشد' });

  const filePath = path.join(uploadDir, song.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'فایل روی سرور نیست' });

  db.prepare('UPDATE songs SET downloads = downloads + 1 WHERE id = ?').run(song.id);
  res.download(filePath, `${song.artist} - ${song.title}${path.extname(song.filename)}`);
});

// ---------- ورود ادمین ----------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'رمز اشتباهه' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ---------- عملیات ادمین (نیاز به ورود) ----------

// آپلود آهنگ جدید
app.post('/api/admin/songs', requireAdmin, upload.single('audio'), (req, res) => {
  const { title, artist, category } = req.body;
  if (!title || !artist || !req.file) {
    return res.status(400).json({ error: 'عنوان، خواننده و فایل صوتی الزامیه' });
  }
  const info = db.prepare(
    'INSERT INTO songs (title, artist, category, filename) VALUES (?, ?, ?, ?)'
  ).run(title, artist, category || 'عمومی', req.file.filename);

  res.json({ ok: true, id: info.lastInsertRowid });
});

// حذف آهنگ
app.delete('/api/admin/songs/:id', requireAdmin, (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).json({ error: 'پیدا نشد' });

  const filePath = path.join(uploadDir, song.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM songs WHERE id = ?').run(req.params.id);

  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`سرور روی http://localhost:${PORT} در حال اجراست`);
});
