# Daily Fitted mobile app

Expo (SDK 58) + Expo Router + TypeScript. Routes live in `src/app/`.

```
src/app/_layout.tsx   Session check; signed-out users only see sign-in
src/app/sign-in.tsx   Email + 6-digit code sign-in (also creates the account)
src/app/index.tsx     "My fits": your outfit diary
src/app/post.tsx      Camera → background upload → post
src/lib/supabase.ts   Supabase client (auth session saved on device)
src/lib/api.ts        Calls to the Python API, with the sign-in token attached
src/lib/photos.ts     Shrink, upload, and get signed URLs for private photos
```

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npx expo start` | Start the dev server; scan the QR code with Expo Go |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npx expo install <pkg>` | Add a package at the version that matches the Expo SDK |

Copy `.env.example` to `.env` and fill it in first. See `AGENTS.md` for Expo-specific notes.
