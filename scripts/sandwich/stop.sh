#!/usr/bin/env bash
# Stops everything the sandwich demo started (anvil fork, bot).
for f in /tmp/ofel-sandwich-anvil.pid /tmp/ofel-sandwich-bot.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null && echo "stopped $(basename "$f" .pid) $(cat "$f")"; rm -f "$f"
done
pkill -f "anvil .*--port 8546" 2>/dev/null || true
pkill -f "scripts/sandwich/bot.ts" 2>/dev/null || true
exit 0
