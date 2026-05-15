"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SceneLaneSnapshot, ScenePedestrianSnapshot, SceneSnapshot, SceneVehicleSnapshot } from "@/lib/simulation/domain/snapshots";

type TrafficSceneProps = {
  scene: SceneSnapshot;
  mode?: "full" | "monitor";
};

type Point = { x: number; y: number };
type RouteMetrics = { points: Point[]; cumulative: number[]; length: number };

type DisplayVehicle = SceneVehicleSnapshot & { displayHeading: number; displayProgress: number };
type DisplayPedestrian = ScenePedestrianSnapshot & { heading: number };
type DisplayLane = Omit<SceneLaneSnapshot, "vehicles"> & { vehicles: DisplayVehicle[] };

function wrapAngle(angle: number) {
  let value = angle;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function smoothAngle(from: number, to: number, alpha: number) {
  const delta = wrapAngle(to - from);
  return wrapAngle(from + delta * alpha);
}

function headingFromVector(dx: number, dy: number) {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return null;
  }
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function buildRouteMetrics(points: Point[]): RouteMetrics {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    cumulative[index] = cumulative[index - 1] + Math.hypot(current.x - prev.x, current.y - prev.y);
  }
  return {
    points,
    cumulative,
    length: cumulative[cumulative.length - 1] ?? 0,
  };
}

function pointAlongRoute(route: RouteMetrics, progress: number) {
  const clamped = Math.max(0, Math.min(progress, route.length));
  let index = 1;
  while (index < route.cumulative.length && route.cumulative[index] < clamped) {
    index += 1;
  }
  const currentIndex = Math.min(index, route.cumulative.length - 1);
  const previousIndex = Math.max(0, currentIndex - 1);
  const start = route.points[previousIndex];
  const end = route.points[currentIndex];
  const startDistance = route.cumulative[previousIndex];
  const endDistance = route.cumulative[currentIndex];
  const span = Math.max(1e-6, endDistance - startDistance);
  const ratio = (clamped - startDistance) / span;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function poseAlongRoute(route: RouteMetrics, progress: number) {
  const point = pointAlongRoute(route, progress);
  const lookBehind = pointAlongRoute(route, Math.max(0, progress - 4));
  const lookAhead = pointAlongRoute(route, Math.min(route.length, progress + 6));
  return {
    point,
    heading: headingFromVector(lookAhead.x - lookBehind.x, lookAhead.y - lookBehind.y),
  };
}

function darken(color: string, amount: number) {
  const hex = color.replace("#", "");
  const value = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
  const channel = (index: number) => parseInt(value.slice(index, index + 2), 16);
  const clamp = (input: number) => Math.max(0, Math.min(255, Math.round(input)));
  const r = clamp(channel(0) * (1 - amount));
  const g = clamp(channel(2) * (1 - amount));
  const b = clamp(channel(4) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function hashNumber(input: string) {
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash;
}

function drawLaneVehicles(lane: DisplayLane) {
  return lane.vehicles.map((vehicle) => {
    // Use actual body dimensions from the simulation engine
    const bl = vehicle.bodyLength ?? 24;  // length along direction of travel
    const bw = vehicle.bodyWidth  ?? 13;  // width perpendicular to travel
    const hw = bl / 2;                    // half-length
    const hh = bw / 2;                    // half-width
    const isTruck = bl >= 30;
    const isCompact = bl <= 21;
    // Windshield: front portion of roof
    const wsX  = hw * 0.18;
    const wsW  = hw * 0.52;
    const wsH  = Math.max(3.5, bw * 0.46);
    // Cabin/roof area
    const roofX = -hw * 0.06;
    const roofW = isTruck ? hw * 0.55 : hw * 0.62;
    return (
      <g key={vehicle.id} transform={`translate(${vehicle.x} ${vehicle.y}) rotate(${vehicle.displayHeading})`}>
        {/* Drop shadow */}
        <ellipse cx="0" cy={hh * 0.18} fill="rgba(0,0,0,0.16)" rx={hw * 0.86} ry={hh * 0.40} />
        {/* Body */}
        <rect
          fill={vehicle.color}
          height={bw}
          opacity={vehicle.committed ? 1 : 0.97}
          rx={isCompact ? 3.5 : isTruck ? 2.5 : 4}
          ry={isCompact ? 3.5 : isTruck ? 2.5 : 4}
          stroke="rgba(8,12,18,0.44)"
          strokeWidth="0.8"
          width={bl}
          x={-hw}
          y={-hh}
        />
        {/* Roof / cabin */}
        {isTruck ? (
          // Truck: flat cargo bed + short cab
          <>
            <rect fill={darken(vehicle.color, 0.18)} height={bw * 0.72} rx={2} ry={2} width={hw * 0.48} x={-hw * 0.1} y={-hh * 0.72} />
            <rect fill={darken(vehicle.color, 0.30)} height={bw * 0.68} rx={2.5} ry={2.5} width={hw * 0.42} x={hw * 0.44} y={-hh * 0.68} />
          </>
        ) : (
          <rect fill={darken(vehicle.color, 0.26)} height={bw * 0.7} rx={3} ry={3} width={roofW} x={roofX} y={-hh * 0.7} />
        )}
        {/* Windshield */}
        <rect fill="rgba(232,238,245,0.88)" height={wsH} rx={1.8} ry={1.8} width={wsW} x={wsX} y={-wsH / 2} />
        {/* Rear window */}
        <rect fill="rgba(136,148,164,0.80)" height={Math.max(3, bw * 0.4)} rx={1.5} ry={1.5} width={hw * 0.42} x={-hw * 0.7} y={-(bw * 0.2)} />
        {/* Side stripe / panel line */}
        <rect fill="rgba(255,255,255,0.10)" height={bw * 0.75} rx={2} width={1.8} x={-hw * 0.78} y={-hh * 0.75} />
        {/* Emergency lightbar */}
        {vehicle.emergencyType ? (
          <>
            <rect fill="rgba(255,255,255,0.9)" height={2.4} rx={1.1} width={bl * 0.30} x={-bl * 0.15} y={-hh - 2.2} />
            <rect fill="#4aa3ff" height={1.9} rx={0.9} width={bl * 0.13} x={-bl * 0.13} y={-hh - 1.95} />
            <rect fill="#ff4d4d" height={1.9} rx={0.9} width={bl * 0.13} x={bl * 0.01} y={-hh - 1.95} />
            <rect
              fill="none"
              height={bw + 2.8}
              rx={isCompact ? 4 : 5}
              ry={isCompact ? 4 : 5}
              stroke={vehicle.emergencyDetected ? "rgba(255,215,0,0.88)" : "rgba(255,255,255,0.40)"}
              strokeWidth={vehicle.emergencyDetected ? 1.4 : 1}
              width={bl + 2.8}
              x={-hw - 1.4}
              y={-hh - 1.4}
            />
          </>
        ) : null}
        {/* Brake lights */}
        {vehicle.brakeLights ? (
          <>
            <rect fill="#ff3b30" height={bw * 0.22} rx={1} width={bl * 0.10} x={-hw - 0.5} y={-hh * 0.58} />
            <rect fill="#ff3b30" height={bw * 0.22} rx={1} width={bl * 0.10} x={-hw - 0.5} y={hh * 0.28} />
          </>
        ) : (
          <>
            <rect fill="rgba(120,30,20,0.55)" height={bw * 0.18} rx={0.8} width={bl * 0.09} x={-hw} y={-hh * 0.55} />
            <rect fill="rgba(120,30,20,0.55)" height={bw * 0.18} rx={0.8} width={bl * 0.09} x={-hw} y={hh * 0.28} />
          </>
        )}
        {/* Headlights (front) */}
        <rect fill="rgba(240,230,180,0.80)" height={bw * 0.18} rx={0.8} width={bl * 0.08} x={hw - bl * 0.08} y={-hh * 0.55} />
        <rect fill="rgba(240,230,180,0.80)" height={bw * 0.18} rx={0.8} width={bl * 0.08} x={hw - bl * 0.08} y={hh * 0.28} />
      </g>
    );
  });
}

function weatherOverlay(scene: SceneSnapshot) {
  if (scene.weatherMode === "rain") {
    return (
      <>
        <rect fill="rgba(24,42,66,0.18)" height="720" width="900" x="0" y="0" />
        {Array.from({ length: 40 }, (_, index) => (
          <line
            key={`rain-${index}`}
            stroke="rgba(210,225,240,0.42)"
            strokeWidth="1"
            x1={index * 24}
            x2={index * 24 - 10}
            y1={0}
            y2={720}
          />
        ))}
      </>
    );
  }
  if (scene.weatherMode === "fog") {
    return <rect fill="rgba(220,226,235,0.18)" height="720" width="900" x="0" y="0" />;
  }
  if (scene.weatherMode === "night") {
    return <rect fill="rgba(8,12,24,0.28)" height="720" width="900" x="0" y="0" />;
  }
  return null;
}

function createDisplayScene(
  scene: SceneSnapshot,
  previous?: SceneSnapshot,
): SceneSnapshot & {
  lanes: Array<SceneLaneSnapshot & { vehicles: DisplayVehicle[] }>;
  pedestrians: DisplayPedestrian[];
} {
  const prevVehicles = new Map(previous?.lanes.flatMap((lane) => lane.vehicles.map((vehicle) => [vehicle.id, vehicle])) ?? []);
  const prevPedestrians = new Map(previous?.pedestrians.map((pedestrian) => [pedestrian.id, pedestrian]) ?? []);

  return {
    ...scene,
    lanes: scene.lanes.map((lane) => ({
      ...lane,
      vehicles: lane.vehicles.map((vehicle) => {
        const previousVehicle = prevVehicles.get(vehicle.id) as DisplayVehicle | undefined;
        return {
          ...vehicle,
          x: previousVehicle?.x ?? vehicle.x,
          y: previousVehicle?.y ?? vehicle.y,
          displayHeading: previousVehicle?.displayHeading ?? vehicle.heading,
          displayProgress: previousVehicle?.displayProgress ?? vehicle.progress,
        };
      }),
    })),
    pedestrians: scene.pedestrians.map((pedestrian) => {
      const previousPedestrian = prevPedestrians.get(pedestrian.id) as DisplayPedestrian | undefined;
      return {
        ...pedestrian,
        x: previousPedestrian?.x ?? pedestrian.x,
        y: previousPedestrian?.y ?? pedestrian.y,
        heading: previousPedestrian?.heading ?? 90,
      };
    }),
  };
}

function useInterpolatedScene(scene: SceneSnapshot) {
  const [displayScene, setDisplayScene] = useState<SceneSnapshot>(() => createDisplayScene(scene));
  const targetSceneRef = useRef(scene);
  const routeMetricsRef = useRef(new Map<string, RouteMetrics>());

  useEffect(() => {
    targetSceneRef.current = scene;
    routeMetricsRef.current = new Map(scene.debugPaths.map((path) => [path.id, buildRouteMetrics(path.points)]));
    setDisplayScene((previous) => createDisplayScene(scene, previous));
  }, [scene]);

  useEffect(() => {
    let frame = 0;
    const animate = () => {
      setDisplayScene((current) => {
        const target = targetSceneRef.current;
        const routeMetrics = routeMetricsRef.current;
        const alpha = 0.26;
        let moving = false;

        const nextLanes = target.lanes.map((targetLane) => {
          const currentLane = current.lanes.find((lane) => lane.id === targetLane.id);
          const currentVehicles = new Map((currentLane?.vehicles ?? []).map((vehicle) => [vehicle.id, vehicle as DisplayVehicle]));
          return {
            ...targetLane,
            vehicles: targetLane.vehicles.map((vehicle) => {
              const existing = currentVehicles.get(vehicle.id);
              if (!existing) {
                return { ...vehicle, displayHeading: vehicle.heading, displayProgress: vehicle.progress };
              }
              const nextProgress = existing.displayProgress + (vehicle.progress - existing.displayProgress) * alpha;
              const route = routeMetrics.get(vehicle.pathId);
              const routePose = route ? poseAlongRoute(route, nextProgress) : null;
              const nextX = existing.x + (vehicle.x - existing.x) * alpha;
              const nextY = existing.y + (vehicle.y - existing.y) * alpha;
              const targetHeading =
                vehicle.intent === "straight"
                  ? vehicle.heading
                  : routePose?.heading ?? vehicle.heading;
              const nextHeading = smoothAngle(existing.displayHeading ?? existing.heading, targetHeading, 0.22);
              if (Math.abs(nextX - vehicle.x) > 0.2 || Math.abs(nextY - vehicle.y) > 0.2 || Math.abs(wrapAngle(nextHeading - vehicle.heading)) > 0.4) {
                moving = true;
              }
              return {
                ...vehicle,
                x: nextX,
                y: nextY,
                displayHeading: nextHeading,
                displayProgress: nextProgress,
              };
            }),
          };
        });

        const currentPedMap = new Map(current.pedestrians.map((pedestrian) => [pedestrian.id, pedestrian as DisplayPedestrian]));
        const nextPedestrians = target.pedestrians.map((pedestrian) => {
          const existing = currentPedMap.get(pedestrian.id);
          if (!existing) {
            return { ...pedestrian, heading: 90 };
          }
          const nextX = existing.x + (pedestrian.x - existing.x) * 0.24;
          const nextY = existing.y + (pedestrian.y - existing.y) * 0.24;
          const rawH = headingFromVector(pedestrian.x - existing.x, pedestrian.y - existing.y);
          const nextHeading = rawH !== null ? smoothAngle(existing.heading, rawH, 0.18) : existing.heading;
          if (Math.abs(nextX - pedestrian.x) > 0.2 || Math.abs(nextY - pedestrian.y) > 0.2) {
            moving = true;
          }
          return {
            ...pedestrian,
            x: nextX,
            y: nextY,
            heading: nextHeading,
          };
        });

        const nextScene = {
          ...target,
          lanes: nextLanes,
          pedestrians: nextPedestrians,
        };

        if (moving) {
          frame = requestAnimationFrame(animate);
        }
        return nextScene;
      });
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [scene]);

  return displayScene as SceneSnapshot & {
    lanes: Array<SceneLaneSnapshot & { vehicles: DisplayVehicle[] }>;
    pedestrians: DisplayPedestrian[];
  };
}

export function TrafficScene({ scene, mode = "full" }: TrafficSceneProps) {
  const displayScene = useInterpolatedScene(scene);
  const displayLanes = displayScene.lanes as DisplayLane[];
  const displayPedestrians = displayScene.pedestrians as DisplayPedestrian[];
  const roadTexture = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: `texture-${index}`,
        y: 48 + index * 56,
      })),
    [],
  );

  return (
    <div className={`scene-root ${mode === "monitor" ? "scene-root-monitor" : ""}`}>
      <div className="scene-caption">
        CAM-01 ● {displayScene.intersectionType.toUpperCase()} | {displayScene.phaseLabel} | {displayScene.signalStageLabel}
      </div>
      <div className="scene-wrapper">
        <svg viewBox="0 0 900 720" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
              <stop offset="55%" stopColor="rgba(0,0,0,0)" />
              <stop offset="100%" stopColor="rgba(6,10,16,0.32)" />
            </radialGradient>
            <radialGradient id="grass-light" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(60,130,20,0.18)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <filter id="tree-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
              <feOffset dx="2" dy="3" in="blur" result="shadow" />
              <feFlood floodColor="rgba(0,0,0,0.4)" result="color" />
              <feComposite in="color" in2="shadow" operator="in" result="shadow2" />
              <feMerge><feMergeNode in="shadow2" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* Sky/ground background */}
          <rect fill="#2d5016" height="720" width="900" x="0" y="0" />
          {/* Grass texture variation */}
          <rect fill="url(#grass-light)" height="720" width="900" x="0" y="0" />
          {/* Tree shadows */}
          <ellipse cx="184" cy="140" fill="rgba(8,18,4,0.32)" rx="32" ry="19" />
          <ellipse cx="724" cy="140" fill="rgba(8,18,4,0.32)" rx="32" ry="19" />
          <ellipse cx="184" cy="598" fill="rgba(8,18,4,0.32)" rx="32" ry="19" />
          <ellipse cx="724" cy="598" fill="rgba(8,18,4,0.32)" rx="32" ry="19" />
          {/* Tree canopies (layered circles for depth) */}
          <circle cx="180" cy="130" fill="#1e5208" r="34" filter="url(#tree-shadow)" />
          <circle cx="180" cy="130" fill="#2d7a0a" r="28" />
          <circle cx="180" cy="126" fill="#38920e" r="20" />
          <circle cx="720" cy="130" fill="#1e5208" r="34" filter="url(#tree-shadow)" />
          <circle cx="720" cy="130" fill="#2d7a0a" r="28" />
          <circle cx="720" cy="126" fill="#38920e" r="20" />
          <circle cx="180" cy="590" fill="#1e5208" r="34" filter="url(#tree-shadow)" />
          <circle cx="180" cy="590" fill="#2d7a0a" r="28" />
          <circle cx="180" cy="586" fill="#38920e" r="20" />
          <circle cx="720" cy="590" fill="#1e5208" r="34" filter="url(#tree-shadow)" />
          <circle cx="720" cy="590" fill="#2d7a0a" r="28" />
          <circle cx="720" cy="586" fill="#38920e" r="20" />
          {/* Additional shrubs for depth */}
          <circle cx="100" cy="360" fill="#246308" r="18" opacity="0.7" />
          <circle cx="100" cy="360" fill="#2d7a0a" r="14" opacity="0.8" />
          <circle cx="800" cy="360" fill="#246308" r="18" opacity="0.7" />
          <circle cx="800" cy="360" fill="#2d7a0a" r="14" opacity="0.8" />
          <circle cx="450" cy="80" fill="#246308" r="14" opacity="0.6" />
          <circle cx="450" cy="640" fill="#246308" r="14" opacity="0.6" />
          {displayScene.roads.map((road) => (
            <rect key={road.id} fill={road.fill} height={road.height} width={road.width} x={road.x} y={road.y} />
          ))}

          {/* ── 2-Way: road grain + shoulder markings ── */}
          {displayScene.intersectionType === "2way" && (
            <g>
              <rect x="370" y="0" width="1" height="720" fill="rgba(255,255,255,0.04)" />
              <rect x="529" y="0" width="1" height="720" fill="rgba(255,255,255,0.04)" />
              {/* Crosswalk bump indicator lines */}
              <line x1="370" y1="270" x2="530" y2="270" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <line x1="370" y1="450" x2="530" y2="450" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </g>
          )}

          {/* ── T-Junction: curb fillets + dead-end markings ── */}
          {displayScene.intersectionType === "3way" && (
            <g>
              {/* SW curb fillet — covers sharp corner where N-road left edge meets H-road top */}
              <path d="M 400 310 L 400 326 A 16 16 0 0 1 384 310 Z" fill="#2d5016" />
              {/* SE curb fillet */}
              <path d="M 500 310 L 484 310 A 16 16 0 0 1 500 326 Z" fill="#2d5016" />
              {/* Curb edge arcs (white) */}
              <path d="M 400 326 A 16 16 0 0 0 384 310" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
              <path d="M 484 310 A 16 16 0 0 0 500 326" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
              {/* T-bar "road ends" striping at the bottom of the north arm */}
              <rect x="400" y="398" width="100" height="10" fill="rgba(240,180,0,0.22)" rx="2" />
              <line x1="420" y1="402" x2="480" y2="402" stroke="rgba(255,200,0,0.55)" strokeWidth="2" strokeDasharray="8 6" />
            </g>
          )}

          {/* ── 4-Way: corner curb fillets ── */}
          {displayScene.intersectionType === "4way" && (
            <g>
              {/* NW corner */}
              <path d="M 390 300 L 390 316 A 16 16 0 0 1 374 300 Z" fill="#2d5016" />
              <path d="M 390 316 A 16 16 0 0 0 374 300" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
              {/* NE corner */}
              <path d="M 510 300 L 494 300 A 16 16 0 0 1 510 316 Z" fill="#2d5016" />
              <path d="M 494 300 A 16 16 0 0 0 510 316" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
              {/* SW corner */}
              <path d="M 390 420 L 374 420 A 16 16 0 0 1 390 404 Z" fill="#2d5016" />
              <path d="M 374 420 A 16 16 0 0 0 390 404" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
              {/* SE corner */}
              <path d="M 510 420 L 510 404 A 16 16 0 0 1 526 420 Z" fill="#2d5016" />
              <path d="M 510 404 A 16 16 0 0 0 526 420" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
            </g>
          )}

          {/* ── Lamp posts at junction corners ── */}
          {displayScene.intersectionType === "4way" && (
            <g opacity="0.85">
              {[{ x: 378, y: 290 }, { x: 522, y: 290 }, { x: 378, y: 430 }, { x: 522, y: 430 }].map((p, i) => (
                <g key={`lamp-${i}`}>
                  <rect x={p.x - 1} y={p.y} width="2" height="18" fill="#8a8a90" rx="1" />
                  <circle cx={p.x} cy={p.y} r="4" fill="#d4b850" opacity="0.9" />
                  <circle cx={p.x} cy={p.y} r="7" fill="rgba(212,184,80,0.15)" />
                </g>
              ))}
            </g>
          )}
          {displayScene.intersectionType === "3way" && (
            <g opacity="0.85">
              {[{ x: 390, y: 300 }, { x: 510, y: 300 }, { x: 378, y: 420 }, { x: 522, y: 420 }].map((p, i) => (
                <g key={`lamp3-${i}`}>
                  <rect x={p.x - 1} y={p.y} width="2" height="18" fill="#8a8a90" rx="1" />
                  <circle cx={p.x} cy={p.y} r="4" fill="#d4b850" opacity="0.9" />
                  <circle cx={p.x} cy={p.y} r="7" fill="rgba(212,184,80,0.15)" />
                </g>
              ))}
            </g>
          )}
          {displayScene.intersectionType === "2way" && (
            <g opacity="0.85">
              {[{ x: 360, y: 280 }, { x: 540, y: 280 }, { x: 360, y: 450 }, { x: 540, y: 450 }].map((p, i) => (
                <g key={`lamp2-${i}`}>
                  <rect x={p.x - 1} y={p.y} width="2" height="18" fill="#8a8a90" rx="1" />
                  <circle cx={p.x} cy={p.y} r="4" fill="#d4b850" opacity="0.9" />
                  <circle cx={p.x} cy={p.y} r="7" fill="rgba(212,184,80,0.15)" />
                </g>
              ))}
            </g>
          )}
          {roadTexture.map((texture) => (
            <line
              key={texture.id}
              stroke="rgba(255,255,255,0.035)"
              strokeWidth="1"
              x1="0"
              x2="900"
              y1={texture.y}
              y2={texture.y}
            />
          ))}
          {displayScene.roadEdges.map((line) => (
            <line
              key={line.id}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth}
              x1={line.x1}
              x2={line.x2}
              y1={line.y1}
              y2={line.y2}
            />
          ))}
          {displayScene.laneDividers.map((line) => (
            <line
              key={line.id}
              stroke={line.stroke}
              strokeDasharray={line.dashArray}
              strokeWidth={line.strokeWidth}
              x1={line.x1}
              x2={line.x2}
              y1={line.y1}
              y2={line.y2}
            />
          ))}
          {displayScene.stopLines.map((line) => (
            <line
              key={line.id}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth}
              x1={line.x1}
              x2={line.x2}
              y1={line.y1}
              y2={line.y2}
            />
          ))}
          {displayScene.crosswalks.flatMap((crosswalk) =>
            crosswalk.stripes.map((stripe, index) => (
              <rect
                fill={crosswalk.state === "walk" ? "rgba(170,255,190,0.86)" : "rgba(255,255,255,0.82)"}
                height={stripe.height}
                key={`${crosswalk.id}-${index}`}
                width={stripe.width}
                x={stripe.x}
                y={stripe.y}
              />
            )),
          )}

          {displayScene.debug
            ? displayScene.debugPaths.map((path) => (
            <polyline
              key={path.id}
              fill="none"
              points={path.points.map((point) => `${point.x},${point.y}`).join(" ")}
              stroke={path.color}
              strokeDasharray="8 8"
              strokeWidth="2"
            />
              ))
            : null}

          {displayScene.debug
            ? displayScene.debugStops.map((stop) => (
            <g key={stop.id} transform={`translate(${stop.x} ${stop.y})`}>
              <circle fill={stop.reserved ? "rgba(255,99,71,0.78)" : "rgba(52,199,89,0.72)"} r="4" />
              <text fill="rgba(255,255,255,0.76)" fontSize="7" textAnchor="middle" x="0" y="-8">
                {stop.label}
              </text>
            </g>
              ))
            : null}

          {displayLanes.map((lane) => (
            <g key={lane.id}>
              {drawLaneVehicles(lane)}
              {displayScene.debug
                ? lane.vehicles.map((vehicle) => (
                    <g key={`${vehicle.id}-debug`} transform={`translate(${vehicle.x} ${vehicle.y}) rotate(${vehicle.displayHeading})`}>
                      <g transform={`rotate(${-vehicle.displayHeading}) translate(0 0)`}>
                        <rect fill="rgba(12,16,20,0.76)" height={26} rx={3} width={90} x={-45} y={10} />
                        <text fill="rgba(255,255,255,0.86)" fontSize="7" textAnchor="middle" x="0" y="17">
                          {`${lane.id}/${vehicle.movementLane}/${vehicle.intent} ${vehicle.state}`}
                        </text>
                        <text fill="rgba(205,214,224,0.82)" fontSize="6.5" textAnchor="middle" x="0" y="24">
                          {`${vehicle.pathId} p${vehicle.progress.toFixed(0)} gap:${Number.isFinite(vehicle.gapToLeader) ? vehicle.gapToLeader.toFixed(0) : "--"}`}
                        </text>
                        <text fill="rgba(205,214,224,0.74)" fontSize="6.5" textAnchor="middle" x="0" y="31">
                          {`${vehicle.waitReason}${vehicle.leadVehicleId ? ` lead:${vehicle.leadVehicleId.split("-").slice(-1)[0]}` : ""}`}
                        </text>
                      </g>
                    </g>
                  ))
                : null}
            </g>
          ))}

          {displayPedestrians.map((pedestrian) => {
            const strideSeed = (hashNumber(pedestrian.id) % 7) / 7;
            const stride = Math.sin((pedestrian.progress * 10 + strideSeed) * Math.PI * 2);
            const armSwing = stride * 2.1;
            const legSwing = stride * 2.7;
            const torsoTilt = pedestrian.committed ? stride * 1.4 : stride * 0.7;
            const bodyScale = pedestrian.committed ? 1.03 : pedestrian.state === "waiting" ? 0.96 : 1;
            return (
              <g key={pedestrian.id} transform={`translate(${pedestrian.x} ${pedestrian.y}) rotate(${pedestrian.heading}) scale(${bodyScale})`}>
                <ellipse cx="1" cy="6.5" fill="rgba(0,0,0,0.16)" rx="5.8" ry="3.1" />
                <g transform={`rotate(${torsoTilt})`}>
                  <line stroke={darken(pedestrian.color, 0.1)} strokeLinecap="round" strokeWidth="1.7" x1="-1.8" x2={-1.8 - armSwing} y1="1.2" y2="5.4" />
                  <line stroke={darken(pedestrian.color, 0.1)} strokeLinecap="round" strokeWidth="1.7" x1="1.8" x2={1.8 + armSwing} y1="1.2" y2="5.4" />
                  <ellipse cx="0" cy="1.8" fill={pedestrian.color} rx="4.3" ry="5.4" />
                  <rect fill="rgba(255,255,255,0.18)" height="3.8" rx="1.3" width="2.2" x="-1.1" y="1.4" />
                  <circle cx="0" cy="-4" fill="#f1c27d" r="3.35" />
                  <line stroke="#3f2d23" strokeLinecap="round" strokeWidth="1.5" x1="-1.2" x2={-2.3 - legSwing} y1="6.2" y2="10.8" />
                  <line stroke="#3f2d23" strokeLinecap="round" strokeWidth="1.5" x1="1.2" x2={2.3 + legSwing} y1="6.2" y2="10.8" />
                </g>
              </g>
            );
          })}

          {displayScene.signals.map((signal) => (
            <g key={signal.id}>
              <rect fill="rgba(90,90,96,0.9)" height="34" rx="1.5" width="3" x={signal.x - 1.5} y={signal.y + 22} />
              <rect fill="#101010" height="54" rx="6" width="18" x={signal.x - 9} y={signal.y - 27} />
              <circle cx={signal.x} cy={signal.y - 16} fill={signal.red === "#ff3b30" ? "rgba(255,59,48,0.18)" : "transparent"} r="8" />
              <circle cx={signal.x} cy={signal.y} fill={signal.amber === "#ff9500" ? "rgba(255,149,0,0.18)" : "transparent"} r="8" />
              <circle cx={signal.x} cy={signal.y + 16} fill={signal.green === "#34c759" ? "rgba(52,199,89,0.18)" : "transparent"} r="8" />
              <circle cx={signal.x} cy={signal.y - 16} fill={signal.red} r="5" />
              <circle cx={signal.x} cy={signal.y} fill={signal.amber} r="5" />
              <circle cx={signal.x} cy={signal.y + 16} fill={signal.green} r="5" />
            </g>
          ))}
          <circle cx="450" cy="360" fill="rgba(18,18,20,0.38)" r="6" />
          {weatherOverlay(displayScene)}
          <rect fill="url(#vignette)" height="720" width="900" x="0" y="0" />
        </svg>
      </div>
    </div>
  );
}
