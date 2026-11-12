#!/bin/bash
# Inside the container: Nav2 with its loopback simulator on the robot's map, the robot at Tag1, then the
# robot's real bridges.
source /opt/ros/jazzy/setup.bash
ros2 launch nav2_bringup tb3_loopback_simulation.launch.py map:=/maps/map.yaml use_rviz:=False > /tmp/nav2.log 2>&1 &
sleep 20
ros2 topic pub --once /initialpose geometry_msgs/msg/PoseWithCovarianceStamped \
  "{header: {frame_id: map}, pose: {pose: {position: {x: 1.26, y: -3.18, z: 0.0}, orientation: {w: 1.0}}}}" > /dev/null
sleep 5
python3 -u /nav2check/robot.py > /tmp/robot.log 2>&1 &
sleep infinity
