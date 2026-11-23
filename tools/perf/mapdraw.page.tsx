// The dashboard map's scene drawn five ways, for tools/perf/mapdraw.ts. ?c= picks the renderer:
// current (react-konva as frontend/src/features/robot-map draws it today, with the app's own
// RobotMarker), laser (current with the laser scan drawn as one path), tuned (react-konva with
// cheaper settings), imperative (the tuned scene on Konva without React), canvas2d (no library).
// ?scene=stress draws 50 robots and 400 pins.
import Konva from 'konva/lib/Core';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { RobotMarker } from '../../frontend/src/features/robot-map/components/RobotMarker';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Path,
  Rect,
  RegularPolygon,
  Shape,
  Stage,
} from '../../frontend/src/lib/map/konva';
import { RobotMode } from '../../frontend/src/types/robot';

const W = 1440;
const H = 900;
const MAP = 2000;
const params = new URLSearchParams(location.search);
const stress = params.get('scene') === 'stress';
const ROBOTS = stress ? 50 : 10;
const PINS = stress ? 400 : 40;
const LASER_POINTS = 720;
const PATH_POINTS = 300;
const ROBOT_W = 12;
const ROBOT_L = 18;
const FIT = H / MAP;
const PIN_SVG =
  'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z';
const PIN_SCALE = 2.2;

const random = (() => {
  let seed = 0x5eed;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

const mapBitmap = async () => {
  const canvas = new OffscreenCanvas(MAP, MAP);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = '#cdcdcd';
  ctx.fillRect(0, 0, MAP, MAP);
  for (let room = 0; room < 60; room += 1) {
    const x = random() * MAP * 0.9;
    const y = random() * MAP * 0.9;
    const w = 80 + random() * 300;
    const h = 80 + random() * 300;
    ctx.fillStyle = '#fefefe';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }
  return createImageBitmap(canvas);
};

const pins = Array.from({ length: PINS }, (_, index) => ({
  id: `pin-${index}`,
  x: 100 + random() * (MAP - 200),
  y: 100 + random() * (MAP - 200),
}));
const robotSeeds = Array.from({ length: ROBOTS }, () => ({
  cx: 300 + random() * (MAP - 600),
  cy: 300 + random() * (MAP - 600),
  radius: 60 + random() * 200,
  phase: random() * Math.PI * 2,
}));
const pathPoints = (() => {
  const points = new Float32Array(PATH_POINTS * 2);
  let x = 200;
  let y = 200;
  for (let index = 0; index < PATH_POINTS; index += 1) {
    x += 4 + random() * 4;
    y += (random() - 0.4) * 8;
    points[index * 2] = x;
    points[index * 2 + 1] = y;
  }
  return points;
})();

type Pose = { x: number; y: number; rotation: number };
const robotsAt = (frame: number): Pose[] =>
  robotSeeds.map(seed => {
    const angle = seed.phase + frame * 0.02;
    return {
      x: seed.cx + Math.cos(angle) * seed.radius,
      y: seed.cy + Math.sin(angle) * seed.radius,
      rotation: (angle * 180) / Math.PI + 90,
    };
  });
const laserAt = (frame: number, around: Pose) => {
  const points = new Float32Array(LASER_POINTS * 2);
  for (let index = 0; index < LASER_POINTS; index += 1) {
    const angle = (index / LASER_POINTS) * Math.PI * 2;
    const range = 120 + Math.sin(angle * 7 + frame * 0.1) * 40 + random() * 6;
    points[index * 2] = around.x + Math.cos(angle) * range;
    points[index * 2 + 1] = around.y + Math.sin(angle) * range;
  }
  return points;
};
const viewAt = (frame: number) => {
  const scale = FIT * (1.6 + Math.sin(frame * 0.05) * 0.6);
  return {
    scale,
    x: W / 2 - (MAP / 2) * scale + Math.cos(frame * 0.03) * 80,
    y: H / 2 - (MAP / 2) * scale + Math.sin(frame * 0.03) * 80,
  };
};

type Draw = CanvasRenderingContext2D;
const drawLaserPerPoint = (ctx: Draw, points: Float32Array, radius: number) => {
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#ef4444';
  for (let index = 0; index < points.length; index += 2) {
    ctx.beginPath();
    ctx.arc(points[index] ?? 0, points[index + 1] ?? 0, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};
const drawLaserBatched = (ctx: Draw, points: Float32Array, radius: number) => {
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index] ?? 0;
    const y = points[index + 1] ?? 0;
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
};
const drawPath = (ctx: Draw, points: Float32Array) => {
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.moveTo(points[0] ?? 0, points[1] ?? 0);
  for (let index = 2; index < points.length; index += 2) {
    ctx.lineTo(points[index] ?? 0, points[index + 1] ?? 0);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};
const laserRadius = (scale: number) => Math.max(0.75, 3.4 / Math.max(scale / FIT, 0.001));
const pinPath = new Path2D(PIN_SVG);

type Harness = { step: (frame: number, scenario: string) => void };
declare global {
  interface Window {
    __bench: Harness;
    __ready: boolean;
    __run: (
      scenario: string,
      frames: number,
      start: number
    ) => Promise<{ frames: number; ms: number }>;
  }
}

const PinCurrent = ({ x, y, onSelect }: { x: number; y: number; onSelect: () => void }) => (
  <Group x={x} y={y} name="location-pin" onClick={onSelect} onTap={onSelect}>
    <Circle x={0} y={0} radius={16 * PIN_SCALE} fill="#000" opacity={0.01} listening />
    <Path
      data={PIN_SVG}
      fill="#01FF01"
      stroke="black"
      strokeWidth={0.65}
      scaleX={PIN_SCALE}
      scaleY={PIN_SCALE}
      rotation={-90}
      offsetX={12}
      offsetY={9}
      perfectDrawEnabled={false}
    />
  </Group>
);

const PinTuned = memo(({ x, y }: { x: number; y: number }) => (
  <Group x={x} y={y} name="location-pin">
    <Circle x={0} y={0} radius={16 * PIN_SCALE} fill="#000" opacity={0.01} listening />
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      scaleX={PIN_SCALE}
      scaleY={PIN_SCALE}
      rotation={-90}
      offsetX={12}
      offsetY={9}
      sceneFunc={ctx => {
        const native = ctx._context;
        native.fillStyle = '#01FF01';
        native.strokeStyle = 'black';
        native.lineWidth = 0.65;
        native.fill(pinPath);
        native.stroke(pinPath);
      }}
    />
  </Group>
));

const RESOLUTION = 0.05;

// As RobotLayer mounts it: a listening group around the app's marker, which redraws on every pose.
const AppRobot = ({ pose }: { pose: Pose }) => (
  <Group listening onClick={() => {}}>
    <RobotMarker
      x={pose.x}
      y={pose.y}
      rotation={pose.rotation}
      status={RobotMode.MISSION}
      widthMeters={ROBOT_W * RESOLUTION}
      lengthMeters={ROBOT_L * RESOLUTION}
      resolution={RESOLUTION}
    />
  </Group>
);

const TunedRobot = memo(({ pose }: { pose: Pose }) => (
  <Group
    x={pose.x}
    y={pose.y}
    rotation={pose.rotation}
    offsetX={ROBOT_W / 2}
    offsetY={ROBOT_L / 2}
    name="robot-marker"
    listening
    onClick={() => {}}
  >
    <Rect
      width={ROBOT_W}
      height={ROBOT_L}
      stroke="black"
      strokeWidth={ROBOT_W * 0.1}
      cornerRadius={ROBOT_W * 0.2}
      fill="#828282"
      shadowColor="black"
      shadowBlur={5}
      shadowOpacity={0.3}
      shadowOffset={{ x: 2, y: 2 }}
      shadowForStrokeEnabled={false}
      perfectDrawEnabled={false}
    />
    <RegularPolygon
      x={ROBOT_W / 2}
      y={ROBOT_L * 0.25}
      sides={3}
      radius={ROBOT_W * 0.25}
      fill="#22C55E"
      listening={false}
      perfectDrawEnabled={false}
    />
  </Group>
));

const ReactScene = ({
  tuned,
  batchedLaser,
  bitmap,
}: {
  tuned: boolean;
  batchedLaser: boolean;
  bitmap: ImageBitmap;
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const [frame, setFrame] = useState(0);
  const [, setSelected] = useState<string | null>(null);
  const robots = robotsAt(frame);
  const laser = laserAt(frame, robots[0] as Pose);
  const tunedPins = useMemo(
    () => pins.map(pin => <PinTuned key={pin.id} x={pin.x} y={pin.y} />),
    []
  );

  useEffect(() => {
    const stage = stageRef.current as Konva.Stage;
    stage.scale({ x: FIT, y: FIT });
    stage.position({ x: (W - MAP * FIT) / 2, y: 0 });
    window.__bench = {
      step: (next, scenario) => {
        if (scenario === 'telemetry') {
          flushSync(() => setFrame(next));
          return;
        }
        const view = viewAt(next);
        stage.scale({ x: view.scale, y: view.scale });
        stage.position(view);
        stage.batchDraw();
      },
    };
    window.__ready = true;
  }, []);

  const scale = stageRef.current?.scaleX() ?? FIT;
  return (
    <Stage width={W} height={H} ref={stageRef}>
      <Layer listening={!tuned}>
        <Group>
          <KonvaImage image={bitmap} width={MAP} height={MAP} />
        </Group>
      </Layer>
      <Layer listening={false}>
        <Group>
          <Shape
            listening={false}
            perfectDrawEnabled={false}
            sceneFunc={ctx => drawPath(ctx._context, pathPoints)}
          />
          <Shape
            listening={false}
            perfectDrawEnabled={false}
            sceneFunc={ctx =>
              (batchedLaser ? drawLaserBatched : drawLaserPerPoint)(
                ctx._context,
                laser,
                laserRadius(scale)
              )
            }
          />
        </Group>
      </Layer>
      <Layer>
        <Group>
          <Rect width={MAP} height={MAP} fill="rgba(0,0,0,0)" />
          {tuned
            ? tunedPins
            : pins.map(pin => (
                <PinCurrent key={pin.id} x={pin.x} y={pin.y} onSelect={() => setSelected(pin.id)} />
              ))}
        </Group>
      </Layer>
      <Layer>
        <Group>
          {robots.map((pose, index) =>
            tuned ? (
              <TunedRobot key={robotSeeds[index]?.phase} pose={pose} />
            ) : (
              <AppRobot key={robotSeeds[index]?.phase} pose={pose} />
            )
          )}
        </Group>
      </Layer>
    </Stage>
  );
};

const imperativeScene = (bitmap: ImageBitmap) => {
  const container = document.getElementById('root') as HTMLDivElement;
  const stage = new Konva.Stage({ container, width: W, height: H });
  stage.scale({ x: FIT, y: FIT });
  stage.position({ x: (W - MAP * FIT) / 2, y: 0 });
  const mapLayer = new Konva.Layer({ listening: false });
  mapLayer.add(new Konva.Image({ image: bitmap, width: MAP, height: MAP }));
  let laser = laserAt(0, robotsAt(0)[0] as Pose);
  const overlay = new Konva.Layer({ listening: false });
  overlay.add(
    new Konva.Shape({
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: ctx => drawPath(ctx._context, pathPoints),
    }),
    new Konva.Shape({
      listening: false,
      perfectDrawEnabled: false,
      sceneFunc: ctx => drawLaserBatched(ctx._context, laser, laserRadius(stage.scaleX())),
    })
  );
  const pinLayer = new Konva.Layer();
  pinLayer.add(new Konva.Rect({ width: MAP, height: MAP, fill: 'rgba(0,0,0,0)' }));
  for (const pin of pins) {
    const group = new Konva.Group({ x: pin.x, y: pin.y, name: 'location-pin' });
    group.add(
      new Konva.Circle({ radius: 16 * PIN_SCALE, fill: '#000', opacity: 0.01 }),
      new Konva.Shape({
        listening: false,
        perfectDrawEnabled: false,
        scaleX: PIN_SCALE,
        scaleY: PIN_SCALE,
        rotation: -90,
        offsetX: 12,
        offsetY: 9,
        sceneFunc: ctx => {
          const native = ctx._context;
          native.fillStyle = '#01FF01';
          native.strokeStyle = 'black';
          native.lineWidth = 0.65;
          native.fill(pinPath);
          native.stroke(pinPath);
        },
      })
    );
    pinLayer.add(group);
  }
  const robotLayer = new Konva.Layer();
  const robotGroups = robotsAt(0).map(pose => {
    const group = new Konva.Group({
      ...pose,
      offsetX: ROBOT_W / 2,
      offsetY: ROBOT_L / 2,
      name: 'robot-marker',
    });
    group.add(
      new Konva.Rect({
        width: ROBOT_W,
        height: ROBOT_L,
        stroke: 'black',
        strokeWidth: ROBOT_W * 0.1,
        cornerRadius: ROBOT_W * 0.2,
        fill: '#828282',
        shadowColor: 'black',
        shadowBlur: 5,
        shadowOpacity: 0.3,
        shadowOffset: { x: 2, y: 2 },
        shadowForStrokeEnabled: false,
        perfectDrawEnabled: false,
      }),
      new Konva.RegularPolygon({
        x: ROBOT_W / 2,
        y: ROBOT_L * 0.25,
        sides: 3,
        radius: ROBOT_W * 0.25,
        fill: '#22C55E',
        listening: false,
        perfectDrawEnabled: false,
      })
    );
    robotLayer.add(group);
    return group;
  });
  stage.add(mapLayer, overlay, pinLayer, robotLayer);
  window.__bench = {
    step: (frame, scenario) => {
      if (scenario === 'telemetry') {
        const robots = robotsAt(frame);
        for (const [index, pose] of robots.entries()) robotGroups[index]?.setAttrs(pose);
        laser = laserAt(frame, robots[0] as Pose);
        overlay.batchDraw();
        robotLayer.batchDraw();
        return;
      }
      const view = viewAt(frame);
      stage.scale({ x: view.scale, y: view.scale });
      stage.position(view);
      stage.batchDraw();
    },
  };
  window.__ready = true;
};

const canvasScene = (bitmap: ImageBitmap) => {
  const root = document.getElementById('root') as HTMLDivElement;
  root.style.position = 'relative';
  const ratio = window.devicePixelRatio;
  const layer = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px`;
    root.append(canvas);
    return canvas.getContext('2d') as CanvasRenderingContext2D;
  };
  const base = layer();
  const live = layer();
  let view = { scale: FIT, x: (W - MAP * FIT) / 2, y: 0 };
  let robots = robotsAt(0);
  let laser = laserAt(0, robots[0] as Pose);
  const begin = (ctx: Draw) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W * ratio, H * ratio);
    ctx.setTransform(view.scale * ratio, 0, 0, view.scale * ratio, view.x * ratio, view.y * ratio);
  };
  const drawBase = () => {
    begin(base);
    base.drawImage(bitmap, 0, 0, MAP, MAP);
    base.fillStyle = '#01FF01';
    base.strokeStyle = 'black';
    base.lineWidth = 0.65;
    for (const pin of pins) {
      base.save();
      base.translate(pin.x, pin.y);
      base.rotate(-Math.PI / 2);
      base.scale(PIN_SCALE, PIN_SCALE);
      base.translate(-12, -9);
      base.fill(pinPath);
      base.stroke(pinPath);
      base.restore();
    }
  };
  const drawLive = () => {
    begin(live);
    drawPath(live, pathPoints);
    drawLaserBatched(live, laser, laserRadius(view.scale));
    const shadowScale = view.scale * ratio;
    for (const pose of robots) {
      live.save();
      live.translate(pose.x, pose.y);
      live.rotate((pose.rotation * Math.PI) / 180);
      live.translate(-ROBOT_W / 2, -ROBOT_L / 2);
      live.beginPath();
      live.roundRect(0, 0, ROBOT_W, ROBOT_L, ROBOT_W * 0.2);
      live.shadowColor = 'rgba(0,0,0,0.3)';
      live.shadowBlur = 5 * shadowScale;
      live.shadowOffsetX = 2 * shadowScale;
      live.shadowOffsetY = 2 * shadowScale;
      live.fillStyle = '#828282';
      live.fill();
      live.shadowColor = 'transparent';
      live.lineWidth = ROBOT_W * 0.1;
      live.strokeStyle = 'black';
      live.stroke();
      const r = ROBOT_W * 0.25;
      live.beginPath();
      for (let side = 0; side < 3; side += 1) {
        const angle = (side * 2 * Math.PI) / 3;
        live.lineTo(ROBOT_W / 2 + r * Math.sin(angle), ROBOT_L * 0.25 - r * Math.cos(angle));
      }
      live.closePath();
      live.fillStyle = '#22C55E';
      live.fill();
      live.restore();
    }
  };
  drawBase();
  drawLive();
  window.__bench = {
    step: (frame, scenario) => {
      if (scenario === 'telemetry') {
        robots = robotsAt(frame);
        laser = laserAt(frame, robots[0] as Pose);
        drawLive();
        return;
      }
      view = viewAt(frame);
      drawBase();
      drawLive();
    },
  };
  window.__ready = true;
};

window.__run = (scenario, frames, start) =>
  new Promise(resolve => {
    let frame = 0;
    const startedAt = performance.now();
    const tick = () => {
      frame += 1;
      window.__bench.step(start + frame, scenario);
      if (frame < frames) requestAnimationFrame(tick);
      else
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve({ frames: frame, ms: performance.now() - startedAt }))
        );
    };
    requestAnimationFrame(tick);
  });

const candidate = params.get('c') ?? 'current';
const bitmap = await mapBitmap();
if (candidate === 'imperative') imperativeScene(bitmap);
else if (candidate === 'canvas2d') canvasScene(bitmap);
else
  createRoot(document.getElementById('root') as HTMLDivElement).render(
    <ReactScene
      tuned={candidate === 'tuned'}
      batchedLaser={candidate !== 'current'}
      bitmap={bitmap}
    />
  );
