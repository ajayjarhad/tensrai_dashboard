# Runs the robot's real bridge code, unmodified: mission_plan.py, emergency_flow.py and
# push_to_websockets.py from dashboard_ros. Only rclpy, the ROS messages and the websockets library
# are stand-ins. Port 9000 is a test control channel.
import asyncio
import json
import os
import sys
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

STUBS = Path(__file__).parent / "stubs"
sys.path[:0] = [str(STUBS), "/robot"]

import fakeros  # noqa: E402
import websockets  # noqa: E402


def module(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    return mod


class Message:
    def __init__(self):
        pass


class Bool(Message):
    data = False


class Twist(Message):
    pass


class Quaternion(Message):
    x = y = z = 0.0
    w = 1.0


class PoseStamped(Message):
    def __init__(self):
        self.header = types.SimpleNamespace(frame_id="", stamp=None)
        self.pose = types.SimpleNamespace(
            position=types.SimpleNamespace(x=0.0, y=0.0, z=0.0), orientation=Quaternion()
        )


class FollowWaypoints:
    class Goal:
        poses = []


class NavigateToPose:
    class Goal:
        pass


class LoadMap:
    class Request:
        map_url = ""

    class Response:
        result = 0


class ClearEntireCostmap:
    class Request:
        pass

    class Response:
        pass


class GoalStatus:
    STATUS_SUCCEEDED = 4
    STATUS_CANCELED = 5
    STATUS_ABORTED = 6


rclpy = module(
    "rclpy", init=lambda: None, ok=lambda: True, shutdown=lambda: None, spin=lambda _n: fakeros.spin()
)
rclpy.__path__ = []
module("rclpy.node", Node=fakeros.Node)
module("rclpy.action", ActionClient=fakeros.ActionClient)
module("rclpy.executors", MultiThreadedExecutor=fakeros.MultiThreadedExecutor)
module("std_msgs").__path__ = []
module("std_msgs.msg", Bool=Bool)
module("geometry_msgs").__path__ = []
module("geometry_msgs.msg", Twist=Twist, PoseStamped=PoseStamped, Quaternion=Quaternion)
module("action_msgs").__path__ = []
module("action_msgs.msg", GoalStatus=GoalStatus)
module("nav2_msgs").__path__ = []
module("nav2_msgs.action", FollowWaypoints=FollowWaypoints, NavigateToPose=NavigateToPose)
module("nav2_msgs.srv", LoadMap=LoadMap, ClearEntireCostmap=ClearEntireCostmap)

import emergency_flow  # noqa: E402
import mission_plan  # noqa: E402
import push_to_websockets  # noqa: E402

MAPS = Path(os.environ.get("MAP_DIR", "/maps"))
mission_plan.MAP_DIR = MAPS
push_to_websockets.MAP_DIR = MAPS

sys.stdin = open(os.devnull)

mission = mission_plan.WaypointMissionController()
mission.start_websocket_server(host="0.0.0.0", port=9487)
emergency = emergency_flow.EmergencyStopBridge(ws_host="0.0.0.0", ws_port=8766)
threading.Thread(target=push_to_websockets.main, daemon=True).start()


class Control(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _reply(self, body):
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path == "/stats":
            state = mission.state
            self._reply(
                {
                    "connections": {str(k): v for k, v in websockets.CONNECTIONS.items()},
                    "received": {str(k): v[-200:] for k, v in websockets.RECEIVED.items()},
                    "sent": {
                        str(k): [m if len(m) < 2000 else m[:2000] for m in v[-300:]]
                        for k, v in websockets.SENT.items()
                    },
                    "mission": {
                        "active": state.active,
                        "paused": state.paused,
                        "missionId": state.mission_id,
                        "runId": state.run_id,
                    },
                    "mode": mission.get_mode(),
                    "sw": emergency._sw_emergency,
                    "hw": emergency._hw_emergency,
                }
            )
        elif url.path == "/reset":
            websockets.SENT.clear()
            websockets.RECEIVED.clear()
            self._reply("ok")
        elif url.path == "/hw":
            message = Bool()
            message.data = query.get("on", ["0"])[0] == "1"
            fakeros.publish("/hw_emergency", message)
            self._reply("ok")
        else:
            self.send_response(404)
            self.end_headers()


threading.Thread(
    target=ThreadingHTTPServer(("0.0.0.0", 9000), Control).serve_forever, daemon=True
).start()
print("real robot bridges running", flush=True)
fakeros.spin()
