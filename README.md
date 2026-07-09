# SplitIt

Split shared expenses with your group, track balances, settle up, and share
payment screenshots straight into the app. Built with Next.js 16 (App
Router), Firebase (Auth + Firestore + Storage), deployed on Vercel.

## Setup

### 1. Firebase project

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Authentication → Sign-in method → Google**.
3. Enable **Firestore Database** (start in production mode).
4. Enable **Storage**.
5. In Project Settings → General, add a Web App and copy the config values.
6. Copy `.env.local.example` to `.env.local` and fill in the values:

   ```bash
   cp .env.local.example .env.local
   ```

7. Deploy Firestore security rules (requires [Firebase CLI](https://firebase.google.com/docs/cli)):

   ```bash
   firebase deploy --only firestore:rules
   ```

   `firestore.rules` is already written for you — it restricts reads/writes
   to signed-in group members.

### 2. ImgBB (receipt image hosting)

Receipt screenshots are uploaded to [ImgBB](https://api.imgbb.com) instead of
Firebase Storage. Get a free API key at
[api.imgbb.com](https://api.imgbb.com/) and set `NEXT_PUBLIC_IMGBB_API_KEY`
in `.env.local`.

Note: ImgBB-hosted images are publicly accessible via their URL (anyone with
the link can view them) — there's no auth-scoped access control like
Firestore has. Fine for a trusted group's receipts, but worth knowing.

### 2. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. Deploy to Vercel

```bash
npx vercel
```

Add the same environment variables from `.env.local` in the Vercel project
settings (Settings → Environment Variables) before deploying to production.

## How it works

- **Auth**: Google sign-in via Firebase Auth.
- **Groups**: create a group (get a 6-character invite code) or join one with
  a code. Data lives in Firestore at `groups/{groupId}`.
- **Expenses**: logged under `groups/{groupId}/expenses`, currently split
  equally among selected members (exact/percentage splits are a natural
  follow-up).
- **Balances**: computed client-side from all expenses + settlements, then
  simplified into the minimum number of payments needed (`src/lib/balance.ts`).
- **Settling up**: recording a settlement just logs that a payment happened
  outside the app (cash, UPI, etc.) — there's no real payment processing.
- **Receipts**: uploaded to [ImgBB](https://api.imgbb.com), linked on the
  expense. ImgBB URLs are publicly accessible to anyone with the link (no
  auth gate), unlike Firestore.
- **PWA / Share Target**: the app is installable (manifest at
  `src/app/manifest.ts`) and registers as a share target, so screenshots
  shared from Photos/Gallery land on `/share-receipt` for you to attach to a
  new expense. This relies on a service worker (`public/sw.js`) intercepting
  the share POST — supported on Android Chrome; iOS Safari does not yet
  support the Web Share Target API for installed PWAs, so on iOS you'll pick
  the image manually from that same screen.

## Security notes

- Firestore rules restrict access to signed-in users; group data is further
  scoped to group members. Review `firestore.rules` before going beyond
  your trusted group of 3.
- No server secrets are required for the MVP — everything runs through the
  Firebase client SDK with rule-based access control.

## Not yet built (natural next steps)

- Exact/percentage splits (currently equal-only)
- Push notifications on new expenses (see Next.js PWA guide for the pattern)
- OCR on receipts to auto-fill amount/merchant
- Editing/deleting expenses
- Multi-currency support
