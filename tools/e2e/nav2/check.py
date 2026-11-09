# Drives missions through the robot's websockets and watches /odom to see whether the robot moves.
import asyncio, json, math, sys, threading, time
import rclpy
import rclpy.executors
from nav_msgs.msg import Odometry
import websockets

rclpy.init()
odom = {'x': None, 'y': None, 'speed': 0.0}
node = rclpy.create_node('estop_check')
def on_odom(msg):
    odom['x'], odom['y'] = msg.pose.pose.position.x, msg.pose.pose.position.y
    odom['speed'] = math.hypot(msg.twist.twist.linear.x, msg.twist.twist.angular.z)
node.create_subscription(Odometry, '/odom', on_odom, 10)
executor = rclpy.executors.SingleThreadedExecutor()
executor.add_node(node)
spin_thread = threading.Thread(target=executor.spin, daemon=True)
spin_thread.start()

results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'   {detail}' if detail and not ok else ''), flush=True)

async def scenario(name, settle_before_estop):
    print(f'\n--- {name}', flush=True)
    m = await websockets.connect('ws://127.0.0.1:9487')
    e = await websockets.connect('ws://127.0.0.1:8766')
    events = []
    async def reader(ws):
        async for raw in ws:
            events.append(json.loads(raw))
    tasks = [asyncio.create_task(reader(m)), asyncio.create_task(reader(e))]
    async def wait(pred, timeout):
        t0 = time.time()
        while time.time() - t0 < timeout:
            hit = next((ev for ev in events if pred(ev)), None)
            if hit: return hit
            await asyncio.sleep(0.05)
        return None
    send = lambda ws, event, payload: ws.send(json.dumps({'event': event, 'payload': payload}))
    def moved_over(seconds):
        x0, y0 = odom['x'], odom['y']
        time.sleep(seconds)
        return math.hypot(odom['x'] - x0, odom['y'] - y0)

    await send(m, 'SHOW_UP', {'missionId': 1, 'requestId': f'{name}-show'})
    shown = await wait(lambda ev: ev.get('event') == 'MISSION_CONTROL_ACK' and ev['payload'].get('requestId') == f'{name}-show', 30)
    check('preview loads the map through the real map server', shown and shown['payload']['status'] == 'success', shown)
    await send(m, 'START_MISSION', {'missionId': 1, 'requestId': f'{name}-start'})
    # The robot sends the Nav2 goal right after this ack, so an e-stop sent on it races the goal.
    started = await wait(lambda ev: ev.get('event') == 'MISSION_START_ACK', 30)
    if settle_before_estop:
        await asyncio.sleep(settle_before_estop)
        check('the robot drives under real Nav2', await asyncio.to_thread(moved_over, 2.0) > 0.1)
    await send(e, 'SOFTWARE_EMERGENCY', {'status': True})
    check('mission started', started and started['payload']['status'] == 'success', started)
    run_id = started and started['payload'].get('runId')
    paused = await wait(lambda ev: ev.get('event') == 'MISSION_CONTROL_ACK' and ev['payload'].get('requestType') == 'PAUSE_MISSION', 15)
    check('the e-stop pauses the mission', paused and paused['payload']['status'] == 'success', paused)
    await asyncio.sleep(3)
    drift = await asyncio.to_thread(moved_over, 4.0)
    check(f'the robot stays still during the e-stop (moved {drift:.3f} m in 4 s)', drift < 0.02)
    failed = [ev for ev in events if ev.get('event') == 'MISSION_COMPLETED']
    check('the e-stop does not end the mission', not failed, failed)
    await send(e, 'SOFTWARE_EMERGENCY', {'status': False})
    resumed = await wait(lambda ev: ev.get('event') == 'MISSION_CONTROL_ACK' and ev['payload'].get('requestId') == 'EMERGENCY_AUTO_RESUME', 15)
    check('release resumes it', resumed and resumed['payload']['status'] == 'success', resumed)
    done = await wait(lambda ev: ev.get('event') == 'MISSION_COMPLETED' and ev['payload'].get('runId') == run_id, 300)
    check('and real Nav2 completes it', done and done['payload']['status'] == 'success', done)
    for task in tasks: task.cancel()
    await m.close(); await e.close()

async def main():
    await scenario('estop-mid-mission', settle_before_estop=6)
    await scenario('estop-as-the-goal-is-sent', settle_before_estop=0)
    print(f'\nRESULT {sum(results)} passed, {len(results) - sum(results)} failed', flush=True)

asyncio.run(main())
# Stopped before exit: a ROS spin thread left running aborts the interpreter at shutdown.
executor.shutdown()
node.destroy_node()
rclpy.shutdown()
spin_thread.join(timeout=5)
sys.exit(0 if all(results) else 1)
