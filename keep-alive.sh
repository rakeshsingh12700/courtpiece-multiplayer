#!/bin/bash
# Pings Render every 4 minutes so the free-tier instance never spins down
# mid-game (spin-down wipes all in-memory rooms - this is a stopgap for
# tonight, not a permanent fix; the real fix is the paid tier).
while true; do
  curl -s -o /dev/null --max-time 15 https://courtpiece.onrender.com/healthz
  sleep 240
done
