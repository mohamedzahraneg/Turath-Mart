import { readFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';
import packageJson from '../../../../package.json';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function readBuildId() {
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim();
  } catch {
    return null;
  }
}

function resolveVersion() {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    readBuildId() ||
    packageJson.version ||
    'unknown'
  );
}

export function GET() {
  return NextResponse.json(
    {
      version: resolveVersion(),
      builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || null,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  );
}
