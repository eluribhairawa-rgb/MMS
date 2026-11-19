const jwt = require('jsonwebtoken');
const { db } = require('./db');

const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

const sign = user => jwt.sign({ id: user.id }, SECRET, { expiresIn: '30d' });

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in' });
  try {
    const { id } = jwt.verify(token, SECRET);
    const u = db.prepare(`SELECT id,name,email,phone,role,department,monthly_limit,active FROM users WHERE id=?`).get(id);
    if (!u || !u.active) throw new Error('inactive');
    req.user = { ...u };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' });

module.exports = { SECRET, sign, requireAuth, requireRole };
