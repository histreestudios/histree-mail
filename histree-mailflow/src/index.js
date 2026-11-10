import { WorkerMailer } from 'worker-mailer';
import UI from './ui.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const aes = async env => crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(env.ENC_KEY)), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function encrypt(env, t) { const iv = crypto.getRandomValues(new Uint8Array(12)); return b64(iv) + '.' + b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(env), enc.encode(t))); }
async function decrypt(env, s) { const [i, c] = s.split('.'); return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(i) }, await aes(env), unb64(c))); }

export default {
  async fetch(req, env) {
    const p = new URL(req.url).pathname;
    try {
      if (p.startsWith('/u/')) return unsub(env, p.slice(3), req.method);
      if (p === '/') return new Response(UI, { headers: { 'content-type': 'text/html;charset=utf-8', 'x-frame-options': 'DENY', 'cache-control': 'no-store' } });
      if (!p.startsWith('/api/')) return new Response('Not found', { status: 404 });
      const post = req.method === 'POST';
      if (post && req.headers.get('X-Req') !== '1') return J({ error: 'Bad request' }, 400);
      const body = post ? await req.json().catch(() => ({})) : {};
      if (p === '/api/login') return login(env, body, new URL(req.url).origin);
      if (!(await authed(req, env))) return J({ error: 'Sign in required' }, 401);
      return await route(env, p.slice(5), body);
    } catch (e) { return J({ error: String(e.message || e) }, 500); }
  },
  async scheduled(_ev, env, ctx) { ctx.waitUntil(tick(env)); }
};

async function login(env, b, origin) {
  if (await hmac(env.SESSION_SECRET, String(b.password || '')) !== await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 1000)); return J({ error: 'Wrong password' }, 401);
  }
  await env.DB.prepare("INSERT INTO meta(k,v) VALUES('base',?) ON CONFLICT(k) DO UPDATE SET v=?").bind(origin, origin).run();
  const exp = String(Date.now() + 7 * 864e5), t = exp + '.' + await hmac(env.SESSION_SECRET, 's' + exp);
  return new Response('{}', { headers: { 'content-type': 'application/json', 'set-cookie': `s=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` } });
}
async function authed(req, env) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|; )s=([^;]+)/); if (!m) return false;
  const [exp, sig] = m[1].split('.'); return +exp > Date.now() && sig === await hmac(env.SESSION_SECRET, 's' + exp);
}

async function sendMail(env, m, msg) {
  const password = await decrypt(env, m.pass_enc);
  return WorkerMailer.send(
    { host: m.host, port: m.port, secure: !!m.secure, startTls: !m.secure, credentials: { username: m.username, password }, authType: ['plain', 'login'] },
    { from: { name: m.name, email: m.email }, to: msg.to, subject: msg.subject, text: msg.text, headers: { 'Reply-To': m.email, ...(msg.headers || {}) } });
}

async function route(env, path, b) {
  const db = env.DB, all = async (s, ...a) => (await db.prepare(s).bind(...a).all()).results, run = (s, ...a) => db.prepare(s).bind(...a).run();
  const [r, id, act] = path.split('/');
  if (r === 'state') {
    const n = async (s, ...a) => (await db.prepare(s).bind(...a).first()).n;
    return J({
      paused: (await db.prepare("SELECT v FROM meta WHERE k='pause'").first())?.v === '1',
      stats: { leads: await n('SELECT COUNT(*) n FROM leads'), sent: await n("SELECT COUNT(*) n FROM events WHERE type='sent'"), queued: await n("SELECT COUNT(*) n FROM cl WHERE status='active'"),
        review: await n("SELECT COUNT(*) n FROM cl WHERE status='review'"), stuck: await n("SELECT COUNT(*) n FROM cl WHERE status='sending'"), failed: await n("SELECT COUNT(*) n FROM cl WHERE status='failed'"),
        replied: await n("SELECT COUNT(*) n FROM leads WHERE status='replied'"), suppressed: await n('SELECT COUNT(*) n FROM suppression') },
      leads: await all('SELECT * FROM leads ORDER BY id DESC LIMIT 300'),
      campaigns: await all("SELECT c.*,(SELECT COUNT(*) FROM cl WHERE campaign_id=c.id) total,(SELECT COUNT(*) FROM cl WHERE campaign_id=c.id AND status='active') active,(SELECT COUNT(*) FROM cl WHERE campaign_id=c.id AND status='done') done FROM campaigns c ORDER BY id DESC"),
      mailboxes: await all('SELECT id,name,email,host,port,secure,username,daily_cap,paused,next_at FROM mailboxes'),
      events: await all('SELECT e.*,l.email lead FROM events e LEFT JOIN cl ON cl.id=e.cl_id LEFT JOIN leads l ON l.id=cl.lead_id ORDER BY e.id DESC LIMIT 60') });
  }
  if (r === 'leads') {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; let bad = 0, st = [];
    for (const x of b.rows || []) {
      const e = String(x.email || '').trim().toLowerCase(); if (!ok.test(e)) { bad++; continue; }
      st.push(db.prepare("INSERT OR IGNORE INTO leads(email,first_name,last_name,company,website,role,source,note,status,added) VALUES(?,?,?,?,?,?,?,?,'new',?)")
        .bind(e, x.first_name || '', x.last_name || '', x.company || '', x.website || '', x.role || '', x.source || 'csv', x.personalization_note || x.note || '', Date.now()));
    }
    let added = 0; for (let i = 0; i < st.length; i += 100) for (const q of await db.batch(st.slice(i, i + 100))) added += q.meta.changes;
    return J({ added, duplicates: st.length - added, invalid: bad });
  }
  if (r === 'lead' && act === 'status') {
    if (!['replied', 'dnc'].includes(b.status)) return J({ error: 'Invalid status' }, 400);
    const l = await db.prepare('SELECT email FROM leads WHERE id=?').bind(id).first();
    const st = [db.prepare('UPDATE leads SET status=? WHERE id=?').bind(b.status, id), db.prepare("UPDATE cl SET status='stopped' WHERE lead_id=? AND status IN ('active','review')").bind(id)];
    if (b.status === 'dnc' && l) st.push(db.prepare("INSERT OR REPLACE INTO suppression(email,reason,ts) VALUES(?,?,?)").bind(l.email, 'manual', Date.now()));
    await db.batch(st); return J({});
  }
  if (r === 'mailbox' && !id) {
    if (!b.email || !b.host || !b.password) return J({ error: 'Email, host and password are required' }, 400);
    await run('INSERT INTO mailboxes(name,email,host,port,secure,username,pass_enc,daily_cap) VALUES(?,?,?,?,?,?,?,?)', b.name || b.email, b.email, b.host, +b.port, +b.port === 465 ? 1 : 0, b.username || b.email, await encrypt(env, b.password), +b.daily_cap || 20);
    return J({});
  }
  if (r === 'mailbox' && act === 'test') {
    const m = await db.prepare('SELECT * FROM mailboxes WHERE id=?').bind(id).first();
    await sendMail(env, m, { to: b.to, subject: 'Mailflow test email', text: 'If you can read this, SMTP sending works.' }); return J({ ok: true });
  }
  if (r === 'mailbox' && act === 'pause') { await run('UPDATE mailboxes SET paused=1-paused WHERE id=?', id); return J({}); }
  if (r === 'campaign' && !id) {
    const steps = (b.steps || []).filter(s => s.subject && s.body).map(s => ({ subject: s.subject, body: s.body, delay: +s.delay || 0 }));
    if (!b.name || !b.mailbox_id || !steps.length) return J({ error: 'Name, mailbox and at least one message are required' }, 400);
    await run('INSERT INTO campaigns(name,mailbox_id,steps,tz,start_hour,end_hour,days,gap_min,gap_max) VALUES(?,?,?,?,?,?,?,?,?)', b.name, b.mailbox_id, JSON.stringify(steps), b.tz || 'Asia/Dhaka', +b.start_hour, +b.end_hour, (b.days || []).join(','), +b.gap_min || 5, +b.gap_max || 10);
    return J({});
  }
  if (r === 'campaign' && act === 'start') {
    const now = Date.now();
    await db.batch([db.prepare("INSERT OR IGNORE INTO cl(campaign_id,lead_id,step,next_at,status) SELECT ?,id,0,?,'active' FROM leads WHERE status='new'").bind(id, now),
      db.prepare("UPDATE leads SET status='active' WHERE status='new'"), db.prepare("UPDATE campaigns SET status='active' WHERE id=?").bind(id)]);
    return J({});
  }
  if (r === 'campaign' && ['pause', 'resume'].includes(act)) { await run('UPDATE campaigns SET status=? WHERE id=?', act === 'pause' ? 'paused' : 'active', id); return J({}); }
  if (r === 'pause') { await run("INSERT INTO meta(k,v) VALUES('pause',?) ON CONFLICT(k) DO UPDATE SET v=?", b.on ? '1' : '0', b.on ? '1' : '0'); return J({}); }
  return J({ error: 'Not found' }, 404);
}

function local(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, wd: p.weekday };
}
function render(t, l) {
  let miss = false;
  const v = { first_name: l.first_name, last_name: l.last_name, company: l.company, website: l.website, personalization_note: l.note, role: l.role };
  const out = t.replace(/\{\{\s*(\w+)(?:\|([^}]*))?\}\}/g, (m, k, f) => { const x = (v[k] || '').trim(); if (x) return x; if (f !== undefined) return f; miss = true; return m; });
  return { out, miss };
}
const b64u = s => btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const utok = async (env, e) => b64u(e) + '.' + (await hmac(env.SESSION_SECRET, 'u' + e)).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);

// Runs every minute. Sends at most one email per active campaign per run.
async function tick(env) {
  const db = env.DB;
  if ((await db.prepare("SELECT v FROM meta WHERE k='pause'").first())?.v === '1') return;
  const base = (await db.prepare("SELECT v FROM meta WHERE k='base'").first())?.v;
  if (!base) return; // sign in to the dashboard once so unsubscribe links know the address
  const cs = (await db.prepare("SELECT c.*,m.name mname,m.email memail,m.host,m.port,m.secure,m.username,m.pass_enc,m.daily_cap,m.next_at mnext FROM campaigns c JOIN mailboxes m ON m.id=c.mailbox_id WHERE c.status='active' AND m.paused=0 LIMIT 6").all()).results;
  const busy = new Set();
  for (const c of cs) {
    const now = Date.now(), t = local(c.tz);
    if (busy.has(c.mailbox_id) || c.mnext > now || t.hour < c.start_hour || t.hour >= c.end_hour || !c.days.split(',').includes(t.wd)) continue;
    busy.add(c.mailbox_id);
    if ((await db.prepare("SELECT COUNT(*) n FROM events WHERE mailbox_id=? AND day=? AND type='sent'").bind(c.mailbox_id, t.day).first()).n >= c.daily_cap) continue;
    const x = await db.prepare("SELECT cl.id clid,cl.step,cl.tries,l.* FROM cl JOIN leads l ON l.id=cl.lead_id WHERE cl.campaign_id=? AND cl.status='active' AND cl.next_at<=? AND l.status='active' ORDER BY cl.next_at LIMIT 1").bind(c.id, now).first();
    if (!x) continue;
    const claim = await db.prepare("UPDATE cl SET status='sending' WHERE id=? AND status='active'").bind(x.clid).run();
    if (!claim.meta.changes) continue;
    const ev = (type, detail) => db.prepare('INSERT INTO events(ts,day,mailbox_id,cl_id,type,detail) VALUES(?,?,?,?,?,?)').bind(now, t.day, c.mailbox_id, x.clid, type, String(detail).slice(0, 300));
    const steps = JSON.parse(c.steps), s = steps[x.step];
    if (await db.prepare('SELECT 1 FROM suppression WHERE email=?').bind(x.email).first()) { await db.batch([db.prepare("UPDATE cl SET status='stopped' WHERE id=?").bind(x.clid), ev('suppressed', x.email)]); continue; }
    const subj = render(s.subject, x), body = render(s.body, x);
    if (subj.miss || body.miss) { await db.batch([db.prepare("UPDATE cl SET status='review' WHERE id=?").bind(x.clid), ev('review', 'Unresolved placeholder')]); continue; }
    const link = `${base}/u/${await utok(env, x.email)}`;
    try {
      await sendMail(env, { name: c.mname, email: c.memail, host: c.host, port: c.port, secure: c.secure, username: c.username, pass_enc: c.pass_enc },
        { to: x.email, subject: subj.out, text: `${body.out}\n\n--\n${c.mname}\nNot interested? Unsubscribe: ${link}`, headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
      const more = x.step + 1 < steps.length, gap = (c.gap_min + Math.random() * Math.max(0, c.gap_max - c.gap_min)) * 60000;
      await db.batch([db.prepare('UPDATE cl SET status=?,step=?,next_at=?,tries=0 WHERE id=?').bind(more ? 'active' : 'done', x.step + 1, now + (more ? steps[x.step + 1].delay * 864e5 : 0), x.clid),
        db.prepare('UPDATE mailboxes SET next_at=? WHERE id=?').bind(now + gap, c.mailbox_id), ev('sent', `step ${x.step + 1} to ${x.email}`)]);
    } catch (e) {
      const msg = String(e.message || e), tries = x.tries + 1, perm = /\b5\d\d\b/.test(msg) || tries >= 3;
      await db.batch([db.prepare('UPDATE cl SET status=?,tries=?,next_at=? WHERE id=?').bind(perm ? 'failed' : 'active', tries, now + tries * 15 * 60000, x.clid), ev(perm ? 'failed' : 'retry', msg)]);
    }
  }
}

async function unsub(env, tok, method) {
  const [e64, sig] = tok.split('.'); let email = '';
  try { email = atob(e64.replace(/-/g, '+').replace(/_/g, '/')); } catch { return new Response('Invalid link', { status: 400 }); }
  if (sig !== (await utok(env, email)).split('.')[1]) return new Response('Invalid link', { status: 400 });
  const page = m => new Response(`<meta name=viewport content="width=device-width"><body style="font:16px system-ui;background:#0d1110;color:#e8efe9;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:380px;padding:24px">${m}</div>`, { headers: { 'content-type': 'text/html;charset=utf-8' } });
  if (method !== 'POST') return page(`<h2>Unsubscribe</h2><p>Stop emails to ${email.replace(/[<&]/g, '')}?</p><form method=post><button style="padding:10px 18px;font:inherit">Unsubscribe me</button></form>`);
  await env.DB.batch([env.DB.prepare('INSERT OR REPLACE INTO suppression(email,reason,ts) VALUES(?,?,?)').bind(email, 'unsubscribed', Date.now()),
    env.DB.prepare("UPDATE leads SET status='dnc' WHERE email=?").bind(email),
    env.DB.prepare("UPDATE cl SET status='stopped' WHERE status IN ('active','review') AND lead_id IN (SELECT id FROM leads WHERE email=?)").bind(email)]);
  return page('<h2>You are unsubscribed</h2><p>You will not receive further emails from us.</p>');
}
