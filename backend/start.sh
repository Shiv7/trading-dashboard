#!/bin/bash
# Dashboard Backend startup script
# Prevents zombie JVMs by checking if port 8085 is already in use

PORT=8085
DIR="$(cd "$(dirname "$0")" && pwd)"

if lsof -i :$PORT -t >/dev/null 2>&1; then
    PID=$(lsof -i :$PORT -t | head -1)
    echo "ERROR: Port $PORT already in use by PID $PID"
    echo "Kill it first:  kill -9 $PID"
    exit 1
fi

cd "$DIR"
nohup mvn spring-boot:run >> nohup.out 2>&1 &
echo "Started dashboard backend (PID $!) — logs: $DIR/nohup.out"
echo "Waiting for startup..."
sleep 15
if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/api/ml/health 2>/dev/null | grep -q "200"; then
    echo "OK: Dashboard backend started on port $PORT"
else
    echo "WARN: Startup may still be in progress — check: tail -f $DIR/nohup.out"
fi
