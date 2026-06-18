# @goldfinch/app

Expo (React Native) client for GoldFinch: iOS, Android, and web SPA from one
codebase. This workspace is the app SHELL (master plan section 12): routing,
auth, secure token storage, biometric gate, API layer, theme, and push
registration. Feature screens live in `features/<name>/` and are delivered by
the feature parts; the shell ships "coming soon" stubs.

## Layout

- `app/` - Expo Router routes: `(auth)` sign-in/callback, `(app)` tabs
  (dashboard `/`, `/transactions`, `/budget`, `/settings`).
- `features/` - feature entry points (default-export a screen component).
- `src/auth/` - Cognito Managed Login PKCE (`expo-auth-session`), SecureStore
  token triple (`gf.accessToken` / `gf.refreshToken` / `gf.idToken`), silent
  refresh, `BiometricGate` (cold-start lock + 5-minute inactivity re-lock).
- `src/api/` - `apiFetch` (access-token bearer, 401 refresh-retry,
  ErrorEnvelope -> `ApiError`), TanStack Query client, query-key factory,
  typed endpoint functions.
- `src/ui/` - light/dark theme tokens, `ThemeProvider`/`useTheme`, `Screen`,
  `Money` (decimal-string in, locale currency out), `ListRow`, ``.
- `src/notifications/registerPush.ts` - permission flow + POST
  `/devices/push-token`.

## Configuration

Copy `.env.example` to `.env` and fill in `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_COGNITO_DOMAIN`, `EXPO_PUBLIC_COGNITO_CLIENT_ID`. Set
`EAS_PROJECT_ID` for EAS builds and push tokens.

## Commands

- `npm run start` / `npm run web` - dev server (auth, secure store, biometrics
  and push need an EAS dev build, not Expo Go).
- `npm run typecheck` (alias `build`) - strict `tsc --noEmit`.
- `npm run export:web` - SPA export to `dist/` for S3 + CloudFront.

## House rules

No emojis anywhere; icons come from `lucide-react-native`. The ID token is
never sent to the API. Money is decimal strings + integer minor units, never
floats.
