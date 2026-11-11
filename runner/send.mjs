// Runs on GitHub Actions. Checks replies, asks dashboard what is due, sends over SMTP, reports back, and exits immediately.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

const { APP_URL, RUNNER_TOKEN } = process.env;
if (!APP_URL || !RUNNER_TOKEN) { 
  console.error('Missing APP_URL or RUNNER_TOKEN secret in GitHub.'); 
  process.exit(1); 
}

const base = APP_URL.trim().replace(/\/+$/, '');
const call = async (p, b) => {
  const r = await fetch(`${base}/api/runner/${p}`, { 
    method: 'POST', 
    headers: { Authorization: 'Bearer ' + RUNNER_TOKEN, 'Content-Type': 'application/json' }, 
    body: JSON.stringify(b || {}) 
  });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Stops follow-ups for people who replied, and marks bounced addresses.
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

let sent = 0;
let running = true;

while (running) {
  let res;
  try {
    res = await call('next');
  } catch (e) {
    console.log('Fetch error:', e.message);
    break;
  }

  const { job, note } = res;
  if (note) console.log(note);

  // If no job is ready right now, exit immediately instead of sleeping
  if (!job) {
    console.log('No more jobs ready right now. Exiting runner.');
    break;
  }

  try {
    console.log(`Sending email to ${job.to}...`);
    const tr = nodemailer.createTransport({
      host: job.mailbox.host,
      port: job.mailbox.port,
      secure: job.mailbox.secure,
      auth: { user: job.mailbox.username, pass: job.mailbox.password },
      connectionTimeout: 20000,
      socketTimeout: 30000
    });

    await tr.sendMail({
      from: `${job.mailbox.name} <${job.mailbox.email}>`,
      to: job.to,
      subject: job.subject,
      text: job.text,
      replyTo: job.mailbox.email,
      headers: job.headers || {}
    });

    await call('result', { kind: job.kind, id: job.id, ok: true, subject: job.subject, text: job.text });
    sent++;
    console.log(`Sent successfully! Total sent this run: ${sent}`);
  } catch (e) {
    console.log(`Failed sending to ${job.to}: ${e.message}`);
    await call('result', { kind: job.kind, id: job.id, ok: false, error: String(e.message || e) });
  }

  // Small pause between emails if needed, but no long background sleeps
  if (job.delay_after) {
    await sleep(job.delay_after * 1000);
  }
}

console.log('Finished. Emails sent this run:', sent);
process.exit(0);
