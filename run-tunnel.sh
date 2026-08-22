#!/bin/bash
# Keeps the public tunnel alive. If cloudflared drops, it reconnects
# automatically (a new URL is printed to the log when that happens).
while true; do
  cloudflared tunnel --url http://localhost:3000 2>&1
  echo "$(date) --- tunnel exited, reconnecting in 3s ---"
  sleep 3
done
