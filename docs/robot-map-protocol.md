# Robot map protocol

How the dashboard sends maps to a robot and takes them off it. This is the spec for the robot side
(`dashboard_ros`); the dashboard side is built and tested against the mock robot in
`tools/e2e/mock-robot.ts`.

The dashboard already pulls maps from robots with `GET_MAP_DATA`. This document adds the other
direction: `PUT_MAP` stores a map on the robot and `DELETE_MAP` removes one. Both use the same
mapping-bridge WebSocket.

## Contents

- [Transport](#transport)
- [PUT_MAP](#put_map)
- [DELETE_MAP](#delete_map)
- [Robots that don't support this yet](#robots-that-dont-support-this-yet)
- [metadata.json v2](#metadatajson-v2)
- [The keepout mask](#the-keepout-mask)
- [Nav2 configuration](#nav2-configuration)
- [When the robot loads maps](#when-the-robot-loads-maps)
- [How the dashboard uses this](#how-the-dashboard-uses-this)
- [Recommended](#recommended)
- [Testing](#testing)

## Transport

- The mapping bridge, `ws://<robot>:8765` (the robot's `mappingBridgePort`).
- One JSON frame each way: `{"event": "<NAME>", "payload": {...}}`.
- The dashboard opens a connection, sends one request, waits for its ack, and closes. It gives up
  after 30 seconds without an ack.
- Frames can be up to **16 MiB**. Python `websockets` defaults `max_size` to 1 MiB, so raise it:
  `websockets.serve(handler, host, 8765, max_size=16 * 1024 * 1024)`. Gzipped grids are small (the
  largest seed map, 3746 × 2437 cells, is 9.1 MB raw and 127 KiB gzipped), but a noisy map
  compresses far less, and the base64 encoding adds a third.
- Every request carries a `transferId`. Echo it in the ack; the dashboard ignores acks for other
  transfers.

## PUT_MAP

Stores one map: the map image and YAML, `metadata.json`, and the keepout mask.

```json
{
  "event": "PUT_MAP",
  "payload": {
    "transferId": "6f1c0c5e-…",
    "mode": "create",
    "stem": "map4",
    "map_yaml_content": "image: map4.pgm\nresolution: 0.05\norigin: [-15.1, -16.7, 0]\n…",
    "map_pgm_gzip": "<base64 of the gzipped PGM>",
    "sha256": "<hex sha256 of the PGM itself, before gzip>",
    "metadata_json": { "locationTags": [], "missions": [], "zones": [], "paths": [] },
    "keepout_yaml_content": "image: keepout_map4.pgm\nmode: raw\n…",
    "keepout_pgm_gzip": "<base64 of the gzipped mask PGM>"
  }
}
```

| Field | Meaning |
| --- | --- |
| `mode` | `create`: refuse if the stem exists. `replace`: overwrite the stem's files. |
| `stem` | The file stem. `map4` means `map4.yaml`, `map4.pgm`, `metadata4.json` and `keepout_map4.{yaml,pgm}`; `map` means `metadata.json`, as `push_to_websockets.py` already pairs them. It always starts with `map`, because the robot finds maps by globbing `map*.yaml`. |
| `map_yaml_content` | The map's YAML, written byte for byte. Its `image:` already names `<stem>.pgm`. |
| `map_pgm_gzip`, `sha256` | The occupancy grid. Gunzip it, check the sha256, then write it byte for byte. |
| `metadata_json` | [metadata.json v2](#metadatajson-v2). Write it as received, including keys you don't know. |
| `keepout_yaml_content`, `keepout_pgm_gzip` | [The keepout mask](#the-keepout-mask). Always sent, even when the map has no zones. |

Reply with:

```json
{ "event": "PUT_MAP_ACK", "payload": { "transferId": "6f1c0c5e-…", "status": "stored" } }
```

| `status` | When |
| --- | --- |
| `stored` | Every file is written and in place. |
| `exists` | `mode` is `create` and the stem is taken. The dashboard re-reads the robot's maps and tries the next free stem. |
| `error` | Anything else. Put a human-readable reason in `message`; the dashboard shows it on the robot's chip. |

### Writing the files

A map must never be seen half-written, because the robot loads whatever `map*.yaml` it finds.

1. Gunzip both images and check the map's `sha256`. On a mismatch, reply `error`.
2. Write every file into a temporary directory next to the maps directory (same filesystem).
3. For `replace`, move the stem's existing YAML aside first, so nothing loads the old image with the
   new YAML in between.
4. Rename the files into place: the images, metadata and mask first, **the map YAML last**.
5. Reply `stored` only after the last rename.

## DELETE_MAP

Removes one map's files.

```json
{ "event": "DELETE_MAP", "payload": { "transferId": "a1b2…", "stem": "map4" } }
```

Delete `<stem>.yaml` first, then `<stem>.pgm`, its `metadata<N>.json` and
`keepout_<stem>.{yaml,pgm}`. Reply:

```json
{ "event": "DELETE_MAP_ACK", "payload": { "transferId": "a1b2…", "status": "deleted" } }
```

- A stem that doesn't exist counts as deleted.
- Refuse to delete the map you have loaded: reply `status: "error"` with a message. The dashboard
  never asks for that itself; it checks the robot's active map first.

## Robots that don't support this yet

Today's `dashboard_ros` answers any event other than `GET_MAP_DATA` with an error frame containing
"Unknown event". The dashboard treats that reply as "this robot can't receive maps yet" and shows
it on the Maps page. Nothing breaks: robots without `PUT_MAP` keep working, and maps are still
imported from them.

## metadata.json v2

Version 1 is today's file: `locationTags` and `missions`. Version 2 adds typed tags, zones and paths.
Unknown keys must survive a round trip, because the dashboard compares the robot's copy with its own.

```json
{
  "locationTags": [
    { "id": 1, "name": "Bay 1", "x": 2.4, "y": -1.1, "theta": 1.571, "type": "mission" },
    { "id": 2, "name": "Charger", "x": 0.0, "y": 0.0, "theta": 0.0, "type": "home" }
  ],
  "missions": [
    { "missionId": 1, "name": "Restock", "locationTagId": [2, 1] }
  ],
  "zones": [
    {
      "id": "z-9Qk2",
      "type": "pick",
      "name": "Pallet lane A",
      "polygon": [[1.0, 2.0], [3.0, 2.0], [3.0, 4.0], [1.0, 4.0]],
      "params": { "slots": "4" }
    }
  ],
  "paths": [
    { "id": "p-3x7d", "type": "preferred", "name": "Main aisle", "points": [[0, 0], [8, 0]], "width": 1.0 }
  ],
  "preferredLaneCost": 40
}
```

- **Coordinates** are metres in the map frame. Headings (`theta`) are radians, counter-clockwise from
  +x, as ROS uses them.
- **Tags**: `id` is an integer. `type` is `mission` or `home`; at most one `home`. A tag is never inside
  a no-go zone or on a virtual wall, because Nav2 can't plan out of a keepout cell.
- **Missions**: unchanged from version 1. `locationTagId` lists the tag ids in order. Mission ids are
  unique across all of a robot's maps, because the robot runs whichever mission it finds first.
- **Zones** are polygons (3 to 500 vertices) of one of these types:

  | `type` | Meaning |
  | --- | --- |
  | `no_go` | The robot must never enter. Also drawn into the keepout mask. |
  | `work` | An area where work happens. |
  | `named` | A named area, for reference. |
  | `trigger` | Something happens on entering it, as its `params` say. |
  | `pick` | Where pallets are picked up. |
  | `drop` | Where pallets are dropped off. |

  `params` is an optional string-to-string map that operators fill in, for the robot's own use.
  Detecting entry and acting on work, trigger, pick and drop zones is the robot's job; the dashboard
  only delivers them.
- **Paths** are polylines with a `width` in metres:
  - `preferred`: a lane the robot should prefer.
  - `virtual_wall`: a wall that doesn't exist physically. Also drawn into the keepout mask.
- **`preferredLaneCost`** (0 to 99) is the cost the mask puts outside preferred lanes. 0 or absent
  means lanes are only information.

## The keepout mask

No-go zones, virtual walls and preferred lanes reach Nav2 as a **KeepoutFilter** mask: one more PGM and
YAML per map, named `keepout_<stem>.pgm` and `keepout_<stem>.yaml`. These names don't match
`map*.yaml`, so map discovery doesn't pick them up. They are never listed in `metadata.json`.

```yaml
image: keepout_map4.pgm
mode: raw
resolution: 0.05
origin: [-15.1, -16.7, 0]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.25
```

- The mask has the map's size, resolution and origin, cell for cell.
- `mode: raw`: a pixel of 0 to 100 is that occupancy value, and 101 to 255 is unknown. `negate` and
  the thresholds are ignored in raw mode.
- Row 0 is the top of the map (the largest y), as in the map PGM.

| Pixel | Effect |
| --- | --- |
| `255` | No effect. The filter skips unknown mask cells. |
| `100` | Lethal: no-go zones and virtual walls (at least one cell wide). |
| `1`–`99` | A cost outside preferred lanes, when `preferredLaneCost` is set. The costmap value is `round(v × 2.54)`. |

"No effect" is 255, not 0. The filter writes mask values over unknown costmap cells, so 0 would turn
unknown space into free space.

One mask carries both hard and soft costs. If lane costs disturb your local controller, apply the
filter to the global costmap only. Or rasterise your own masks from `zones` and `paths`.

## Nav2 configuration

This is the configuration `tools/e2e/nav2/run-keepout.sh` runs against real Nav2 (Jazzy). Humble's
documentation lists the same parameters, but the check hasn't been run on Humble.

Add the filter to the global costmap:

```yaml
global_costmap:
  global_costmap:
    ros__parameters:
      plugins: ["static_layer", "obstacle_layer", "inflation_layer"]
      filters: ["keepout_filter"]
      keepout_filter:
        plugin: "nav2_costmap_2d::KeepoutFilter"
        enabled: True
        filter_info_topic: "/costmap_filter_info"
```

Serve the mask, and say what it is, with two more nodes under their own lifecycle manager:

```bash
ros2 run nav2_map_server map_server --ros-args -r __node:=filter_mask_server \
  -p yaml_filename:=/maps/keepout_map4.yaml -p topic_name:=/keepout_filter_mask -p frame_id:=map
ros2 run nav2_map_server costmap_filter_info_server --ros-args -r __node:=costmap_filter_info_server \
  -p type:=0 -p filter_info_topic:=/costmap_filter_info -p mask_topic:=/keepout_filter_mask \
  -p base:=0.0 -p multiplier:=1.0
ros2 run nav2_lifecycle_manager lifecycle_manager --ros-args -r __node:=lifecycle_manager_filters \
  -p autostart:=true -p "node_names:=['filter_mask_server', 'costmap_filter_info_server']"
```

`type: 0` is the keepout filter. Set `use_sim_time` to match the rest of Nav2.

## When the robot loads maps

- **On every map switch**, load the matching mask:
  `ros2 service call /filter_mask_server/load_map nav2_msgs/srv/LoadMap "{map_url: /maps/keepout_map4.yaml}"`.
  The KeepoutFilter keeps the last mask it received, so skipping this leaves the previous map's zones
  in place. If a map has no mask file, load an all-255 one, or switch the filter off with its
  `/global_costmap/keepout_filter/toggle_filter` service (`std_srvs/srv/SetBool`, in Jazzy).
- **After a `replace` of the loaded map**, reload the map and its mask once the robot is idle. Don't
  reload in the middle of a mission.

## How the dashboard uses this

- **Assign**: `PUT_MAP` with `mode: create` under the map's own stem, or the next free `map<N>`. On
  `exists`, the dashboard imports and tries the next stem.
- **Sync**: imports first, so a change made on the robot is never overwritten unseen, then sends
  `PUT_MAP` with `mode: replace`.
- **Unassign**: imports, sends `DELETE_MAP`, then drops its record of the robot holding the map.
- **Refused while a mission runs**: the dashboard doesn't sync or unassign during a mission. The robot
  may still refuse a `PUT_MAP` or `DELETE_MAP` it can't do safely; reply `error` with a message.

The dashboard compares copies by a revision: a sha256 over the PGM's sha256, the YAML minus `image`,
and the metadata. A robot that keeps the files exactly as sent imports back as "up to date".

## Recommended

- **Use the chunked manifest import** that the dashboard and the mock already speak (`MAP_MANIFEST`,
  then `MAP_SKIP` or `MAP_SEND_CHUNKS`). With it, the import before each sync compares hashes instead
  of downloading every image again. Without it, each sync downloads every map the robot holds first.
- **Resolve missions within one map's metadata**, not across all maps.
- **Report `currentMap`** (the stem) in status updates, so the dashboard knows the active map without
  guessing.

## Testing

- `tools/e2e/mock-robot.ts` implements `PUT_MAP` and `DELETE_MAP`, with faults to inject:
  `/map-put?mode=unsupported|reject|silent`.
- `tools/e2e/e2e-8-map-management.ts` runs upload, assign, sync with zones and the mask, conflicts,
  unassign and delete against the mock.
- `tools/e2e/nav2/run-keepout.sh` loads masks made by the dashboard's own generator into real Nav2. It
  checks that the no-go square becomes exactly its 1,024 lethal cells, the right way up, and that the
  planner goes around it.
