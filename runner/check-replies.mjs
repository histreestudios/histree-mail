import { ImapFlow } from 'imapflow';

const APP_URL = process.env.APP_URL;
const RUNNER_TOKEN = process.env.RUNNER_TOKEN;

if (!APP_URL || !RUNNER_TOKEN) {
  console.error('Missing APP_URL or RUNNER_TOKEN environment variables.');
  process.exit(1);
}

async function api(endpoint, body) {
  const res = await fetch(`${APP_URL}/api/runner/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RUNNER_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  console.log('Fetching reply targets from Mailflow...');
  const data = await api('reply-targets', {});
  const boxes = data.boxes || [];

  if (!boxes.length) {
    console.log('No active mailboxes or leads to check for replies.');
    return;
  }

  for (const item of boxes) {
    const m = item.mailbox;
    const client = new ImapFlow({
      host: item.imap_host || m.host,
      port: 993,
      secure: true,
      auth: {
        user: m.username,
        pass: m.password
      },
      logger: false
    });

    console.log(`Connecting to IMAP for ${m.email}...`);
    try {
      await client.connect();
      await client.mailboxOpen('INBOX');

      const repliedEmails = new Set();
      const targetEmails = new Set(item.emails.map(e => e.toLowerCase()));
      const sinceDate = new Date(item.since);

      for await (let message of client.fetch({ since: sinceDate }, { envelope: true })) {
        const fromAddr = message.envelope?.from?.[0]?.address?.toLowerCase();
        if (fromAddr && targetEmails.has(fromAddr)) {
          repliedEmails.add(fromAddr);
        }
      }

      await client.logout();

      if (repliedEmails.size > 0) {
        console.log(`Found replies for: ${[...repliedEmails].join(', ')}`);
        await api('replies', {
          replied: [...repliedEmails],
          bounced: [],
          status: [{ mailbox_id: item.mailbox_id, ok: true }]
        });
      } else {
        console.log(`No new replies found for ${m.email}.`);
      }
    } catch (err) {
      console.error(`IMAP check failed for ${m.email}:`, err.message);
      try { await client.logout(); } catch (e) {}
      await api('replies', {
        replied: [],
        bounced: [],
        status: [{ mailbox_id: item.mailbox_id, ok: false, error: err.message }]
      });
    }
  }
}

main().catch((e) => {
  console.error('Fatal reply checker error:', e);
  process.exit(1);
});
