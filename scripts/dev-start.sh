#!/bin/bash
# Starts both servers in the background and pipes output to log files.
# Run automatically via devcontainer postStartCommand, or manually: bash scripts/dev-start.sh

ROOT="/workspaces/motifle-discord"
mkdir -p "$ROOT/logs"

# Kill any existing instances
pkill -f "nodemon.*server.js" 2>/dev/null || true
pkill -f "node.*server.js" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# Start Express server with polling watcher (reliable on WSL2)
cd "$ROOT/server"
nohup npx nodemon --legacy-watch server.js > "$ROOT/logs/server.log" 2>&1 &
echo "Express server started (PID $!), logging to logs/server.log"

# Start Vite dev server
cd "$ROOT/client"
nohup npm run dev > "$ROOT/logs/client.log" 2>&1 &
echo "Vite dev server started (PID $!), logging to logs/client.log"
