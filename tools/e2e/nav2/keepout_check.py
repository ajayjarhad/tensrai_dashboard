# Loads the dashboard's keepout masks into real Nav2 and asks its planner for a path, as the robot
# would when sent to a goal: with the empty mask the path goes straight through the square, with
# the no-go mask it goes around it, and the global costmap shows the square as lethal.
import json, math, os, threading, time
import rclpy
import rclpy.executors
from rclpy.action import ActionClient
from geometry_msgs.msg import PoseStamped
from nav2_msgs.action import ComputePathToPose
from nav2_msgs.srv import LoadMap
from nav_msgs.msg import OccupancyGrid

check_spec = json.load(open('/mask/zone.json'))
polygon = check_spec['polygon']

rclpy.init()
node = rclpy.create_node('keepout_check')
latest = {}
node.create_subscription(OccupancyGrid, '/global_costmap/costmap', lambda msg: latest.update(costmap=msg), 1)
planner = ActionClient(node, ComputePathToPose, '/compute_path_to_pose')
load_mask = node.create_client(LoadMap, '/filter_mask_server/load_map')
executor = rclpy.executors.SingleThreadedExecutor()
executor.add_node(node)
threading.Thread(target=executor.spin, daemon=True).start()

results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'   {detail}' if detail and not ok else ''), flush=True)

def wait_for(test, timeout):
    end = time.time() + timeout
    while time.time() < end:
        value = test()
        if value:
            return value
        time.sleep(0.2)
    return None

def lethal_cells():
    grid = latest.get('costmap')
    return sum(1 for value in grid.data if value == 100) if grid else 0

# How far inside the square a point is, in metres; 0 or less is outside.
def depth(x, y):
    xs = [px for px, _ in polygon]
    ys = [py for _, py in polygon]
    return min(x - min(xs), max(xs) - x, y - min(ys), max(ys) - y)

def cost_at(x, y):
    grid = latest.get('costmap')
    if not grid:
        return None
    info = grid.info
    col = int((x - info.origin.position.x) / info.resolution)
    row = int((y - info.origin.position.y) / info.resolution)
    return grid.data[row * info.width + col]

def pose(x, y):
    stamped = PoseStamped()
    stamped.header.frame_id = 'map'
    stamped.pose.position.x, stamped.pose.position.y = float(x), float(y)
    stamped.pose.orientation.w = 1.0
    return stamped

def plan():
    goal = ComputePathToPose.Goal()
    goal.goal = pose(*check_spec['goal'])
    goal.start = pose(*check_spec['start'])
    goal.use_start = True
    sent = planner.send_goal_async(goal)
    handle = wait_for(lambda: sent.done() and sent.result(), 30)
    if not handle or not handle.accepted:
        return []
    result = handle.get_result_async()
    done = wait_for(lambda: result.done() and result.result(), 60)
    return [(p.pose.position.x, p.pose.position.y) for p in done.result.path.poses] if done else []

def use_mask(stem):
    request = LoadMap.Request()
    request.map_url = f'/mask/keepout_{stem}.yaml'
    future = load_mask.call_async(request)
    wait_for(lambda: future.done(), 15)
    time.sleep(4)  # the global costmap updates at 1 Hz
    return future.result() is not None and future.result().result == 0

cx, cy = check_spec['centre']
check('the planner is up', planner.wait_for_server(timeout_sec=120) and load_mask.wait_for_service(timeout_sec=30))
wait_for(lambda: latest.get('costmap'), 60)

print('\n--- empty mask (every cell 255)', flush=True)
straight = plan()
check('Nav2 plans from the start to the goal', len(straight) > 10, len(straight))
check('the straight plan crosses the square', max(depth(x, y) for x, y in straight) > 0.5)
check('the square is not lethal', (cost_at(cx, cy) or 0) < 100, cost_at(cx, cy))
lethal_before = lethal_cells()

print('\n--- mask with the no-go square', flush=True)
check('the robot loads the zone mask', use_mask('zone'))
check('the KeepoutFilter marks the square lethal (rows the right way up)', cost_at(cx, cy) == 100, cost_at(cx, cy))
added = lethal_cells() - lethal_before
zone_cells = round(1.6 / 0.05) ** 2
check(
    f'the mask adds the square and nothing else ({added} lethal cells for a {zone_cells}-cell square)',
    abs(added - zone_cells) < zone_cells * 0.1,
)
check('outside the square the costmap is unchanged', (cost_at(cx, cy + 1.5) or 0) < 100, cost_at(cx, cy + 1.5))
around = plan()
check('Nav2 still finds a path', len(around) > 10, len(around))
# The planner works on cells and smooths between them, so it may touch the edge cells.
deepest = max([depth(x, y) for x, y in around] + [0.0])
check(f'and it never goes into the square (deepest {deepest:.3f} m, a cell is 0.05 m)', deepest <= 0.075)
length = lambda path: sum(math.dist(a, b) for a, b in zip(path, path[1:]))
check('it goes around, so it is longer', length(around) > length(straight) + 0.2, f'{length(straight):.2f} m vs {length(around):.2f} m')

print(f'\nRESULT {sum(results)} passed, {len(results) - sum(results)} failed', flush=True)
# ponytail: exit without rclpy's teardown, which can abort ("terminate called without an active
# exception") while the spin thread is still in its wait set. The container is removed next.
os._exit(0 if all(results) else 1)
