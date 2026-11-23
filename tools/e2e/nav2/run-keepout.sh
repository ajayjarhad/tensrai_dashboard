#!/bin/bash
# The dashboard's generated keepout masks against real Nav2's KeepoutFilter and planner.
#   tools/e2e/nav2/run-keepout.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MASKS="$HERE/../.out/keepout"
mkdir -p "$MASKS"
# From this folder: the repo root's bunfig.toml forces auto-install, which can't see @tensrai/shared.
(cd "$HERE" && bun keepout-masks.ts "$MASKS") || exit 1
docker build -q -t dashboard-nav2-check:jazzy "$HERE" > /dev/null || exit 1
docker rm -f nav2-keepout > /dev/null 2>&1
docker run -d --name nav2-keepout -v "$HERE:/nav2check:ro" -v "$REPO/dashboard_ros/maps:/maps:ro" \
  -v "$MASKS:/mask:ro" dashboard-nav2-check:jazzy /nav2check/start-keepout.sh > /dev/null
for _ in $(seq 1 60); do
  docker exec nav2-keepout test -f /tmp/ready 2> /dev/null && break
  sleep 2
done
docker exec nav2-keepout bash -c 'source /opt/ros/jazzy/setup.bash; python3 -u /nav2check/keepout_check.py' \
  | grep -vE '^\[INFO\]|^$'
STATUS=${PIPESTATUS[0]}
[ "$STATUS" -ne 0 ] && docker exec nav2-keepout tail -20 /tmp/nav2.log
docker rm -f nav2-keepout > /dev/null
exit "$STATUS"
