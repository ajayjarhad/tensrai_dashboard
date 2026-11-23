#!/bin/bash
# Inside the container: Nav2 with its loopback simulator on the robot's map, the global costmap
# running the KeepoutFilter, and the mask served as the robot would serve it (empty to begin with).
source /opt/ros/jazzy/setup.bash
python3 - <<'PY'
import yaml
params = yaml.safe_load(open('/opt/ros/jazzy/share/nav2_bringup/params/nav2_params.yaml'))
costmap = params['global_costmap']['global_costmap']['ros__parameters']
costmap['filters'] = ['keepout_filter']
costmap['keepout_filter'] = {
    'plugin': 'nav2_costmap_2d::KeepoutFilter',
    'enabled': True,
    'filter_info_topic': '/costmap_filter_info',
}
yaml.safe_dump(params, open('/tmp/keepout_params.yaml', 'w'))
PY
ros2 launch nav2_bringup tb3_loopback_simulation.launch.py map:=/maps/map.yaml use_rviz:=False \
  params_file:=/tmp/keepout_params.yaml > /tmp/nav2.log 2>&1 &
ros2 run nav2_map_server map_server --ros-args -r __node:=filter_mask_server \
  -p use_sim_time:=true -p yaml_filename:=/mask/keepout_empty.yaml \
  -p topic_name:=/keepout_filter_mask -p frame_id:=map > /tmp/mask.log 2>&1 &
ros2 run nav2_map_server costmap_filter_info_server --ros-args -r __node:=costmap_filter_info_server \
  -p use_sim_time:=true -p type:=0 -p filter_info_topic:=/costmap_filter_info \
  -p mask_topic:=/keepout_filter_mask -p base:=0.0 -p multiplier:=1.0 > /tmp/info.log 2>&1 &
ros2 run nav2_lifecycle_manager lifecycle_manager --ros-args -r __node:=lifecycle_manager_filters \
  -p use_sim_time:=true -p autostart:=true \
  -p "node_names:=['filter_mask_server', 'costmap_filter_info_server']" > /tmp/filters.log 2>&1 &
sleep 20
ros2 topic pub --once /initialpose geometry_msgs/msg/PoseWithCovarianceStamped \
  "{header: {frame_id: map}, pose: {pose: {position: {x: 1.26, y: -3.18, z: 0.0}, orientation: {w: 1.0}}}}" > /dev/null
touch /tmp/ready
sleep infinity
