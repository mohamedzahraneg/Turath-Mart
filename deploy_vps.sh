#!/bin/bash

# --- VPS Deployment Script (Turath Masr) ---
# IP: 72.60.184.79
# User: root

# [1] Configuration
VPS_IP="72.60.184.79"
VPS_PORT="22"
VPS_USER="root"
REMOTE_DIR="/root/turath-mart"

echo "🚀 Starting Deployment of Turath Masr to $VPS_IP:$VPS_PORT..."

# [2] Synchronize Files
echo "📦 Uploading local changes to VPS..."
rsync -avz --progress \
  -e "ssh -p $VPS_PORT -o StrictHostKeyChecking=no" \
  --exclude '.next' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env.local' \
  --exclude 'deploy_vps.sh' \
  --exclude 'server.log' \
  ./ "$VPS_USER@$VPS_IP:$REMOTE_DIR"

if [ $? -ne 0 ]; then
    echo "❌ Error: Sync failed. Check SSH connection."
    exit 1
fi

echo "✅ Files uploaded successfully."

# [3] Remote Execution
echo "⚙️ Preparing remote server..."
ssh -p "$VPS_PORT" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" << EOF
  cd $REMOTE_DIR
  
  NODE_BIN="/www/server/nodejs/v22.20.0/bin/node"
  NPM_BIN="/www/server/nodejs/v22.20.0/bin/npm"
  
  export PATH=\$(dirname "\$NODE_BIN"):\$PATH
  
  echo "🧹 Cleaning up old build..."
  rm -rf .next
  
  echo "📥 Installing dependencies..."
  \$NPM_BIN install --quiet --ignore-scripts
  
  echo "🏗️ Building the project (Next.js 15)..."
  \$NPM_BIN run build
  
  echo "🔄 Stopping any process on port 4028..."
  fuser -k 4028/tcp || true
  
  echo "🔄 Starting the application on port 4028..."
  nohup \$NPM_BIN run start -- -p 4028 > server.log 2>&1 &
  
  sleep 5
  echo "📜 Latest Logs from Server:"
  tail -n 20 server.log
EOF

echo "🏁 All tasks finished. Visit http://$VPS_IP:4028 to check Turath Masr."
