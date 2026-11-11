import Imap from 'imap-simple';

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
    const imapConfig = {
      imap: {
        user: m.username,
        password: m.password,
        host: item.imap_host,
        port: 993,
        tls: true,
        authTimeout: 15000,
        tlsOptions: { rejectUnauthorized: false }
      }
    };

    console.log(`Connecting to IMAP for ${m.email}...`);
    try {
      const connection = await Imap.connect(imapConfig);
      await connection.openBox('INBOX');

      // Search for emails received since campaign start
      const searchCriteria = [['SINCE', new Date(item.since)]];
      const fetchOptions = { bodies: ['HEADER.FIELDS.FROM'], struct: true };
      const messages = await connection.search(searchCriteria, fetchOptions);

      const repliedEmails = new Set();
      const targetEmails = new Set(item.emails.map(e => e.toLowerCase()));

      for (const msg of messages) {
        const fromHeader = msg.parts.find(p => p.which === 'HEADER.FIELDS.FROM');
        if (fromHeader && fromHeader.body && fromHeader.body.from) {
          const rawFrom = fromHeader.body.from[0];
          const match = rawFrom.match(/<([^>]+)>|([^\s]+@[^\s]+)/);
          const email = match ? (match[1] || match[2]).toLowerCase() : '';
          
          if (email && targetEmails.has(email)) {
            repliedEmails.add(email);
          }
        }
      }

      await connection.end();

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
