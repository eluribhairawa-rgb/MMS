require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { UPLOAD_DIR } = require('./db');
const { SECRET } = require('./auth');
const { router } = require('./routes');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const fileSig = name => crypto.createHmac('sha256', SECRET).update(name).digest('hex').slice(0, 24);
app.locals.fileSig = fileSig;

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', router);

// Photos need a login token (?token=) or a signed link (?sig=, used in CSV exports)
app.get('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  let ok = req.query.sig === fileSig(name);
  if (!ok && req.query.token) { try { jwt.verify(req.query.token, SECRET); ok = true; } catch {} }
  if (!ok) return res.status(401).send('Unauthorized');
  const p = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(p)) return res.status(404).send('Not found');
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.sendFile(p);
});

// Website (one app for phone and desktop)
const WEB_DIR = path.join(__dirname, '..', '..', 'web');
app.use(express.static(WEB_DIR));
app.get(/^\/(?!api|files).*/, (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
