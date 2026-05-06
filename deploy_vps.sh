#!/bin/bash

# --- VPS Deployment Script (Turath Masr - Standalone Mode) ---
# Configuration is loaded from environment variables.
# Copy .env.example to .env and set the required variables before running.

# ─── [1] Require environment variables ────────────────────────────────────────
: "${VPS_IP:?VPS_IP is required — add it to your .env or export it}"
: "${VPS_USER:?VPS_USER is required — add it to your .env or export it}"
: "${VPS_PATH:?VPS_PATH is required — add it to your .env or export it}"
: "${APP_PORT:?APP_PORT is required — add it to your .env or export it}"

VPS_PORT="${VPS_PORT:-22}"

# Optional override so a staging deployment can run alongside production with
# a separate PM2 process (e.g. PM2_APP_NAME=turath-staging APP_PORT=875
# VPS_PATH=/www/wwwroot/turath-staging ./deploy_vps.sh).
# Defaults to the production process name to keep current behaviour identical.
PM2_APP_NAME="${PM2_APP_NAME:-turath-masr}"

echo "🚀 Starting STANDALONE Deployment of Turath Masr..."

# ─── [2] Synchronize Files (source & config only, exclude secrets) ────────────
echo "📦 Uploading source changes to VPS..."
rsync -avz --checksum --delete --progress \
  -e "ssh -p $VPS_PORT -o StrictHostKeyChecking=no" \
  --exclude '.next' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'deploy_vps.sh' \
  ./ "$VPS_USER@$VPS_IP:$VPS_PATH"

if [ $? -ne 0 ]; then
    echo "❌ Error: Sync failed."
    exit 1
fi

# ─── [3] Remote Execution (Standalone Build & Run) ────────────────────────────
echo "⚙️ Preparing STANDALONE build on remote server..."
ssh -p "$VPS_PORT" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" << EOF
  cd $VPS_PATH

  NODE_BIN="/www/server/nodejs/v22.20.0/bin/node"
  COREPACK_BIN="/www/server/nodejs/v22.20.0/bin/corepack"
  PM2_BIN="/www/server/nodejs/v22.20.0/bin/pm2"

  export PATH=\$(dirname "\$NODE_BIN"):\$PATH

  echo "🛑 Removing old process and builds..."
  \$PM2_BIN delete "${PM2_APP_NAME}" || true
  rm -rf .next node_modules package-lock.json

  echo "📥 Installing dependencies with pnpm (via corepack, version pinned in package.json)..."
  \$COREPACK_BIN enable
  \$COREPACK_BIN pnpm install --frozen-lockfile

  echo "🏗️ Building STANDALONE production version..."
  \$COREPACK_BIN pnpm build

  if [ ! -d ".next/standalone" ]; then
    echo "❌ Error: Standalone build failed. .next/standalone not found."
    exit 1
  fi

  echo "📂 Copying public and static assets..."
  cp -r public .next/standalone/
  cp -r .next/static .next/standalone/.next/

  echo "🔄 Clearing port $APP_PORT..."
  fuser -k $APP_PORT/tcp || true

  echo "🚀 Starting server with PM2..."
  # Script path is relative to --cwd, so use bare server.js. The previous
  # form (.next/standalone/server.js + --cwd .next/standalone) resolved to
  # the doubled path .next/standalone/.next/standalone/server.js and made
  # PM2 silently fail to register the process.
  PORT=$APP_PORT \$PM2_BIN start server.js --name "${PM2_APP_NAME}" --cwd .next/standalone

  echo "Waiting for PM2 to settle..."
  sleep 5
  \$PM2_BIN status

  # Fail-loud verification — confirm ${PM2_APP_NAME} actually started and
  # is online. Without this, a failed start (e.g. wrong path) leaves PM2
  # with no process while the script returns 0 and the workflow shows
  # "Service started" — the silent failure observed on run 25448962265.
  ST=\$(\$PM2_BIN jlist 2>/dev/null | \$NODE_BIN -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const a=JSON.parse(d).filter(x=>x.name==='${PM2_APP_NAME}');if(a.length===0){console.log('NOT_FOUND');return;}console.log((a[0].pm2_env&&a[0].pm2_env.status)||'UNKNOWN');});")
  if [ "\$ST" != "online" ]; then
    echo "❌ Error: PM2 process '${PM2_APP_NAME}' is not online (status=\$ST)."
    echo "--- Last 40 log lines for ${PM2_APP_NAME} (this process only) ---"
    \$PM2_BIN logs "${PM2_APP_NAME}" --lines 40 --nostream 2>&1 || true
    exit 1
  fi
  echo "✅ Verified: ${PM2_APP_NAME} is online."
EOF

echo "🏁 Deployment finished."
