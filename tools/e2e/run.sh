#!/bin/bash
# Fresh stack from an empty database, three mock robots plus the robot's real Python, then every suite.
#   tools/e2e/run.sh          plain HTTP, NODE_ENV=development
#   tools/e2e/run.sh --tls    HTTPS, NODE_ENV=production
#   tools/e2e/run.sh --keep   leave the stack running afterwards
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/.out"
TLS=0
KEEP=0
for arg in "$@"; do
  [ "$arg" = "--tls" ] && TLS=1
  [ "$arg" = "--keep" ] && KEEP=1
done
PROJECT=dashboard-e2e
NET=${PROJECT}_tensrai-network
ROBOTS="mock-a1 mock-a2 mock-b1 mock-probe real-robot"
FILES=(-f docker-compose.yml -f "$HERE/compose-verify.yml")
LABEL=http
mkdir -p "$OUT"
if [ "$TLS" = 1 ]; then
  LABEL=tls
  FILES+=(-f "$HERE/compose-tls.yml")
  export E2E_WEB=https://127.0.0.1:18443 NODE_TLS_REJECT_UNAUTHORIZED=0
  mkdir -p "$OUT/tls"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3 -keyout "$OUT/tls/k.pem" -out "$OUT/tls/c.pem" \
    -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1,DNS:dash.test" >/dev/null 2>&1
  sed -e 's|listen       80;|listen 443 ssl; ssl_certificate /certs/c.pem; ssl_certificate_key /certs/k.pem;|' \
    "$REPO/docker/nginx/nginx.conf" > "$OUT/tls/nginx-tls.conf"
fi
compose() { (cd "$REPO" && docker compose -p "$PROJECT" "${FILES[@]}" "$@"); }

docker rm -f $ROBOTS >/dev/null 2>&1
compose down -v --remove-orphans > "$OUT/down.log" 2>&1
compose up -d --build mongo mongo-init backend web > "$OUT/up.log" 2>&1 || { tail -5 "$OUT/up.log"; exit 1; }
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' $PROJECT-backend-1 2>/dev/null)" = "healthy" ] && break
  sleep 3
done
echo "backend $(docker inspect -f '{{.State.Health.Status}}' $PROJECT-backend-1), NODE_ENV=$(docker exec $PROJECT-backend-1 printenv NODE_ENV)"

MAPS="$REPO/dashboard_ros/maps"
mock() { # name, control port, serve map1 as the default map, extra docker args
  local name=$1 control=$2 swap=$3
  shift 3
  # --no-healthcheck: the image's check probes the backend's port, which a mock never opens.
  docker run -d --name "mock-$name" --no-healthcheck -p "127.0.0.1:$control:9000" "$@" \
    -v "$HERE:/mock:ro" -v "$MAPS:/maps:ro" -e "ROBOT_NAME=$name" -e "SWAP_MAPS=$swap" \
    --entrypoint bun $PROJECT-backend /mock/mock-robot.ts >/dev/null
}
mock a1 19001 0 --network "$NET" -e WAYPOINT_MS=1500
mock a2 19002 1 --network "$NET" -e WAYPOINT_MS=1500
mock b1 19003 0 --network "$NET" -e WAYPOINT_MS=1500
mock probe 19005 0 -e WAYPOINT_MS=1000 -p 127.0.0.1:19488:9487 -p 127.0.0.1:18767:8766 -p 127.0.0.1:18768:8765
docker run -d --name real-robot --network "$NET" -p 127.0.0.1:19004:9000 -p 127.0.0.1:19487:9487 \
  -p 127.0.0.1:18766:8766 -p 127.0.0.1:18765:8765 -v "$HERE/real-robot:/app:ro" \
  -v "$REPO/dashboard_ros/mission_to_websockets:/robot:ro" -v "$MAPS:/maps:ro" \
  -e NAV_WAYPOINT_SEC=1.0 -e PYTHONDONTWRITEBYTECODE=1 python:3.10-slim python -u /app/run_real_robot.py >/dev/null
sleep 4

cd "$HERE" || exit 1
rm -f "$OUT/state.json"
export RESTARTS_BEFORE=0
FAILED=0
for suite in conformance e2e-1-setup e2e-2-telemetry e2e-3-missions e2e-4-maps e2e-5-break e2e-6-edge e2e-7-real-robot; do
  timeout 400 bun "$suite.ts" > "$OUT/$suite.$LABEL.log" 2>&1 || FAILED=1
  echo "$suite: $(grep -E '^RESULT' "$OUT/$suite.$LABEL.log" | cut -c9-)"
  grep -E '^(FAIL|DIFF)|TypeError' "$OUT/$suite.$LABEL.log" | cut -c1-300
done
echo "backend restarts: $(docker inspect -f '{{.RestartCount}}' $PROJECT-backend-1)"

if [ "$KEEP" = 0 ]; then
  docker rm -f $ROBOTS >/dev/null 2>&1
  compose down -v --remove-orphans >> "$OUT/down.log" 2>&1
fi
exit $FAILED
