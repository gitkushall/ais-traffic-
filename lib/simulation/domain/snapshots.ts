import { IntersectionType, LaneId, MovementLane, TurnIntent, WeatherMode } from "@/lib/simulation/domain/enums";
import { ControllerMode, EmergencyVehicleType, SimulationWeights } from "@/lib/simulation/domain/models";

export type DashboardLaneSnapshot = {
  id: LaneId;
  label: string;
  score: number;
  queueLength: number;
  carCount: number;
  waitSeconds: number;
};

export type DashboardPhaseSnapshot = {
  currentLabel: string;
  nextLabel: string;
  greenRemaining: number;
  stageLabel: string;
  reason: string;
  walkCrossings: string[];
  controllerMode: ControllerMode;
  preemptionActive: boolean;
  emergency: {
    detected: boolean;
    type: EmergencyVehicleType | null;
    laneId: LaneId | null;
    movementLane: MovementLane | null;
    distanceToStop: number | null;
  };
};

export type DashboardControlsSnapshot = {
  running: boolean;
  debug: boolean;
  speed: number;
  weights: SimulationWeights;
  weather: WeatherMode;
};

export type DashboardSnapshot = {
  intersectionType: IntersectionType;
  lanes: DashboardLaneSnapshot[];
  phase: DashboardPhaseSnapshot;
  controls: DashboardControlsSnapshot;
  weatherLabel: string;
  analytics: {
    tick: number;
    stage: string;
    phaseScores: Array<{ key: string; score: number }>;
    emergencyServedCount: number;
    pedestrianServedCount: number;
  };
};

export type SceneVehicleSnapshot = {
  id: string;
  pathId: string;
  x: number;
  y: number;
  heading: number;
  color: string;
  intent: TurnIntent;
  movementLane: MovementLane;
  state: string;
  committed: boolean;
  brakeLights: boolean;
  progress: number;
  leadVehicleId: string | null;
  gapToLeader: number;
  waitReason: string;
  emergencyType: EmergencyVehicleType | null;
  emergencyDetected: boolean;
};

export type ScenePedestrianSnapshot = {
  id: string;
  crossingId: string;
  x: number;
  y: number;
  color: string;
};

export type SceneRoadRectSnapshot = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
};

export type SceneLineSnapshot = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  dashArray?: string;
};

export type SceneCrosswalkSnapshot = {
  id: string;
  state: "walk" | "dont_walk";
  stripes: Array<{ x: number; y: number; width: number; height: number }>;
};

export type SceneLaneSnapshot = {
  id: LaneId;
  label: string;
  vehicles: SceneVehicleSnapshot[];
};

export type SceneSignalSnapshot = {
  id: string;
  x: number;
  y: number;
  red: string;
  amber: string;
  green: string;
};

export type SceneDebugPathSnapshot = {
  id: string;
  label: string;
  color: string;
  points: Array<{ x: number; y: number }>;
};

export type SceneDebugStopSnapshot = {
  id: string;
  x: number;
  y: number;
  reserved: boolean;
  label: string;
};

export type SceneSnapshot = {
  intersectionType: IntersectionType;
  phaseLabel: string;
  signalStageLabel: string;
  weatherMode: WeatherMode;
  debug: boolean;
  roads: SceneRoadRectSnapshot[];
  laneDividers: SceneLineSnapshot[];
  roadEdges: SceneLineSnapshot[];
  stopLines: SceneLineSnapshot[];
  crosswalks: SceneCrosswalkSnapshot[];
  lanes: SceneLaneSnapshot[];
  signals: SceneSignalSnapshot[];
  pedestrians: ScenePedestrianSnapshot[];
  debugPaths: SceneDebugPathSnapshot[];
  debugStops: SceneDebugStopSnapshot[];
};

export type SimulationSnapshot = {
  dashboard: DashboardSnapshot;
  scene: SceneSnapshot;
};
