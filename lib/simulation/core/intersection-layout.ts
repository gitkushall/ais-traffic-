import { IntersectionType, LaneId, MovementLane, TurnIntent } from "@/lib/simulation/domain/enums";
import {
  SceneCrosswalkSnapshot,
  SceneLineSnapshot,
  SceneRoadRectSnapshot,
} from "@/lib/simulation/domain/snapshots";

export type MovementLaneLayout = {
  id: `${LaneId}_${MovementLane}`;
  laneId: LaneId;
  lane: MovementLane;
  intent: TurnIntent;
  trackKey: string;
  centerX: number;
  centerY: number;
  spawnX: number;
  spawnY: number;
  holdX: number;
  holdY: number;
  stopX: number;
  stopY: number;
  exitLaneId: LaneId;
  exitHeading: number;
  controlX: number;
  controlY: number;
};

export type LaneLayout = {
  id: LaneId;
  label: string;
  direction: number;
  signalX: number;
  signalY: number;
  queueAxis: "x" | "y";
  queueDirection: 1 | -1;
  fixedPosition: number;
  stopLine: number;
  colors: string[];
  movementLanes: MovementLaneLayout[];
};

export type PhaseLayout = {
  key: string;
  label: string;
  approaches: LaneId[];
  allowedMovements: string[];
  scoreLanes: LaneId[];
};

export type IntersectionLayout = {
  type: IntersectionType;
  lanes: LaneLayout[];
  phases: PhaseLayout[];
  movementConflicts: Record<string, string[]>;
  roads: SceneRoadRectSnapshot[];
  laneDividers: SceneLineSnapshot[];
  roadEdges: SceneLineSnapshot[];
  stopLines: SceneLineSnapshot[];
  crosswalks: SceneCrosswalkSnapshot[];
};

function createMovementConflictMap(phases: PhaseLayout[]) {
  const movements = Array.from(new Set(phases.flatMap((phase) => phase.allowedMovements)));
  const compatibility = new Map<string, Set<string>>();

  for (const movement of movements) {
    compatibility.set(movement, new Set([movement]));
  }

  for (const phase of phases) {
    for (const movement of phase.allowedMovements) {
      const set = compatibility.get(movement)!;
      for (const other of phase.allowedMovements) {
        set.add(other);
      }
    }
  }

  const conflicts: Record<string, string[]> = {};
  for (const movement of movements) {
    conflicts[movement] = movements.filter((other) => !compatibility.get(movement)?.has(other));
  }
  return conflicts;
}

const BASE_COLORS = ["#f5f5f5", "#c0c0c0", "#555555", "#c0392b", "#2471a3", "#1e8449"];
const ROAD = "#3a3a3a";
const SIDEWALK = "#4a4a4a";
const ROAD_EDGE = "rgba(255,255,255,0.8)";
const ROAD_DASH = "rgba(255,215,0,0.7)";
const STOP = "rgba(255,255,255,0.88)";
const LANE_MARK = "rgba(255,255,255,0.32)";

function zebraNorth(id: string, y: number): SceneCrosswalkSnapshot {
  return {
    id,
    state: "dont_walk",
    stripes: Array.from({ length: 6 }, (_, index) => ({
      x: 404 + index * 16,
      y,
      width: 10,
      height: 40,
    })),
  };
}

function zebraSouth(id: string, y: number): SceneCrosswalkSnapshot {
  return {
    id,
    state: "dont_walk",
    stripes: Array.from({ length: 6 }, (_, index) => ({
      x: 404 + index * 16,
      y,
      width: 10,
      height: 40,
    })),
  };
}

function zebraEast(id: string, x: number): SceneCrosswalkSnapshot {
  return {
    id,
    state: "dont_walk",
    stripes: Array.from({ length: 6 }, (_, index) => ({
      x,
      y: 314 + index * 16,
      width: 40,
      height: 10,
    })),
  };
}

function zebraWest(id: string, x: number): SceneCrosswalkSnapshot {
  return {
    id,
    state: "dont_walk",
    stripes: Array.from({ length: 6 }, (_, index) => ({
      x,
      y: 314 + index * 16,
      width: 40,
      height: 10,
    })),
  };
}

function northMovement(
  lane: MovementLane,
  intent: TurnIntent,
  centerX: number,
  exitLaneId: LaneId,
  controlX: number,
  controlY: number,
): MovementLaneLayout {
  return {
    id: `north_${lane}`,
    laneId: "north",
    lane,
    intent,
    trackKey: `north-${centerX}`,
    centerX,
    centerY: 0,
    spawnX: centerX,
    spawnY: -80,
    holdX: centerX,
    holdY: 176,
    stopX: centerX,
    stopY: 278,
    exitLaneId,
    exitHeading: exitLaneId === "south" ? 180 : exitLaneId === "east" ? 90 : 270,
    controlX,
    controlY,
  };
}

function southMovement(
  lane: MovementLane,
  intent: TurnIntent,
  centerX: number,
  exitLaneId: LaneId,
  controlX: number,
  controlY: number,
): MovementLaneLayout {
  return {
    id: `south_${lane}`,
    laneId: "south",
    lane,
    intent,
    trackKey: `south-${centerX}`,
    centerX,
    centerY: 0,
    spawnX: centerX,
    spawnY: 800,
    holdX: centerX,
    holdY: 548,
    stopX: centerX,
    stopY: 442,
    exitLaneId,
    exitHeading: exitLaneId === "north" ? 0 : exitLaneId === "east" ? 90 : 270,
    controlX,
    controlY,
  };
}

function eastMovement(
  lane: MovementLane,
  intent: TurnIntent,
  centerY: number,
  exitLaneId: LaneId,
  controlX: number,
  controlY: number,
): MovementLaneLayout {
  return {
    id: `east_${lane}`,
    laneId: "east",
    lane,
    intent,
    trackKey: `east-${centerY}`,
    centerX: 0,
    centerY,
    spawnX: 980,
    spawnY: centerY,
    holdX: 646,
    holdY: centerY,
    stopX: 532,
    stopY: centerY,
    exitLaneId,
    exitHeading: exitLaneId === "west" ? 270 : exitLaneId === "north" ? 0 : 180,
    controlX,
    controlY,
  };
}

function westMovement(
  lane: MovementLane,
  intent: TurnIntent,
  centerY: number,
  exitLaneId: LaneId,
  controlX: number,
  controlY: number,
): MovementLaneLayout {
  return {
    id: `west_${lane}`,
    laneId: "west",
    lane,
    intent,
    trackKey: `west-${centerY}`,
    centerX: 0,
    centerY,
    spawnX: -80,
    spawnY: centerY,
    holdX: 254,
    holdY: centerY,
    stopX: 368,
    stopY: centerY,
    exitLaneId,
    exitHeading: exitLaneId === "east" ? 90 : exitLaneId === "north" ? 0 : 180,
    controlX,
    controlY,
  };
}

const twoWayNorthInner = northMovement("left", "straight", 430, "south", 430, 520);
const twoWayNorthOuter = northMovement("through", "straight", 390, "south", 390, 520);
const twoWaySouthInner = southMovement("left", "straight", 470, "north", 470, 200);
const twoWaySouthOuter = southMovement("through", "straight", 510, "north", 510, 200);

const threeNorthLeft = northMovement("left", "left", 438, "east", 588, 278);
const threeNorthRight = northMovement("right", "right", 402, "west", 312, 278);
const threeEastThrough = eastMovement("through", "straight", 318, "west", 200, 318);
const threeEastRight = eastMovement("right", "right", 318, "north", 532, 210);
const threeWestThrough = westMovement("through", "straight", 402, "east", 700, 402);
const threeWestLeft = westMovement("left", "left", 372, "north", 368, 210);

const northLeft = northMovement("left", "left", 438, "east", 590, 278);
const northThrough = northMovement("through", "straight", 402, "south", 402, 520);
const northRight = northMovement("right", "right", 402, "west", 312, 278);
const southLeft = southMovement("left", "left", 462, "west", 310, 442);
const southThrough = southMovement("through", "straight", 498, "north", 498, 200);
const southRight = southMovement("right", "right", 498, "east", 590, 442);
const eastLeft = eastMovement("left", "left", 348, "south", 532, 520);
const eastThrough = eastMovement("through", "straight", 318, "west", 200, 318);
const eastRight = eastMovement("right", "right", 318, "north", 532, 198);
const westLeft = westMovement("left", "left", 372, "north", 368, 198);
const westThrough = westMovement("through", "straight", 402, "east", 700, 402);
const westRight = westMovement("right", "right", 402, "south", 368, 520);

const LAYOUTS: Record<IntersectionType, IntersectionLayout> = {
  "2way": {
    type: "2way",
    lanes: [
      {
        id: "north",
        label: "North",
        direction: 180,
        signalX: 506,
        signalY: 240,
        queueAxis: "y",
        queueDirection: -1,
        fixedPosition: 410,
        stopLine: 278,
        colors: BASE_COLORS,
        movementLanes: [twoWayNorthInner, twoWayNorthOuter],
      },
      {
        id: "south",
        label: "South",
        direction: 0,
        signalX: 394,
        signalY: 480,
        queueAxis: "y",
        queueDirection: 1,
        fixedPosition: 490,
        stopLine: 442,
        colors: BASE_COLORS,
        movementLanes: [twoWaySouthInner, twoWaySouthOuter],
      },
    ],
    phases: [
      {
        key: "ns_main",
        label: "N/S Through",
        approaches: ["north", "south"],
        allowedMovements: [twoWayNorthInner.id, twoWayNorthOuter.id, twoWaySouthInner.id, twoWaySouthOuter.id],
        scoreLanes: ["north", "south"],
      },
    ],
    movementConflicts: createMovementConflictMap([
      {
        key: "ns_main",
        label: "N/S Through",
        approaches: ["north", "south"],
        allowedMovements: [twoWayNorthInner.id, twoWayNorthOuter.id, twoWaySouthInner.id, twoWaySouthOuter.id],
        scoreLanes: ["north", "south"],
      },
    ]),
    roads: [
      { id: "sidewalk-vertical", x: 350, y: 0, width: 200, height: 720, fill: SIDEWALK },
      { id: "road-vertical", x: 370, y: 0, width: 160, height: 720, fill: ROAD },
    ],
    laneDividers: [
      { id: "center-vertical", x1: 450, y1: 0, x2: 450, y2: 720, stroke: ROAD_DASH, strokeWidth: 2, dashArray: "14 10" },
      { id: "lane-southbound-split", x1: 410, y1: 0, x2: 410, y2: 720, stroke: LANE_MARK, strokeWidth: 1.5, dashArray: "12 12" },
      { id: "lane-northbound-split", x1: 490, y1: 0, x2: 490, y2: 720, stroke: LANE_MARK, strokeWidth: 1.5, dashArray: "12 12" },
    ],
    roadEdges: [
      { id: "edge-left", x1: 370, y1: 0, x2: 370, y2: 720, stroke: ROAD_EDGE, strokeWidth: 2 },
      { id: "edge-right", x1: 530, y1: 0, x2: 530, y2: 720, stroke: ROAD_EDGE, strokeWidth: 2 },
    ],
    stopLines: [
      { id: "stop-north", x1: 370, y1: 278, x2: 530, y2: 278, stroke: STOP, strokeWidth: 4 },
      { id: "stop-south", x1: 370, y1: 442, x2: 530, y2: 442, stroke: STOP, strokeWidth: 4 },
    ],
    crosswalks: [zebraNorth("cross-north", 256), zebraSouth("cross-south", 464)],
  },
  "3way": {
    type: "3way",
    lanes: [
      {
        id: "north",
        label: "North",
        direction: 180,
        signalX: 506,
        signalY: 240,
        queueAxis: "y",
        queueDirection: -1,
        fixedPosition: 474,
        stopLine: 278,
        colors: BASE_COLORS,
        movementLanes: [threeNorthLeft, threeNorthRight],
      },
      {
        id: "east",
        label: "East",
        direction: 270,
        signalX: 588,
        signalY: 416,
        queueAxis: "x",
        queueDirection: 1,
        fixedPosition: 394,
        stopLine: 532,
        colors: BASE_COLORS,
        movementLanes: [threeEastThrough, threeEastRight],
      },
      {
        id: "west",
        label: "West",
        direction: 90,
        signalX: 312,
        signalY: 304,
        queueAxis: "x",
        queueDirection: -1,
        fixedPosition: 326,
        stopLine: 368,
        colors: BASE_COLORS,
        movementLanes: [threeWestThrough, threeWestLeft],
      },
    ],
    phases: [
      {
        key: "north_turns",
        label: "North Turns",
        approaches: ["north"],
        allowedMovements: [threeNorthLeft.id, threeNorthRight.id],
        scoreLanes: ["north"],
      },
      {
        key: "east_west_main",
        label: "East/West Main",
        approaches: ["east", "west"],
        allowedMovements: [threeEastThrough.id, threeEastRight.id, threeWestThrough.id, threeWestLeft.id],
        scoreLanes: ["east", "west"],
      },
    ],
    movementConflicts: createMovementConflictMap([
      {
        key: "north_turns",
        label: "North Turns",
        approaches: ["north"],
        allowedMovements: [threeNorthLeft.id, threeNorthRight.id],
        scoreLanes: ["north"],
      },
      {
        key: "east_west_main",
        label: "East/West Main",
        approaches: ["east", "west"],
        allowedMovements: [threeEastThrough.id, threeEastRight.id, threeWestThrough.id, threeWestLeft.id],
        scoreLanes: ["east", "west"],
      },
    ]),
    roads: [
      { id: "sidewalk-vertical-top", x: 380, y: 0, width: 140, height: 360, fill: SIDEWALK },
      { id: "sidewalk-horizontal", x: 0, y: 290, width: 900, height: 140, fill: SIDEWALK },
      { id: "road-vertical-top", x: 400, y: 0, width: 100, height: 360, fill: ROAD },
      { id: "road-horizontal", x: 0, y: 310, width: 900, height: 100, fill: ROAD },
    ],
    laneDividers: [
      { id: "center-vertical", x1: 450, y1: 0, x2: 450, y2: 360, stroke: ROAD_DASH, strokeWidth: 2, dashArray: "14 10" },
      { id: "center-horizontal", x1: 0, y1: 360, x2: 900, y2: 360, stroke: ROAD_DASH, strokeWidth: 2, dashArray: "14 10" },
    ],
    roadEdges: [
      { id: "edge-v-left", x1: 400, y1: 0, x2: 400, y2: 360, stroke: ROAD_EDGE, strokeWidth: 2 },
      { id: "edge-v-right", x1: 500, y1: 0, x2: 500, y2: 360, stroke: ROAD_EDGE, strokeWidth: 2 },
      { id: "edge-h-top", x1: 0, y1: 310, x2: 900, y2: 310, stroke: ROAD_EDGE, strokeWidth: 2 },
      { id: "edge-h-bottom", x1: 0, y1: 410, x2: 900, y2: 410, stroke: ROAD_EDGE, strokeWidth: 2 },
    ],
    stopLines: [
      { id: "stop-north", x1: 400, y1: 278, x2: 500, y2: 278, stroke: STOP, strokeWidth: 4 },
      { id: "stop-east", x1: 532, y1: 310, x2: 532, y2: 410, stroke: STOP, strokeWidth: 4 },
      { id: "stop-west", x1: 368, y1: 310, x2: 368, y2: 410, stroke: STOP, strokeWidth: 4 },
    ],
    crosswalks: [zebraNorth("cross-north", 256), zebraEast("cross-east", 554), zebraWest("cross-west", 346)],
  },
  "4way": {
    type: "4way",
    lanes: [
      {
        id: "north",
        label: "North",
        direction: 180,
        signalX: 506,
        signalY: 240,
        queueAxis: "y",
        queueDirection: -1,
        fixedPosition: 474,
        stopLine: 278,
        colors: BASE_COLORS,
        movementLanes: [northLeft, northThrough, northRight],
      },
      {
        id: "south",
        label: "South",
        direction: 0,
        signalX: 394,
        signalY: 480,
        queueAxis: "y",
        queueDirection: 1,
        fixedPosition: 426,
        stopLine: 442,
        colors: BASE_COLORS,
        movementLanes: [southLeft, southThrough, southRight],
      },
      {
        id: "east",
        label: "East",
        direction: 270,
        signalX: 588,
        signalY: 416,
        queueAxis: "x",
        queueDirection: 1,
        fixedPosition: 394,
        stopLine: 532,
        colors: BASE_COLORS,
        movementLanes: [eastLeft, eastThrough, eastRight],
      },
      {
        id: "west",
        label: "West",
        direction: 90,
        signalX: 312,
        signalY: 304,
        queueAxis: "x",
        queueDirection: -1,
        fixedPosition: 326,
        stopLine: 368,
        colors: BASE_COLORS,
        movementLanes: [westLeft, westThrough, westRight],
      },
    ],
    phases: [
      {
        key: "ns_left",
        label: "N/S Left",
        approaches: ["north", "south"],
        allowedMovements: [northLeft.id, southLeft.id],
        scoreLanes: ["north", "south"],
      },
      {
        key: "ns_main",
        label: "N/S Through + Right",
        approaches: ["north", "south"],
        allowedMovements: [northThrough.id, northRight.id, southThrough.id, southRight.id],
        scoreLanes: ["north", "south"],
      },
      {
        key: "ew_left",
        label: "E/W Left",
        approaches: ["east", "west"],
        allowedMovements: [eastLeft.id, westLeft.id],
        scoreLanes: ["east", "west"],
      },
      {
        key: "ew_main",
        label: "E/W Through + Right",
        approaches: ["east", "west"],
        allowedMovements: [eastThrough.id, eastRight.id, westThrough.id, westRight.id],
        scoreLanes: ["east", "west"],
      },
    ],
    movementConflicts: createMovementConflictMap([
      {
        key: "ns_left",
        label: "N/S Left",
        approaches: ["north", "south"],
        allowedMovements: [northLeft.id, southLeft.id],
        scoreLanes: ["north", "south"],
      },
      {
        key: "ns_main",
        label: "N/S Through + Right",
        approaches: ["north", "south"],
        allowedMovements: [northThrough.id, northRight.id, southThrough.id, southRight.id],
        scoreLanes: ["north", "south"],
      },
      {
        key: "ew_left",
        label: "E/W Left",
        approaches: ["east", "west"],
        allowedMovements: [eastLeft.id, westLeft.id],
        scoreLanes: ["east", "west"],
      },
      {
        key: "ew_main",
        label: "E/W Through + Right",
        approaches: ["east", "west"],
        allowedMovements: [eastThrough.id, eastRight.id, westThrough.id, westRight.id],
        scoreLanes: ["east", "west"],
      },
    ]),
    roads: [
      { id: "sidewalk-vertical", x: 360, y: 0, width: 180, height: 720, fill: SIDEWALK },
      { id: "sidewalk-horizontal", x: 0, y: 270, width: 900, height: 180, fill: SIDEWALK },
      { id: "road-vertical", x: 390, y: 0, width: 120, height: 720, fill: ROAD },
      { id: "road-horizontal", x: 0, y: 300, width: 900, height: 120, fill: ROAD },
    ],
    laneDividers: [
      { id: "center-vertical", x1: 450, y1: 0, x2: 450, y2: 720, stroke: ROAD_DASH, strokeWidth: 2, dashArray: "14 10" },
      { id: "v-lane-1", x1: 426, y1: 0, x2: 426, y2: 720, stroke: LANE_MARK, strokeWidth: 1.5, dashArray: "12 12" },
      { id: "v-lane-2", x1: 474, y1: 0, x2: 474, y2: 720, stroke: LANE_MARK, strokeWidth: 1.5, dashArray: "12 12" },
      { id: "center-horizontal", x1: 0, y1: 360, x2: 900, y2: 360, stroke: ROAD_DASH, strokeWidth: 2, dashArray: "14 10" },
      { id: "h-lane-1", x1: 0, y1: 336, x2: 900, y2: 336, stroke: LANE_MARK, strokeWidth: 1.5, dashArray: "12 12" },
      { id: "h-lane-2", x1: 0, y1: 384, x2: 900, y2: 384, stroke: LANE_MARK, strokeWidth: 1.5, dashArray: "12 12" },
    ],
    roadEdges: [
      { id: "edge-v-left", x1: 390, y1: 0, x2: 390, y2: 720, stroke: ROAD_EDGE, strokeWidth: 2 },
      { id: "edge-v-right", x1: 510, y1: 0, x2: 510, y2: 720, stroke: ROAD_EDGE, strokeWidth: 2 },
      { id: "edge-h-top", x1: 0, y1: 300, x2: 900, y2: 300, stroke: ROAD_EDGE, strokeWidth: 2 },
      { id: "edge-h-bottom", x1: 0, y1: 420, x2: 900, y2: 420, stroke: ROAD_EDGE, strokeWidth: 2 },
    ],
    stopLines: [
      { id: "stop-north", x1: 390, y1: 278, x2: 510, y2: 278, stroke: STOP, strokeWidth: 4 },
      { id: "stop-south", x1: 390, y1: 442, x2: 510, y2: 442, stroke: STOP, strokeWidth: 4 },
      { id: "stop-east", x1: 532, y1: 300, x2: 532, y2: 420, stroke: STOP, strokeWidth: 4 },
      { id: "stop-west", x1: 368, y1: 300, x2: 368, y2: 420, stroke: STOP, strokeWidth: 4 },
    ],
    crosswalks: [zebraNorth("cross-north", 256), zebraSouth("cross-south", 464), zebraEast("cross-east", 554), zebraWest("cross-west", 346)],
  },
};

export function getIntersectionLayout(type: IntersectionType): IntersectionLayout {
  return LAYOUTS[type];
}
