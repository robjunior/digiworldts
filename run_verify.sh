#!/usr/bin/env bash
set -u
cd /mnt/sdc/digiworld/backend

# kill any prior server
pkill -9 -f "tsx watch src/server.ts" 2>/dev/null
pkill -9 -f "src/server.ts" 2>/dev/null
sleep 1

# start server (detached stdio to file)
CLUSTER=memory PORT=3100 pnpm dev > /tmp/dw-backend.log 2>&1 < /dev/null &
SRV=$!
echo "server pid=$SRV"

up=0
for i in $(seq 1 40); do
  if curl -s -m 2 http://localhost:3100/api/health >/dev/null 2>&1; then echo "UP after ${i}s"; up=1; break; fi
  sleep 1
done
if [ "$up" = "0" ]; then echo "SERVER NEVER CAME UP"; tail -15 /tmp/dw-backend.log; pkill -9 -f "src/server.ts" 2>/dev/null; exit 1; fi

NODE_PATH=/mnt/sdc/digiworld/backend/node_modules node /mnt/sdc/digiworld/verify_ws_move.cjs
RC=$?
echo "verify rc=$RC"

# hard kill server
pkill -9 -f "tsx watch src/server.ts" 2>/dev/null
pkill -9 -f "src/server.ts" 2>/dev/null

# wait for port to actually free
for i in $(seq 1 20); do
  if ! curl -s -m 2 http://localhost:3100/api/health >/dev/null 2>&1; then echo "port free after ${i}s"; break; fi
  sleep 1
done
echo "done"
