# Histree Mailflow v3 (free): dashboard on Cloudflare, sending on GitHub

Cloudflare keeps the dashboard, database and rules. A GitHub Actions job ("Sender") does the SMTP sending and reads your inbox for replies. Cost: $0.

## Update your existing install (about 3 minutes)
1. In your GitHub repo, replace these files with the ones in this folder: `package.json`, `schema.sql`, `src/index.js`, `src/ui.js`, `runner/send.mjs`, `README.md`. (Use Add file > Upload files, or open each file and paste the new contents.) Your two workflow files and all secrets stay exactly as they are.
2. The commit starts "Deploy Mailflow" automatically. Wait for the green tick. It adds the new database table by itself.
3. Open the dashboard. Hard refresh (Ctrl+Shift+R) to see the new design.

## What is new
- Matches your ICP Scraper look: near-black, coral-red accent, pill tabs.
- Campaigns: write 6 or more versions of every email and follow-up. Each lead gets a random version per step.
- Leads: import a CSV with column matching (works with ICP Scraper exports), search, filter, delete one, many, a whole import batch, or everything shown.
- Compose: send a custom email to any address(es) from any of your mailboxes. Sent history: every campaign, manual and test email, click to read.
- Warm-up: a mailbox starts at, for example, 5 emails a day and rises to its full cap over 14 days. Set it when adding a mailbox or with the Warm-up button.
- Automatic reply detection: the Sender checks each mailbox inbox and stops follow-ups for anyone who replied. Bounces are marked and blocked.
- Overview: setup checklist, per-mailbox "sent today / today's cap" and "next email in X min", toasts instead of pop-ups, auto-refresh.

## Daily use
Mailboxes: add (exact SMTP host and port from Hostinger). Leads: import CSV. Campaigns: write versions, set hours and gaps, Save, Start. Close your computer. The Sender runs about every 15 minutes. To send something right now (a test or a Compose email), run Actions > Sender > Run workflow.

## Limits (please read)
- Reply and bounce detection is NOT yet tested against a real Hostinger inbox. It connects to `imap.` plus your SMTP domain (smtp.hostinger.com becomes imap.hostinger.com) on port 993. If it fails, the Mailboxes tab shows "check failed" (hover for the reason); sending is not affected.
- A reply from a different address than the one you emailed is not matched. Out-of-office auto-replies also stop the sequence.
- Compose and test emails wait for the next Sender run (up to about 15 minutes) unless you run Sender yourself.
- GitHub's scheduler can start runs late or skip some. It pauses after 60 days with no repo activity (re-enable under Actions).
- Tested locally (not on real Hostinger): dashboard server, variants, warm-up cap, compose, history, reply and bounce handling, lead deletion. The new screen layouts were syntax-checked only, not clicked through in a browser.
- Deliverability: SPF, DKIM, DMARC must be set; keep caps low; only email people you have a legitimate reason to contact.
