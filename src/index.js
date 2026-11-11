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

const RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n; // unbiased enough for picking among a few versions
const dayUTC = () => new Date().toISOString().slice(0, 10);
const metaSet = (db, k, v) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?').bind(k, v, v);
const metaGet = async (db, k) => (await db.prepare('SELECT v FROM meta WHERE k=?').bind(k).first())?.v;
const pj = v => { try { return JSON.parse(v); } catch { return null; } };
// Warm-up: daily cap rises linearly from w.start to the full cap over w.days days.
function capToday(cap, w, day) {
  if (!w || !w.days) return cap;
  const d = Math.max(0, Math.floor((Date.parse(day) - Date.parse(w.from)) / 864e5));
  return Math.min(cap, Math.round(w.start + (cap - w.start) * Math.min(1, d / w.days)));
}
function leadWhere(sp) {
  const q = (sp.get('q') || '').trim(), st = sp.get('status') || '', ba = sp.get('batch') || '', like = '%' + q + '%';
  return { sql: "WHERE (?='' OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR company LIKE ?) AND (?='' OR status=?) AND (?='' OR source=?)", args: [q, like, like, like, like, st, st, ba, ba] };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    try {
      if (p.startsWith('/u/')) return unsub(env, p.slice(3), req.method);
      if (p === '/') return new Response(UI, { headers: { 'content-type': 'text/html;charset=utf-8', 'x-frame-options': 'DENY', 'cache-control': 'no-store' } });
      if (!p.startsWith('/api/')) return new Response('Not found', { status: 404 });
      if (p.startsWith('/api/runner/')) {
        const tok = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
        if (!env.RUNNER_TOKEN || !tok || await hmac(env.SESSION_SECRET, tok) !== await hmac(env.SESSION_SECRET, env.RUNNER_TOKEN)) return J({ error: 'Unauthorized' }, 401);
        const rb = await req.json().catch(() => ({})), k = p.slice(12);
        return k === 'next' ? runnerNext(env) : k === 'result' ? runnerResult(env, rb) : k === 'reply-targets' ? replyTargets(env) : k === 'replies' ? applyReplies(env, rb) : J({ error: 'Not found' }, 404);
      }
      const post = req.method === 'POST';
      if (post && req.headers.get('X-Req') !== '1') return J({ error: 'Bad request' }, 400);
      const body = post ? await req.json().catch(() => ({})) : {};
      if (p === '/api/login') return login(env, body, url.origin);
      if (!(await authed(req, env))) return J({ error: 'Sign in required' }, 401);
      return await route(env, p.slice(5), body, url.searchParams);
    } catch (e) { return J({ error: String(e.message || e) }, 500); }
  }
};

async function login(env, b, origin) {
  if (await hmac(env.SESSION_SECRET, String(b.password || '')) !== await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 1000)); return J({ error: 'Wrong password' }, 401);
  }
  await metaSet(env.DB, 'base', origin).run();
  const exp = String(Date.now() + 7 * 864e5), t = exp + '.' + await hmac(env.SESSION_SECRET, 's' + exp);
  return new Response('{}', { headers: { 'content-type': 'application/json', 'set-cookie': `s=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` } });
}
async function authed(req, env) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|; )s=([^;]+)/); if (!m) return false;
  const [exp, sig] = m[1].split('.'); return +exp > Date.now() && sig === await hmac(env.SESSION_SECRET, 's' + exp);
}

async function route(env, path, b, sp) {
  const db = env.DB, all = async (s, ...a) => (await db.prepare(s).bind(...a).all()).results, run = (s, ...a) => db.prepare(s).bind(...a).run();
  const [r, id, act] = path.split('/');
  if (r === 'state') {
    const n = async (s, ...a) => (await db.prepare(s).bind(...a).first()).n;
    const metas = Object.fromEntries((await all("SELECT k,v FROM meta WHERE k LIKE 'warm:%' OR k LIKE 'rc:%' OR k IN ('pause','last_run')")).map(x => [x.k, x.v]));
    const sent24 = Object.fromEntries((await all("SELECT mailbox_id m,COUNT(*) n FROM events WHERE type='sent' AND ts>? GROUP BY mailbox_id", Date.now() - 864e5)).map(x => [x.m, x.n]));
    return J({
      paused: metas.pause === '1', last_run: +metas.last_run || null,
      stats: { leads: await n('SELECT COUNT(*) n FROM leads'), sent: await n("SELECT COUNT(*) n FROM events WHERE type='sent'"), queued: await n("SELECT COUNT(*) n FROM cl WHERE status='active'"),
        review: await n("SELECT COUNT(*) n FROM cl WHERE status='review'"), stuck: await n("SELECT COUNT(*) n FROM cl WHERE status='sending'"), failed: await n("SELECT COUNT(*) n FROM cl WHERE status='failed'"),
        replied: await n("SELECT COUNT(*) n FROM leads WHERE status='replied'"), bounced: await n("SELECT COUNT(*) n FROM leads WHERE status='bounced'"), suppressed: await n('SELECT COUNT(*) n FROM suppression') },
      campaigns: await all("SELECT c.*,(SELECT COUNT(*) FROM cl WHERE campaign_id=c.id) total,(SELECT COUNT(*) FROM cl WHERE campaign_id=c.id AND status='active') active,(SELECT COUNT(*) FROM cl WHERE campaign_id=c.id AND status='done') done FROM campaigns c ORDER BY id DESC"),
      mailboxes: (await all('SELECT id,name,email,host,port,username,daily_cap,paused,next_at FROM mailboxes')).map(m => { const w = pj(metas['warm:' + m.id]); return { ...m, warm: w, cap_today: capToday(m.daily_cap, w, dayUTC()), sent24: sent24[m.id] || 0, rc: pj(metas['rc:' + m.id]) }; }),
      queued_outbox: await n("SELECT COUNT(*) n FROM outbox WHERE status='pending'"),
      events: await all('SELECT e.*,l.email lead FROM events e LEFT JOIN cl ON cl.id=e.cl_id LEFT JOIN leads l ON l.id=cl.lead_id ORDER BY e.id DESC LIMIT 40') });
  }
  if (r === 'leadlist') {
    const w = leadWhere(sp), page = Math.max(0, +sp.get('page') || 0);
    return J({ rows: await all(`SELECT * FROM leads ${w.sql} ORDER BY id DESC LIMIT 100 OFFSET ?`, ...w.args, page * 100),
      total: (await db.prepare(`SELECT COUNT(*) n FROM leads ${w.sql}`).bind(...w.args).first()).n,
      batches: await all('SELECT source,COUNT(*) n FROM leads GROUP BY source ORDER BY MAX(id) DESC LIMIT 50') });
  }
  if (r === 'history') return J({ rows: await all('SELECT o.*,m.email from_email FROM outbox o LEFT JOIN mailboxes m ON m.id=o.mailbox_id ORDER BY o.id DESC LIMIT 200') });
  if (r === 'leads' && id === 'delete') {
    let sub, args;
    if (Array.isArray(b.ids)) { sub = 'SELECT value FROM json_each(?)'; args = [JSON.stringify(b.ids.map(Number))]; }
    else { const w = leadWhere(new URLSearchParams(b.filter || {})); sub = `SELECT id FROM leads ${w.sql}`; args = w.args; }
    const res = await db.batch([db.prepare(`DELETE FROM cl WHERE lead_id IN (${sub})`).bind(...args), db.prepare(`DELETE FROM leads WHERE id IN (${sub})`).bind(...args)]);
    return J({ deleted: res[1].meta.changes });
  }
  if (r === 'leads') {
    let st = [];
    for (const x of b.rows || []) {
      const e = String(x.email || '').trim().toLowerCase(); if (!RE.test(e)) continue;
      st.push(db.prepare("INSERT OR IGNORE INTO leads(email,first_name,last_name,company,website,role,source,note,status,added) VALUES(?,?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM suppression WHERE email=?) THEN 'dnc' ELSE 'new' END,?)")
        .bind(e, x.first_name || '', x.last_name || '', x.company || '', x.website || '', x.role || '', String(b.batch || x.source || 'csv').slice(0, 80), x.personalization_note || x.note || '', e, Date.now()));
    }
    let added = 0; for (let i = 0; i < st.length; i += 100) for (const q of await db.batch(st.slice(i, i + 100))) added += q.meta.changes;
    return J({ added, duplicates: st.length - added, invalid: (b.rows || []).length - st.length });
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
    const res = await run('INSERT INTO mailboxes(name,email,host,port,secure,username,pass_enc,daily_cap) VALUES(?,?,?,?,?,?,?,?)', b.name || b.email, b.email, b.host, +b.port, +b.port === 465 ? 1 : 0, b.username || b.email, await encrypt(env, b.password), +b.daily_cap || 20);
    if (+b.warm_days > 0) await metaSet(db, 'warm:' + res.meta.last_row_id, JSON.stringify({ start: Math.max(1, +b.warm_start || 5), days: +b.warm_days, from: dayUTC() })).run();
    return J({});
  }
  if (r === 'mailbox' && act === 'test') {
    if (!RE.test(b.to || '')) return J({ error: 'Enter a valid email address' }, 400);
    await run("INSERT INTO outbox(ts,mailbox_id,to_addr,subject,body,kind,status) VALUES(?,?,?,?,?,'test','pending')", Date.now(), id, b.to, 'Mailflow test email', 'If you can read this, sending works.'); return J({ queued: true });
  }
  if (r === 'mailbox' && act === 'delete') {
    if (await db.prepare('SELECT 1 FROM campaigns WHERE mailbox_id=?').bind(id).first()) return J({ error: 'This mailbox is used by a campaign' }, 400);
    await db.batch([db.prepare('DELETE FROM mailboxes WHERE id=?').bind(id), db.prepare('DELETE FROM meta WHERE k IN (?,?)').bind('warm:' + id, 'rc:' + id)]); return J({});
  }
  if (r === 'mailbox' && act === 'pause') { await run('UPDATE mailboxes SET paused=1-paused WHERE id=?', id); return J({}); }
  if (r === 'mailbox' && act === 'warmup') {
    if (+b.days > 0) await metaSet(db, 'warm:' + id, JSON.stringify({ start: Math.max(1, +b.start || 5), days: +b.days, from: dayUTC() })).run();
    else await run('DELETE FROM meta WHERE k=?', 'warm:' + id);
    return J({});
  }
  if (r === 'compose') {
    const list = [...new Set(String(Array.isArray(b.to) ? b.to.join(',') : b.to || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];
    if (!list.length || list.length > 20 || list.some(e => !RE.test(e))) return J({ error: 'Enter 1 to 20 valid email addresses' }, 400);
    if (!String(b.subject || '').trim() || !String(b.body || '').trim()) return J({ error: 'Subject and message are required' }, 400);
    const m = await db.prepare('SELECT id FROM mailboxes WHERE id=?').bind(b.mailbox_id).first(); if (!m) return J({ error: 'Choose a mailbox to send from' }, 400);
    const sup = (await all('SELECT email FROM suppression WHERE email IN (SELECT value FROM json_each(?))', JSON.stringify(list))).map(x => x.email.toLowerCase()), ok = list.filter(e => !sup.includes(e));
    if (!ok.length) return J({ error: 'All of these addresses have unsubscribed' }, 400);
    await db.batch(ok.map(e => db.prepare("INSERT INTO outbox(ts,mailbox_id,to_addr,subject,body,kind,status) VALUES(?,?,?,?,?,'manual','pending')").bind(Date.now(), m.id, e, String(b.subject).trim(), String(b.body))));
    return J({ queued: ok.length, skipped: sup.length });
  }
  if (r === 'outbox' && act === 'cancel') { await run("UPDATE outbox SET status='cancelled' WHERE id=? AND status='pending'", id); return J({}); }
  if (r === 'campaign' && !id) {
    const raw = b.steps || [];
    const steps = raw.map((s, i) => ({ delay: i ? Math.max(1, +s.delay || 1) : 0, variants: (s.variants || []).filter(v => String(v.subject || '').trim() && String(v.body || '').trim()).map(v => ({ subject: v.subject.trim(), body: v.body })) }));
    if (!b.name || !b.mailbox_id || !steps.length || steps.some(s => !s.variants.length)) return J({ error: 'Name, mailbox, and at least one complete version in every step are required' }, 400);
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
  if (r === 'pause') { await metaSet(db, 'pause', b.on ? '1' : '0').run(); return J({}); }
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
const mb = async (env, m) => ({ name: m.name, email: m.email, host: m.host, port: m.port, secure: !!m.secure, username: m.username, password: await decrypt(env, m.pass_enc) });

// The GitHub sender asks for one job at a time, sends it over SMTP, then reports back.
async function runnerNext(env, depth = 0) {
  const db = env.DB, now = Date.now(), one = async (s, ...a) => db.prepare(s).bind(...a).first();
  if (!depth) await metaSet(db, 'last_run', String(now)).run();
  const base = await metaGet(db, 'base');
  if (!base) return J({ job: null, wait: 0, note: 'Sign in to the dashboard once first' });
  if ((await metaGet(db, 'pause')) === '1') return J({ job: null, wait: 0 });
  const o = await one("SELECT o.id oid,o.to_addr,o.subject,o.body,o.kind okind,m.name,m.email,m.host,m.port,m.secure,m.username,m.pass_enc FROM outbox o JOIN mailboxes m ON m.id=o.mailbox_id WHERE o.status='pending' ORDER BY o.id LIMIT 1");
  if (o && (await db.prepare("UPDATE outbox SET status='sending' WHERE id=? AND status='pending'").bind(o.oid).run()).meta.changes)
    return J({ job: { kind: 'outbox', id: o.oid, to: o.to_addr, subject: o.subject, text: o.body, delay_after: o.okind === 'test' ? 0 : 15 + rnd(20), mailbox: await mb(env, o) } });
  const cs = (await db.prepare("SELECT c.*,m.name mname,m.email memail,m.host,m.port,m.secure,m.username,m.pass_enc,m.daily_cap,m.next_at mnext FROM campaigns c JOIN mailboxes m ON m.id=c.mailbox_id WHERE c.status='active' AND m.paused=0 LIMIT 6").all()).results;
  let wait = 0; const busy = new Set();
  for (const c of cs) {
    const tl = local(c.tz);
    if (busy.has(c.mailbox_id) || tl.hour < c.start_hour || tl.hour >= c.end_hour || !c.days.split(',').includes(tl.wd)) continue;
    const cap = capToday(c.daily_cap, pj(await metaGet(db, 'warm:' + c.mailbox_id)), tl.day);
    if ((await one("SELECT COUNT(*) n FROM events WHERE mailbox_id=? AND day=? AND type='sent'", c.mailbox_id, tl.day)).n >= cap) continue;
    const x = await one("SELECT cl.id clid,cl.step,l.* FROM cl JOIN leads l ON l.id=cl.lead_id WHERE cl.campaign_id=? AND cl.status='active' AND cl.next_at<=? AND l.status='active' ORDER BY cl.next_at LIMIT 1", c.id, now);
    if (!x) continue;
    busy.add(c.mailbox_id);
    if (c.mnext > now) { const w = Math.ceil((c.mnext - now) / 1000); wait = wait ? Math.min(wait, w) : w; continue; }
    if (!(await db.prepare("UPDATE cl SET status='sending' WHERE id=? AND status='active'").bind(x.clid).run()).meta.changes) continue;
    const ev = (type, d) => db.prepare('INSERT INTO events(ts,day,mailbox_id,cl_id,type,detail) VALUES(?,?,?,?,?,?)').bind(now, tl.day, c.mailbox_id, x.clid, type, String(d).slice(0, 300));
    const again = () => depth < 5 ? runnerNext(env, depth + 1) : J({ job: null, wait: 1 });
    if (await one('SELECT 1 FROM suppression WHERE email=?', x.email)) { await db.batch([db.prepare("UPDATE cl SET status='stopped' WHERE id=?").bind(x.clid), ev('suppressed', x.email)]); return again(); }
    const s = JSON.parse(c.steps)[x.step], vs = s.variants || [{ subject: s.subject, body: s.body }], v = vs[rnd(vs.length)];
    const subj = render(v.subject, x), body = render(v.body, x);
    if (subj.miss || body.miss) { await db.batch([db.prepare("UPDATE cl SET status='review' WHERE id=?").bind(x.clid), ev('review', 'Unresolved placeholder')]); return again(); }
    const link = `${base}/u/${await utok(env, x.email)}`;
    return J({ job: { kind: 'mail', id: x.clid, to: x.email, subject: subj.out, text: `${body.out}\n\n--\n${c.mname}\nNot interested? Unsubscribe: ${link}`,
      headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      mailbox: await mb(env, { name: c.mname, email: c.memail, host: c.host, port: c.port, secure: c.secure, username: c.username, pass_enc: c.pass_enc }) } });
  }
  return J({ job: null, wait });
}

async function runnerResult(env, b) {
  const db = env.DB, now = Date.now(), err = String(b.error || '').slice(0, 300);
  const evn = (mid, type, d) => db.prepare('INSERT INTO events(ts,day,mailbox_id,cl_id,type,detail) VALUES(?,?,?,NULL,?,?)').bind(now, '', mid, type, d);
  if (b.kind === 'outbox') {
    const o = await db.prepare('SELECT * FROM outbox WHERE id=?').bind(b.id).first(); if (!o || o.status !== 'sending') return J({});
    const type = o.kind === 'test' ? (b.ok ? 'test_ok' : 'test_failed') : (b.ok ? 'manual_sent' : 'manual_failed');
    await db.batch([db.prepare('UPDATE outbox SET status=?,detail=?,ts=? WHERE id=?').bind(b.ok ? 'sent' : 'failed', err, now, b.id), evn(o.mailbox_id, type, b.ok ? 'To ' + o.to_addr : err)]);
    return J({});
  }
  const x = await db.prepare("SELECT cl.id,cl.step,cl.tries,c.steps,c.mailbox_id,c.gap_min,c.gap_max,c.tz,l.email FROM cl JOIN campaigns c ON c.id=cl.campaign_id JOIN leads l ON l.id=cl.lead_id WHERE cl.id=? AND cl.status='sending'").bind(b.id).first();
  if (!x) return J({});
  const ev = (type, d) => db.prepare('INSERT INTO events(ts,day,mailbox_id,cl_id,type,detail) VALUES(?,?,?,?,?,?)').bind(now, local(x.tz).day, x.mailbox_id, x.id, type, String(d).slice(0, 300));
  if (b.ok) {
    const steps = JSON.parse(x.steps), more = x.step + 1 < steps.length, gap = (x.gap_min + Math.random() * Math.max(0, x.gap_max - x.gap_min)) * 60000;
    await db.batch([db.prepare('UPDATE cl SET status=?,step=?,next_at=?,tries=0 WHERE id=?').bind(more ? 'active' : 'done', x.step + 1, now + (more ? steps[x.step + 1].delay * 864e5 : 0), x.id),
      db.prepare('UPDATE mailboxes SET next_at=? WHERE id=?').bind(now + gap, x.mailbox_id), ev('sent', `step ${x.step + 1} to ${x.email}`),
      db.prepare("INSERT INTO outbox(ts,mailbox_id,to_addr,subject,body,kind,step,status) VALUES(?,?,?,?,?,'campaign',?,'sent')").bind(now, x.mailbox_id, x.email, String(b.subject || '').slice(0, 300), String(b.text || '').slice(0, 6000), x.step + 1)]);
  } else {
    const tries = x.tries + 1, perm = /\b5\d\d\b/.test(err) || tries >= 3;
    await db.batch([db.prepare('UPDATE cl SET status=?,tries=?,next_at=? WHERE id=?').bind(perm ? 'failed' : 'active', tries, now + tries * 15 * 60000, x.id), ev(perm ? 'failed' : 'retry', err)]);
  }
  return J({});
}

// Reply and bounce detection: the sender reads each mailbox's inbox over IMAP and reports back.
async function replyTargets(env) {
  const db = env.DB, by = {};
  const rows = (await db.prepare("SELECT c.mailbox_id mid,l.email,MIN(e.ts) first FROM cl JOIN campaigns c ON c.id=cl.campaign_id JOIN leads l ON l.id=cl.lead_id JOIN events e ON e.cl_id=cl.id AND e.type='sent' WHERE cl.status IN ('active','sending') AND l.status='active' GROUP BY c.mailbox_id,l.email LIMIT 2000").all()).results;
  for (const r of rows) { const g = by[r.mid] ||= { since: r.first, emails: [] }; g.emails.push(r.email.toLowerCase()); g.since = Math.min(g.since, r.first); }
  const boxes = [];
  for (const mid of Object.keys(by)) {
    const m = await db.prepare('SELECT * FROM mailboxes WHERE id=?').bind(mid).first(); if (!m) continue;
    boxes.push({ mailbox_id: +mid, imap_host: m.host.replace(/^smtp\./i, 'imap.'), since: new Date(by[mid].since - 864e5).toISOString(), emails: by[mid].emails, mailbox: await mb(env, m) });
  }
  return J({ boxes });
}
async function applyReplies(env, b) {
  const db = env.DB, now = Date.now(), st = [], low = a => (a || []).slice(0, 500).map(x => String(x).toLowerCase());
  const ev = (type, d) => db.prepare('INSERT INTO events(ts,day,mailbox_id,cl_id,type,detail) VALUES(?,?,NULL,NULL,?,?)').bind(now, '', type, d);
  const stop = e => db.prepare("UPDATE cl SET status='stopped' WHERE status IN ('active','review') AND lead_id IN (SELECT id FROM leads WHERE email=?)").bind(e);
  const replied = low(b.replied);
  for (const e of replied) st.push(db.prepare("UPDATE leads SET status='replied' WHERE email=? AND status='active'").bind(e), stop(e), ev('reply', e));
  for (const e of low(b.bounced).filter(x => !replied.includes(x))) st.push(db.prepare("UPDATE leads SET status='bounced' WHERE email=? AND status='active'").bind(e), stop(e), db.prepare('INSERT OR REPLACE INTO suppression(email,reason,ts) VALUES(?,?,?)').bind(e, 'bounced', now), ev('bounce', e));
  for (const s of b.status || []) st.push(metaSet(db, 'rc:' + Number(s.mailbox_id), JSON.stringify({ ts: now, ok: !!s.ok, error: String(s.error || '').slice(0, 200) })));
  for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  return J({ ok: true });
}

async function unsub(env, tok, method) {
  const [e64, sig] = tok.split('.'); let email = '';
  try { email = atob(e64.replace(/-/g, '+').replace(/_/g, '/')); } catch { return new Response('Invalid link', { status: 400 }); }
  if (sig !== (await utok(env, email)).split('.')[1]) return new Response('Invalid link', { status: 400 });
  const page = m => new Response(`<meta name=viewport content="width=device-width"><body style="font:16px system-ui;background:#08080a;color:#f4f4f5;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:380px;padding:24px">${m}</div>`, { headers: { 'content-type': 'text/html;charset=utf-8' } });
  if (method !== 'POST') return page(`<h2>Unsubscribe</h2><p>Stop emails to ${email.replace(/[<&]/g, '')}?</p><form method=post><button style="padding:10px 18px;font:inherit;background:#ff3b4c;color:#fff;border:0;border-radius:8px;font-weight:700">Unsubscribe me</button></form>`);
  await env.DB.batch([env.DB.prepare('INSERT OR REPLACE INTO suppression(email,reason,ts) VALUES(?,?,?)').bind(email, 'unsubscribed', Date.now()),
    env.DB.prepare("UPDATE leads SET status='dnc' WHERE email=?").bind(email),
    env.DB.prepare("UPDATE cl SET status='stopped' WHERE status IN ('active','review') AND lead_id IN (SELECT id FROM leads WHERE email=?)").bind(email)]);
  return page('<h2>You are unsubscribed</h2><p>You will not receive further emails from us.</p>');
}
