// Runs on GitHub Actions. Asks the dashboard what is due, sends it over SMTP, reports back.
import nodemailer from 'nodemailer';
const { APP_URL, RUNNER_TOKEN } = process.env;
if (!APP_URL || !RUNNER_TOKEN) { console.error('Missing APP_URL or RUNNER_TOKEN secret in GitHub.'); process.exit(1); }
const base = APP_URL.trim().replace(/\/+$/, '');
const call = async (p, b) => {
  const r = await fetch(`${base}/api/runner/${p}`, { method: 'POST', headers: { Authorization: 'Bearer ' + RUNNER_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const end = Date.now() + 13 * 60 * 1000; let sent = 0;
while (Date.now() < end) {
  const { job, wait, note } = await call('next');
  if (note) console.log(note);
  if (!job) { if (wait && Date.now() + wait * 1000 < end) { await sleep(wait * 1000 + 1000); continue; } break; }
  const m = job.mailbox; console.log('::add-mask::' + m.password);
  try {
    const tr = nodemailer.createTransport({ host: m.host, port: m.port, secure: !!m.secure, auth: { user: m.username, pass: m.password }, connectionTimeout: 20000, socketTimeout: 30000 });
    await tr.sendMail({ from: { name: m.name, address: m.email }, to: job.to, subject: job.subject, text: job.text, replyTo: m.email, headers: job.headers || {} });
    await call('result', { kind: job.kind, id: job.id, ok: true }); sent++; console.log(`Sent (${job.kind}) #${job.id}`);
  } catch (e) {
    console.log(`Failed (${job.kind}) #${job.id}: ${e.message}`);
    await call('result', { kind: job.kind, id: job.id, ok: false, error: String(e.message || e) });
  }
}
console.log('Finished. Emails sent this run:', sent);
