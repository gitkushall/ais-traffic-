import {
  IntersectionType,
  LaneId,
  MovementLane,
  PedestrianState,
  SignalStage,
  TurnIntent,
  VehicleMotionState,
  WeatherMode,
} from "@/lib/simulation/domain/enums";

export type CrosswalkSignalState = "walk" | "dont_walk";
export type EmergencyVehicleType = "ambulance" | "police" | "fire_truck";
export type ControllerMode =
  | "normal_adaptive"
  | "emergency_requested"
  | "preempt_transition"
  | "emergency_serving"
  | "recovery"
  | "fixed_cycle";

export type ComparisonStats = {
  adaptiveThroughput: number;
  fixedThroughput: number;
  adaptiveAvgWait: number;
  fixedAvgWait: number;
  adaptiveQueue: number;
  fixedQueue: number;
};

export type EmergencyPriorityState = {
  vehicleId: string;
  type: EmergencyVehicleType;
  laneId: LaneId;
  movementLane: MovementLane;
  intent: TurnIntent;
  movementId: string;
  phaseKey: string;
  phaseLabel: string;
  distanceToStop: number;
  priorityScore: number;
  detected: boolean;
  preemptionActive: boolean;
};

export type LaneState = {
  id: LaneId;
  label: string;
  direction: number;
  carCount: number;
  queueLength: number;
  pedestrianCount: number;
  waitingTime: number;
  score: number;
  isGreen: boolean;
};

export type IntersectionState = {
  type: IntersectionType;
  tick: number;
  stage: SignalStage;
  controllerMode: ControllerMode;
  currentPhaseKey: string;
  currentPhaseLabel: string;
  currentPhase: LaneId[];
  nextPhaseKey: string;
  nextPhaseLabel: string;
  nextPhase: LaneId[];
  allowedMovements: string[];
  nextAllowedMovements: string[];
  crosswalkSignals: Record<string, CrosswalkSignalState>;
  greenRemaining: number;
  activePhaseElapsed: number;
  controllerReason: string;
  phaseScores: Record<string, number>;
  phaseReasonMap: Record<string, string>;
  weatherMode: WeatherMode;
  lanes: LaneState[];
  emergencyState: EmergencyPriorityState | null;
  emergencyServedCount: number;
  pedestrianServedCount: number;
};

export type SimulationWeights = {
  density: number;
  wait: number;
  pedestrian: number;
};

export type VehicleRenderState = {
  id: string;
  laneId: LaneId;
  movementLane: MovementLane;
  x: number;
  y: number;
  heading: number;
  color: string;
  intent: TurnIntent;
  committed: boolean;
};

export type VehicleAgentState = {
  id: string;
  laneId: LaneId;
  movementLane: MovementLane;
  pathId: string;
  x: number;
  y: number;
  heading: number;
  color: string;
  intent: TurnIntent;
  state: VehicleMotionState;
  speed: number;
  desiredSpeed: number;
  maxSpeed: number;
  turnSpeed: number;
  acceleration: number;
  braking: number;
  minimumGap: number;
  comfortableGap: number;
  progress: number;
  holdProgress: number;
  stopProgress: number;
  routeLength: number;
  committed: boolean;
  clearedStopLine: boolean;
  inBox: boolean;
  reactionDelay: number;
  reactionTimer: number;
  bodyLength: number;
  bodyWidth: number;
  leadVehicleId: string | null;
  gapToLeader: number;
  waitReason: "movement_red" | "lead_vehicle" | "clear" | "clearance" | "crosswalk" | "blocked_intersection" | "no_exit_space";
  emergencyType: EmergencyVehicleType | null;
  emergencyPriority: number;
  emergencyDetected: boolean;
};

export type PedestrianAgentState = {
  id: string;
  laneId: LaneId;
  crossingId: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  speed: number;
  state: PedestrianState;
  committed: boolean;
  progress: number;
  waitTimer: number;
  startDelay: number;
  color: string;
  // Building entry/exit walk
  buildingEntryX: number;
  buildingEntryY: number;
  destEntryX: number;
  destEntryY: number;
  buildingWalkProgress: number;
};

export type ScenarioPreset = "normal" | "rush_hour" | "off_peak" | "event_surge";

export type MetricSample = {
  tick: number;
  vehiclesServed: number;
  avgWaitSeconds: number;
  totalQueue: number;
};

export type SimulationCommand =
  | { type: "setIntersectionType"; intersectionType: IntersectionType }
  | { type: "toggleRunning" }
  | { type: "toggleDebug" }
  | { type: "setSpeed"; speed: number }
  | { type: "setWeights"; weights: SimulationWeights }
  | { type: "cycleWeather" }
  | { type: "spawnEmergency" }
  | { type: "setScenario"; scenario: ScenarioPreset }
  | { type: "toggleControllerMode" };
