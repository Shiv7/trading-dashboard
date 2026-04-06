#!/bin/bash
SERVICE_NAME="$(basename $(pwd))"
PORT=$(grep -oP 'server.port=\K\d+' src/main/resources/application.properties 2>/dev/null || echo "unknown")
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
PID=$(lsof -i :$PORT -t 2>/dev/null | head -1)
if [ -n "$PID" ]; then
    echo "[$SERVICE_NAME] Stopping PID=$PID (graceful SIGTERM)..."
    kill -15 $PID 2>/dev/null
    for i in $(seq 1 30); do
        if ! kill -0 $PID 2>/dev/null; then echo "[$SERVICE_NAME] Stopped after ${i}s"; break; fi
        sleep 1
    done
    if kill -0 $PID 2>/dev/null; then kill -9 $PID 2>/dev/null; sleep 2; fi
fi
echo "[$SERVICE_NAME] Starting..."
nohup mvn spring-boot:run > nohup.out 2>&1 &
echo "[$SERVICE_NAME] Started PID=$!"
