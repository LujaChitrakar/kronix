This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Create `kronix-frontend/.env.local` with server-side RPC config:

```bash
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
# Optional browser websocket endpoint. Defaults to Solana devnet websocket.
NEXT_PUBLIC_RPC_WS_URL=wss://api.devnet.solana.com
NEXT_PUBLIC_USDC_MINT=4VwXppbTdzQvzt7SsMYUpXdrZcytrQeixJFXUcgsEetF
```

The browser uses the same-origin `/api/rpc` proxy. Keep
`NEXT_PUBLIC_RPC_URL` out of client components so paid RPC URLs are not bundled
or called directly by the browser. `/api/rpc` is HTTP-only, so websocket
subscriptions use `NEXT_PUBLIC_RPC_WS_URL` instead of `wss://<site>/api/rpc`.

Phoenix strategies run on mainnet-oriented Phoenix APIs and use a separate
keeper signer:

```bash
NEXT_PUBLIC_PHOENIX_RPC_URL=https://api.mainnet-beta.solana.com
PHOENIX_API_URL=https://perp-api.phoenix.trade
# Optional: if unset, the keeper also accepts KEEPER_KEYPAIR_PATH.
PHOENIX_KEEPER_KEYPAIR='[64-byte-json-secret-key]'
```

The Phoenix keeper signer must be the wallet authority for testing or a
Phoenix delegated position authority for the trader. `KEEPER_KEYPAIR_PATH` may
be either a keypair file path, a 64-byte JSON array, or a base58 secret key.
Start it with:

```bash
pnpm phoenix-keeper
```

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
