# Longway

Discord carpool bot for one configured channel, deployed on Cloudflare Workers with D1.

## Public Setup

1. Create a Discord application, add a bot, and copy the application ID, public key, and bot token.
2. Create a Cloudflare Worker and D1 database for your own instance.
3. Set the Discord interaction endpoint in the Discord Developer Portal to `https://<your-worker-domain>/interactions`.
4. Register the slash commands after your app credentials are set.

## Install

Install dependencies:

```txt
npm install
```

Apply D1 migrations:

```txt
npx wrangler d1 migrations apply <your-d1-database-name>
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in your Discord values.

```txt
cp .dev.vars.example .dev.vars
```

Register slash commands:

```txt
set -a; source .dev.vars; npm run register-commands
```

Run locally:

```txt
npm run dev
```

Deploy:

```txt
npm run deploy
```

Generate Worker binding types after config changes:

```txt
npm run cf-typegen
```

## Deployment Config

Set these values in Cloudflare before deploying your own instance:

- D1 `database_name`
- D1 `database_id`

Deployment checklist:

- `DISCORD_APPLICATION_ID`
- `DISCORD_PUBLIC_KEY`
- `CARPOOL_CHANNEL_ID`
- `DISCORD_TOKEN`

Set them in the Cloudflare dashboard or with `wrangler secret put DISCORD_TOKEN` for the bot token. `.dev.vars` is for local development only.

Invite URL:

```txt
https://discord.com/oauth2/authorize?client_id=<your-application-id>&permissions=326417599488&integration_type=0&scope=bot+applications.commands
```

Required interaction endpoint in Discord Developer Portal:

```txt
https://<your-worker-domain>/interactions
```

## Commands

- `/register-car name seats`
- `/edit-car car name? seats?`
- `/delete-car car`
- `/start-board`

All commands and ride actions are limited to the configured channel or ride threads under it.

## Verification

```txt
npm test
npm run typecheck
```

## Security Note

Never commit Discord bot tokens or deployment-specific private values. `.dev.vars` stays local and is ignored by git.
