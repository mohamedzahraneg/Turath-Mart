#!/bin/bash

# --- VPS Deployment Script ---
# IP: 72.60.184.79
# User: root

# [1] Configuration
VPS_IP="72.60.184.79"
VPS_USER="root"
VPS_PASS='ooVamjz6RFzP46CHv(7I)'
REMOTE_DIR="/root/turath-mart" # Adjust if your path is different (e.g., /var/www/...)

echo "🚀 Starting Deployment to $VPS_IP..."

# [2] Synchronize Files (Excluding Cache and Node Modules)
echo "📦 Uploading local changes to VPS..."
sshpass -p "$VPS_PASS" rsync -avz --progress \
  --exclude '.next' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env.local' \
  --exclude 'deploy_vps.sh' \
  ./ "$VPS_USER@$VPS_IP:$REMOTE_DIR"

if [ $? -ne 0 ]; then
    echo "❌ Error: Sync failed. Please check your connection or sshpass installation."
    exit 1
fi

echo "✅ Files uploaded successfully."

# [3] Remote Execution (Install, Build, Restart)
echo "⚙️ Preparing remote server..."
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_IP" << EOF
  cd $REMOTE_DIR
  
  # Install dependencies if needed
  echo "📥 Installing dependencies..."
  npm install --quiet
  
  # Build the project
  echo "🏗️ Building the project (Next.js 15)..."
  npm run build
  
  # Restart the application
  # We check if PM2 is available, otherwise we use standard npm start in background
  if command -v pm2 > /dev/null; then
    echo "🔄 Restarting with PM2..."
    pm2 restart turath-mart || pm2 start npm --name "turath-mart" -- start
  else
    echo "⚠️ PM2 not found. Starting in background on port 4028..."
    pkill -f "next-server"
    nohup npm start -- -p 4028 > server.log 2>&1 &
  fi
  
  echo "✨ Deployment complete on the VPS!"
EOF

echo "🏁 All tasks finished. Visit http://$VPS_IP:4028 to check your site."
