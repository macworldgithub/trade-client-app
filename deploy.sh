#!/bin/bash
# ==============================================================================
# Automated Production Deployment Script for VPS
# Usage: ./deploy.sh
# ==============================================================================

set -e

echo "=========================================="
echo " Starting Trade Client Backend Deployment "
echo "=========================================="

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found! Please copy .env.example to .env and configure it."
    exit 1
fi

# Ensure logs directory exists
mkdir -p logs

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 2. Build the NestJS application
echo "🔨 Building application..."
npm run build

# 3. Reload or start PM2 process
echo "🚀 Updating PM2 process..."
if pm2 describe trade-client-backend > /dev/null 2>&1; then
    echo "Reloading existing PM2 cluster without downtime..."
    pm2 reload ecosystem.config.js --env production
else
    echo "Starting PM2 cluster for the first time..."
    pm2 start ecosystem.config.js --env production
fi

# 4. Save PM2 list so it restarts automatically on VPS reboot
pm2 save

echo "=========================================="
echo "✅ Deployment completed successfully!"
echo "Status:"
pm2 status trade-client-backend
echo "=========================================="
