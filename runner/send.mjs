// Runs on GitHub Actions. Checks replies, then asks the dashboard what is due, sends it over SMTP, reports back.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
const { APP_URL, RUNNER_TOKEN } = process.env;
if (!APP_URL || !RUNNER_TOKEN) { console.error('Missing APP_URL or RUNNER_TOKEN secret in GitHub.'); process.exit(1); }
const base = APP_URL.trim().replace(/\/+$/, '');
const call = async (p, b) => {
  const r = await fetch(`${base}/api/runner/${p}`, { method: 'POST', headers: { Authorization: 'Bearer ' + RUNNER_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Stops follow-ups for people who replied, and marks bounced addresses. Never blocks sending.
async function checkReplies() {
  const { boxes } = await call('reply-targets');
  const replied = new Set(), bounced = new Set(), status = [];
  for (const b of boxes) {
    const m = b.mailbox, targets = new Set(b.emails), bounceUids = [];
    console.log('::add-mask::' + m.password);
    const client = new ImapFlow({ host: b.imap_host, port: 993, secure: true, auth: { user: m.username, pass: m.password }, logger: false });
    client.on('error', () => {});
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        for await (const msg of client.fetch({ since: new Date(b.since) }, { envelope: true, uid: true })) {
          const from = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
          if (targets.has(from)) replied.add(from);
          else if (/mailer-daemon|postmaster/.test(from)) bounceUids.push(msg.uid);
        }
        for (const uid of bounceUids.slice(-30)) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          const text = (msg?.source?.toString('utf8') || '').toLowerCase();
          for (const e of targets) if (text.includes(e)) bounced.add(e);
        }
      } finally { lock.release(); }
      await client.logout();
      status.push({ mailbox_id: b.mailbox_id, ok: true });
    } catch (e) {
      console.log(`Reply check failed for ${m.email}: ${e.message}`);
      status.push({ mailbox_id: b.mailbox_id, ok: false, error: String(e.message || e) });
      try { client.close(); } catch {}
    }
  }
  await call('replies', { replied: [...replied], bounced: [...bounced], status });
  console.log(`Reply check done. Replies: ${replied.size}, bounces: ${bounced.size}`);
}

try { await checkReplies(); } catch (e) { console.log('Reply check skipped:', e.message); }

const end = Date.now() + 12 * 60 * 1000; let sent = 0;
  while (Date.now() < end) {
    const { job, wait, note } = await call('next');
    if (note) console.log(note);
    if (!job) {
      if (wait > 0 && Date.now() + wait * 1000 < end) {
        await sleep(wait * 1000 + 1000);
        continue;
      }
      break;
    }
  const m = job.mailbox; console.log('::add-mask::' + m.password);
  try {
    const tr = nodemailer.createTransport({ host: m.host, port: m.port, secure: !!m.secure, auth: { user: m.username, pass: m.password }, connectionTimeout: 20000, socketTimeout: 30000 });
    await tr.sendMail({ from: { name: m.name, address: m.email }, to: job.to, subject: job.subject, text: job.text, replyTo: m.email, headers: job.headers || {} });
    await call('result', { kind: job.kind, id: job.id, ok: true, subject: job.subject, text: job.text }); sent++; console.log(`Sent (${job.kind}) #${job.id}`);
  } catch (e) {
    console.log(`Failed (${job.kind}) #${job.id}: ${e.message}`);
    await call('result', { kind: job.kind, id: job.id, ok: false, error: String(e.message || e) });
  }
  if (job.delay_after && Date.now() + job.delay_after * 1000 < end) await sleep(job.delay_after * 1000);
}
console.log('Finished. Emails sent this run:', sent);
