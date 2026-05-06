"use client";

import { useEffect, useRef, useState, RefObject, useCallback } from "react";

import type { FrameBuffer } from "@/lib/hooks/use-simulation-worker";
import type {
  SceneCrosswalkSnapshot,
  SceneLineSnapshot,
  ScenePedestrianSnapshot,
  SceneRoadRectSnapshot,
  SceneSignalSnapshot,
  SceneSnapshot,
  SceneVehicleSnapshot,
} from "@/lib/simulation/domain/snapshots";

// ─── coordinate space ────────────────────────────────────────────────────────
const W = 900;
const H = 720;
const TICK_MS = 50;
const TWO_PI = Math.PI * 2;

// ─── lane arrow data (exact positions from intersection-layout.ts) ───────────
// heading = direction vehicles TRAVEL (0=east/right, 90=south/down, 180=west/left, 270=north/up)
type ArrowDef = { x: number; y: number; heading: number; intent: "left" | "straight" | "right" };

const ARROWS_4WAY: ArrowDef[] = [
  // North approach (traveling south ↓, heading=90)
  { x: 438, y: 210, heading: 90,  intent: "left"     },
  { x: 402, y: 210, heading: 90,  intent: "straight"  },
  { x: 402, y: 230, heading: 90,  intent: "right"     },
  // South approach (traveling north ↑, heading=270)
  { x: 462, y: 508, heading: 270, intent: "left"      },
  { x: 498, y: 508, heading: 270, intent: "straight"  },
  { x: 498, y: 490, heading: 270, intent: "right"     },
  // East approach (traveling west ←, heading=180)
  { x: 616, y: 348, heading: 180, intent: "left"      },
  { x: 616, y: 318, heading: 180, intent: "straight"  },
  { x: 598, y: 318, heading: 180, intent: "right"     },
  // West approach (traveling east →, heading=0)
  { x: 284, y: 372, heading: 0,   intent: "left"      },
  { x: 284, y: 402, heading: 0,   intent: "straight"  },
  { x: 302, y: 402, heading: 0,   intent: "right"     },
];

const ARROWS_2WAY: ArrowDef[] = [
  { x: 430, y: 210, heading: 90,  intent: "straight" },
  { x: 390, y: 210, heading: 90,  intent: "straight" },
  { x: 470, y: 508, heading: 270, intent: "straight" },
  { x: 510, y: 508, heading: 270, intent: "straight" },
];

const ARROWS_3WAY: ArrowDef[] = [
  { x: 438, y: 210, heading: 90,  intent: "left"    },
  { x: 402, y: 210, heading: 90,  intent: "right"   },
  { x: 616, y: 318, heading: 180, intent: "straight"},
  { x: 616, y: 318, heading: 180, intent: "right"   },
  { x: 284, y: 402, heading: 0,   intent: "straight"},
  { x: 284, y: 372, heading: 0,   intent: "left"    },
];

// ─── static environment ──────────────────────────────────────────────────────
const TREES = [
  { x: 180, y: 130, r: 28 }, { x: 720, y: 130, r: 28 },
  { x: 180, y: 590, r: 28 }, { x: 720, y: 590, r: 28 },
  { x:  85, y: 355, r: 20 }, { x: 815, y: 355, r: 20 },
  { x: 120, y: 220, r: 16 }, { x: 780, y: 220, r: 16 },
  { x: 120, y: 500, r: 16 }, { x: 780, y: 500, r: 16 },
  { x:  60, y: 130, r: 14 }, { x: 840, y: 590, r: 14 },
];

// ─── math ────────────────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function lerpAngle(a: number, b: number, t: number) {
  const diff = ((b - a + 180) % 360 + 360) % 360 - 180;
  return a + diff * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  const s = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
}

function darken(color: string, amount: number) {
  if (!color.startsWith("#")) return color;
  const [r, g, b] = hexToRgb(color);
  const f = 1 - amount;
  return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
}

// ─── drawing: environment ─────────────────────────────────────────────────────
function drawBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#283d12";
  ctx.fillRect(0, 0, W, H);
  // subtle ground texture
  ctx.fillStyle = "rgba(255,255,255,0.018)";
  for (let x = 0; x < W; x += 42) {
    for (let y = 0; y < H; y += 42) {
      if ((x + y) % 84 === 0) ctx.fillRect(x, y, 40, 40);
    }
  }
}

function drawTrees(ctx: CanvasRenderingContext2D) {
  for (const t of TREES) {
    ctx.fillStyle = "rgba(10,20,5,0.32)";
    ctx.beginPath();
    ctx.ellipse(t.x + 5, t.y + 8, t.r * 1.1, t.r * 0.55, 0, 0, TWO_PI);
    ctx.fill();
    // outer canopy
    ctx.fillStyle = "#2a5c09";
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TWO_PI); ctx.fill();
    // inner lighter zone
    ctx.fillStyle = "#3a7c0e";
    ctx.beginPath(); ctx.arc(t.x - t.r*0.18, t.y - t.r*0.18, t.r*0.62, 0, TWO_PI); ctx.fill();
    // highlight
    ctx.fillStyle = "rgba(100,200,40,0.22)";
    ctx.beginPath(); ctx.arc(t.x - t.r*0.28, t.y - t.r*0.28, t.r*0.38, 0, TWO_PI); ctx.fill();
  }
}

function drawRoads(ctx: CanvasRenderingContext2D, roads: SceneRoadRectSnapshot[]) {
  for (const road of roads) {
    ctx.fillStyle = road.fill;
    ctx.fillRect(road.x, road.y, road.width, road.height);
  }
  // subtle road texture overlay
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  for (const road of roads) {
    for (let i = 0; i < road.width; i += 18) {
      ctx.fillRect(road.x + i, road.y, 1, road.height);
    }
  }
}

function drawLine(ctx: CanvasRenderingContext2D, line: SceneLineSnapshot) {
  ctx.beginPath();
  ctx.strokeStyle = line.stroke;
  ctx.lineWidth   = line.strokeWidth;
  if (line.dashArray) {
    ctx.setLineDash(line.dashArray.split(" ").map(Number));
  } else {
    ctx.setLineDash([]);
  }
  ctx.moveTo(line.x1, line.y1);
  ctx.lineTo(line.x2, line.y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCrosswalk(ctx: CanvasRenderingContext2D, cw: SceneCrosswalkSnapshot) {
  const walk = cw.state === "walk";
  // Walk-phase glow under crosswalk
  if (walk) {
    ctx.fillStyle = "rgba(60,210,120,0.12)";
    for (const s of cw.stripes) ctx.fillRect(s.x - 3, s.y - 3, s.width + 6, s.height + 6);
  }
  ctx.fillStyle = walk ? "rgba(255,255,255,0.90)" : "rgba(190,190,190,0.40)";
  for (const s of cw.stripes) ctx.fillRect(s.x, s.y, s.width, s.height);
}

// ─── drawing: lane arrows ─────────────────────────────────────────────────────
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  heading: number,         // world degrees: 0=east 90=south 180=west 270=north
  intent: "left" | "straight" | "right",
) {
  ctx.save();
  ctx.translate(x, y);
  // heading 0 = east → our local "forward" is +x. Rotate so forward matches heading.
  ctx.rotate((heading + 90) * Math.PI / 180); // +90 because we draw arrow pointing "up" locally

  ctx.fillStyle   = "rgba(255,255,255,0.36)";
  ctx.strokeStyle = "rgba(255,255,255,0.36)";
  ctx.lineWidth   = 1.6;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  if (intent === "straight") {
    // shaft
    ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(0, -5); ctx.stroke();
    // head
    ctx.beginPath(); ctx.moveTo(-3.5, -3); ctx.lineTo(0, -10); ctx.lineTo(3.5, -3); ctx.closePath(); ctx.fill();

  } else if (intent === "left") {
    // curved shaft
    ctx.beginPath();
    ctx.moveTo(0, 11); ctx.lineTo(0, 2);
    ctx.quadraticCurveTo(0, -5, -8, -5);
    ctx.stroke();
    // head pointing left
    ctx.beginPath(); ctx.moveTo(-6, -1.5); ctx.lineTo(-11, -5); ctx.lineTo(-6, -8.5); ctx.closePath(); ctx.fill();

  } else {
    // curved shaft right
    ctx.beginPath();
    ctx.moveTo(0, 11); ctx.lineTo(0, 2);
    ctx.quadraticCurveTo(0, -5, 8, -5);
    ctx.stroke();
    // head pointing right
    ctx.beginPath(); ctx.moveTo(6, -1.5); ctx.lineTo(11, -5); ctx.lineTo(6, -8.5); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawLaneArrows(ctx: CanvasRenderingContext2D, intersectionType: string) {
  const arrows =
    intersectionType === "4way" ? ARROWS_4WAY :
    intersectionType === "2way" ? ARROWS_2WAY : ARROWS_3WAY;
  for (const a of arrows) drawArrow(ctx, a.x, a.y, a.heading, a.intent);
}

// ─── drawing: traffic signals ─────────────────────────────────────────────────
function drawSignal(ctx: CanvasRenderingContext2D, signal: SceneSignalSnapshot) {
  const bw = 20;
  const bh = 52;
  const bx = signal.x - bw / 2;
  const by = signal.y - bh / 2;

  // Pole
  ctx.strokeStyle = "#222";
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.moveTo(signal.x, signal.y + bh / 2);
  ctx.lineTo(signal.x, signal.y + bh / 2 + 18);
  ctx.stroke();

  // Housing shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.roundRect(bx + 2, by + 2, bw, bh, 4);
  ctx.fill();

  // Housing
  ctx.fillStyle = "#111";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 4);
  ctx.fill(); ctx.stroke();

  const lights = [
    { color: signal.red,   cy: by + 10 },
    { color: signal.amber, cy: by + 26 },
    { color: signal.green, cy: by + 42 },
  ];

  for (const light of lights) {
    const active = light.color !== "#2a2a2a";
    // lens housing
    ctx.fillStyle = "#0a0a0a";
    ctx.beginPath(); ctx.arc(signal.x, light.cy, 7.5, 0, TWO_PI); ctx.fill();
    // bulb
    if (active) {
      ctx.shadowColor = light.color;
      ctx.shadowBlur  = 14;
    }
    ctx.fillStyle = light.color;
    ctx.beginPath(); ctx.arc(signal.x, light.cy, 5.5, 0, TWO_PI); ctx.fill();
    ctx.shadowBlur = 0;
    // lens glare
    if (active) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath(); ctx.arc(signal.x - 1.5, light.cy - 1.5, 2, 0, TWO_PI); ctx.fill();
    }
  }
}

// ─── drawing: pedestrians (human silhouette) ──────────────────────────────────
function drawPedestrian(
  ctx: CanvasRenderingContext2D,
  ped: ScenePedestrianSnapshot,
  x: number, y: number,
  heading: number,         // degrees, direction of movement
  walkPhase: number,       // 0–1 leg-swing cycle
) {
  const active = ped.state === "crossing" || ped.state === "finishing" || ped.state === "starting";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading + 90) * Math.PI / 180); // face direction of travel

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(1.5, 10, 4.5, 2, 0, 0, TWO_PI);
  ctx.fill();

  // Legs (walking animation)
  const swing = active ? Math.sin(walkPhase * TWO_PI) * 4 : 0;
  ctx.strokeStyle = darken(ped.color, 0.3);
  ctx.lineWidth   = 2.2;
  ctx.lineCap     = "round";
  // left leg
  ctx.beginPath(); ctx.moveTo(-1, 4); ctx.lineTo(-1.5 - swing, 11); ctx.stroke();
  // right leg
  ctx.beginPath(); ctx.moveTo( 1, 4); ctx.lineTo( 1.5 + swing, 11); ctx.stroke();

  // Arms
  ctx.strokeStyle = ped.color;
  ctx.lineWidth   = 1.6;
  ctx.beginPath(); ctx.moveTo(-1.5, -3); ctx.lineTo(-4   + swing * 0.5, 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( 1.5, -3); ctx.lineTo( 4   - swing * 0.5, 3); ctx.stroke();

  // Torso
  ctx.fillStyle = ped.color;
  ctx.beginPath();
  ctx.roundRect(-3, -5, 6, 9, 1.5);
  ctx.fill();

  // Head (skin tone — lighten the color slightly)
  const [r, g, b] = hexToRgb(ped.color.startsWith("#") ? ped.color : "#f4a460");
  ctx.fillStyle = `rgb(${Math.min(255, r + 30)},${Math.min(255, g + 20)},${Math.min(255, b + 10)})`;
  ctx.beginPath(); ctx.arc(0, -8, 3.2, 0, TWO_PI); ctx.fill();

  ctx.restore();
}

// ─── drawing: vehicles ────────────────────────────────────────────────────────
function drawVehicle(
  ctx: CanvasRenderingContext2D,
  vehicle: SceneVehicleSnapshot,
  x: number, y: number, heading: number,
) {
  const bl = vehicle.bodyLength ?? 24;
  const bw = vehicle.bodyWidth  ?? 13;
  const hw = bl / 2;
  const hh = bw / 2;
  const isTruck   = bl >= 30;
  const isCompact = bl <= 21;
  const radius    = isTruck ? 2.5 : isCompact ? 3.5 : 4;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading * Math.PI / 180);

  // Ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.beginPath();
  ctx.ellipse(hw * 0.06, hh * 0.65, hw * 0.88, hh * 0.42, 0, 0, TWO_PI);
  ctx.fill();

  // Body
  ctx.fillStyle   = vehicle.color;
  ctx.strokeStyle = "rgba(5,10,15,0.55)";
  ctx.lineWidth   = 0.9;
  ctx.beginPath(); ctx.roundRect(-hw, -hh, bl, bw, radius); ctx.fill(); ctx.stroke();

  if (isTruck) {
    // Cab box (front half)
    ctx.fillStyle = darken(vehicle.color, 0.25);
    ctx.beginPath(); ctx.roundRect(hw * 0.3, -hh * 0.78, hw * 0.66, bw * 0.78, 2); ctx.fill();
    // Cargo divider line
    ctx.strokeStyle = "rgba(0,0,0,0.30)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hw * 0.28, -hh); ctx.lineTo(hw * 0.28, hh); ctx.stroke();
  } else {
    // Roofline
    const roofW = isCompact ? hw * 0.78 : hw * 0.72;
    ctx.fillStyle = darken(vehicle.color, 0.24);
    ctx.beginPath(); ctx.roundRect(-hw * 0.08, -hh * 0.75, roofW, bw * 0.75, 3); ctx.fill();
  }

  // Windshield (front glass)
  ctx.fillStyle = "rgba(200,228,248,0.85)";
  ctx.beginPath(); ctx.roundRect(hw * 0.14, -hh * 0.52, hw * 0.56, bw * 0.52, 2); ctx.fill();

  // Rear window
  ctx.fillStyle = "rgba(125,150,170,0.75)";
  ctx.beginPath(); ctx.roundRect(-hw * 0.76, -hh * 0.48, hw * 0.46, bw * 0.48, 1.5); ctx.fill();

  // Headlights (front)
  ctx.fillStyle = vehicle.brakeLights ? "rgba(240,230,180,0.55)" : "rgba(255,248,200,0.95)";
  ctx.fillRect(hw - bl * 0.10, -hh * 0.58, bl * 0.10, bw * 0.22);
  ctx.fillRect(hw - bl * 0.10,  hh * 0.30, bl * 0.10, bw * 0.22);

  // Tail lights (rear)
  if (vehicle.brakeLights) {
    ctx.shadowColor = "#ff2200"; ctx.shadowBlur = 10;
    ctx.fillStyle   = "#ff3b30";
  } else {
    ctx.fillStyle   = "rgba(140,20,10,0.65)";
  }
  ctx.fillRect(-hw,  -hh * 0.58, bl * 0.10, bw * 0.22);
  ctx.fillRect(-hw,   hh * 0.30, bl * 0.10, bw * 0.22);
  ctx.shadowBlur = 0;

  // Emergency lightbar
  if (vehicle.emergencyType) {
    const barW = bl * 0.34;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.beginPath(); ctx.roundRect(-barW/2, -hh - 3, barW, 3, 1.5); ctx.fill();
    ctx.fillStyle = "#3399ff";
    ctx.beginPath(); ctx.roundRect(-barW/2 + 1, -hh - 2.7, barW * 0.46, 2.4, 0.8); ctx.fill();
    ctx.fillStyle = "#ff3333";
    ctx.beginPath(); ctx.roundRect(barW * 0.02, -hh - 2.7, barW * 0.46, 2.4, 0.8); ctx.fill();
    // ring
    const ringColor = vehicle.emergencyDetected ? "rgba(255,220,0,0.92)" : "rgba(255,255,255,0.35)";
    ctx.strokeStyle = ringColor; ctx.lineWidth = vehicle.emergencyDetected ? 1.6 : 1;
    if (vehicle.emergencyDetected) { ctx.shadowColor = "rgba(255,220,0,0.6)"; ctx.shadowBlur = 8; }
    ctx.beginPath(); ctx.roundRect(-hw - 1.8, -hh - 1.8, bl + 3.6, bw + 3.6, radius + 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// ─── drawing: weather & atmosphere ───────────────────────────────────────────
function drawWeather(ctx: CanvasRenderingContext2D, weather: string) {
  if (weather === "rain") {
    ctx.fillStyle = "rgba(20,38,62,0.20)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(200,220,245,0.45)";
    ctx.lineWidth   = 0.8;
    for (let i = 0; i < 48; i++) {
      const x = (i * 20) % W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 12, H); ctx.stroke();
    }
  } else if (weather === "fog") {
    ctx.fillStyle = "rgba(215,222,232,0.22)";
    ctx.fillRect(0, 0, W, H);
  } else if (weather === "night") {
    ctx.fillStyle = "rgba(6,10,22,0.35)";
    ctx.fillRect(0, 0, W, H);
  }
}

function drawVignette(ctx: CanvasRenderingContext2D) {
  const g = ctx.createRadialGradient(W/2, H/2, W*0.36, W/2, H/2, W*0.74);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(4,8,14,0.32)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawDebugPaths(ctx: CanvasRenderingContext2D, scene: SceneSnapshot) {
  if (!scene.debug) return;
  for (const path of scene.debugPaths) {
    if (path.points.length < 2) continue;
    ctx.strokeStyle = path.color;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ─── main render ─────────────────────────────────────────────────────────────
type VehicleState = { x: number; y: number };
type PedState     = { x: number; y: number; heading: number; walkPhase: number };

function renderFrame(
  ctx: CanvasRenderingContext2D,
  buf: FrameBuffer,
  prevVehicles:    Map<string, VehicleState>,
  prevPedestrians: Map<string, PedState>,
  vehicleHeadings: Map<string, number>,
  dt: number,              // real elapsed ms since last rAF call
) {
  const { current } = buf;
  if (!current) return;

  const elapsed = performance.now() - current.ts;
  const t = Math.min(1, elapsed / TICK_MS);
  const scene = current.scene;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();

  drawBackground(ctx);
  drawTrees(ctx);
  drawRoads(ctx, scene.roads);
  drawLaneArrows(ctx, scene.intersectionType);
  for (const line of scene.laneDividers) drawLine(ctx, line);
  for (const line of scene.roadEdges)    drawLine(ctx, line);
  for (const line of scene.stopLines)    drawLine(ctx, line);
  for (const cw of scene.crosswalks)     drawCrosswalk(ctx, cw);

  // Pedestrians
  const nextPedState = new Map<string, PedState>();
  for (const ped of scene.pedestrians) {
    const prev = prevPedestrians.get(ped.id);
    const x = prev ? lerp(prev.x, ped.x, t) : ped.x;
    const y = prev ? lerp(prev.y, ped.y, t) : ped.y;
    const moving = prev && (Math.abs(ped.x - prev.x) + Math.abs(ped.y - prev.y)) > 0.08;
    const rawHeading = prev && moving
      ? Math.atan2(ped.y - prev.y, ped.x - prev.x) * 180 / Math.PI - 90
      : (prev?.heading ?? 0);
    const heading   = prev ? lerpAngle(prev.heading, rawHeading, 0.2) : rawHeading;
    // Walk phase: advance only when actually moving
    const walkPhase = prev
      ? (prev.walkPhase + (moving ? dt / 380 : 0)) % 1
      : 0;
    nextPedState.set(ped.id, { x, y, heading, walkPhase });
    drawPedestrian(ctx, ped, x, y, heading, walkPhase);
  }

  // Vehicles
  const nextVehicleState = new Map<string, VehicleState>();
  for (const lane of scene.lanes) {
    for (const vehicle of lane.vehicles) {
      const prev    = prevVehicles.get(vehicle.id);
      const x       = prev ? lerp(prev.x, vehicle.x, t) : vehicle.x;
      const y       = prev ? lerp(prev.y, vehicle.y, t) : vehicle.y;
      const prevH   = vehicleHeadings.get(vehicle.id) ?? vehicle.heading;
      const heading = lerpAngle(prevH, vehicle.heading, Math.min(1, t * 1.5));
      vehicleHeadings.set(vehicle.id, heading);
      nextVehicleState.set(vehicle.id, { x, y });
      drawVehicle(ctx, vehicle, x, y, heading);
    }
  }

  for (const signal of scene.signals) drawSignal(ctx, signal);
  drawDebugPaths(ctx, scene);
  drawWeather(ctx, scene.weatherMode);
  drawVignette(ctx);
  ctx.restore();

  // Swap state maps by reference
  prevVehicles.clear();
  for (const [k, v] of nextVehicleState) prevVehicles.set(k, v);
  prevPedestrians.clear();
  for (const [k, v] of nextPedState) prevPedestrians.set(k, v);
  // Prune stale headings
  for (const id of vehicleHeadings.keys()) {
    if (!nextVehicleState.has(id)) vehicleHeadings.delete(id);
  }
}

// ─── component ────────────────────────────────────────────────────────────────
type Props = {
  frameRef: RefObject<FrameBuffer>;
  caption?: string;
  mode?: "full" | "monitor";
};

export function TrafficCanvas({ frameRef, caption, mode = "full" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    // Responsive canvas: fills its CSS container and letterboxes the 900×720 scene
    let transform = { sx: 1, sy: 1, ox: 0, oy: 0 };

    const resize = () => {
      const dpr  = window.devicePixelRatio || 1;
      const cw   = canvas.clientWidth;
      const ch   = canvas.clientHeight;
      canvas.width  = cw * dpr;
      canvas.height = ch * dpr;
      const scale   = Math.min(cw / W, ch / H);
      const ox      = (cw - W * scale) / 2;
      const oy      = (ch - H * scale) / 2;
      transform = { sx: scale * dpr, sy: scale * dpr, ox: ox * dpr, oy: oy * dpr };
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const prevVehicles    = new Map<string, VehicleState>();
    const prevPedestrians = new Map<string, PedState>();
    const vehicleHeadings = new Map<string, number>();
    let lastTime = performance.now();
    let rafId = 0;

    const loop = () => {
      const now = performance.now();
      const dt  = now - lastTime;
      lastTime  = now;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(transform.sx, 0, 0, transform.sy, transform.ox, transform.oy);
      renderFrame(ctx, frameRef.current, prevVehicles, prevPedestrians, vehicleHeadings, dt);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
  }, [frameRef]);

  return (
    <div className={`scene-root ${isFullscreen ? "is-fullscreen" : ""}`} ref={wrapperRef}>
      <div className="scene-caption-bar">
        {caption && <div className="scene-caption">{caption}</div>}
        {mode === "full" && (
          <button className="fullscreen-btn" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {isFullscreen ? "⛶" : "⛶"}
            <span>{isFullscreen ? "Exit" : "Fullscreen"}</span>
          </button>
        )}
      </div>
      <div className="scene-wrapper">
        <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}
