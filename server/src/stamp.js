// Burns a permanent watermark (name, time, GPS, address, reason) into every photo,
// so the image itself proves where and when it was taken even if downloaded.
const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('./db');

const TZ = process.env.TZ_DISPLAY || 'Asia/Kolkata';

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'medium' });
}

async function stampAndSave(buffer, { title, userName, capturedAt, lat, lng, accuracy, address, reason }) {
  const base = sharp(buffer).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await base.jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const fs = Math.max(14, Math.round(W / 42));
  const lines = [
    `${title} • ${userName}`,
    `Time: ${fmtTime(capturedAt)}`,
    lat != null ? `GPS: ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}${accuracy ? `  (±${Math.round(accuracy)} m)` : ''}` : null,
    address ? clip(address, 70) : null,
    reason ? `${clip(reason, 80)}` : null,
  ].filter(Boolean);
  const pad = Math.round(fs * 0.6);
  const lh = Math.round(fs * 1.35);
  const boxH = pad * 2 + lh * lines.length;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${H - boxH}" width="${W}" height="${boxH}" fill="black" fill-opacity="0.6"/>
    ${lines.map((l, i) => `<text x="${pad}" y="${H - boxH + pad + lh * (i + 0.8)}" font-family="DejaVu Sans, Arial, sans-serif"
      font-size="${i === 0 ? fs * 1.05 : fs}" font-weight="${i === 0 ? 700 : 400}" fill="white">${esc(l)}</text>`).join('')}
  </svg>`;
  const out = await sharp(data).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 82 }).toBuffer();
  const name = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.jpg`;
  await sharp(out).toFile(path.join(UPLOAD_DIR, name));
  return name;
}

module.exports = { stampAndSave, fmtTime };
