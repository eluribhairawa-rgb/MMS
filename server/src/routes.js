const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { sign, requireAuth, requireRole } = require('./auth');
const { stampAndSave, fmtTime } = require('./stamp');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const CATEGORIES = ['Food', 'Travel', 'Fuel', 'Stay', 'Other'];
const ADMINS = ['super_admin', 'admin'];

// ---------- time helpers (company time zone) ----------
const TZ_OFFSET = process.env.TZ_OFFSET || '+05:30';
const OFF_MS = (() => { const m = TZ_OFFSET.match(/([+-])(\d\d):(\d\d)/); return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000; })();
const nowIso = () => new Date().toISOString();
const localDate = (iso = nowIso()) => new Date(new Date(iso).getTime() + OFF_MS).toISOString().slice(0, 10);
const localHM = iso => new Date(new Date(iso).getTime() + OFF_MS).toISOString().slice(11, 16);
const dayRange = (d = localDate()) => { const from = new Date(`${d}T00:00:00${TZ_OFFSET}`).toISOString(); return { from, to: new Date(new Date(from).getTime() + 864e5).toISOString(), date: d }; };
const monthRange = (m = localDate().slice(0, 7)) => {
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { from: new Date(`${m}-01T00:00:00${TZ_OFFSET}`).toISOString(), to: new Date(`${next}-01T00:00:00${TZ_OFFSET}`).toISOString(), month: m };
};
const hmToMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const round2 = n => Math.round(n * 100) / 100;
const getSetting = k => JSON.parse(db.prepare(`SELECT value FROM settings WHERE key=?`).get(k)?.value ?? 'null');
const publicUser = u => u && ({ id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone, role: u.role, department: u.department, monthly_limit: u.monthly_limit, active: !!u.active, created_at: u.created_at });

// Every photo must come from the live in-app camera.
function checkPhoto(req, res) {
  if (req.body.source !== 'camera') { bad(res, 'Photos must be taken with the camera — uploads are not allowed'); return false; }
  if (!req.file || !/^image\//.test(req.file.mimetype)) { bad(res, 'Photo is required'); return false; }
  return true;
}
function readGps(body, required) {
  const lat = Number(body.lat), lng = Number(body.lng);
  const ok = body.lat !== undefined && body.lat !== '' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!ok) return required ? { error: 'Location is required. Turn on GPS / allow location and try again.' } : { lat: null, lng: null, accuracy: null, address: null };
  return { lat, lng, accuracy: body.accuracy ? Number(body.accuracy) : null, address: body.address || null };
}
function readTime(body) {
  const t = body.captured_at ? new Date(body.captured_at) : new Date();
  if (isNaN(t) || t.getTime() > Date.now() + 5 * 60000 || t.getTime() < Date.now() - 24 * 3600e3) return new Date().toISOString();
  return t.toISOString();
}

// ---------- auth ----------
const cleanPhone = p => String(p || '').replace(/[\s\-()]/g, '');
router.post('/auth/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return bad(res, 'Enter your email/phone and password');
  const l = String(login).trim();
  const u = db.prepare(`SELECT * FROM users WHERE username=? OR email=? OR phone=? OR phone=?`).get(l.toLowerCase(), l.toLowerCase(), l, cleanPhone(l));
  const pw = String(password);
  if (!u || !(bcrypt.compareSync(pw, u.password_hash) || bcrypt.compareSync(pw.trim(), u.password_hash))) return bad(res, 'Wrong email/phone or password', 401);
  if (!u.active) return bad(res, 'Your account is disabled. Contact your admin.', 403);
  res.json({ token: sign(u), user: publicUser(u) });
});

router.use(requireAuth);

router.get('/auth/me', (req, res) => res.json({ user: req.user, settings: { report_times: getSetting('report_times'), company_name: getSetting('company_name'), categories: CATEGORIES } }));

router.post('/auth/change-password', (req, res) => {
  const { current_password, new_password } = req.body || {};
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  const cur = String(current_password || '');
  if (!(bcrypt.compareSync(cur, u.password_hash) || bcrypt.compareSync(cur.trim(), u.password_hash))) return bad(res, 'Current password is wrong');
  if (!new_password || String(new_password).trim().length < 6) return bad(res, 'New password must be at least 6 characters');
  db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(bcrypt.hashSync(String(new_password).trim(), 10), u.id);
  res.json({ ok: true });
});

// ---------- settings (report times) ----------
router.put('/settings', requireRole('super_admin'), (req, res) => {
  const { report_times, company_name } = req.body || {};
  if (report_times !== undefined) {
    if (!Array.isArray(report_times) || report_times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return bad(res, 'Times must look like 10:00 or 16:30');
    const sorted = [...new Set(report_times)].sort();
    db.prepare(`UPDATE settings SET value=? WHERE key='report_times'`).run(JSON.stringify(sorted));
  }
  if (company_name !== undefined) db.prepare(`UPDATE settings SET value=? WHERE key='company_name'`).run(JSON.stringify(String(company_name).slice(0, 80)));
  res.json({ report_times: getSetting('report_times'), company_name: getSetting('company_name') });
});

// ---------- users ----------
router.get('/people', (req, res) => {
  // for the group-bill picker: everyone active who can share a bill
  res.json(db.prepare(`SELECT id,name,department FROM users WHERE active=1 AND role!='super_admin' ORDER BY name`).all());
});

router.get('/users', requireRole(...ADMINS), (req, res) => {
  res.json(db.prepare(`SELECT * FROM users ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name`).all().map(publicUser));
});

router.post('/users', requireRole(...ADMINS), (req, res) => {
  const { name, username, email, phone, role = 'employee', department, monthly_limit } = req.body || {};
  const password = String((req.body || {}).password || '').trim();
  if (!name || !password || (!username && !email && !phone)) return bad(res, 'Name, password and a username, email or phone are required');
  if (username && !/^[a-z0-9._-]{3,30}$/i.test(String(username).trim())) return bad(res, 'Username: 3-30 letters, numbers, dot, dash or underscore (no spaces)');
  if (password.length < 6) return bad(res, 'Password must be at least 6 characters');
  if (!['super_admin', 'admin', 'employee'].includes(role)) return bad(res, 'Invalid role');
  if (req.user.role === 'admin' && role !== 'employee') return bad(res, 'HR/Admin can only add employees', 403);
  try {
    const r = db.prepare(`INSERT INTO users (name,username,email,phone,password_hash,role,department,monthly_limit,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(name.trim(), username ? String(username).trim().toLowerCase() : null, email ? email.trim().toLowerCase() : null, phone ? cleanPhone(phone) : null, bcrypt.hashSync(password, 10), role, department || null, Math.max(0, Number(monthly_limit) || 0), nowIso());
    res.status(201).json(publicUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(r.lastInsertRowid)));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return bad(res, 'That username, email or phone is already used');
    throw e;
  }
});

router.patch('/users/:id', requireRole(...ADMINS), (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
  if (!t) return bad(res, 'User not found', 404);
  if (req.user.role === 'admin' && t.role !== 'employee') return bad(res, 'HR/Admin can only edit employees', 403);
  const b = req.body || {}, f = {};
  if (b.name !== undefined) f.name = String(b.name).trim();
  if (b.username !== undefined) {
    const un = String(b.username || '').trim().toLowerCase();
    if (un && !/^[a-z0-9._-]{3,30}$/.test(un)) return bad(res, 'Username: 3-30 letters, numbers, dot, dash or underscore (no spaces)');
    f.username = un || null;
  }
  if (b.email !== undefined) f.email = b.email ? b.email.trim().toLowerCase() : null;
  if (b.phone !== undefined) f.phone = b.phone ? cleanPhone(b.phone) : null;
  if (b.department !== undefined) f.department = b.department || null;
  if (b.monthly_limit !== undefined) f.monthly_limit = Math.max(0, Number(b.monthly_limit) || 0);
  if (b.active !== undefined) { if (id === req.user.id) return bad(res, 'You cannot disable your own account'); f.active = b.active ? 1 : 0; }
  if (b.role !== undefined && req.user.role === 'super_admin' && id !== req.user.id) {
    if (!['super_admin', 'admin', 'employee'].includes(b.role)) return bad(res, 'Invalid role');
    f.role = b.role;
  }
  const newPw = String(b.password || '').trim();
  if (newPw) { if (newPw.length < 6) return bad(res, 'Password must be at least 6 characters'); f.password_hash = bcrypt.hashSync(newPw, 10); }
  const finalEmail = f.email !== undefined ? f.email : t.email, finalPhone = f.phone !== undefined ? f.phone : t.phone, finalUser = f.username !== undefined ? f.username : t.username;
  if (!finalEmail && !finalPhone && !finalUser) return bad(res, 'User needs an email or phone to log in');
  const keys = Object.keys(f);
  try { if (keys.length) db.prepare(`UPDATE users SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => f[k]), id); }
  catch (e) { if (String(e.message).includes('UNIQUE')) return bad(res, 'That username, email or phone is already used'); throw e; }
  res.json(publicUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(id)));
});

// ---------- attendance: login / work update / logout ----------
function slotStatus(updates, date) {
  // An update counts for a report time if it was sent between 30 min before that time and 30 min before the next one.
  const times = getSetting('report_times') || [];
  const nowMin = date === localDate() ? hmToMin(localHM(nowIso())) : 24 * 60;
  return times.map((t, i) => {
    const start = hmToMin(t) - 30, end = i + 1 < times.length ? hmToMin(times[i + 1]) - 30 : 24 * 60;
    const hit = updates.find(u => { const m = hmToMin(localHM(u.captured_at)); return m >= start && m < end; });
    return { time: t, done: !!hit, at: hit ? hit.captured_at : null, upcoming: !hit && nowMin < hmToMin(t) };
  });
}
function openSession(userId) {
  const { from } = dayRange();
  return db.prepare(`SELECT * FROM sessions WHERE user_id=? AND logout_at IS NULL AND login_at>=? ORDER BY id DESC LIMIT 1`).get(userId, from);
}
function dayFor(userId, date) {
  const r = dayRange(date);
  const entries = db.prepare(`SELECT * FROM entries WHERE user_id=? AND captured_at>=? AND captured_at<? ORDER BY captured_at`).all(userId, r.from, r.to);
  const sessions = db.prepare(`SELECT * FROM sessions WHERE user_id=? AND login_at>=? AND login_at<? ORDER BY login_at`).all(userId, r.from, r.to);
  return { date: r.date, entries, sessions, slots: slotStatus(entries.filter(e => e.type === 'update'), r.date) };
}

router.get('/day', (req, res) => res.json({ ...dayFor(req.user.id, req.query.date), open_session: openSession(req.user.id) || null }));

async function saveEntry(req, res, type) {
  if (!checkPhoto(req, res)) return null;
  const g = readGps(req.body, true);
  if (g.error) return bad(res, g.error), null;
  const note = (req.body.note || '').trim().slice(0, 500);
  if (type === 'update' && !note) return bad(res, 'Write a short work update'), null;
  let session = openSession(req.user.id);
  if (type === 'login') {
    if (session) return bad(res, 'You are already logged in'), null;
    session = { id: db.prepare(`INSERT INTO sessions (user_id,login_at) VALUES (?,?)`).run(req.user.id, nowIso()).lastInsertRowid };
  } else if (!session) return bad(res, 'Please mark your Login first'), null;
  const capturedAt = readTime(req.body);
  const photo = await stampAndSave(req.file.buffer, { title: { login: 'LOGIN', update: 'WORK UPDATE', logout: 'LOGOUT' }[type], userName: req.user.name, capturedAt, ...g, reason: note });
  const id = db.prepare(`INSERT INTO entries (user_id,session_id,type,photo,note,lat,lng,accuracy,address,captured_at,server_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, session.id, type, photo, note || null, g.lat, g.lng, g.accuracy, g.address, capturedAt, nowIso()).lastInsertRowid;
  if (type === 'login') db.prepare(`UPDATE sessions SET login_at=? WHERE id=?`).run(capturedAt, session.id);
  if (type === 'logout') db.prepare(`UPDATE sessions SET logout_at=? WHERE id=?`).run(capturedAt, session.id);
  return db.prepare(`SELECT * FROM entries WHERE id=?`).get(id);
}
for (const type of ['login', 'update', 'logout']) {
  router.post(`/day/${type}`, upload.single('photo'), async (req, res) => {
    const e = await saveEntry(req, res, type);
    if (e) res.status(201).json(e);
  });
}

router.get('/attendance', requireRole(...ADMINS), (req, res) => {
  const date = req.query.date || localDate();
  const users = db.prepare(`SELECT id,name,department,role FROM users WHERE active=1 AND role!='super_admin' ORDER BY name`).all();
  res.json({ date, report_times: getSetting('report_times'), people: users.map(u => ({ ...u, ...dayFor(u.id, date) })) });
});

// ---------- bills ----------
function sharesOf(billId) {
  return db.prepare(`SELECT s.user_id, s.amount, u.name FROM bill_shares s JOIN users u ON u.id=s.user_id WHERE s.bill_id=? ORDER BY u.name`).all(billId);
}
function findDuplicate(amount, capturedAt, userIds, excludeId = 0) {
  if (!userIds.length) return null;
  return db.prepare(`SELECT DISTINCT b.id, b.amount, b.captured_at, u.name AS created_by_name FROM bills b
    JOIN bill_shares s ON s.bill_id=b.id JOIN users u ON u.id=b.created_by
    WHERE b.id!=? AND b.status!='rejected' AND ABS(b.amount-?)<0.01
      AND ABS(strftime('%s',b.captured_at)-strftime('%s',?))<10800
      AND s.user_id IN (${userIds.map(() => '?').join(',')}) LIMIT 1`).get(excludeId, amount, capturedAt, ...userIds);
}
function usage(userIds, month) {
  const r = monthRange(month);
  const rows = db.prepare(`SELECT s.user_id, b.status, SUM(s.amount) total FROM bill_shares s JOIN bills b ON b.id=s.bill_id
    WHERE b.captured_at>=? AND b.captured_at<? GROUP BY s.user_id, b.status`).all(r.from, r.to);
  const out = {};
  for (const id of userIds) out[id] = { approved: 0, pending: 0, rejected: 0 };
  for (const x of rows) if (out[x.user_id]) out[x.user_id][x.status] = round2(x.total);
  return out;
}
function usageRow(u, use) {
  const limit = u.monthly_limit || 0;
  return { user_id: u.id, name: u.name, department: u.department, limit, used: use.approved, pending: use.pending,
    remaining: limit ? round2(limit - use.approved - use.pending) : null };
}
function billOut(b, viewerId) {
  const shares = sharesOf(b.id);
  const out = { ...b, is_group: !!b.is_group, shares };
  if (viewerId) out.my_share = shares.find(s => s.user_id === viewerId)?.amount ?? null;
  return out;
}

router.get('/bills/categories', (req, res) => res.json(CATEGORIES));

router.post('/bills', upload.single('photo'), async (req, res) => {
  if (!checkPhoto(req, res)) return;
  const amount = round2(Number(req.body.amount));
  if (!Number.isFinite(amount) || amount <= 0) return bad(res, 'Enter the bill amount');
  if (amount > 1e7) return bad(res, 'Amount is too large');
  const reason = (req.body.reason || '').trim().slice(0, 300);
  if (!reason) return bad(res, 'Write the reason for this bill');
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other';
  const g = readGps(req.body, false);
  const capturedAt = readTime(req.body);

  // Shares: who this bill is charged to. Default = only me.
  let shares = [{ user_id: req.user.id, amount }];
  if (req.body.shares) {
    try { shares = JSON.parse(req.body.shares).map(s => ({ user_id: Number(s.user_id), amount: round2(Number(s.amount)) })); }
    catch { return bad(res, 'Invalid split'); }
    if (!shares.length) return bad(res, 'Add at least one person');
    if (!shares.some(s => s.user_id === req.user.id)) return bad(res, 'You must be one of the people on the bill');
    if (new Set(shares.map(s => s.user_id)).size !== shares.length) return bad(res, 'A person is added twice');
    if (shares.some(s => !Number.isFinite(s.amount) || s.amount < 0)) return bad(res, 'Each share must be 0 or more');
    const sum = round2(shares.reduce((a, s) => a + s.amount, 0));
    if (Math.abs(sum - amount) > 0.05) return bad(res, `Shares add up to ₹${sum}, but the bill is ₹${amount}`);
    const valid = db.prepare(`SELECT COUNT(*) n FROM users WHERE active=1 AND id IN (${shares.map(() => '?').join(',')})`).get(...shares.map(s => s.user_id)).n;
    if (valid !== shares.length) return bad(res, 'One of the selected people is not an active user');
  }
  const isGroup = shares.length > 1 ? 1 : 0;

  // Duplicate guard: same amount, same people, within 3 hours.
  const dup = findDuplicate(amount, capturedAt, shares.map(s => s.user_id));
  if (dup && req.body.confirm_duplicate !== '1') {
    return res.status(409).json({ error: `A ₹${dup.amount} bill (#${dup.id}) was already added by ${dup.created_by_name} for one of these people at ${fmtTime(dup.captured_at)}. Is this a different bill?`, duplicate: dup });
  }

  const title = isGroup ? `GROUP BILL ₹${amount.toFixed(2)} • ${shares.length} people` : `BILL ₹${amount.toFixed(2)} • ${category}`;
  const photo = await stampAndSave(req.file.buffer, { title, userName: req.user.name, capturedAt, ...g, reason });
  const id = db.transaction(() => {
    const id = db.prepare(`INSERT INTO bills (created_by,photo,amount,category,reason,is_group,lat,lng,accuracy,address,captured_at,server_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.user.id, photo, amount, category, reason, isGroup, g.lat, g.lng, g.accuracy, g.address, capturedAt, nowIso()).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO bill_shares (bill_id,user_id,amount) VALUES (?,?,?)`);
    for (const s of shares) ins.run(id, s.user_id, s.amount);
    return id;
  })();
  res.status(201).json(billOut(db.prepare(`SELECT * FROM bills WHERE id=?`).get(id), req.user.id));
});

// My bills = bills I paid for + group bills I'm part of
router.get('/bills/mine', (req, res) => {
  const r = monthRange(req.query.month);
  const rows = db.prepare(`SELECT DISTINCT b.*, c.name AS created_by_name, rv.name AS reviewer_name FROM bills b
    JOIN bill_shares s ON s.bill_id=b.id JOIN users c ON c.id=b.created_by LEFT JOIN users rv ON rv.id=b.reviewed_by
    WHERE s.user_id=? AND b.captured_at>=? AND b.captured_at<? ORDER BY b.captured_at DESC`).all(req.user.id, r.from, r.to);
  const me = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  res.json({ month: r.month, usage: usageRow(me, usage([me.id], r.month)[me.id]), bills: rows.map(b => billOut(b, req.user.id)) });
});

router.delete('/bills/:id', (req, res) => {
  const b = db.prepare(`SELECT * FROM bills WHERE id=?`).get(req.params.id);
  if (!b || b.created_by !== req.user.id) return bad(res, 'Bill not found', 404);
  if (b.status !== 'pending') return bad(res, 'Only pending bills can be deleted');
  db.prepare(`DELETE FROM bills WHERE id=?`).run(b.id);
  res.json({ ok: true });
});

router.get('/bills', requireRole(...ADMINS), (req, res) => {
  const r = monthRange(req.query.month);
  const where = ['b.captured_at>=?', 'b.captured_at<?'], p = [r.from, r.to];
  if (req.query.status) { where.push('b.status=?'); p.push(req.query.status); }
  if (req.query.user_id) { where.push('b.id IN (SELECT bill_id FROM bill_shares WHERE user_id=?)'); p.push(Number(req.query.user_id)); }
  const rows = db.prepare(`SELECT b.*, c.name AS created_by_name, rv.name AS reviewer_name FROM bills b
    JOIN users c ON c.id=b.created_by LEFT JOIN users rv ON rv.id=b.reviewed_by
    WHERE ${where.join(' AND ')} ORDER BY CASE b.status WHEN 'pending' THEN 0 ELSE 1 END, b.captured_at DESC`).all(...p);
  const users = db.prepare(`SELECT * FROM users`).all();
  const use = usage(users.map(u => u.id), localDate().slice(0, 7));
  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  res.json(rows.map(b => {
    const o = billOut(b);
    o.shares = o.shares.map(s => ({ ...s, ...(({ limit, used, pending, remaining }) => ({ limit, used, pending, remaining }))(usageRow(byId[s.user_id], use[s.user_id])) }));
    const dup = b.status !== 'rejected' && findDuplicate(b.amount, b.captured_at, o.shares.map(s => s.user_id), b.id);
    o.possible_duplicate = dup ? dup.id : null;
    return o;
  }));
});

router.patch('/bills/:id/review', requireRole(...ADMINS), (req, res) => {
  const b = db.prepare(`SELECT * FROM bills WHERE id=?`).get(req.params.id);
  if (!b) return bad(res, 'Bill not found', 404);
  if (b.created_by === req.user.id && req.user.role !== 'super_admin') return bad(res, 'You cannot approve your own bill', 403);
  const { status, note } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(status)) return bad(res, 'Invalid status');
  if (status === 'rejected' && !String(note || '').trim()) return bad(res, 'Please write why the bill is rejected');
  db.prepare(`UPDATE bills SET status=?, review_note=?, reviewed_by=?, reviewed_at=? WHERE id=?`)
    .run(status, status === 'pending' ? null : (note || null), status === 'pending' ? null : req.user.id, status === 'pending' ? null : nowIso(), b.id);
  res.json(billOut(db.prepare(`SELECT * FROM bills WHERE id=?`).get(b.id)));
});

// ---------- usage: limit / used / pending / remaining per person ----------
router.get('/usage', requireRole(...ADMINS), (req, res) => {
  const month = req.query.month || localDate().slice(0, 7);
  const users = db.prepare(`SELECT * FROM users WHERE role!='super_admin' ORDER BY name`).all();
  const use = usage(users.map(u => u.id), month);
  res.json({ month, rows: users.map(u => ({ ...usageRow(u, use[u.id]), active: !!u.active })) });
});

// ---------- money reports (super admin) ----------
router.get('/reports', requireRole('super_admin'), (req, res) => {
  const month = req.query.month || localDate().slice(0, 7);
  const r = monthRange(month);
  // last 12 months ending at the selected month
  const months = [];
  let [y, m] = month.split('-').map(Number);
  for (let i = 0; i < 12; i++) { months.unshift(`${y}-${String(m).padStart(2, '0')}`); if (--m === 0) { m = 12; y--; } }
  const monthly = months.map(mm => {
    const q = monthRange(mm);
    const t = db.prepare(`SELECT status, SUM(amount) total, COUNT(*) n FROM bills WHERE captured_at>=? AND captured_at<? GROUP BY status`).all(q.from, q.to);
    const g = s => round2(t.find(x => x.status === s)?.total || 0);
    return { month: mm, approved: g('approved'), pending: g('pending'), rejected: g('rejected'), bills: t.reduce((a, x) => a + x.n, 0) };
  });
  const bills = db.prepare(`SELECT * FROM bills WHERE captured_at>=? AND captured_at<?`).all(r.from, r.to);
  const daysInMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const daily = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, approved: 0, pending: 0 }));
  const byCategory = {};
  for (const b of bills) {
    if (b.status === 'rejected') continue;
    const d = Number(localDate(b.captured_at).slice(8, 10));
    daily[d - 1][b.status] = round2(daily[d - 1][b.status] + b.amount);
    if (b.status === 'approved') byCategory[b.category] = round2((byCategory[b.category] || 0) + b.amount);
  }
  const users = db.prepare(`SELECT * FROM users WHERE role!='super_admin' ORDER BY name`).all();
  const use = usage(users.map(u => u.id), month);
  const byPerson = users.map(u => usageRow(u, use[u.id])).filter(x => x.used || x.pending || x.limit).sort((a, b) => b.used - a.used);
  const totalLimit = round2(users.filter(u => u.active).reduce((a, u) => a + (u.monthly_limit || 0), 0));
  const cur = monthly[monthly.length - 1], prev = monthly[monthly.length - 2];
  res.json({
    month, monthly, daily,
    by_category: Object.entries(byCategory).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
    by_person: byPerson,
    totals: { approved: cur.approved, pending: cur.pending, rejected: cur.rejected, bills: cur.bills, total_limit: totalLimit,
      prev_approved: prev.approved, group_bills: bills.filter(b => b.is_group && b.status !== 'rejected').length },
  });
});

// ---------- CSV export for accounts (one row per person per bill) ----------
router.get('/export/bills.csv', requireRole(...ADMINS), (req, res) => {
  const r = monthRange(req.query.month);
  const rows = db.prepare(`SELECT b.*, s.user_id, s.amount AS share, u.name AS person, c.name AS paid_by, rv.name AS reviewer FROM bills b
    JOIN bill_shares s ON s.bill_id=b.id JOIN users u ON u.id=s.user_id JOIN users c ON c.id=b.created_by LEFT JOIN users rv ON rv.id=b.reviewed_by
    WHERE b.captured_at>=? AND b.captured_at<? ORDER BY b.captured_at, b.id, u.name`).all(r.from, r.to);
  const base = `${req.protocol}://${req.get('host')}`;
  const e = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = ['Bill ID', 'Date & time', 'Person', 'Person share (₹)', 'Bill total (₹)', 'Group bill', 'Paid/added by', 'Category', 'Reason', 'Status', 'Reviewed by', 'Review note', 'Location', 'Photo'];
  const lines = rows.map(b => [b.id, fmtTime(b.captured_at), b.person, b.share, b.amount, b.is_group ? 'Yes' : 'No', b.paid_by, b.category, b.reason, b.status, b.reviewer, b.review_note,
    b.lat != null ? `https://maps.google.com/?q=${b.lat},${b.lng}` : '', `${base}/files/${b.photo}?sig=${req.app.locals.fileSig(b.photo)}`].map(e).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bills-${r.month}.csv"`);
  res.send('﻿' + [head.join(','), ...lines].join('\n'));
});

module.exports = { router };
