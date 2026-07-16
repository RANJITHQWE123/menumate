# Deploy MenuMate free on Cloudflare

This Cloudflare Worker replaces the Render/Docker deployment. It uses Workers Static Assets for the website, a persistent D1 SQL database for restaurants, menu items, suggested questions, and chat logs, and Cloudflare Workers AI for the AI waiter.

## Dashboard deployment

1. In Cloudflare, open **Workers & Pages** and choose **Create application**.
2. Choose the Git repository `RANJITHQWE123/menumate`.
3. Set the install command to `npm install` and the deploy command to `npm run deploy`.
4. Deploy. The `DB` D1 binding in `wrangler.jsonc` is automatically provisioned during the first Git deployment.
5. In the deployed Worker's **Settings → Variables and Secrets**, add this **Secret**:
   - `APP_SECRET`: click **Generate** in a password manager, or use a long random string.
6. Redeploy the Worker after saving the secret.

The Worker creates its own D1 tables on the first API request. Visit `/api/health`, then `/owner` to create the first restaurant account.

## Public URL

Cloudflare gives the Worker a `*.workers.dev` URL. Customers can visit it directly without a login. QR codes use the current public origin automatically. You can add a custom domain later in the Worker settings.

## Free-tier note

The Cloudflare Worker and D1 database use the free plan limits. Workers AI includes a free daily allowance; the AI waiter will temporarily be unavailable if that daily limit is reached.
