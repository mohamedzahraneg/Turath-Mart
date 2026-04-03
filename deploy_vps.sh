#!/bin/bash

# --- VPS Deployment Script (Turath Masr - Standalone Mode) ---
# IP: 72.60.184.79
# User: root

# [1] Configuration
VPS_IP="72.60.184.79"
VPS_PORT="22"
VPS_USER="root"
REMOTE_DIR="/www/wwwroot/schools"

echo "🚀 Starting STANDALONE Deployment of Turath Masr to $VPS_IP..."

# [2] Synchronize Files (Source & Config only)
echo "📦 Uploading source changes to VPS..."
rsync -avz --checksum --delete --progress \
  -e "ssh -p $VPS_PORT -o StrictHostKeyChecking=no" \
  --exclude '.next' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'deploy_vps.sh' \
  ./ "$VPS_USER@$VPS_IP:$REMOTE_DIR"

if [ $? -ne 0 ]; then
    echo "❌ Error: Sync failed."
    exit 1
fi

# [3] Remote Execution (Standalone Build & Run)
echo "⚙️ Preparing STANDALONE build on remote server..."
ssh -p "$VPS_PORT" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" << EOF
  cd $REMOTE_DIR
  
  NODE_BIN="/www/server/nodejs/v22.20.0/bin/node"
  NPM_BIN="/www/server/nodejs/v22.20.0/bin/npm"
  PM2_BIN="/www/server/nodejs/v22.20.0/bin/pm2"
  
  export PATH=\$(dirname "\$NODE_BIN"):\$PATH
  
  echo "🛑 NUCLEAR CLEAN: Removing old process and builds..."
  \$PM2_BIN delete "turath-masr" || true
  rm -rf .next node_modules package-lock.json
  
  echo "📥 Fresh Installing dependencies..."
  \$NPM_BIN install --quiet --no-audit
  
  echo "🏗️ Building STANDALONE production version..."
  \$NPM_BIN run build
  
  if [ ! -d ".next/standalone" ]; then
    echo "❌ Error: Standalone build failed. .next/standalone not found."
    exit 1
  fi
  
  echo "📂 Preparing standalone folder (copying public and static)..."
  cp -r public .next/standalone/
  cp -r .next/static .next/standalone/.next/
  
  echo "🔄 Clearing ports..."
  fuser -k 874/tcp || true
  
  echo "🚀 Starting the STANDALONE server with PM2..."
  # Standalone mode uses PORT environment variable
  PORT=874 \$PM2_BIN start .next/standalone/server.js --name "turath-masr" --cwd .next/standalone
  
  echo "✅ Standalone service started."
  sleep 5
  \$PM2_BIN status
EOF

echo "🏁 All tasks finished. Visit https://turathmasr.com to check Turath Masr."
