# Deploy MenuMate free on Cloudflare

This Cloudflare Worker replaces the Render/Docker deployment. It uses Workers Static Assets for the website and a persistent D1 SQL database for restaurants, menu items, suggested questions, and chat logs.

## Dashboard deployment

1. In Cloudflare, open **Workers & Pages** and choose **Create application**.
2. Choose the Git repository `RANJITHQWE123/menumate`.
3. Set the install command to `npm install` and the deploy command to `npm run deploy`.
4. Deploy. The `DB` D1 binding in `wrangler.jsonc` is automatically provisioned during the first Git deployment.
5. In the deployed Worker's **Settings → Variables and Secrets**, add these **Secrets**:
   - `APP_SECRET`: click **Generate** in a password manager, or use a long random string.
   - `OPENAI_API_KEY`: the replacement OpenAI key. Never commit it to GitHub.
6. Redeploy the Worker after saving the secrets.

The Worker creates its own D1 tables on the first API request. Visit `/api/health`, then `/owner` to create the first restaurant account.

## Public URL

Cloudflare gives the Worker a `*.workers.dev` URL. Customers can visit it directly without a login. QR codes use the current public origin automatically. You can add a custom domain later in the Worker settings.

## Free-tier note

The Cloudflare Worker and D1 database use the free plan limits. The OpenAI API is separate and can incur usage charges.
