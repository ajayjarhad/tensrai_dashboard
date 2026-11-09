# Runs the robot's real mission_plan and emergency_flow, unmodified, against real Nav2.
import sys
from pathlib import Path
sys.path.insert(0, '/robot_pkg')
import rclpy
from rclpy.executors import MultiThreadedExecutor
from mission_to_websockets import emergency_flow, mission_plan

mission_plan.MAP_DIR = Path('/maps')
rclpy.init()
mission = mission_plan.WaypointMissionController()
mission.start_websocket_server(host='0.0.0.0', port=9487)
emergency = emergency_flow.EmergencyStopBridge(ws_host='0.0.0.0', ws_port=8766)
executor = MultiThreadedExecutor(num_threads=6)
executor.add_node(mission)
executor.add_node(emergency)
executor.spin()
