#!/bin/bash
# Restart only the Express server and tail the log to confirm startup.

ROOT="/workspaces/motifle-discord"
mkdir -p "$ROOT/logs"

pkill -f "nodemon.*server.js" 2>/dev/null || true
pkill -f "node.*server.js" 2>/dev/null || true
sleep 1

cd "$ROOT/server"
nohup npx nodemon --legacy-watch server.js > "$ROOT/logs/server.log" 2>&1 &
echo "Server restarted (PID $!)"

# Tail log until "listening" appears or 10s timeout
echo "Waiting for server..."
timeout 10 grep -q "listening\|started\|3001" <(tail -f "$ROOT/logs/server.log") 2>/dev/null && echo "Server up." || true
tail -n 20 "$ROOT/logs/server.log"
