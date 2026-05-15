"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type {
  SceneBuildingSnapshot,
  SceneLineSnapshot,
  SceneSnapshot,
  SceneVehicleSnapshot,
} from "@/lib/simulation/domain/snapshots";

type Props = {
  scene: SceneSnapshot;
  caption?: string;
  mode?: "full" | "monitor";
};

type VehicleObject = {
  group: THREE.Group;
  target: THREE.Vector3;
  heading: number;
  rearMat: THREE.MeshBasicMaterial;
  tailGlowMat: THREE.MeshBasicMaterial;
};

type WalkerObject = {
  group: THREE.Group;
  target: THREE.Vector3;
  heading: number;
  fadeMeshes: THREE.Mesh[];
};

type SignalObject = {
  group: THREE.Group;
  red: THREE.MeshBasicMaterial;
  amber: THREE.MeshBasicMaterial;
  green: THREE.MeshBasicMaterial;
  redGlow: THREE.SpriteMaterial;
  amberGlow: THREE.SpriteMaterial;
  greenGlow: THREE.SpriteMaterial;
  lamp: THREE.PointLight;
};

const SCENE_W = 900;
const SCENE_H = 720;
const SCALE = 0.075;
type ArrowIntent = "left" | "straight" | "right";
type ArrowDef = { x: number; y: number; heading: number; intent: ArrowIntent };

const ARROWS_4WAY: ArrowDef[] = [
  { x: 438, y: 210, heading: 90, intent: "left" },
  { x: 410, y: 210, heading: 90, intent: "straight" },
  { x: 396, y: 230, heading: 90, intent: "right" },
  { x: 462, y: 508, heading: 270, intent: "left" },
  { x: 490, y: 508, heading: 270, intent: "straight" },
  { x: 504, y: 490, heading: 270, intent: "right" },
  { x: 616, y: 348, heading: 180, intent: "left" },
  { x: 616, y: 324, heading: 180, intent: "straight" },
  { x: 598, y: 308, heading: 180, intent: "right" },
  { x: 284, y: 372, heading: 0, intent: "left" },
  { x: 284, y: 390, heading: 0, intent: "straight" },
  { x: 302, y: 408, heading: 0, intent: "right" },
];
const ARROWS_2WAY: ArrowDef[] = [
  { x: 430, y: 210, heading: 90, intent: "straight" },
  { x: 390, y: 210, heading: 90, intent: "straight" },
  { x: 470, y: 508, heading: 270, intent: "straight" },
  { x: 510, y: 508, heading: 270, intent: "straight" },
];
const ARROWS_3WAY: ArrowDef[] = [
  { x: 438, y: 210, heading: 90, intent: "left" },
  { x: 402, y: 210, heading: 90, intent: "right" },
  { x: 616, y: 318, heading: 180, intent: "straight" },
  { x: 616, y: 318, heading: 180, intent: "right" },
  { x: 284, y: 402, heading: 0, intent: "straight" },
  { x: 284, y: 372, heading: 0, intent: "left" },
];

function toWorld(x: number, y: number, lift = 0) {
  return new THREE.Vector3((x - SCENE_W / 2) * SCALE, lift, (y - SCENE_H / 2) * SCALE);
}

function lerpAngleRad(from: number, to: number, alpha: number) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}

function colorFromCss(input: string, fallback = 0xffffff) {
  if (input.startsWith("#")) {
    return new THREE.Color(input);
  }
  const match = input.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return new THREE.Color(fallback);
  }
  const [r, g, b] = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  return new THREE.Color((r || 255) / 255, (g || 255) / 255, (b || 255) / 255);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}

function makeMat(color: THREE.ColorRepresentation, roughness = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.03 });
}

function addBox(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  x: number,
  z: number,
  y: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y + height / 2, z);
  mesh.receiveShadow = true;
  mesh.castShadow = height > 0.08;
  group.add(mesh);
  return mesh;
}

function addDashedLine(group: THREE.Group, line: SceneLineSnapshot) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  if (length <= 0) {
    return;
  }

  const dash = line.dashArray?.split(" ").map(Number).filter((part) => part > 0);
  const pattern = dash && dash.length > 0 ? dash : [length];
  const material = new THREE.MeshBasicMaterial({
    color: colorFromCss(line.stroke),
    transparent: true,
    opacity: line.stroke.includes("rgba") ? 0.72 : 0.94,
  });
  const angle = Math.atan2(dy, dx);
  const thickness = Math.max(0.04, line.strokeWidth * SCALE * 0.48);
  let cursor = 0;
  let index = 0;

  while (cursor < length) {
    const segment = Math.min(pattern[index % pattern.length], length - cursor);
    const draw = index % 2 === 0;
    if (draw && segment > 0.5) {
      const mid = cursor + segment / 2;
      const px = line.x1 + Math.cos(angle) * mid;
      const py = line.y1 + Math.sin(angle) * mid;
      const center = toWorld(px, py, 0);
      const mesh = addBox(group, segment * SCALE, 0.035, thickness, center.x, center.z, 0.2, material);
      mesh.rotation.y = -angle;
    }
    cursor += segment;
    index += 1;
  }
}

// Hardcoded building bounding boxes per intersection type (screen px, same as layout)
const BUILDING_ZONES: Record<string, Array<[number, number, number, number]>> = {
  "4way": [
    [22, 18, 215, 165],   // hospital
    [548, 18, 230, 162],  // school
    [12, 452, 238, 172],  // mall
    [546, 452, 230, 168], // office
  ],
};

// Lamp posts go in the grass strips OUTSIDE the road, not in the carriageway
const LAMP_POSITIONS: [number, number][] = [
  [200, 240], [700, 240],   // NW / NE grass (between buildings and north road)
  [200, 480], [700, 480],   // SW / SE grass (between buildings and south road)
  [95,  355], [805, 355],   // W / E grass strips beside E-W road
];

// Footpath polylines for each intersection type (screen px coords)
const FOOTPATHS_3D: Record<string, [number, number][][]> = {
  "4way": [
    [[237, 183], [310, 198], [363, 270]],
    [[225, 178], [258, 270]],
    [[548, 180], [537, 218], [537, 270]],
    [[644, 178], [638, 270]],
    [[250, 452], [363, 455], [363, 430]],
    [[222, 458], [258, 452]],
    [[546, 452], [537, 458], [537, 432]],
    [[640, 458], [638, 452]],
  ],
};

function addLampPost(group: THREE.Group, x: number, y: number) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x28292e, roughness: 0.7, metalness: 0.4 });
  const p = toWorld(x, y);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.052, 3.0, 8), poleMat);
  pole.position.set(p.x, 1.5, p.z);
  pole.castShadow = true;
  // Arm
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.52, 6), poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(p.x + 0.26, 2.96, p.z);
  // Shade (inverted cone)
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.6, metalness: 0.5 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 10), shadeMat);
  shade.rotation.x = Math.PI;
  shade.position.set(p.x + 0.26, 2.82, p.z);
  // Bulb
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffe080, emissiveIntensity: 1.2, roughness: 0.2 }),
  );
  bulb.position.set(p.x + 0.26, 2.76, p.z);
  group.add(pole, arm, shade, bulb);
}

function addFootpaths(group: THREE.Group, intersectionType: string) {
  const paths = FOOTPATHS_3D[intersectionType] ?? [];
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.88, metalness: 0.0 });
  for (const polyline of paths) {
    for (let i = 0; i < polyline.length - 1; i++) {
      const [x1, y1] = polyline[i];
      const [x2, y2] = polyline[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 2) continue;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const c = toWorld(mx, my);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len * SCALE, 0.055, 11 * SCALE), mat);
      slab.position.set(c.x, 0.032, c.z);
      slab.rotation.y = -angle;
      slab.receiveShadow = true;
      group.add(slab);
    }
  }
}

function addStaticScene(group: THREE.Group, scene: SceneSnapshot, crosswalks: Map<string, THREE.Mesh[]>) {
  const grass = new THREE.MeshStandardMaterial({ color: 0x2a5018, roughness: 0.92, metalness: 0.0 });
  addBox(group, SCENE_W * SCALE, 0.04, SCENE_H * SCALE, 0, 0, -0.04, grass);

  // Sidewalk border — thin concrete band around the full perimeter before roads
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x9a9490, roughness: 0.85 });
  const SW = SCENE_W * SCALE;
  const SH = SCENE_H * SCALE;
  for (const [ox, oz, w, d] of [
    [0, -SH / 2, SW, 0.3],
    [0,  SH / 2, SW, 0.3],
    [-SW / 2, 0, 0.3, SH],
    [ SW / 2, 0, 0.3, SH],
  ] as [number, number, number, number][]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), sidewalkMat);
    curb.position.set(ox, 0.04, oz);
    group.add(curb);
  }

  addFootpaths(group, scene.intersectionType);
  for (const [lx, ly] of LAMP_POSITIONS) addLampPost(group, lx, ly);

  const roadMats = new Map<string, THREE.Material>();
  scene.roads.forEach((road, index) => {
    const fillKey = road.fill;
    const material = roadMats.get(fillKey) ?? makeMat(road.fill === "#3a3a3a" ? 0x3d4041 : 0x585b5b, 0.86);
    roadMats.set(fillKey, material);
    const center = toWorld(road.x + road.width / 2, road.y + road.height / 2, 0);
    const isRoad = road.id.startsWith("road-");
    addBox(group, road.width * SCALE, isRoad ? 0.1 : 0.06, road.height * SCALE, center.x, center.z, isRoad ? 0.04 + index * 0.012 : 0, material);
  });

  for (const line of scene.roadEdges) addDashedLine(group, line);
  for (const line of scene.laneDividers) addDashedLine(group, line);
  for (const line of scene.stopLines) addDashedLine(group, line);
  addLaneArrows(group, scene.intersectionType);

  for (const crosswalk of scene.crosswalks) {
    const meshes: THREE.Mesh[] = [];
    for (const stripe of crosswalk.stripes) {
      const material = new THREE.MeshBasicMaterial({ color: 0xe7eeee, transparent: true, opacity: 0.82 });
      const center = toWorld(stripe.x + stripe.width / 2, stripe.y + stripe.height / 2, 0);
      const mesh = addBox(group, stripe.width * SCALE, 0.035, stripe.height * SCALE, center.x, center.z, 0.24, material);
      meshes.push(mesh);
    }
    crosswalks.set(crosswalk.id, meshes);
  }

  // Intersection corner plaza tiles (raised concrete squares at the 4 corners of the box)
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xa8a4a0, roughness: 0.82 });
  for (const [px, pz] of [
    [SCENE_W / 2 - 87, SCENE_H / 2 - 90],
    [SCENE_W / 2 + 87, SCENE_H / 2 - 90],
    [SCENE_W / 2 - 87, SCENE_H / 2 + 90],
    [SCENE_W / 2 + 87, SCENE_H / 2 + 90],
  ] as [number, number][]) {
    const c = toWorld(px, pz);
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.07, 3.0), plazaMat);
    plaza.position.set(c.x, 0.04, c.z);
    plaza.receiveShadow = true;
    group.add(plaza);
  }

  // Trees — mix of round deciduous and conical conifers
  // [x, y, r, type] where type 0 = round, 1 = conifer
  const treeLocations: [number, number, number, number][] = [
    [180, 130, 28, 0], [720, 130, 28, 1], [180, 590, 28, 1], [720, 590, 28, 0],
    [85, 355, 20, 0],  [815, 355, 20, 1], [120, 220, 16, 0], [780, 220, 16, 1],
    [120, 500, 16, 1], [780, 500, 16, 0], [60, 130, 14, 0],  [840, 590, 14, 1],
  ];
  const trunkColors = [0x6b4a22, 0x5c3d1a, 0x7a5530];
  const crownColors = [0x3d7a16, 0x4a8c1c, 0x2e6412, 0x558a28];
  const buildingZones = BUILDING_ZONES[scene.intersectionType] ?? [];
  for (const [x, y, r, type] of treeLocations) {
    const insideBuilding = buildingZones.some(
      ([bx, by, bw, bh]) => x > bx - r && x < bx + bw + r && y > by - r && y < by + bh + r,
    );
    if (insideBuilding) continue;
    const point = toWorld(x, y);
    // Slight positional jitter for natural feel
    const jx = (((x * 7 + y * 3) % 5) - 2.5) * 0.06;
    const jz = (((x * 3 + y * 11) % 5) - 2.5) * 0.06;
    const scale = 0.88 + ((x * 13 + y) % 10) * 0.024;
    const trunkMat = makeMat(trunkColors[(x + y) % trunkColors.length]);
    const crownMat = makeMat(crownColors[(x * 3 + y) % crownColors.length]);
    const trunkH = 0.55 * scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.1 * scale, trunkH, 8), trunkMat);
    trunk.position.set(point.x + jx, trunkH / 2, point.z + jz);
    trunk.castShadow = true;

    if (type === 0) {
      // Round deciduous tree
      const crownR = r * SCALE * 0.68 * scale;
      const crown = new THREE.Mesh(new THREE.SphereGeometry(crownR, 14, 10), crownMat);
      crown.position.set(point.x + jx, trunkH + crownR * 0.82, point.z + jz);
      crown.scale.y = 0.80;
      crown.castShadow = true;
      // Secondary smaller sphere for irregular silhouette
      const leaf2 = new THREE.Mesh(new THREE.SphereGeometry(crownR * 0.62, 10, 8), crownMat);
      leaf2.position.set(point.x + jx + crownR * 0.44, trunkH + crownR * 0.96, point.z + jz + crownR * 0.28);
      leaf2.castShadow = true;
      group.add(trunk, crown, leaf2);
    } else {
      // Conical conifer (stacked cones)
      const cr = r * SCALE * 0.60 * scale;
      const coneH = cr * 2.6;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(cr, coneH, 10), crownMat);
      cone.position.set(point.x + jx, trunkH + coneH / 2, point.z + jz);
      cone.castShadow = true;
      const cone2 = new THREE.Mesh(new THREE.ConeGeometry(cr * 0.72, coneH * 0.7, 10), crownMat);
      cone2.position.set(point.x + jx, trunkH + coneH * 0.78, point.z + jz);
      cone2.castShadow = true;
      group.add(trunk, cone, cone2);
    }
  }

  // Buildings
  for (const b of scene.buildings ?? []) {
    const buildingGroup = makeBuilding(b);
    group.add(buildingGroup);
  }
}

function addLaneArrows(group: THREE.Group, intersectionType: string) {
  const arrows = intersectionType === "4way" ? ARROWS_4WAY : intersectionType === "2way" ? ARROWS_2WAY : ARROWS_3WAY;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34 });
  for (const arrow of arrows) {
    const arrowGroup = new THREE.Group();
    const center = toWorld(arrow.x, arrow.y, 0.26);
    arrowGroup.position.copy(center);
    arrowGroup.rotation.y = -THREE.MathUtils.degToRad(arrow.heading);
    const stem = addBox(arrowGroup, 1.05, 0.02, 0.09, 0.02, 0.18, 0, mat);
    stem.rotation.y = Math.PI / 2;
    const headShape = new THREE.Shape();
    if (arrow.intent === "straight") {
      headShape.moveTo(0, 0);
      headShape.lineTo(0.22, 0.38);
      headShape.lineTo(-0.22, 0.38);
      headShape.lineTo(0, 0);
    } else if (arrow.intent === "left") {
      headShape.moveTo(0, 0);
      headShape.lineTo(-0.38, 0.22);
      headShape.lineTo(-0.38, -0.22);
      headShape.lineTo(0, 0);
    } else {
      headShape.moveTo(0, 0);
      headShape.lineTo(0.38, 0.22);
      headShape.lineTo(0.38, -0.22);
      headShape.lineTo(0, 0);
    }
    const head = new THREE.Mesh(new THREE.ShapeGeometry(headShape), mat);
    head.position.set(0.46, 0.011, 0);
    head.rotation.x = -Math.PI / 2;
    arrowGroup.add(head);
    if (arrow.intent !== "straight") {
      const bend = addBox(arrowGroup, 0.52, 0.02, 0.09, 0.18, arrow.intent === "left" ? -0.24 : 0.24, 0, mat);
      bend.rotation.y = 0;
    }
    group.add(arrowGroup);
  }
}

function makeVehicle(vehicle: SceneVehicleSnapshot) {
  const group = new THREE.Group();
  const length = (vehicle.bodyLength || 24) * SCALE;
  const width = (vehicle.bodyWidth || 13) * SCALE;
  const height = vehicle.bodyLength >= 30 ? 0.42 : 0.32;
  const isTruck = (vehicle.bodyLength || 24) >= 30;
  const body = new THREE.Mesh(new THREE.BoxGeometry(length, height, width), makeMat(colorFromCss(vehicle.color), 0.48));
  body.position.y = height / 2;
  body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(length * 0.38, height * 0.55, width * 0.72), makeMat(0xd7e6ee, 0.35));
  cabin.position.set(length * 0.12, height * 1.02, 0);
  cabin.castShadow = true;
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, width * 0.74), new THREE.MeshBasicMaterial({ color: 0xfff1bc }));
  front.position.set(length / 2 + 0.03, 0.18, 0);
  const rearMat = new THREE.MeshBasicMaterial({ color: vehicle.brakeLights ? 0xff3328 : 0x7b1c16 });
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, width * 0.82), rearMat);
  rear.position.set(-length / 2 - 0.03, 0.18, 0);
  group.add(body, cabin, front, rear);
  const headGlowMat = new THREE.MeshBasicMaterial({ color: 0xffefbe, transparent: true, opacity: 0.26, depthWrite: false });
  const headGlow = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.16, width * 0.46, 0.95, 12, 1, true), headGlowMat);
  headGlow.rotation.z = Math.PI / 2;
  headGlow.position.set(length / 2 + 0.42, 0.2, 0);
  group.add(headGlow);
  const tailGlowMat = new THREE.MeshBasicMaterial({
    color: vehicle.brakeLights ? 0xff3b30 : 0x7b1c16,
    transparent: true,
    opacity: vehicle.brakeLights ? 0.3 : 0.12,
    depthWrite: false,
  });
  const tailGlow = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.18, width * 0.36, 0.56, 10, 1, true), tailGlowMat);
  tailGlow.rotation.z = -Math.PI / 2;
  tailGlow.position.set(-length / 2 - 0.22, 0.2, 0);
  group.add(tailGlow);

  const wheelRadius = isTruck ? 0.1 : 0.085;
  const wheelDepth = isTruck ? 0.09 : 0.07;
  const wheelMat = makeMat(0x1b1e22, 0.9);
  const wheelOffsets: Array<[number, number]> = [
    [length * 0.26, width * 0.42],
    [length * 0.26, -width * 0.42],
    [-length * 0.26, width * 0.42],
    [-length * 0.26, -width * 0.42],
  ];
  for (const [wx, wz] of wheelOffsets) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelDepth, 12), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, wheelRadius + 0.02, wz);
    wheel.castShadow = true;
    group.add(wheel);
  }

  const mirrorMat = makeMat(0x0f1216, 0.55);
  const leftMirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.045), mirrorMat);
  const rightMirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.045), mirrorMat);
  leftMirror.position.set(length * 0.2, height * 0.8, width * 0.43);
  rightMirror.position.set(length * 0.2, height * 0.8, -width * 0.43);
  group.add(leftMirror, rightMirror);

  if (vehicle.emergencyType) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(length * 0.34, 0.05, width * 0.55), new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
    bar.position.set(0, height * 1.52, 0);
    group.add(bar);
  }

  group.position.copy(toWorld(vehicle.x, vehicle.y, 0.16));
  group.rotation.y = -THREE.MathUtils.degToRad(vehicle.heading);
  return { group, rearMat, tailGlowMat };
}

function makeWalker(color: string): { group: THREE.Group; fadeMeshes: THREE.Mesh[] } {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorFromCss(color, 0xd2691e), roughness: 0.7, transparent: true, opacity: 1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), bodyMat);
  body.position.y = 0.46;
  body.castShadow = true;
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf0c287, roughness: 0.5, transparent: true, opacity: 1 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), headMat);
  head.position.y = 0.78;
  // Backpack / bag suggestion
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x404858, roughness: 0.7, transparent: true, opacity: 1 });
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.18, 0.07), bagMat);
  bag.position.set(0, 0.52, 0.10);
  group.add(body, head, bag);
  return { group, fadeMeshes: [body, head, bag] };
}

function makeSignal() {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.5 });

  // Tall tapered pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.060, 2.10, 10), poleMat);
  pole.position.y = 1.05;
  pole.castShadow = true;

  // Base plate at ground
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.08, 10), poleMat);
  base.position.y = 0.04;

  // Horizontal arm
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.030, 0.68, 8), poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-0.34, 2.0, 0);

  // Signal housing — taller and wider for visibility
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.3, metalness: 0.2 });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.30, 1.10, 0.22), housingMat);
  housing.position.set(-0.34, 1.72, 0);
  housing.castShadow = true;

  // Yellow accent stripe on housing top
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.06, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xf0c830, roughness: 0.5 }),
  );
  stripe.position.set(-0.34, 2.30, 0);

  // Back plate
  const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.12, 0.03), new THREE.MeshStandardMaterial({ color: 0x070809 }));
  backplate.position.set(-0.34, 1.72, 0.13);
  group.add(pole, base, arm, housing, stripe, backplate);

  // Three lenses (red top → amber mid → green bottom)
  const lensY: [number, string][] = [[2.10, "red"], [1.72, "amber"], [1.34, "green"]];
  const red   = new THREE.MeshBasicMaterial({ color: 0x300808 });
  const amber = new THREE.MeshBasicMaterial({ color: 0x261408 });
  const green = new THREE.MeshBasicMaterial({ color: 0x081c0a });
  const lensMats = [red, amber, green];

  lensY.forEach(([ly], i) => {
    // Lens bulb
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.088, 16, 12), lensMats[i]);
    bulb.position.set(-0.34, ly, -0.13);
    // Visor shade above each lens
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.036, 0.16), housingMat);
    visor.position.set(-0.34, ly + 0.11, -0.14);
    // Chrome ring around lens
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.092, 0.016, 8, 22),
      new THREE.MeshStandardMaterial({ color: 0x303438, roughness: 0.3, metalness: 0.7 }),
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.34, ly, -0.12);
    group.add(bulb, visor, ring);
  });

  // Billboard glow sprites (always face camera)
  const redGlow   = new THREE.SpriteMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const amberGlow = new THREE.SpriteMaterial({ color: 0xff9500, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const greenGlow = new THREE.SpriteMaterial({ color: 0x34c759, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glowMats = [redGlow, amberGlow, greenGlow];
  lensY.forEach(([ly], i) => {
    const sprite = new THREE.Sprite(glowMats[i]);
    sprite.scale.set(0.52, 0.52, 1);
    sprite.position.set(-0.34, ly, -0.13);
    group.add(sprite);
  });

  const lamp = new THREE.PointLight(0xffffff, 0, 9.0, 2);
  lamp.position.set(-0.34, 1.72, -0.10);
  group.add(lamp);

  return { group, red, amber, green, redGlow, amberGlow, greenGlow, lamp };
}

// Build a 3-D building from a 2-D layout snapshot
function makeBuilding(b: SceneBuildingSnapshot): THREE.Group {
  const group = new THREE.Group();
  const cx = toWorld(b.x + b.w / 2, b.y + b.h / 2);
  const BW = b.w * SCALE;
  const BD = b.h * SCALE;

  const isHosp   = b.type === "hospital";
  const isSchool = b.type === "school";
  const isMall   = b.type === "mall";

  // Taller, more realistic proportions
  const floors = isHosp ? 5 : isSchool ? 3 : isMall ? 3 : 6;
  const floorH = isHosp ? 0.58 : isSchool ? 0.55 : isMall ? 0.62 : 0.54;
  const totalH = floors * floorH;

  // Wall material — off-white concrete base, not pure color
  const wallHex = isHosp ? 0xece8e0 : isSchool ? 0xf5f0d8 : isMall ? 0xe0eaf5 : 0xd8e0ec;
  const wallMat = new THREE.MeshStandardMaterial({ color: wallHex, roughness: 0.78, metalness: 0.0 });

  const accentColor = new THREE.Color(b.accentColor);

  // Which faces are visible from the intersection center
  const facesEast  = cx.x < 0;
  const facesSouth = cx.z < 0;

  // Ground shadow
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(BW + 0.6, BD + 0.6),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(cx.x + 0.12, 0.001, cx.z + 0.16);
  group.add(shadowMesh);

  // ── Main structural body ──────────────────────────────────────────────────
  const body = new THREE.Mesh(new THREE.BoxGeometry(BW, totalH, BD), wallMat);
  body.position.set(cx.x, totalH / 2, cx.z);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // ── Spandrel bands between every floor (horizontal concrete bands) ─────────
  const spandrelMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.62, metalness: 0.06 });
  for (let f = 1; f <= floors; f++) {
    const bandY = f * floorH;
    const band = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.03, 0.10, BD + 0.03), spandrelMat);
    band.position.set(cx.x, bandY - 0.05, cx.z);
    group.add(band);
  }

  // ── Corner pilasters (vertical accent columns on all four corners) ─────────
  const pilasterMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.55, metalness: 0.04 });
  const corners: [number, number][] = [
    [cx.x - BW / 2 - 0.04, cx.z - BD / 2 - 0.04],
    [cx.x + BW / 2 + 0.04, cx.z - BD / 2 - 0.04],
    [cx.x - BW / 2 - 0.04, cx.z + BD / 2 + 0.04],
    [cx.x + BW / 2 + 0.04, cx.z + BD / 2 + 0.04],
  ];
  for (const [px, pz] of corners) {
    const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.12, totalH + 0.22, 0.12), pilasterMat);
    pilaster.position.set(px, totalH / 2, pz);
    pilaster.castShadow = true;
    group.add(pilaster);
  }

  // ── Roof parapet ──────────────────────────────────────────────────────────
  const parapetMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 });
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.12, 0.18, BD + 0.12), parapetMat);
  parapet.position.set(cx.x, totalH + 0.07, cx.z);
  group.add(parapet);

  const roofSurf = new THREE.Mesh(
    new THREE.BoxGeometry(BW + 0.06, 0.04, BD + 0.06),
    new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.88 }),
  );
  roofSurf.position.set(cx.x, totalH + 0.18, cx.z);
  group.add(roofSurf);

  // ── Windows — 3-D framed bays on visible faces ────────────────────────────
  const glassMat = new THREE.MeshStandardMaterial({
    color: isMall ? 0x7ab8d4 : isSchool ? 0x9dc8e8 : 0x88b4d2,
    roughness: 0.04,
    metalness: 0.72,
    transparent: true,
    opacity: 0.88,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: wallHex, roughness: 0.72 });

  const xCols = Math.max(3, Math.min(8, Math.floor(b.w / 24)));
  const zCols = Math.max(2, Math.min(6, Math.floor(b.h / 24)));
  const xStep = BW / xCols;
  const zStep = BD / zCols;
  const winW = xStep * 0.56;
  const winD = zStep * 0.56;
  const winH = floorH * 0.58;
  const frameThick = 0.028;

  for (let f = 0; f < floors; f++) {
    const wy = f * floorH + floorH * 0.42;

    // Visible side face (east or west)
    const sideXOuter = facesEast ? cx.x + BW / 2 : cx.x - BW / 2;
    const sideXSign  = facesEast ? 1 : -1;
    for (let c = 0; c < zCols; c++) {
      const wz = cx.z - BD / 2 + zStep * (c + 0.5);
      // Window frame (slightly protrudes from wall)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(frameThick * 2, winH + frameThick, winD + frameThick * 2), frameMat);
      frame.position.set(sideXOuter + sideXSign * frameThick, wy, wz);
      // Glass pane (recessed inside frame)
      const glass = new THREE.Mesh(new THREE.BoxGeometry(frameThick, winH, winD), glassMat);
      glass.position.set(sideXOuter + sideXSign * frameThick * 0.5, wy, wz);
      group.add(frame, glass);
    }

    // Visible front face (south or north)
    const sideFZOuter = facesSouth ? cx.z + BD / 2 : cx.z - BD / 2;
    const sideFZSign  = facesSouth ? 1 : -1;
    for (let c = 0; c < xCols; c++) {
      const wx = cx.x - BW / 2 + xStep * (c + 0.5);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(winW + frameThick * 2, winH + frameThick, frameThick * 2), frameMat);
      frame.position.set(wx, wy, sideFZOuter + sideFZSign * frameThick);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, frameThick), glassMat);
      glass.position.set(wx, wy, sideFZOuter + sideFZSign * frameThick * 0.5);
      group.add(frame, glass);
    }
  }

  // ── Type-specific features ────────────────────────────────────────────────
  if (isHosp) {
    // Large illuminated red cross on roof
    const crossMat = new THREE.MeshStandardMaterial({
      color: 0xdd1111,
      roughness: 0.4,
      emissive: 0xaa0000,
      emissiveIntensity: 0.55,
    });
    const cv = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.56), crossMat);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.10, 0.16), crossMat);
    cv.position.set(cx.x, totalH + 0.28, cx.z);
    ch.position.set(cx.x, totalH + 0.28, cx.z);
    group.add(cv, ch);

    // Emergency bay awning — bold red canopy with support columns
    const awningMat = new THREE.MeshStandardMaterial({ color: 0xcc1818, roughness: 0.5, metalness: 0.1 });
    const awningEdge = facesSouth ? cx.z + BD / 2 + 0.30 : cx.z - BD / 2 - 0.30;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.46, 0.06, 0.56), awningMat);
    awning.position.set(cx.x, floorH * 1.15, awningEdge);
    group.add(awning);
    for (const px of [cx.x - BW * 0.18, cx.x + BW * 0.18]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, floorH * 1.15, 6), makeMat(0xb01010));
      col.position.set(px, floorH * 0.575, awningEdge);
      group.add(col);
    }
    // "EMERGENCY" entrance sign strip
    const signMat = new THREE.MeshStandardMaterial({ color: 0xdd1111, emissive: 0x880000, emissiveIntensity: 0.6, roughness: 0.3 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.42, 0.12, 0.06), signMat);
    sign.position.set(cx.x, floorH * 1.22, awningEdge);
    group.add(sign);

    // Stair tower / elevator core on one side of roof
    const towerMat = new THREE.MeshStandardMaterial({ color: wallHex, roughness: 0.7 });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.22, floorH * 0.9, BD * 0.22), towerMat);
    tower.position.set(cx.x - BW * 0.3, totalH + floorH * 0.45, cx.z - BD * 0.28);
    group.add(tower);
  }

  if (isSchool) {
    // Flagpole with flag
    const fpoleMat = makeMat(0xa0a0a0);
    const fpole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), fpoleMat);
    fpole.position.set(cx.x - BW / 2 + 0.20, totalH + 0.72, cx.z - BD / 2 + 0.08);
    fpole.castShadow = true;
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xe82020, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.27), flagMat);
    flag.position.set(cx.x - BW / 2 + 0.44, totalH + 1.22, cx.z - BD / 2 + 0.08);
    group.add(fpole, flag);

    // Clock on visible facade
    const clockFaceMat = new THREE.MeshStandardMaterial({ color: 0xfffef0, roughness: 0.3, side: THREE.FrontSide });
    const clockBase = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), clockFaceMat);
    const clockFaceZ = facesSouth ? cx.z + BD / 2 + 0.012 : cx.z - BD / 2 - 0.012;
    clockBase.rotation.y = facesSouth ? 0 : Math.PI;
    clockBase.position.set(cx.x, totalH * 0.62, clockFaceZ);
    const handMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.13, 0.013), handMat);
    hourHand.position.set(cx.x, totalH * 0.62 + 0.04, clockFaceZ + (facesSouth ? 0.018 : -0.018));
    hourHand.rotation.z = Math.PI / 6;
    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.18, 0.009), handMat);
    minHand.position.set(cx.x, totalH * 0.62 + 0.06, clockFaceZ + (facesSouth ? 0.018 : -0.018));
    minHand.rotation.z = -Math.PI / 3;
    group.add(clockBase, hourHand, minHand);

    // Entrance portico (two columns + lintel)
    const porticoMat = makeMat(0xe0d8c0, 0.65);
    const lintelZ = facesSouth ? cx.z + BD / 2 + 0.20 : cx.z - BD / 2 - 0.20;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.36, 0.10, 0.36), porticoMat);
    lintel.position.set(cx.x, floorH * 0.95, lintelZ);
    group.add(lintel);
    for (const px of [cx.x - BW * 0.13, cx.x + BW * 0.13]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, floorH * 0.95, 8), porticoMat);
      col.position.set(px, floorH * 0.475, lintelZ);
      group.add(col);
    }
  }

  if (isMall) {
    // Wide glass entrance canopy
    const canopyGlassMat = new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.04, metalness: 0.55, transparent: true, opacity: 0.72 });
    const canopyFrameMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.5, metalness: 0.4 });
    const canopyEdge = facesSouth ? cx.z + BD / 2 + 0.44 : cx.z - BD / 2 - 0.44;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.70, 0.05, 0.88), canopyGlassMat);
    canopy.position.set(cx.x, floorH * 0.92, canopyEdge);
    const canopyBeam = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.72, 0.08, 0.06), canopyFrameMat);
    canopyBeam.position.set(cx.x, floorH * 0.92, canopyEdge + (facesSouth ? 0.44 : -0.44));
    group.add(canopy, canopyBeam);
    // Support columns
    for (const px of [cx.x - BW * 0.28, cx.x, cx.x + BW * 0.28]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, floorH * 0.92, 8), canopyFrameMat);
      col.position.set(px, floorH * 0.46, canopyEdge);
      group.add(col);
    }
    // Mall sign panel above entrance
    const signMat = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor.clone().multiplyScalar(0.5), emissiveIntensity: 0.4, roughness: 0.3 });
    const signPanel = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.52, 0.28, 0.08), signMat);
    signPanel.position.set(cx.x, floorH * 1.34, canopyEdge - (facesSouth ? 0.36 : -0.36));
    group.add(signPanel);
  }

  if (!isHosp && !isSchool && !isMall) {
    // Office: rooftop HVAC units + antenna mast
    const hvacMat = makeMat(0x565b62, 0.82);
    const hvacPositions: [number, number][] = [[-BW * 0.24, -BD * 0.18], [BW * 0.20, BD * 0.20], [-BW * 0.06, BD * 0.06], [BW * 0.28, -BD * 0.24]];
    for (const [ox, oz] of hvacPositions) {
      const unit = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.22, 0.26), hvacMat);
      unit.position.set(cx.x + ox, totalH + 0.22, cx.z + oz);
      group.add(unit);
    }
    // Antenna mast
    const antMat = makeMat(0x888c92, 0.7);
    const antBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.28, 6), antMat);
    antBase.position.set(cx.x + BW * 0.10, totalH + 0.32, cx.z + BD * 0.10);
    const antMast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.72, 6), antMat);
    antMast.position.set(cx.x + BW * 0.10, totalH + 0.78, cx.z + BD * 0.10);
    group.add(antBase, antMast);
  }

  return group;
}

export function TrafficThreeView({ scene, caption, mode = "full" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const staticGroupRef = useRef<THREE.Group | null>(null);
  const vehiclesRef = useRef(new Map<string, VehicleObject>());
  const walkersRef = useRef(new Map<string, WalkerObject>());
  const signalsRef = useRef(new Map<string, SignalObject>());
  const crosswalksRef = useRef(new Map<string, THREE.Mesh[]>());
  const emergencyBarsRef = useRef(new Map<string, THREE.Mesh>());
  const rainRef = useRef<THREE.Points | null>(null);
  const ambientRef = useRef<THREE.AmbientLight | null>(null);
  const sunRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiRef = useRef<THREE.HemisphereLight | null>(null);
  const streetLightsRef = useRef<THREE.PointLight[]>([]);
  const debugGroupRef = useRef<THREE.Group | null>(null);
  const lowQualityRef = useRef(false);
  const debugSignatureRef = useRef<string>("");
  const typeRef = useRef<string | null>(null);
  const frameRef = useRef(0);
  const fpsSampleRef = useRef({ last: performance.now(), frames: 0, fps: 60 });
  const autoLowQualityRef = useRef(false);
  const cameraTweenRef = useRef<{
    active: boolean;
    start: THREE.Vector3;
    end: THREE.Vector3;
    targetStart: THREE.Vector3;
    targetEnd: THREE.Vector3;
    t: number;
  }>({
    active: false,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    targetStart: new THREE.Vector3(),
    targetEnd: new THREE.Vector3(),
    t: 0,
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<"ops" | "iso" | "top">("ops");
  const [fpsReadout, setFpsReadout] = useState(60);
  const [autoLowQuality, setAutoLowQuality] = useState(false);

  const resetCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(0, 36, 28);
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.update();
  }, []);

  const applyPreset = useCallback((preset: "ops" | "iso" | "top") => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    setCameraPreset(preset);
    const end = new THREE.Vector3();
    const targetEnd = new THREE.Vector3(0, 0, 0);
    if (preset === "top") {
      end.set(0, 56, 0.01);
    } else if (preset === "iso") {
      end.set(28, 32, 22);
    } else {
      end.set(0, 36, 28);
    }
    cameraTweenRef.current = {
      active: true,
      start: camera.position.clone(),
      end,
      targetStart: controls.target.clone(),
      targetEnd,
      t: 0,
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
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
    if (mode !== "full") return;
    const onKey = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea") return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetCamera();
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleFullscreen();
      }
      if (event.key.toLowerCase() === "1") applyPreset("ops");
      if (event.key.toLowerCase() === "2") applyPreset("iso");
      if (event.key.toLowerCase() === "3") applyPreset("top");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyPreset, mode, resetCamera, toggleFullscreen]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x7ab8d4);
    threeScene.fog = new THREE.Fog(0x9acce0, 60, 96);

    const camera = new THREE.OrthographicCamera(-24, 24, 16, -16, 0.1, 100);
    camera.position.set(0, 36, 28);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const lowQuality = (window.devicePixelRatio || 1) > 1.5 || window.innerWidth < 1100;
    lowQualityRef.current = lowQuality;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQuality ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.minZoom = 0.62;
    controls.maxZoom = 1.8;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minPolarAngle = Math.PI * 0.22;

    const ambient = new THREE.AmbientLight(0xffffff, 1.45);
    const hemi = new THREE.HemisphereLight(0xa5cfff, 0x12200e, 0.32);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-12, 28, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowQuality ? 512 : 1024, lowQuality ? 512 : 1024);
    sun.shadow.camera.left = -35;
    sun.shadow.camera.right = 35;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    threeScene.add(ambient, hemi, sun);
    ambientRef.current = ambient;
    sunRef.current = sun;
    hemiRef.current = hemi;

    streetLightsRef.current = LAMP_POSITIONS.map(([x, y]) => {
      const light = new THREE.PointLight(0xfff1c7, 0.14, 26, 2);
      const p = toWorld(x, y, 0);
      light.position.set(p.x, 3.2, p.z);
      threeScene.add(light);
      return light;
    });

    const rainGeometry = new THREE.BufferGeometry();
    const rainCount = lowQuality ? 460 : 900;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i += 1) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 90;
      rainPositions[i * 3 + 1] = Math.random() * 28 + 2;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 76;
    }
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rainMaterial = new THREE.PointsMaterial({
      color: 0xd9ecff,
      size: 0.06,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const rain = new THREE.Points(rainGeometry, rainMaterial);
    rain.visible = false;
    threeScene.add(rain);
    rainRef.current = rain;

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      const aspect = width / height;
      const viewHeight = 32;
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const animate = () => {
      const now = performance.now();
      const meter = fpsSampleRef.current;
      meter.frames += 1;
      if (now - meter.last >= 800) {
        meter.fps = Math.round((meter.frames * 1000) / (now - meter.last));
        meter.frames = 0;
        meter.last = now;
        setFpsReadout(meter.fps);
        if (!autoLowQualityRef.current && meter.fps < 32) {
          autoLowQualityRef.current = true;
          setAutoLowQuality(true);
          if (rendererRef.current) {
            rendererRef.current.setPixelRatio(1);
          }
          if (sunRef.current) {
            sunRef.current.shadow.mapSize.set(512, 512);
          }
          if (rainRef.current) {
            const geometry = rainRef.current.geometry as THREE.BufferGeometry;
            const old = geometry.getAttribute("position") as THREE.BufferAttribute;
            if (old.count > 420) {
              const next = new Float32Array(420 * 3);
              for (let i = 0; i < 420; i += 1) {
                next[i * 3] = old.getX(i);
                next[i * 3 + 1] = old.getY(i);
                next[i * 3 + 2] = old.getZ(i);
              }
              geometry.setAttribute("position", new THREE.BufferAttribute(next, 3));
            }
          }
        }
      }
      const tween = cameraTweenRef.current;
      if (tween.active) {
        tween.t = Math.min(1, tween.t + 0.06);
        const eased = 1 - Math.pow(1 - tween.t, 3);
        camera.position.lerpVectors(tween.start, tween.end, eased);
        controls.target.lerpVectors(tween.targetStart, tween.targetEnd, eased);
        if (tween.t >= 1) tween.active = false;
      }
      for (const item of vehiclesRef.current.values()) {
        item.group.position.lerp(item.target, 0.2);
        item.group.rotation.y = lerpAngleRad(item.group.rotation.y, item.heading, 0.2);
      }
      for (const item of walkersRef.current.values()) {
        item.group.position.lerp(item.target, 0.24);
        item.group.rotation.y = lerpAngleRad(item.group.rotation.y, item.heading, 0.18);
      }
      if (rainRef.current?.visible) {
        const geometry = rainRef.current.geometry as THREE.BufferGeometry;
        const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < attr.count; i += 1) {
          let y = attr.getY(i) - 0.62;
          let x = attr.getX(i) - 0.05;
          if (y < 0.2) {
            y = Math.random() * 28 + 18;
            x = (Math.random() - 0.5) * 90;
          }
          attr.setX(i, x);
          attr.setY(i, y);
        }
        attr.needsUpdate = true;
      }
      const pulse = 0.45 + Math.sin(performance.now() / 120) * 0.45;
      for (const [id, bar] of emergencyBarsRef.current) {
        const flash = (Math.floor(performance.now() / 160 + id.length) % 2) === 0;
        const visible = pulse > 0.4 || flash;
        bar.visible = visible;
        const mat = bar.material as THREE.MeshBasicMaterial;
        mat.opacity = visible ? 0.9 : 0.35;
      }
      controls.update();
      renderer.render(threeScene, camera);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);

    sceneRef.current = threeScene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    staticGroupRef.current = null;
    crosswalksRef.current = new Map();
    emergencyBarsRef.current = new Map();
    typeRef.current = null;

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      disposeObject(threeScene);
    };
  }, []);

  useEffect(() => {
    const threeScene = sceneRef.current;
    if (!threeScene) return;
    const ambient = ambientRef.current;
    const sun = sunRef.current;
    const hemi = hemiRef.current;

    if (typeRef.current !== scene.intersectionType) {
      if (staticGroupRef.current) {
        threeScene.remove(staticGroupRef.current);
        disposeObject(staticGroupRef.current);
      }
      crosswalksRef.current = new Map();
      const staticGroup = new THREE.Group();
      addStaticScene(staticGroup, scene, crosswalksRef.current);
      threeScene.add(staticGroup);
      staticGroupRef.current = staticGroup;
      typeRef.current = scene.intersectionType;
    }
    const weatherState = scene.weatherMode;
    if (weatherState === "night") {
      threeScene.background = new THREE.Color(0x060d14);
      threeScene.fog = new THREE.Fog(0x060d14, 35, 62);
      if (ambient) ambient.intensity = 0.78;
      if (sun) sun.intensity = 0.4;
      if (hemi) hemi.intensity = 0.22;
      for (const light of streetLightsRef.current) light.intensity = 0.62;
      if (rainRef.current) rainRef.current.visible = false;
    } else if (weatherState === "fog") {
      threeScene.background = new THREE.Color(0x768287);
      threeScene.fog = new THREE.Fog(0x768287, 24, 44);
      if (ambient) ambient.intensity = 1.2;
      if (sun) sun.intensity = 0.95;
      if (hemi) hemi.intensity = 0.3;
      for (const light of streetLightsRef.current) light.intensity = 0.26;
      if (rainRef.current) rainRef.current.visible = false;
    } else if (weatherState === "rain") {
      threeScene.background = new THREE.Color(0x18273a);
      threeScene.fog = new THREE.Fog(0x18273a, 44, 72);
      if (ambient) ambient.intensity = 1.02;
      if (sun) sun.intensity = 1.2;
      if (hemi) hemi.intensity = 0.28;
      for (const light of streetLightsRef.current) light.intensity = 0.36;
      if (rainRef.current) rainRef.current.visible = true;
    } else {
      threeScene.background = new THREE.Color(0x7ab8d4);
      threeScene.fog = new THREE.Fog(0x9acce0, 60, 96);
      if (ambient) ambient.intensity = 1.65;
      if (sun) sun.intensity = 2.6;
      if (hemi) hemi.intensity = 0.42;
      for (const light of streetLightsRef.current) light.intensity = 0.12;
      if (rainRef.current) rainRef.current.visible = false;
    }

    for (const crosswalk of scene.crosswalks) {
      const color = crosswalk.state === "walk" ? 0xbfffd1 : 0xe7eeee;
      const opacity = crosswalk.state === "walk" ? 0.98 : 0.48;
      for (const mesh of crosswalksRef.current.get(crosswalk.id) ?? []) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.color.set(color);
        material.opacity = opacity;
        material.needsUpdate = true;
      }
    }

    const currentVehicleIds = new Set<string>();
    for (const lane of scene.lanes) {
      for (const vehicle of lane.vehicles) {
        currentVehicleIds.add(vehicle.id);
        let item = vehiclesRef.current.get(vehicle.id);
        if (!item) {
          const vehicleObject = makeVehicle(vehicle);
          threeScene.add(vehicleObject.group);
          item = {
            group: vehicleObject.group,
            target: vehicleObject.group.position.clone(),
            heading: vehicleObject.group.rotation.y,
            rearMat: vehicleObject.rearMat,
            tailGlowMat: vehicleObject.tailGlowMat,
          };
          vehiclesRef.current.set(vehicle.id, item);
          const emergencyBar = vehicleObject.group.children.at(-1) as THREE.Mesh | undefined;
          if (vehicle.emergencyType && emergencyBar) {
            const material = emergencyBar.material as THREE.MeshBasicMaterial;
            material.transparent = true;
            emergencyBarsRef.current.set(vehicle.id, emergencyBar);
          }
        }
        item.target = toWorld(vehicle.x, vehicle.y, 0.16);
        item.heading = -THREE.MathUtils.degToRad(vehicle.heading);
        item.rearMat.color.set(vehicle.brakeLights ? 0xff3328 : 0x7b1c16);
        item.tailGlowMat.color.set(vehicle.brakeLights ? 0xff3b30 : 0x7b1c16);
        item.tailGlowMat.opacity = vehicle.brakeLights ? 0.3 : 0.12;
        if (!vehicle.emergencyType) {
          emergencyBarsRef.current.delete(vehicle.id);
        }
      }
    }
    for (const [id, item] of vehiclesRef.current) {
      if (!currentVehicleIds.has(id)) {
        threeScene.remove(item.group);
        disposeObject(item.group);
        vehiclesRef.current.delete(id);
        emergencyBarsRef.current.delete(id);
      }
    }

    const currentWalkerIds = new Set<string>();
    for (const pedestrian of scene.pedestrians) {
      currentWalkerIds.add(pedestrian.id);
      let item = walkersRef.current.get(pedestrian.id);
      if (!item) {
        const { group, fadeMeshes } = makeWalker(pedestrian.color);
        group.position.copy(toWorld(pedestrian.x, pedestrian.y, 0.2));
        threeScene.add(group);
        item = { group, target: group.position.clone(), heading: 0, fadeMeshes };
        walkersRef.current.set(pedestrian.id, item);
      }
      const dx = pedestrian.x - (item.target.x / SCALE + SCENE_W / 2);
      const dy = pedestrian.y - (item.target.z / SCALE + SCENE_H / 2);
      if (Math.hypot(dx, dy) > 0.2) {
        item.heading = -Math.atan2(dy, dx);
      }
      item.target = toWorld(pedestrian.x, pedestrian.y, 0.2);
      // Fade in from building / fade out entering building
      const alpha = pedestrian.state === "exiting_building"
        ? pedestrian.buildingWalkProgress
        : pedestrian.state === "entering_building"
        ? 1 - pedestrian.buildingWalkProgress
        : 1;
      for (const mesh of item.fadeMeshes) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0.02, alpha);
      }
    }
    for (const [id, item] of walkersRef.current) {
      if (!currentWalkerIds.has(id)) {
        threeScene.remove(item.group);
        disposeObject(item.group);
        walkersRef.current.delete(id);
      }
    }

    const currentSignalIds = new Set<string>();
    for (const signal of scene.signals) {
      currentSignalIds.add(signal.id);
      let signalObject = signalsRef.current.get(signal.id);
      if (!signalObject) {
        signalObject = makeSignal();
        threeScene.add(signalObject.group);
        signalsRef.current.set(signal.id, signalObject);
      }
      signalObject.group.position.copy(toWorld(signal.x, signal.y, 0.2));
      {
        // Orient signal to face approaching traffic
        // In world space: -z = north, +z = south, +x = east, -x = west
        const dx = signal.x - SCENE_W / 2;
        const dy = signal.y - SCENE_H / 2;
        signalObject.group.rotation.y = Math.abs(dx) >= Math.abs(dy)
          ? (dx > 0 ? -Math.PI / 2 : Math.PI / 2)   // east / west approach
          : (dy > 0 ? Math.PI : 0);                   // south / north approach
      }
      signalObject.red.color.set(signal.red === "#ff3b30" ? 0xff3b30 : 0x300808);
      signalObject.amber.color.set(signal.amber === "#ff9500" ? 0xff9500 : 0x261408);
      signalObject.green.color.set(signal.green === "#34c759" ? 0x34c759 : 0x081c0a);
      signalObject.redGlow.opacity = signal.red === "#ff3b30" ? 0.52 : 0;
      signalObject.amberGlow.opacity = signal.amber === "#ff9500" ? 0.46 : 0;
      signalObject.greenGlow.opacity = signal.green === "#34c759" ? 0.52 : 0;
      if (signal.green === "#34c759") {
        signalObject.lamp.color.set(0x6cf596);
        signalObject.lamp.intensity = 0.68;
      } else if (signal.amber === "#ff9500") {
        signalObject.lamp.color.set(0xffc261);
        signalObject.lamp.intensity = 0.52;
      } else if (signal.red === "#ff3b30") {
        signalObject.lamp.color.set(0xff8178);
        signalObject.lamp.intensity = 0.60;
      } else {
        signalObject.lamp.intensity = 0.08;
      }
    }
    for (const [id, signalObject] of signalsRef.current) {
      if (!currentSignalIds.has(id)) {
        threeScene.remove(signalObject.group);
        disposeObject(signalObject.group);
        signalsRef.current.delete(id);
      }
    }

    const debugSignature = `${scene.debug}|${scene.debugPaths.length}|${scene.debugStops.length}|${scene.debugPaths.map((p) => `${p.id}:${p.points.length}`).join(",")}`;
    if (debugSignatureRef.current === debugSignature) return;
    debugSignatureRef.current = debugSignature;
    if (debugGroupRef.current) {
      threeScene.remove(debugGroupRef.current);
      disposeObject(debugGroupRef.current);
      debugGroupRef.current = null;
    }
    if (scene.debug) {
      const debugGroup = new THREE.Group();
      for (const path of scene.debugPaths) {
        if (path.points.length < 2) continue;
        const points = path.points.map((point) => toWorld(point.x, point.y, 0.34));
        const curve = new THREE.CatmullRomCurve3(points);
        const geometry = new THREE.TubeGeometry(curve, Math.max(24, points.length * 7), 0.03, 6, false);
        const material = new THREE.MeshBasicMaterial({
          color: colorFromCss(path.color, 0x9de66f),
          transparent: true,
          opacity: 0.9,
        });
        const mesh = new THREE.Mesh(geometry, material);
        debugGroup.add(mesh);
      }
      for (const stop of scene.debugStops) {
        const p = toWorld(stop.x, stop.y, 0.34);
        const marker = new THREE.Mesh(
          new THREE.CircleGeometry(0.16, 18),
          new THREE.MeshBasicMaterial({
            color: stop.reserved ? 0xffd147 : 0x74e6a1,
            transparent: true,
            opacity: 0.62,
          }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.copy(p);
        debugGroup.add(marker);
      }
      threeScene.add(debugGroup);
      debugGroupRef.current = debugGroup;
    }
  }, [scene]);

  return (
    <div className={`scene-root scene-root-3d ${mode === "monitor" ? "scene-root-monitor" : ""} ${isFullscreen ? "is-fullscreen" : ""}`} ref={rootRef}>
      {caption ? <div className="scene-caption">{caption}</div> : null}
      {mode === "full" ? (
        <div className="three-controls">
          <span>FPS {fpsReadout}{autoLowQuality ? " • Auto-Low" : ""}</span>
          <span>Shortcuts: R reset, F fullscreen, 1/2/3 cameras</span>
          <button
            className={cameraPreset === "ops" ? "is-active" : ""}
            onClick={() => applyPreset("ops")}
            type="button"
          >
            Ops
          </button>
          <button
            className={cameraPreset === "iso" ? "is-active" : ""}
            onClick={() => applyPreset("iso")}
            type="button"
          >
            Iso
          </button>
          <button
            className={cameraPreset === "top" ? "is-active" : ""}
            onClick={() => applyPreset("top")}
            type="button"
          >
            Top
          </button>
          <button onClick={resetCamera} type="button">Reset Cam</button>
          <button onClick={toggleFullscreen} type="button">{isFullscreen ? "Exit" : "Fullscreen"}</button>
        </div>
      ) : null}
      <div className="scene-wrapper scene-wrapper-3d" ref={mountRef} />
    </div>
  );
}
