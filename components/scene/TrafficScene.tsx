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
    return 90;
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

function drawLaneVehicles(lane: DisplayLane) {
  return lane.vehicles.map((vehicle) => (
    <g key={vehicle.id} transform={`translate(${vehicle.x} ${vehicle.y}) rotate(${vehicle.displayHeading})`}>
      <ellipse cx="1" cy="8" fill="rgba(0,0,0,0.14)" rx="11" ry="4.5" />
      <rect
        fill={vehicle.color}
        height={14}
        opacity={vehicle.committed ? 1 : 0.97}
        rx={4}
        ry={4}
        stroke="rgba(8,12,18,0.44)"
        strokeWidth="0.8"
        width={26}
        x={-13}
        y={-7}
      />
      <rect fill={darken(vehicle.color, 0.26)} height={9} rx={3} ry={3} width={15} x={-4} y={-4.5} />
      <rect fill="rgba(232,238,245,0.9)" height={5} rx={2} ry={2} width={7} x={4.8} y={-2.5} />
      <rect fill="rgba(136,148,164,0.82)" height={4.5} rx={2} ry={2} width={5.5} x={-8.8} y={-2.25} />
      <rect fill="rgba(255,255,255,0.12)" height={10} rx={3} width={2} x={-10} y={-5} />
      {vehicle.emergencyType ? (
        <>
          <rect fill="rgba(255,255,255,0.9)" height={2.4} rx={1.1} width={8} x={-1.5} y={-6.8} />
          <rect fill="#4aa3ff" height={1.9} rx={0.9} width={3.3} x={-1.1} y={-6.55} />
          <rect fill="#ff4d4d" height={1.9} rx={0.9} width={3.3} x={2.0} y={-6.55} />
          <rect
            fill="none"
            height={16.4}
            rx={4.6}
            ry={4.6}
            stroke={vehicle.emergencyDetected ? "rgba(255,215,0,0.85)" : "rgba(255,255,255,0.42)"}
            strokeWidth={vehicle.emergencyDetected ? 1.3 : 1}
            width={28.4}
            x={-14.2}
            y={-8.2}
          />
        </>
      ) : null}
      {vehicle.brakeLights ? (
        <>
          <rect fill="#ff4d4d" height={2.5} rx={1} width={3} x={-11.5} y={-4.5} />
          <rect fill="#ff4d4d" height={2.5} rx={1} width={3} x={-11.5} y={2} />
        </>
      ) : null}
    </g>
  ));
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
              const nextX = routePose?.point.x ?? existing.x + (vehicle.x - existing.x) * alpha;
              const nextY = routePose?.point.y ?? existing.y + (vehicle.y - existing.y) * alpha;
              const targetHeading = routePose?.heading ?? vehicle.heading;
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
          const nextHeading = smoothAngle(existing.heading, headingFromVector(pedestrian.x - existing.x, pedestrian.y - existing.y), 0.18);
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
              <stop offset="100%" stopColor="rgba(6,10,16,0.26)" />
            </radialGradient>
          </defs>
          <rect fill="#2d5016" height="720" width="900" x="0" y="0" />
          <ellipse cx="184" cy="136" fill="rgba(12,25,8,0.28)" rx="30" ry="18" />
          <ellipse cx="724" cy="136" fill="rgba(12,25,8,0.28)" rx="30" ry="18" />
          <ellipse cx="184" cy="596" fill="rgba(12,25,8,0.28)" rx="30" ry="18" />
          <ellipse cx="724" cy="596" fill="rgba(12,25,8,0.28)" rx="30" ry="18" />
          <circle cx="180" cy="130" fill="#2d6a0a" r="28" />
          <circle cx="720" cy="130" fill="#2d6a0a" r="28" />
          <circle cx="180" cy="590" fill="#2d6a0a" r="28" />
          <circle cx="720" cy="590" fill="#2d6a0a" r="28" />
          {displayScene.roads.map((road) => (
            <rect key={road.id} fill={road.fill} height={road.height} width={road.width} x={road.x} y={road.y} />
          ))}
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

          {displayPedestrians.map((pedestrian) => (
            <g key={pedestrian.id} transform={`translate(${pedestrian.x} ${pedestrian.y}) rotate(${pedestrian.heading})`}>
              <ellipse cx="1" cy="5" fill="rgba(0,0,0,0.18)" rx="5.5" ry="3.2" />
              <ellipse cx="0" cy="3.2" fill={pedestrian.color} rx="4.2" ry="5.2" />
              <circle cx="0" cy="-3.2" fill="#f1c27d" r="3.4" />
              <rect fill="rgba(255,255,255,0.15)" height="3.5" rx="1.2" width="2.4" x="-1.2" y="2.4" />
            </g>
          ))}

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
