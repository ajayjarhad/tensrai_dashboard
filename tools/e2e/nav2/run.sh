#!/bin/bash
# The robot's real mission_plan and emergency_flow against real Nav2 (its loopback simulator stands in
# for the base and sensors, no Gazebo), then e-stop pause, stillness, resume and completion.
#   tools/e2e/nav2/run.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
docker build -q -t dashboard-nav2-check:jazzy "$HERE" > /dev/null || exit 1
docker rm -f nav2-check > /dev/null 2>&1
docker run -d --name nav2-check -v "$HERE:/nav2check:ro" -v "$REPO/dashboard_ros:/robot_pkg:ro" \
  -v "$REPO/dashboard_ros/maps:/maps:ro" dashboard-nav2-check:jazzy /nav2check/start.sh > /dev/null
for _ in $(seq 1 60); do
  docker exec nav2-check grep -q 'WebSocket server starting' /tmp/robot.log 2> /dev/null && break
  sleep 2
done
sleep 5
docker exec nav2-check bash -c 'source /opt/ros/jazzy/setup.bash; python3 -u /nav2check/check.py' \
  | grep -vE '^\[INFO\]|^$'
STATUS=${PIPESTATUS[0]}
docker rm -f nav2-check > /dev/null
exit "$STATUS"
