/* Work & Bills — one website for employees, HR/Admin and Super Admin (phone + desktop). No build step. */
const $ = s => document.querySelector(s);
const main = $('#main');
const S = { token: localStorage.getItem('wb_token'), me: null, settings: {}, people: null, pendingCount: 0 };

// ---------- small helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const moneyShort = n => n >= 1e5 ? '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L' : n >= 1e3 ? '₹' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : '₹' + Math.round(n);
const tm = iso => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—';
const dt = iso => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const localDate = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const thisMonth = () => localDate().slice(0, 7);
const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const monthShort = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
const photo = n => `/files/${encodeURIComponent(n)}?token=${encodeURIComponent(S.token)}`;
const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const isAdmin = () => ['super_admin', 'admin'].includes(S.me?.role);
const ROLE = { super_admin: 'Super Admin', admin: 'HR / Admin', employee: 'Employee' };
const STATUS = { pending: ['Waiting', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'] };
const statusPill = s => `<span class="pill ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 3500); }
const busy = (on, text = 'Saving…') => { $('#busy-text').textContent = text; $('#busy').classList.toggle('hidden', !on); };
function sheet(html) { $('#sheet-card').innerHTML = html; $('#sheet').classList.remove('hidden'); return $('#sheet-card'); }
const closeSheet = () => $('#sheet').classList.add('hidden');
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('click', e => {
  const p = e.target.closest('[data-photo]');
  if (p) { $('#viewer-img').src = photo(p.dataset.photo); $('#viewer').classList.remove('hidden'); }
  const a = e.target.closest('[data-action]');
  if (a?.dataset.action === 'logout') signOut();
  if (a?.dataset.action === 'password') changePassword();
  if (a?.dataset.action === 'close') closeSheet();
});
$('#viewer').onclick = () => $('#viewer').classList.add('hidden');

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${S.token}` },
    body: opts.body && !isForm && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401 && path !== '/auth/change-password') { signOut(true); throw new Error('Please sign in again'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = res.status; e.data = data; throw e; }
  return data;
}

// ---------- icons ----------
const I = {
  day: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  bill: '<svg viewBox="0 0 24 24"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
  team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5c2.6 0 4.5 1.4 5.3 4.5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3 1 3"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  login: '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

// ---------- navigation (what each role sees) ----------
function navItems() {
  const r = S.me.role;
  const items = [];
  if (r === 'super_admin') items.push(['dashboard', 'Money', I.chart]);
  if (r !== 'super_admin') items.push(['day', 'My Day', I.day], ['bills', 'My Bills', I.bill]);
  if (isAdmin()) items.push(['approvals', 'Approvals', I.check], ['attendance', 'Attendance', I.team], ['usage', 'Usage', I.wallet], ['users', 'People', I.user]);
  if (r === 'super_admin') items.push(['settings', 'Settings', I.gear]);
  return items;
}
function drawNav(active) {
  const html = navItems().map(([k, label, icon]) =>
    `<a href="#/${k}" class="${k === active ? 'active' : ''}">${icon}<span>${label}</span>${k === 'approvals' && S.pendingCount ? `<span class="count">${S.pendingCount}</span>` : ''}</a>`).join('');
  $('#nav').innerHTML = html; $('#tabbar').innerHTML = html;
}
async function refreshPendingCount() {
  if (!isAdmin()) return;
  try { S.pendingCount = (await api(`/bills?status=pending&month=${thisMonth()}`)).length; } catch {}
}
window.addEventListener('hashchange', route);
async function route() {
  if (!S.me) return;
  const items = navItems().map(i => i[0]);
  let page = location.hash.replace(/^#\//, '').split('?')[0];
  if (!items.includes(page)) page = items[0];
  drawNav(page);
  main.innerHTML = '<div class="empty">Loading…</div>';
  window.scrollTo(0, 0);
  try { await pages[page](); } catch (e) { main.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}
const pages = {};

// ---------- sign in / out ----------
$('#login-form').onsubmit = async e => {
  e.preventDefault();
  $('#login-err').textContent = '';
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    S.token = d.token; localStorage.setItem('wb_token', d.token);
    boot();
  } catch (err) { $('#login-err').textContent = err.message; }
};
function signOut(silent) {
  S.token = null; S.me = null; localStorage.removeItem('wb_token');
  $('#shell').classList.add('hidden'); $('#login').classList.remove('hidden'); closeSheet();
  if (!silent) history.replaceState(null, '', '/');
}
function changePassword() {
  const c = sheet(`<h2>Change password</h2>
    <label>Current password<input type="password" id="pw1" autocomplete="current-password"></label>
    <label>New password (at least 6 characters)<input type="password" id="pw2" autocomplete="new-password"></label>
    <div class="err" id="pw-err"></div>
    <div class="row"><button class="btn" data-action="close">Cancel</button><button class="btn primary" id="pw-save">Save</button></div>`);
  c.querySelector('#pw-save').onclick = async () => {
    try { await api('/auth/change-password', { method: 'POST', body: { current_password: $('#pw1').value, new_password: $('#pw2').value } }); closeSheet(); toast('Password changed'); }
    catch (e) { $('#pw-err').textContent = e.message; }
  };
}
$('#btn-account').onclick = () => sheet(`<h2>${esc(S.me.name)}</h2><p class="muted" style="margin-top:-6px">${ROLE[S.me.role]}${S.me.phone ? ' · ' + esc(S.me.phone) : ''}</p>
  <button class="btn block" data-action="password" style="margin-bottom:8px">Change password</button>
  <button class="btn block danger" data-action="logout">Sign out</button>`);

async function boot() {
  if (!S.token) { $('#login').classList.remove('hidden'); return; }
  try {
    const d = await api('/auth/me');
    S.me = d.user; S.settings = d.settings;
  } catch { $('#login').classList.remove('hidden'); return; }
  const name = S.settings.company_name || 'EnergyStacks';
  document.title = name; $('#company').textContent = name; $('#company-m').textContent = name;
  $('#me-name').textContent = S.me.name; $('#me-role').textContent = ROLE[S.me.role];
  $('#login').classList.add('hidden'); $('#shell').classList.remove('hidden');
  await refreshPendingCount();
  route();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- location & camera ----------
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot get your location.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(e.code === 1 ? 'Location permission is blocked. Allow location for this site in your browser settings.' : 'Could not get your location. Turn on GPS and try again.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}
async function addressFor(lat, lng) {
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`, { signal: ctl.signal, headers: { 'Accept-Language': 'en' } });
    const d = await r.json();
    return d.display_name ? d.display_name.split(',').slice(0, 4).join(',').trim() : null;
  } catch { return null; }
}

/** Opens the live camera. Resolves with { blob, url, at, loc } or null if closed. No gallery / file picker exists. */
function takePhoto({ title, facing = 'user', needLocation = true, hint = '' }) {
  return new Promise(async resolve => {
    let stream = null, loc = null, locErr = null, timer;
    const cam = $('#cam'), video = $('#video'), shoot = $('#cam-shoot');
    $('#cam-title').textContent = title;
    shoot.disabled = true; // stays off until the camera (and GPS, if needed) is ready
    cam.classList.remove('hidden');
    const info = () => {
      $('#cam-info').innerHTML = `<b>${esc(S.me.name)}</b> · ${new Date().toLocaleString('en-IN')}<br>` +
        (loc ? `📍 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : locErr ? `<span style="color:#ffb4b0">📍 ${esc(locErr)}</span>` : '📍 Getting your location…') +
        (hint ? `<br><span style="opacity:.8">${esc(hint)}</span>` : '');
      shoot.disabled = !stream || !video.videoWidth || (needLocation && !loc);
    };
    const start = async () => {
      stream?.getTracks().forEach(t => t.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1600 }, height: { ideal: 1600 } }, audio: false });
        video.srcObject = stream; video.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
        video.onloadedmetadata = info;
      } catch (e) {
        stream = null;
        toast(!window.isSecureContext ? 'Camera needs a secure (https://) website.' : e.name === 'NotAllowedError' ? 'Camera permission is blocked. Allow camera for this site in browser settings.' : 'Could not open the camera.', true);
      }
      info();
    };
    const finish = result => { clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; cam.classList.add('hidden'); resolve(result); };
    $('#cam-close').onclick = () => finish(null);
    $('#cam-flip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; start(); };
    shoot.onclick = async () => {
      if (!video.videoWidth) return;
      const c = $('#canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      const ctx = c.getContext('2d');
      if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
      navigator.vibrate?.(30);
      finish({ blob, url: URL.createObjectURL(blob), at: new Date().toISOString(), loc });
    };
    timer = setInterval(info, 1000);
    getLocation().then(l => { loc = l; info(); }).catch(e => { locErr = e.message; info(); });
    await start();
  });
}
function photoForm(shot, extra = {}) {
  const fd = new FormData();
  fd.append('photo', shot.blob, 'photo.jpg');
  fd.append('source', 'camera');
  fd.append('captured_at', shot.at);
  if (shot.loc) { fd.append('lat', shot.loc.lat); fd.append('lng', shot.loc.lng); fd.append('accuracy', shot.loc.accuracy); }
  if (shot.address) fd.append('address', shot.address);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') fd.append(k, v);
  return fd;
}
function fillAddress(shot, el) {
  if (!shot.loc) { el.textContent = '📍 Location not available'; return; }
  el.textContent = `📍 ${shot.loc.lat.toFixed(5)}, ${shot.loc.lng.toFixed(5)}`;
  addressFor(shot.loc.lat, shot.loc.lng).then(a => { if (a) { shot.address = a; el.textContent = '📍 ' + a; } });
}

// =====================================================================
// EMPLOYEE — My Day: Login, Work update, Logout
// =====================================================================
pages.day = async () => {
  const d = await api('/day');
  const open = d.open_session;
  const last = d.sessions[d.sessions.length - 1];
  const status = open ? ['var(--ok)', `Logged in at ${tm(open.login_at)}`, 'Send work updates at the report times below']
    : last?.logout_at ? ['#9aa3af', `Logged out at ${tm(last.logout_at)}`, `Logged in at ${tm(last.login_at)}`]
    : ['#d0d5dc', 'Not logged in yet', 'Tap Login to start your day'];
  main.innerHTML = `
    <div class="head"><div><h1>My Day</h1><div class="sub">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div></div>
    <div class="card status"><span class="dot" style="background:${status[0]}"></span><div><div class="t">${status[1]}</div><div class="muted small">${status[2]}</div></div></div>
    <div class="bigacts">${open ? `
      <button class="bigact primary full" data-do="update">${I.camera}<b>Work update</b><span>Selfie + location + what you are doing</span></button>
      <button class="bigact full" data-do="logout">${I.logout}<b>Logout</b><span>End your day with a selfie</span></button>`
      : `<button class="bigact primary full" data-do="login">${I.login}<b>Login</b><span>Start your day with a selfie and location</span></button>`}
    </div>
    ${d.slots.length ? `<div class="card"><h2>Report times</h2><div class="slots">${d.slots.map(s => `
      <div class="slot ${s.done ? 'done' : s.upcoming ? '' : 'miss'}">${s.time}<small>${s.done ? '✓ sent ' + tm(s.at) : s.upcoming ? 'upcoming' : 'no update'}</small></div>`).join('')}</div>
      <div class="muted small" style="margin-top:10px">Set by management. Send a work update around each time.</div></div>` : ''}
    <div class="card"><h2>Today</h2>${d.entries.length ? `<ul class="timeline">${[...d.entries].reverse().map(e => `
      <li><img class="thumb" src="${photo(e.photo)}" data-photo="${esc(e.photo)}" loading="lazy" alt="">
        <div class="w"><div><span class="pill ${e.type === 'login' ? 'ok' : e.type === 'logout' ? 'grey' : 'blue'}">${{ login: 'Login', update: 'Update', logout: 'Logout' }[e.type]}</span> <b>${tm(e.captured_at)}</b></div>
        ${e.note ? `<div style="margin-top:3px">${esc(e.note)}</div>` : ''}
        <div class="muted tiny ellip">${esc(e.address || `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`)}</div></div></li>`).join('')}</ul>` : '<div class="empty">Nothing yet today</div>'}</div>`;
  main.querySelectorAll('[data-do]').forEach(b => b.onclick = () => dayAction(b.dataset.do));
};

async function dayAction(type) {
  const titles = { login: 'Login', update: 'Work update', logout: 'Logout' };
  const shot = await takePhoto({ title: titles[type], facing: 'user', hint: 'Take a selfie' });
  if (!shot) return;
  const c = sheet(`<h2>${titles[type]}</h2>
    <img class="sheet-photo" src="${shot.url}" alt="">
    <div class="muted small" id="addr"></div><div class="muted small">🕒 ${new Date(shot.at).toLocaleString('en-IN')}</div><br>
    <label>${type === 'update' ? 'What are you doing? (work update)' : 'Note (optional)'}
      <textarea id="note" rows="3" placeholder="${type === 'update' ? 'e.g. Met dealer at Kukatpally, collected order for 20 boxes' : type === 'login' ? 'e.g. Starting from office' : 'e.g. Finished visits for today'}"></textarea></label>
    <div class="err" id="f-err"></div>
    <div class="row"><button class="btn" id="retake">Retake</button><button class="btn primary" id="go">Submit</button></div>`);
  fillAddress(shot, c.querySelector('#addr'));
  c.querySelector('#retake').onclick = () => { closeSheet(); dayAction(type); };
  c.querySelector('#go').onclick = async () => {
    const note = c.querySelector('#note').value.trim();
    if (type === 'update' && !note) return (c.querySelector('#f-err').textContent = 'Please write a short work update');
    busy(true);
    try {
      await api(`/day/${type}`, { method: 'POST', body: photoForm(shot, { note }) });
      closeSheet(); toast({ login: 'Logged in ✓', update: 'Work update sent ✓', logout: 'Logged out ✓ See you tomorrow' }[type]); route();
    } catch (e) { c.querySelector('#f-err').textContent = navigator.onLine ? e.message : 'No internet. Tap Submit again when you are online.'; }
    finally { busy(false); }
  };
}

// =====================================================================
// EMPLOYEE — My Bills: add bill (camera only), group split, track approvals
// =====================================================================
function usageCard(u, title = 'This month') {
  const lim = u.limit, used = u.used, pend = u.pending;
  const over = lim && used + pend > lim;
  const pct = x => lim ? Math.min(100, (x / lim) * 100) : 0;
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="margin:0">${title}</h2><span class="muted small">${lim ? 'Monthly limit ' + money(lim) : 'No limit set'}</span></div>
    <div class="grid" style="grid-template-columns:repeat(3,1fr);margin:12px 0">
      <div><div class="muted tiny">USED (approved)</div><div class="num" style="font-size:20px;font-weight:750">${money(used)}</div></div>
      <div><div class="muted tiny">WAITING</div><div class="num" style="font-size:20px;font-weight:750">${money(pend)}</div></div>
      <div><div class="muted tiny">REMAINING</div><div class="num ${u.remaining < 0 ? 'neg' : ''}" style="font-size:20px;font-weight:750">${u.remaining == null ? '—' : money(u.remaining)}</div></div>
    </div>
    ${lim ? `<div class="ubar ${over ? 'over' : ''}"><div class="u" style="width:${pct(used)}%"></div><div class="p" style="width:${pct(pend)}%"></div></div>
      <div class="legend"><span><i style="background:var(--brand)"></i>Used</span><span><i style="background:#9db6f0"></i>Waiting for approval</span></div>` : ''}
  </div>`;
}

pages.bills = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const month = q.get('m') || thisMonth(), filter = q.get('f') || 'all';
  const d = await api(`/bills/mine?month=${month}`);
  const list = d.bills.filter(b => filter === 'all' || b.status === filter);
  const nav = (m, f) => { location.hash = `#/bills?m=${m}&f=${f}`; };
  main.innerHTML = `
    <div class="head"><div><h1>My Bills</h1><div class="sub">Take a photo of the bill — the camera is the only way to add one.</div></div>
      <button class="btn primary" id="add-bill">${I.camera} Add bill</button></div>
    ${usageCard(d.usage, monthName(month))}
    <div class="card">
      <div class="tools" style="justify-content:space-between;margin-bottom:8px">
        <div class="segs">${['all', 'pending', 'approved', 'rejected'].map(f => `<button data-f="${f}" class="${f === filter ? 'on' : ''}">${f === 'all' ? 'All' : STATUS[f][0]}</button>`).join('')}</div>
        <input type="month" id="month" value="${month}" max="${thisMonth()}">
      </div>
      ${list.map(b => billRow(b)).join('') || '<div class="empty">No bills here</div>'}
    </div>`;
  $('#add-bill').onclick = addBill;
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => nav(month, b.dataset.f));
  $('#month').onchange = e => nav(e.target.value || thisMonth(), filter);
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this bill? (only possible while it is waiting)')) return;
    try { await api(`/bills/${b.dataset.del}`, { method: 'DELETE' }); toast('Bill deleted'); route(); } catch (e) { toast(e.message, true); }
  });
};

function billRow(b) {
  const mine = b.created_by === S.me.id;
  return `<div class="bill">
    <img class="thumb" src="${photo(b.photo)}" data-photo="${esc(b.photo)}" loading="lazy" alt="">
    <div class="w">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div><span class="amt">${money(b.is_group ? b.my_share : b.amount)}</span>
          ${b.is_group ? `<span class="muted small"> your share of ${money(b.amount)}</span>` : ''}</div>
        ${statusPill(b.status)}
      </div>
      <div class="ellip">${esc(b.reason)}</div>
      <div class="muted tiny">${dt(b.captured_at)} · ${esc(b.category)}${!mine ? ` · added by ${esc(b.created_by_name)}` : ''}${b.reviewer_name && b.status !== 'pending' ? ` · by ${esc(b.reviewer_name)}` : ''}</div>
      ${b.is_group ? `<div class="members">${b.shares.map(s => `<span class="pill grey">${esc(s.name.split(' ')[0])} ${money(s.amount)}</span>`).join('')}</div>` : ''}
      ${b.status === 'rejected' && b.review_note ? `<div class="badbox">Reason: ${esc(b.review_note)}</div>` : ''}
      ${mine && b.status === 'pending' ? `<button class="linkbtn small" style="color:var(--bad)" data-del="${b.id}">Delete</button>` : ''}
    </div></div>`;
}

async function addBill() {
  const shot = await takePhoto({ title: 'Bill photo', facing: 'environment', needLocation: false, hint: 'Hold the bill flat and fill the screen' });
  if (!shot) return;
  if (!S.people) S.people = await api('/people').catch(() => []);
  const others = S.people.filter(p => p.id !== S.me.id);
  const cats = S.settings.categories || ['Food', 'Travel', 'Fuel', 'Stay', 'Other'];
  const st = { category: 'Food', group: false, picked: new Set(), custom: {} };
  const c = sheet(`<h2>New bill</h2>
    <img class="sheet-photo" src="${shot.url}" alt="" style="max-height:24vh">
    <div class="muted small" id="addr"></div><br>
    <label>Bill amount (₹)<input id="amount" type="number" inputmode="decimal" min="1" step="0.01" placeholder="e.g. 900"></label>
    <label style="margin-bottom:0">Type</label>
    <div class="chips" id="cats">${cats.map(x => `<button type="button" class="chip ${x === st.category ? 'on' : ''}">${esc(x)}</button>`).join('')}</div>
    <label>Reason for this bill<textarea id="reason" rows="2" placeholder="e.g. Lunch with dealer team at Ameerpet"></textarea></label>
    ${others.length ? `<label class="switch">Group bill — split with others<input type="checkbox" id="group"></label>
    <div id="groupbox" class="hidden">
      <input id="search" placeholder="Search people…" style="margin:0 0 8px">
      <div class="people" id="people">${others.map(p => `<label data-name="${esc(p.name.toLowerCase())}"><input type="checkbox" value="${p.id}"> ${esc(p.name)} <span class="muted small">${esc(p.department || '')}</span></label>`).join('')}</div>
      <div class="tools" style="justify-content:space-between;margin-bottom:8px"><b>Split</b><button type="button" class="btn sm" id="equal">Split equally</button></div>
      <div id="split"></div>
      <div class="sumline" id="sum"></div>
      <div class="muted tiny" style="margin-bottom:12px">Only you add this bill. Each person's share counts toward their own monthly limit, so nobody needs to add it again.</div>
    </div>` : ''}
    <div class="err" id="f-err"></div>
    <div class="row"><button class="btn" id="retake">Retake</button><button class="btn primary" id="go">Submit for approval</button></div>`);
  fillAddress(shot, c.querySelector('#addr'));
  const amountEl = c.querySelector('#amount');
  c.querySelector('#cats').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; st.category = b.textContent; c.querySelectorAll('#cats .chip').forEach(x => x.classList.toggle('on', x === b)); };
  const members = () => [S.me.id, ...st.picked];
  const nameOf = id => id === S.me.id ? `${S.me.name} (you)` : S.people.find(p => p.id === id)?.name;
  function equalSplit() {
    const amt = Number(amountEl.value) || 0, ids = members(), n = ids.length;
    const each = Math.floor((amt / n) * 100) / 100;
    st.custom = {}; ids.forEach((id, i) => { st.custom[id] = i === 0 ? Math.round((amt - each * (n - 1)) * 100) / 100 : each; });
    drawSplit();
  }
  function drawSplit() {
    if (!st.group) return;
    const ids = members();
    c.querySelector('#split').innerHTML = ids.map(id => `<div class="split-row"><span>${esc(nameOf(id))}</span><input type="number" inputmode="decimal" step="0.01" min="0" data-id="${id}" value="${st.custom[id] ?? ''}"></div>`).join('');
    c.querySelectorAll('#split input').forEach(i => i.oninput = () => { st.custom[i.dataset.id] = Number(i.value) || 0; drawSum(); });
    drawSum();
  }
  function drawSum() {
    const amt = Number(amountEl.value) || 0, sum = members().reduce((a, id) => a + (Number(st.custom[id]) || 0), 0);
    const ok = Math.abs(sum - amt) < 0.05;
    c.querySelector('#sum').innerHTML = `<span>${members().length} people · total of shares</span><span style="color:${ok ? 'var(--ok)' : 'var(--bad)'}">${money(sum)} ${ok ? '✓' : `of ${money(amt)}`}</span>`;
  }
  const g = c.querySelector('#group');
  if (g) {
    g.onchange = () => { st.group = g.checked; c.querySelector('#groupbox').classList.toggle('hidden', !g.checked); equalSplit(); };
    c.querySelector('#people').onchange = e => { const id = Number(e.target.value); e.target.checked ? st.picked.add(id) : st.picked.delete(id); equalSplit(); };
    c.querySelector('#search').oninput = e => { const s = e.target.value.toLowerCase(); c.querySelectorAll('#people label').forEach(l => l.classList.toggle('hidden', !l.dataset.name.includes(s))); };
    c.querySelector('#equal').onclick = equalSplit;
    amountEl.addEventListener('input', () => st.group && equalSplit());
  }
  c.querySelector('#retake').onclick = () => { closeSheet(); addBill(); };
  const submit = async confirmDup => {
    const err = c.querySelector('#f-err'); err.textContent = '';
    const amount = Number(amountEl.value), reason = c.querySelector('#reason').value.trim();
    if (!(amount > 0)) return (err.textContent = 'Enter the bill amount');
    if (!reason) return (err.textContent = 'Write the reason for this bill');
    let shares;
    if (st.group) {
      if (!st.picked.size) return (err.textContent = 'Pick the people who were with you, or turn off Group bill');
      shares = members().map(id => ({ user_id: id, amount: Number(st.custom[id]) || 0 }));
      const sum = shares.reduce((a, s) => a + s.amount, 0);
      if (Math.abs(sum - amount) > 0.05) return (err.textContent = `Shares add up to ${money(sum)} but the bill is ${money(amount)}`);
    }
    busy(true);
    try {
      await api('/bills', { method: 'POST', body: photoForm(shot, { amount, reason, category: st.category, shares: shares && JSON.stringify(shares), confirm_duplicate: confirmDup ? '1' : '' }) });
      closeSheet(); toast(st.group ? `Group bill sent for approval ✓ (${shares.length} people)` : 'Bill sent for approval ✓'); route();
    } catch (e) {
      if (e.status === 409) { busy(false); if (confirm(e.message + '\n\nPress OK only if this is a different bill.')) return submit(true); err.textContent = 'Not submitted — this bill is already added.'; return; }
      err.textContent = navigator.onLine ? e.message : 'No internet. Tap Submit again when you are online.';
    } finally { busy(false); }
  };
  c.querySelector('#go').onclick = () => submit(false);
}

// =====================================================================
// HR / ADMIN — Approvals
// =====================================================================
pages.approvals = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const status = q.get('s') || 'pending', month = q.get('m') || thisMonth(), person = q.get('u') || '';
  const [bills, users] = await Promise.all([api(`/bills?status=${status}&month=${month}${person ? '&user_id=' + person : ''}`), api('/users')]);
  const nav = (s, m, u) => { location.hash = `#/approvals?s=${s}&m=${m}&u=${u}`; };
  const total = bills.reduce((a, b) => a + b.amount, 0);
  main.innerHTML = `
    <div class="head"><div><h1>Bill approvals</h1><div class="sub">${bills.length} bills · ${money(total)}</div></div>
      <div class="tools"><select id="person"><option value="">Everyone</option>${users.filter(u => u.role !== 'super_admin').map(u => `<option value="${u.id}" ${person == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        <input type="month" id="month" value="${month}" max="${thisMonth()}"><button class="btn sm" id="csv">Download Excel (CSV)</button></div></div>
    <div class="segs" style="margin-bottom:14px">${['pending', 'approved', 'rejected'].map(s => `<button data-s="${s}" class="${s === status ? 'on' : ''}">${STATUS[s][0]}</button>`).join('')}</div>
    ${bills.map(reviewCard).join('') || `<div class="card empty">${status === 'pending' ? 'All caught up — no bills waiting 🎉' : 'No bills'}</div>`}`;
  main.querySelectorAll('[data-s]').forEach(b => b.onclick = () => nav(b.dataset.s, month, person));
  $('#month').onchange = e => nav(status, e.target.value || thisMonth(), person);
  $('#person').onchange = e => nav(status, month, e.target.value);
  $('#csv').onclick = async () => {
    const r = await fetch(`/api/export/bills.csv?month=${month}`, { headers: { Authorization: `Bearer ${S.token}` } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `bills-${month}.csv`; a.click();
  };
  const review = async (id, st, note) => {
    try { await api(`/bills/${id}/review`, { method: 'PATCH', body: { status: st, note } }); toast(st === 'pending' ? 'Moved back to waiting' : `Bill ${st}`); await refreshPendingCount(); route(); }
    catch (e) { toast(e.message, true); }
  };
  main.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => review(b.dataset.ok, 'approved'));
  main.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => review(b.dataset.undo, 'pending'));
  main.querySelectorAll('[data-no]').forEach(b => b.onclick = () => {
    const c = sheet(`<h2>Reject bill #${b.dataset.no}</h2><label>Reason (the employee will see this)<textarea id="rj" rows="3" placeholder="e.g. Bill is not readable, please add again"></textarea></label>
      <div class="row"><button class="btn" data-action="close">Cancel</button><button class="btn danger" id="rj-go">Reject</button></div>`);
    c.querySelector('#rj-go').onclick = () => { const n = $('#rj').value.trim(); if (!n) return toast('Please write a reason', true); closeSheet(); review(b.dataset.no, 'rejected', n); };
  });
};

function reviewCard(b) {
  const canAct = b.created_by !== S.me.id || S.me.role === 'super_admin';
  return `<div class="review">
    <img class="ph" src="${photo(b.photo)}" data-photo="${esc(b.photo)}" loading="lazy" alt="">
    <div>
      <div class="top"><div><div class="amt">${money(b.amount)}</div><div class="muted small">#${b.id} · ${esc(b.category)} · ${dt(b.captured_at)}</div></div>
        <div>${b.is_group ? `<span class="pill blue">Group · ${b.shares.length} people</span> ` : ''}${statusPill(b.status)}</div></div>
      <div style="margin-top:6px"><b>${esc(b.reason)}</b></div>
      <div class="muted small">Added by ${esc(b.created_by_name)}${b.lat != null ? ` · <a href="${mapUrl(b.lat, b.lng)}" target="_blank" rel="noopener">📍 ${esc(b.address || 'View location')}</a>` : ''}</div>
      ${b.possible_duplicate ? `<div class="warnbox">⚠ Possible duplicate of bill #${b.possible_duplicate} (same amount, same people, within 3 hours)</div>` : ''}
      <table class="shares"><thead><tr><th>Person</th><th class="r">Share</th><th class="r">Used this month</th><th class="r">Remaining</th></tr></thead><tbody>
        ${b.shares.map(s => `<tr><td>${esc(s.name)}</td><td class="r"><b>${money(s.amount)}</b></td><td class="r">${money(s.used)}${s.limit ? ` <span class="muted tiny">/ ${money(s.limit)}</span>` : ''}</td>
          <td class="r ${s.remaining != null && s.remaining < 0 ? 'neg' : ''}">${s.remaining == null ? '<span class="muted">no limit</span>' : money(s.remaining)}</td></tr>`).join('')}
      </tbody></table>
      ${b.status === 'rejected' && b.review_note ? `<div class="badbox">Rejected: ${esc(b.review_note)}</div>` : ''}
      ${b.reviewer_name ? `<div class="muted tiny" style="margin-top:4px">${STATUS[b.status][0]} by ${esc(b.reviewer_name)} · ${dt(b.reviewed_at)}</div>` : ''}
      <div class="acts">${!canAct ? '<span class="muted small">Your own bill — another admin must approve it</span>' : b.status === 'pending'
        ? `<button class="btn ok" data-ok="${b.id}">Approve</button><button class="btn danger" data-no="${b.id}">Reject</button>`
        : `<button class="btn sm" data-undo="${b.id}">Undo</button>`}</div>
    </div></div>`;
}

// =====================================================================
// HR / ADMIN — Attendance (login, updates, logout)
// =====================================================================
pages.attendance = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const date = q.get('d') || localDate();
  const d = await api(`/attendance?date=${date}`);
  const people = d.people.filter(p => p.role !== 'super_admin');
  const present = people.filter(p => p.sessions.length).length;
  main.innerHTML = `
    <div class="head"><div><h1>Attendance</h1><div class="sub">${present} of ${people.length} logged in · report times ${d.report_times.join(', ') || 'not set'}</div></div>
      <div class="tools"><input type="date" id="date" value="${date}" max="${localDate()}"></div></div>
    <div class="card">${people.map(p => {
      const first = p.sessions[0], last = p.sessions[p.sessions.length - 1];
      const updates = p.entries.filter(e => e.type === 'update').length;
      return `<div class="person">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
          <div><b>${esc(p.name)}</b> <span class="muted small">${esc(p.department || '')}</span></div>
          <div class="tools">${first ? `<span class="pill ok">In ${tm(first.login_at)}</span>
            ${last.logout_at ? `<span class="pill grey">Out ${tm(last.logout_at)}</span>` : `<span class="pill blue">${date === localDate() ? 'Working' : 'No logout'}</span>`}
            <span class="pill grey">${updates} update${updates === 1 ? '' : 's'}</span>` : '<span class="pill bad">Not logged in</span>'}</div>
        </div>
        ${p.slots.length && first ? `<div class="slots" style="margin-top:8px">${p.slots.map(s => `<div class="slot ${s.done ? 'done' : s.upcoming ? '' : 'miss'}" style="min-width:64px;padding:4px 10px">${s.time}<small>${s.done ? '✓ ' + tm(s.at) : s.upcoming ? 'later' : '—'}</small></div>`).join('')}</div>` : ''}
        ${p.entries.length ? `<div class="ph-row">${p.entries.map(e => `<figure>
          <img src="${photo(e.photo)}" data-photo="${esc(e.photo)}" loading="lazy" alt="">
          <figcaption><b>${{ login: 'Login', update: 'Update', logout: 'Logout' }[e.type]} ${tm(e.captured_at)}</b><br>${esc(e.note || '')}<br>
            <a href="${mapUrl(e.lat, e.lng)}" target="_blank" rel="noopener" class="tiny">📍 ${esc((e.address || 'Map').slice(0, 40))}</a></figcaption></figure>`).join('')}</div>` : ''}
      </div>`;
    }).join('') || '<div class="empty">No employees yet</div>'}</div>`;
  $('#date').onchange = e => { location.hash = `#/attendance?d=${e.target.value || localDate()}`; };
};

// =====================================================================
// HR / ADMIN — Usage per person (limit, used, waiting, remaining)
// =====================================================================
pages.usage = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const month = q.get('m') || thisMonth();
  const d = await api(`/usage?month=${month}`);
  const rows = d.rows.filter(r => r.active || r.used || r.pending);
  const t = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
  main.innerHTML = `
    <div class="head"><div><h1>Usage by person</h1><div class="sub">${monthName(month)} — each person's share of every bill, including group bills</div></div>
      <div class="tools"><input type="month" id="month" value="${month}" max="${thisMonth()}"></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="tile"><div class="k">Total limits</div><div class="v">${money(t('limit'))}</div></div>
      <div class="tile"><div class="k">Used</div><div class="v">${money(t('used'))}</div></div>
      <div class="tile"><div class="k">Waiting</div><div class="v">${money(t('pending'))}</div></div>
      <div class="tile"><div class="k">Over limit</div><div class="v" style="color:${rows.some(r => r.remaining < 0) ? 'var(--bad)' : 'inherit'}">${rows.filter(r => r.remaining < 0).length}</div><div class="s">people</div></div>
    </div>
    <div class="card scroll"><table class="table">
      <thead><tr><th>Person</th><th class="r">Limit</th><th class="r">Used</th><th class="r">Waiting</th><th class="r">Remaining</th><th style="width:28%">Progress</th></tr></thead>
      <tbody>${rows.map(r => {
        const pct = x => r.limit ? Math.min(100, (x / r.limit) * 100) : 0;
        return `<tr><td><b>${esc(r.name)}</b><div class="muted tiny">${esc(r.department || '')}</div></td>
          <td class="r">${r.limit ? money(r.limit) : '<span class="muted">—</span>'}</td><td class="r">${money(r.used)}</td><td class="r">${money(r.pending)}</td>
          <td class="r ${r.remaining < 0 ? 'neg' : ''}">${r.remaining == null ? '<span class="muted">no limit</span>' : money(r.remaining)}</td>
          <td>${r.limit ? `<div class="ubar ${r.remaining < 0 ? 'over' : ''}" title="${Math.round(((r.used + r.pending) / r.limit) * 100)}% of limit"><div class="u" style="width:${pct(r.used)}%"></div><div class="p" style="width:${pct(r.pending)}%"></div></div>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      <div class="legend"><span><i style="background:var(--brand)"></i>Used (approved)</span><span><i style="background:#9db6f0"></i>Waiting for approval</span><span><i style="background:var(--bad)"></i>Over limit</span></div>
    </div>`;
  $('#month').onchange = e => { location.hash = `#/usage?m=${e.target.value || thisMonth()}`; };
};

// =====================================================================
// HR / ADMIN — People (create users by role, monthly limits)
// =====================================================================
pages.users = async () => {
  const users = await api('/users');
  main.innerHTML = `
    <div class="head"><div><h1>People</h1><div class="sub">${S.me.role === 'super_admin' ? 'Add employees, HR/Admins and other super admins. Set each person\'s monthly bill limit.' : 'Add employees and set their monthly bill limit.'}</div></div>
      <button class="btn primary" id="add">+ Add person</button></div>
    <div class="card scroll"><table class="table">
      <thead><tr><th>Name</th><th>Login</th><th>Role</th><th class="r">Monthly limit</th><th>Status</th><th></th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><b>${esc(u.name)}</b><div class="muted tiny">${esc(u.department || '')}</div></td>
        <td class="small">${[u.username, u.phone, u.email].filter(Boolean).map(esc).join('<br>')}</td>
        <td>${ROLE[u.role]}</td>
        <td class="r">${u.role === 'super_admin' ? '' : u.monthly_limit ? money(u.monthly_limit) : '<span class="muted">No limit</span>'}</td>
        <td>${u.active ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Disabled</span>'}</td>
        <td class="r">${u.id !== S.me.id && (S.me.role === 'super_admin' || u.role === 'employee') ? `<button class="btn sm" data-edit="${u.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('#add').onclick = () => userForm(null);
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => userForm(users.find(u => u.id == b.dataset.edit)));
};
function userForm(u) {
  const sup = S.me.role === 'super_admin';
  const c = sheet(`<h2>${u ? 'Edit ' + esc(u.name) : 'Add person'}</h2>
    <label>Full name<input id="u-name" value="${esc(u?.name || '')}"></label>
    <label>Username (for sign in)<input id="u-username" autocapitalize="none" autocomplete="off" placeholder="e.g. ravi.sales" value="${esc(u?.username || '')}"></label>
    <div class="row"><label>Phone<input id="u-phone" inputmode="tel" value="${esc(u?.phone || '')}"></label><label>Email<input id="u-email" type="email" value="${esc(u?.email || '')}"></label></div>
    <label>${u ? 'New password (leave empty to keep)' : 'Password (at least 6 characters)'}<input id="u-pass" autocomplete="new-password"></label>
    <div class="row">${sup ? `<label>Role<select id="u-role">${['employee', 'admin', 'super_admin'].map(r => `<option value="${r}" ${(u?.role || 'employee') === r ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select></label>` : ''}
      <label>Department<input id="u-dept" value="${esc(u?.department || '')}" placeholder="e.g. Sales"></label></div>
    <label>Monthly bill limit (₹) — 0 means no limit<input id="u-limit" type="number" min="0" inputmode="numeric" value="${u?.monthly_limit || 0}"></label>
    ${u ? `<label class="switch">Account active (can sign in)<input type="checkbox" id="u-active" ${u.active ? 'checked' : ''}></label>` : ''}
    <div class="muted tiny" style="margin:-4px 0 10px">They sign in with the username, phone number or email above, and the password.</div>
    <div class="err" id="u-err"></div>
    <div class="row"><button class="btn" data-action="close">Cancel</button><button class="btn primary" id="u-save">${u ? 'Save' : 'Add person'}</button></div>`);
  c.querySelector('#u-save').onclick = async () => {
    const body = { name: $('#u-name').value.trim(), username: $('#u-username').value.trim(), phone: $('#u-phone').value.trim(), email: $('#u-email').value.trim(), department: $('#u-dept').value.trim(), monthly_limit: Number($('#u-limit').value) || 0 };
    if ($('#u-pass').value) body.password = $('#u-pass').value;
    if (sup) body.role = $('#u-role').value; else if (!u) body.role = 'employee';
    if (u) body.active = $('#u-active').checked;
    try { await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PATCH' : 'POST', body }); S.people = null; closeSheet(); toast(u ? 'Saved' : 'Person added'); route(); }
    catch (e) { $('#u-err').textContent = e.message; }
  };
}

// =====================================================================
// SUPER ADMIN — Settings (report times)
// =====================================================================
pages.settings = async () => {
  const d = await api('/auth/me'); S.settings = d.settings;
  let times = [...(S.settings.report_times || [])];
  main.innerHTML = `
    <div class="head"><div><h1>Settings</h1></div></div>
    <div class="card"><h2>Report times</h2>
      <p class="muted small" style="margin-top:-6px">Employees see these times on their My Day screen as a guide for when to send work updates. Updates are not forced.</p>
      <div class="slots" id="times"></div>
      <div class="tools" style="margin-top:12px"><input type="time" id="new-time" value="12:00"><button class="btn sm" id="add-time">Add time</button></div>
      <div style="margin-top:14px"><button class="btn primary" id="save-times">Save report times</button></div></div>
    <div class="card"><h2>Company name</h2><div class="tools"><input id="cname" value="${esc(S.settings.company_name || '')}" style="flex:1;min-width:200px"><button class="btn primary" id="save-name">Save</button></div></div>`;
  const draw = () => { $('#times').innerHTML = times.map((t, i) => `<div class="slot" style="flex-direction:row;align-items:center;gap:8px">${t}<button class="linkbtn" data-rm="${i}" aria-label="Remove" style="color:var(--bad)">✕</button></div>`).join('') || '<span class="muted">No times set</span>';
    main.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { times.splice(b.dataset.rm, 1); draw(); }); };
  draw();
  $('#add-time').onclick = () => { const v = $('#new-time').value; if (v && !times.includes(v)) { times.push(v); times.sort(); draw(); } };
  $('#save-times').onclick = async () => { try { const r = await api('/settings', { method: 'PUT', body: { report_times: times } }); S.settings.report_times = r.report_times; toast('Report times saved'); } catch (e) { toast(e.message, true); } };
  $('#save-name').onclick = async () => { try { await api('/settings', { method: 'PUT', body: { company_name: $('#cname').value } }); toast('Saved'); boot(); } catch (e) { toast(e.message, true); } };
};

// =====================================================================
// SUPER ADMIN — Money dashboard (monthly spend, daily histogram, by person, by category)
// =====================================================================
function barChart(data, { label, value, tip, height = 220 }) {
  // Single-series vertical bar chart (SVG), with hover tooltips. Rounded tops, 2px gaps, recessive grid.
  const id = 'c' + Math.random().toString(36).slice(2, 8);
  const W = 720, H = height, padL = 46, padB = 26, padT = 10;
  const max = Math.max(1, ...data.map(value));
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const bw = (W - padL) / data.length, barW = Math.max(3, Math.min(42, bw - 4));
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  const labelEvery = Math.ceil(data.length / 16);
  let g = '';
  for (let v = 0; v <= top; v += step) g += `<line class="gridline" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${moneyShort(v)}</text>`;
  data.forEach((d, i) => {
    const v = value(d), x = padL + i * bw + (bw - barW) / 2, h = Math.max(0, H - padB - y(v));
    const r = Math.min(4, barW / 2, h);
    const path = h > 0 ? `M${x},${H - padB} V${H - padB - h + r} Q${x},${H - padB - h} ${x + r},${H - padB - h} H${x + barW - r} Q${x + barW},${H - padB - h} ${x + barW},${H - padB - h + r} V${H - padB} Z` : '';
    g += `<g data-i="${i}"><rect class="hit" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}"/>${path ? `<path class="bar" d="${path}"/>` : ''}</g>`;
    if (i % labelEvery === 0) g += `<text class="axis" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${esc(label(d))}</text>`;
  });
  setTimeout(() => {
    const box = document.getElementById(id); if (!box) return;
    const tipEl = box.querySelector('.tip'), svg = box.querySelector('svg');
    box.querySelectorAll('g[data-i]').forEach(el => {
      el.onmouseenter = el.ontouchstart = () => {
        const i = +el.dataset.i, d = data[i], rect = svg.getBoundingClientRect(), sx = rect.width / W;
        tipEl.innerHTML = tip(d); tipEl.classList.remove('hidden');
        tipEl.style.left = Math.min(Math.max((padL + i * bw + bw / 2) * sx, 70), rect.width - 70) + 'px';
        tipEl.style.top = y(value(d)) * (rect.height / H) + 'px';
      };
      el.onmouseleave = () => tipEl.classList.add('hidden');
    });
  });
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg><div class="tip hidden"></div></div>`;
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function hbars(rows, { name, value, limit, sub }) {
  const max = Math.max(1, ...rows.map(r => Math.max(value(r), limit ? limit(r) || 0 : 0)));
  return `<div class="hbars">${rows.map(r => {
    const v = value(r), l = limit ? limit(r) : 0, over = l && v > l;
    return `<div class="hbar"><div class="lbl"><span>${esc(name(r))}</span><span class="num"><b>${money(v)}</b>${sub ? ` <span class="muted tiny">${sub(r)}</span>` : ''}</span></div>
      <div class="track"><div class="fill ${over ? 'over' : ''}" style="width:${(v / max) * 100}%"></div>${l ? `<div class="limit" style="left:calc(${(l / max) * 100}% - 1px)" title="Limit ${money(l)}"></div>` : ''}</div></div>`;
  }).join('')}</div>`;
}

pages.dashboard = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const month = q.get('m') || thisMonth();
  const r = await api(`/reports?month=${month}`);
  const t = r.totals;
  const change = t.prev_approved ? Math.round(((t.approved - t.prev_approved) / t.prev_approved) * 100) : null;
  main.innerHTML = `
    <div class="head"><div><h1>Money</h1><div class="sub">Company spend on bills · ${monthName(month)}</div></div>
      <div class="tools"><input type="month" id="month" value="${month}" max="${thisMonth()}"></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="tile"><div class="k">Spent (approved)</div><div class="v">${money(t.approved)}</div><div class="s">${change == null ? 'no data last month' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs last month`}</div></div>
      <div class="tile"><div class="k">Waiting approval</div><div class="v">${money(t.pending)}</div><div class="s"><a href="#/approvals?s=pending&m=${month}">Review →</a></div></div>
      <div class="tile"><div class="k">Monthly limits</div><div class="v">${money(t.total_limit)}</div><div class="s">${t.total_limit ? Math.round((t.approved / t.total_limit) * 100) + '% used' : 'no limits set'}</div></div>
      <div class="tile"><div class="k">Bills</div><div class="v">${t.bills}</div><div class="s">${t.group_bills} group bill${t.group_bills === 1 ? '' : 's'}</div></div>
    </div>
    <div class="card"><h2>Monthly spend — last 12 months</h2>
      ${barChart(r.monthly, { label: d => monthShort(d.month), value: d => d.approved, tip: d => `<b>${monthName(d.month)}</b><br>Approved ${money(d.approved)}<br>Waiting ${money(d.pending)}<br>${d.bills} bills` })}</div>
    <div class="card"><h2>Daily spend — ${monthName(month)}</h2>
      ${barChart(r.daily, { label: d => d.day, value: d => d.approved, height: 180, tip: d => `<b>${d.day} ${monthShort(month)}</b><br>Approved ${money(d.approved)}${d.pending ? `<br>Waiting ${money(d.pending)}` : ''}` })}</div>
    <div class="grid g2">
      <div class="card"><h2>Spend by person</h2>
        ${r.by_person.length ? hbars(r.by_person, { name: p => p.name, value: p => p.used, limit: p => p.limit, sub: p => p.limit ? `of ${money(p.limit)}` : '' }) +
          '<div class="legend"><span><i style="background:var(--brand)"></i>Used</span><span><i style="background:var(--ink);width:3px"></i>Monthly limit</span><span><i style="background:var(--bad)"></i>Over limit</span></div>' : '<div class="empty">No spend yet</div>'}</div>
      <div class="card"><h2>Spend by type</h2>
        ${r.by_category.length ? hbars(r.by_category, { name: c => c.category, value: c => c.total, sub: c => Math.round((c.total / (t.approved || 1)) * 100) + '%' }) : '<div class="empty">No approved bills yet</div>'}</div>
    </div>`;
  $('#month').onchange = e => { location.hash = `#/dashboard?m=${e.target.value || thisMonth()}`; };
};

boot();
