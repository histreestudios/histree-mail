# Histree Mailflow: setup with GitHub (no terminal needed)

Sends cold emails and follow-ups through your Hostinger mailboxes on a server schedule, so it keeps working with your computer off. Cost: $0.

## One-time setup (about 10 minutes)

**1. Cloudflare (free, no card)**
- Sign up at cloudflare.com. Open "Workers & Pages" once; if it asks you to pick a workers.dev subdomain, pick one.
- Copy your **Account ID** (shown on the Workers & Pages page, right side).
- My Profile > API Tokens > Create Token > use the "Edit Cloudflare Workers" template, then add the permission **Account > D1 > Edit**. Copy the token.

**2. GitHub**
- Create a new **private** repository (name it histree-mailflow). Do not use your website repo.
- Click "Add file > Upload files", drag in everything from this folder (including the hidden `.github` folder; if your computer hides it, upload the zip contents using GitHub Desktop or drag the whole folder), and commit to `main`.
- Repo Settings > Secrets and variables > Actions > New repository secret. Add these five:

| Secret name | Value |
|---|---|
| CLOUDFLARE_API_TOKEN | the token from step 1 |
| CLOUDFLARE_ACCOUNT_ID | your Account ID |
| ADMIN_PASSWORD | the password you will use to sign in |
| SESSION_SECRET | any long random text |
| ENC_KEY | another long random text (keep a copy, never change it later) |

**3. Deploy**
- Go to the repo's **Actions** tab > "Deploy Mailflow" > Run workflow. Wait for the green tick.
- Open the finished run: the summary shows your dashboard address (https://...workers.dev). Bookmark it.

## Daily use
1. Sign in with ADMIN_PASSWORD.
2. Mailboxes: add each Hostinger mailbox using the exact SMTP host and port from Hostinger (hPanel > Emails). Press "Send test" to your own address.
3. Leads: upload a CSV (see leads_template.csv).
4. Campaigns: write the first email and follow-ups, pick hours, days, time zone and gaps, save, then press Start.
5. Close the computer. The server sends every minute inside your hours, below the daily cap.
6. When someone replies, press "Mark replied" on the Leads tab so follow-ups stop. The red button at the top pauses everything.

To update later, change a file in the repo and the workflow redeploys automatically.

## Limits (please read)
- Replies and bounces are not detected automatically (free Workers cannot read your inbox). Use the buttons.
- Not yet tested with a real Hostinger mailbox. The free plan gives 10 ms CPU per run; if the activity log shows CPU-limit errors, the fallback is the $5/month Workers plan or Hostinger web hosting.
- A send cut off mid-way shows as "Interrupted (check)" on Overview and is never retried automatically. Check your Sent folder first.
- Before real sending: SPF, DKIM and DMARC must be set for your domain, start at 10 to 20 emails per mailbox per day, and only email people you have a legitimate reason to contact.
- If the Deploy workflow fails, open the failed step and send me the red error text.
