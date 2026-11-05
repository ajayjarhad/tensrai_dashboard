# A tiny in-process stand-in for rclpy and Nav2, so the robot's real bridge code runs unmodified.
# Only ROS is faked: every message the dashboard sees is built by the real Python.
import heapq
import itertools
import os
import threading
import time
import types

WAYPOINT_SEC = float(os.environ.get("NAV_WAYPOINT_SEC", "1.0"))
CANCEL_SEC = 0.2

_queue = []
_lock = threading.Lock()
_counter = itertools.count()
_running = threading.Event()
_running.set()
_subscribers = {}


def schedule(delay, fn):
    with _lock:
        heapq.heappush(_queue, (time.time() + delay, next(_counter), fn))


def spin():
    while _running.is_set():
        due = []
        with _lock:
            now = time.time()
            while _queue and _queue[0][0] <= now:
                due.append(heapq.heappop(_queue)[2])
        for fn in due:
            try:
                fn()
            except Exception as err:
                print(f"[fakeros] callback failed: {err!r}", flush=True)
        time.sleep(0.005)


class Future:
    def __init__(self):
        self._done = False
        self._result = None
        self._callbacks = []
        self._lock = threading.Lock()

    def done(self):
        return self._done

    def result(self):
        return self._result

    def add_done_callback(self, cb):
        with self._lock:
            if not self._done:
                self._callbacks.append(cb)
                return
        schedule(0, lambda: cb(self))

    def set_result(self, value):
        with self._lock:
            self._result = value
            self._done = True
            callbacks, self._callbacks = self._callbacks, []
        for cb in callbacks:
            schedule(0, lambda cb=cb: cb(self))


def publish(topic, msg):
    for cb in list(_subscribers.get(topic, [])):
        schedule(0, lambda cb=cb: cb(msg))


class _Logger:
    def __init__(self, name):
        self.name = name

    def _log(self, level, message):
        print(f"[{level}] [{self.name}] {message}", flush=True)

    def info(self, message):
        self._log("INFO", message)

    def warn(self, message):
        self._log("WARN", message)

    warning = warn

    def error(self, message):
        self._log("ERROR", message)

    def debug(self, message):
        pass


class _Publisher:
    def __init__(self, topic):
        self.topic = topic

    def publish(self, msg):
        publish(self.topic, msg)


class _Timer:
    def __init__(self, period, cb):
        self.period = period
        self.cb = cb
        self.cancelled = False
        schedule(period, self._fire)

    def _fire(self):
        if self.cancelled:
            return
        self.cb()
        schedule(self.period, self._fire)

    def cancel(self):
        self.cancelled = True


class _ServiceClient:
    def __init__(self, srv_type, name):
        self.srv_type = srv_type
        self.name = name

    def service_is_ready(self):
        return True

    def wait_for_service(self, timeout_sec=None):
        return True

    def call_async(self, _request):
        future = Future()
        response = self.srv_type.Response()
        schedule(0.05, lambda: future.set_result(response))
        return future


class _Stamp:
    def to_msg(self):
        now = time.time()
        return types.SimpleNamespace(sec=int(now), nanosec=int((now % 1) * 1e9))


class _Clock:
    def now(self):
        return _Stamp()


class Node:
    def __init__(self, name):
        self._logger = _Logger(name)

    def get_logger(self):
        return self._logger

    def get_clock(self):
        return _Clock()

    def create_publisher(self, _type, topic, _qos):
        return _Publisher(topic)

    def create_subscription(self, _type, topic, cb, _qos):
        _subscribers.setdefault(topic, []).append(cb)
        return cb

    def create_timer(self, period, cb):
        return _Timer(period, cb)

    def destroy_timer(self, timer):
        timer.cancel()

    def create_client(self, srv_type, name):
        return _ServiceClient(srv_type, name)

    def destroy_node(self):
        pass


# Nav2's FollowWaypoints: feedback reports the waypoint being driven to, and the result status is
# SUCCEEDED (4), or CANCELED (5) after a cancel.
class _GoalHandle:
    accepted = True

    def __init__(self, client, goal, feedback_callback):
        self.client = client
        self.total = len(goal.poses)
        self.feedback_callback = feedback_callback
        self.result_future = Future()
        self.cancelled = False
        self.finished = False
        schedule(0, lambda: self._feedback(0))

    def _feedback(self, index):
        if self.cancelled or self.finished:
            return
        message = types.SimpleNamespace(feedback=types.SimpleNamespace(current_waypoint=index))
        self.feedback_callback(message)
        if index + 1 < self.total:
            schedule(WAYPOINT_SEC, lambda: self._feedback(index + 1))
        else:
            schedule(WAYPOINT_SEC, lambda: self._finish(4))

    def _finish(self, status):
        if self.finished:
            return
        self.finished = True
        result = types.SimpleNamespace(missed_waypoints=[])
        self.result_future.set_result(types.SimpleNamespace(status=status, result=result))

    def get_result_async(self):
        return self.result_future

    def cancel_goal_async(self):
        future = Future()
        self.cancelled = True
        schedule(CANCEL_SEC, lambda: self._finish(5))
        schedule(0.01, lambda: future.set_result(types.SimpleNamespace(goals_canceling=[])))
        return future


class ActionClient:
    # The robot probes several action names; a real system serves one of them.
    def __init__(self, _node, _action_type, name):
        self.name = name
        self.goals = []

    def server_is_ready(self):
        return True

    def wait_for_server(self, timeout_sec=None):
        return True

    def send_goal_async(self, goal, feedback_callback=None):
        future = Future()
        handle = _GoalHandle(self, goal, feedback_callback or (lambda _m: None))
        self.goals.append(handle)
        schedule(0.02, lambda: future.set_result(handle))
        return future

    def cancel_all_goals_async(self):
        for handle in self.goals:
            if not handle.finished and not handle.cancelled:
                handle.cancel_goal_async()
        future = Future()
        schedule(0.01, lambda: future.set_result(types.SimpleNamespace(goals_canceling=[])))
        return future


class MultiThreadedExecutor:
    def __init__(self, num_threads=1):
        pass

    def add_node(self, _node):
        pass

    def spin(self):
        spin()
