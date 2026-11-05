# End-to-end tests with no robot

Runs the real stack (UI assets, nginx, backend, MongoDB) from an empty database against simulated
robots, and tries to break it.

```bash
tools/e2e/run.sh          # plain HTTP, NODE_ENV=development
tools/e2e/run.sh --tls    # HTTPS with a throwaway certificate, NODE_ENV=production
tools/e2e/run.sh --keep   # leave it running on http://127.0.0.1:18080 (or https://127.0.0.1:18443)
```

Needs Docker, Bun, a `.env` for docker compose, and a checkout of `dashboard_ros`. Only local ports
are used, and logs and generated logins go to `tools/e2e/.out/`, which git ignores.

## The robots

- **`mock-robot.ts`** serves all four bridges (rosbridge 9090, mapping 8765, mission 9487, emergency
  8766), with faults on a control channel (port 9000): garbage frames, floods, hardware e-stop, dropped
  connections, corrupt maps.
- **`real-robot/`** runs the real `dashboard_ros` Python, unmodified, with only ROS and the
  `websockets` library stubbed. It has no rosbridge, so port 9090 is down on that robot.
- **`conformance.ts`** sends the same commands to both and compares every frame, so the mock can't
  drift from what robots really send. If the Python changes, this is what fails.

## The suites

| Suite | Covers |
|---|---|
| `e2e-1-setup` | Onboarding: staff, orgs, members, robots, address approval |
| `e2e-2-telemetry` | Telemetry, teleop limits and watchdog, initial pose, live isolation |
| `e2e-3-missions` | Mission lifecycle, what gets stored, e-stop auto pause and resume |
| `e2e-4-maps` | Map sync, separate floors per robot and org, corrupt map data |
| `e2e-5-break` | Garbage, robot and backend restarts, revoked access, moved robots, staff flows |
| `e2e-6-edge` | Hostile input, role boundaries, cookies and CORS, deleting things in use |
| `e2e-7-real-robot` | The real robot Python through the whole stack |

## What this can't tell you

- Real rosbridge, Nav2 and hardware behaviour: those are stubbed or simulated here.
- The chunked map transfer has no robot-side code in `dashboard_ros`, so the mock's version comes from
  what the backend expects.
- The UI: these drive the same HTTP and WebSocket routes the browser uses. Click through by hand too.
