#!/bin/bash
# Keeps the public tunnel alive. If cloudflared drops, it reconnects
# automatically (a new URL is printed to the log when that happens).
#
# --protocol http2 forces plain TCP instead of cloudflared's default QUIC
# (UDP). QUIC was flapping every ~2 minutes all night ("timeout: no recent
# network activity") - a classic symptom of a router/ISP that doesn't carry
# UDP well. HTTP/2-over-TCP is far more tolerant of that.
while true; do
  cloudflared tunnel --protocol http2 --url http://localhost:3000 2>&1
  echo "$(date) --- tunnel exited, reconnecting in 3s ---"
  sleep 3
done
