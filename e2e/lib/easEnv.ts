/**
 * Reads the EXPO_PUBLIC_* build environment out of app/eas.json so the web
 * export is bundled with exactly the values real builds ship with (the
 * variables are statically inlined by Expo at bundle time -- see
 * app/src/config.ts). The production profile is authoritative; the loader
 * verifies every profile agrees so a drifted profile cannot silently produce
 * an export that talks to a different API than the tests mock.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ExpoPublicEnv {
  EXPO_PUBLIC_API_URL: string;
  EXPO_PUBLIC_COGNITO_DOMAIN: string;
  EXPO_PUBLIC_COGNITO_CLIENT_ID: string;
}

const REQUIRED_KEYS = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_COGNITO_DOMAIN',
  'EXPO_PUBLIC_COGNITO_CLIENT_ID',
] as const;

interface EasJsonShape {
  build?: Record<string, { env?: Record<string, unknown> }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Repo root = parent of this file's directory (e2e/lib -> e2e -> root). */
export function repoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function appDir(): string {
  return path.join(repoRoot(), 'app');
}

export function distDir(): string {
  return path.join(appDir(), 'dist');
}

export function easJsonPath(): string {
  return path.join(appDir(), 'eas.json');
}

/**
 * Parse app/eas.json and return the EXPO_PUBLIC_* env of the production
 * profile, after asserting all profiles that define these keys agree.
 * Throws with a precise message when the file is missing keys -- a silent
 * default here would bundle an export pointing at no API at all.
 */
export function loadExpoPublicEnv(): ExpoPublicEnv {
  const raw = readFileSync(easJsonPath(), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed['build'])) {
    throw new Error(`app/eas.json has no "build" section (${easJsonPath()})`);
  }
  const build = parsed['build'] as NonNullable<EasJsonShape['build']>;

  const profiles = Object.entries(build).filter(
    ([, profile]) => isRecord(profile) && isRecord(profile.env),
  );
  if (profiles.length === 0) {
    throw new Error('app/eas.json: no build profile defines an "env" block');
  }

  const production = build['production'];
  if (production === undefined || !isRecord(production.env)) {
    throw new Error('app/eas.json: the production profile has no "env" block');
  }

  const readKey = (key: (typeof REQUIRED_KEYS)[number]): string => {
    const value = production.env?.[key];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`app/eas.json production env is missing ${key}`);
    }
    for (const [name, profile] of profiles) {
      const other = profile.env?.[key];
      if (other !== undefined && other !== value) {
        throw new Error(
          `app/eas.json profile "${name}" disagrees with production on ${key}: ` +
            `${String(other)} != ${value}`,
        );
      }
    }
    return value;
  };

  return {
    EXPO_PUBLIC_API_URL: readKey('EXPO_PUBLIC_API_URL'),
    EXPO_PUBLIC_COGNITO_DOMAIN: readKey('EXPO_PUBLIC_COGNITO_DOMAIN'),
    EXPO_PUBLIC_COGNITO_CLIENT_ID: readKey('EXPO_PUBLIC_COGNITO_CLIENT_ID'),
  };
}

/** API origin (no trailing slash) the exported bundle will call. */
export function apiOrigin(): string {
  return loadExpoPublicEnv().EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
}
