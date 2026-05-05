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
  \$PM2_BIN delete "turath-masr" || true
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
  PORT=$APP_PORT \$PM2_BIN start .next/standalone/server.js --name "turath-masr" --cwd .next/standalone

  echo "✅ Service started."
  sleep 5
  \$PM2_BIN status
EOF

echo "🏁 Deployment finished."
