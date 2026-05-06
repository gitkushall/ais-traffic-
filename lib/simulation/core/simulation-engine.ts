import { ScoringEngine } from "@/lib/simulation/ai/scoring-engine";
import {
  getIntersectionLayout,
  IntersectionLayout,
  LaneLayout,
  MovementLaneLayout,
} from "@/lib/simulation/core/intersection-layout";
import { SignalController } from "@/lib/simulation/core/signal-controller";
import { IntersectionType, LaneId, WeatherMode } from "@/lib/simulation/domain/enums";
import {
  CrosswalkSignalState,
  EmergencyPriorityState,
  EmergencyVehicleType,
  IntersectionState,
  LaneState,
  MetricSample,
  PedestrianAgentState,
  ScenarioPreset,
  SimulationCommand,
  SimulationWeights,
  VehicleAgentState,
} from "@/lib/simulation/domain/models";
import {
  SceneDebugPathSnapshot,
  SceneSignalSnapshot,
  SceneSnapshot,
  SimulationSnapshot,
} from "@/lib/simulation/domain/snapshots";
import { createSidebarSnapshot } from "@/lib/simulation/view-models/sidebar-view-model";

const DEFAULT_WEIGHTS: SimulationWeights = {
  density: 0.5,
  wait: 0.3,
  pedestrian: 0.2,
};
const MIN_FOLLOWING_GAP = 22;
const COMFORTABLE_FOLLOWING_GAP = 44;
const VEHICLE_COLLISION_BOX = { width: 16, height: 28 };
const PEDESTRIAN_COLLISION_BOX = { size: 8 };
const MAX_APPROACH_QUEUE = 8;
const PLATOON_RELEASE_WINDOW = 0.5;
const PLATOON_RELEASE_SPACING = 0.18;

// Vehicle type profiles: [bodyLength, bodyWidth, maxSpeedBase, accel, braking, minGap, comfortGap]
// Distribution: compact 20%, sedan 40%, sport 10%, SUV 20%, truck 10%
const VEHICLE_PROFILES = [
  { bodyLength: 20, bodyWidth: 11, maxSpeedBase: 2.0, accel: 5.0, braking: 7.5, minGap: 22, comfortGap: 36 }, // compact
  { bodyLength: 24, bodyWidth: 13, maxSpeedBase: 2.1, accel: 4.2, braking: 6.6, minGap: 26, comfortGap: 42 }, // sedan
  { bodyLength: 24, bodyWidth: 13, maxSpeedBase: 2.45, accel: 4.8, braking: 7.0, minGap: 25, comfortGap: 40 }, // sport sedan
  { bodyLength: 24, bodyWidth: 13, maxSpeedBase: 1.95, accel: 4.0, braking: 6.4, minGap: 28, comfortGap: 44 }, // sedan (cautious)
  { bodyLength: 28, bodyWidth: 14, maxSpeedBase: 1.9, accel: 3.8, braking: 6.2, minGap: 30, comfortGap: 48 }, // SUV
  { bodyLength: 28, bodyWidth: 14, maxSpeedBase: 2.05, accel: 3.6, braking: 6.0, minGap: 32, comfortGap: 50 }, // SUV (large)
  { bodyLength: 20, bodyWidth: 11, maxSpeedBase: 2.2, accel: 5.2, braking: 7.8, minGap: 20, comfortGap: 34 }, // compact (agile)
  { bodyLength: 24, bodyWidth: 13, maxSpeedBase: 2.3, accel: 4.5, braking: 6.8, minGap: 26, comfortGap: 42 }, // sedan
  { bodyLength: 32, bodyWidth: 15, maxSpeedBase: 1.65, accel: 2.9, braking: 5.6, minGap: 38, comfortGap: 56 }, // truck/van
  { bodyLength: 28, bodyWidth: 14, maxSpeedBase: 1.8, accel: 3.5, braking: 5.9, minGap: 32, comfortGap: 50 }, // SUV
] as const;

const WEATHER_ORDER: WeatherMode[] = ["clear", "rain", "fog", "night"];
const EMERGENCY_TYPES: EmergencyVehicleType[] = ["ambulance", "police", "fire_truck"];

type Point = { x: number; y: number };

type MovementRoute = {
  id: string;
  laneId: LaneId;
  movementLane: MovementLaneLayout["lane"];
  intent: MovementLaneLayout["intent"];
  exitLaneId: LaneId;
  points: Point[];
  cumulative: number[];
  length: number;
  holdProgress: number;
  stopProgress: number;
  coreEndProgress: number;
};

function normalizeWeights(weights: SimulationWeights): SimulationWeights {
  const total = weights.density + weights.wait + weights.pedestrian;
  if (total <= 0) {
    return DEFAULT_WEIGHTS;
  }
  return {
    density: weights.density / total,
    wait: weights.wait / total,
    pedestrian: weights.pedestrian / total,
  };
}

function weatherFactors(weather: WeatherMode) {
  if (weather === "rain") {
    return { speed: 0.84, braking: 0.82, headway: 1.2, pedestrian: 1.05, spawn: 0.92 };
  }
  if (weather === "fog") {
    return { speed: 0.76, braking: 0.78, headway: 1.28, pedestrian: 0.96, spawn: 0.88 };
  }
  if (weather === "night") {
    return { speed: 0.9, braking: 0.9, headway: 1.1, pedestrian: 0.92, spawn: 0.82 };
  }
  return { speed: 1, braking: 1, headway: 1, pedestrian: 1, spawn: 1 };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
    y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
  };
}

function cubicPoint(start: Point, control1: Point, control2: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * start.x +
      3 * mt * mt * t * control1.x +
      3 * mt * t * t * control2.x +
      t * t * t * end.x,
    y:
      mt * mt * mt * start.y +
      3 * mt * mt * t * control1.y +
      3 * mt * t * t * control2.y +
      t * t * t * end.y,
  };
}

function headingFromVector(dx: number, dy: number) {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function routeColor(id: string) {
  const palette = [
    "rgba(255,255,255,0.22)",
    "rgba(244,208,63,0.22)",
    "rgba(93,173,226,0.22)",
    "rgba(236,112,99,0.22)",
    "rgba(88,214,141,0.22)",
  ];
  let hash = 0;
  for (const char of id) {
    hash = (hash * 33 + char.charCodeAt(0)) % 997;
  }
  return palette[hash % palette.length];
}

function stageDisplayLabel(stage: IntersectionState["stage"]) {
  if (stage === "amber") {
    return "YELLOW";
  }
  if (stage === "all_red") {
    return "ALL RED";
  }
  return "GREEN";
}

const SCENARIO_SETTINGS: Record<string, { spawnMultiplier: number; speedHint: number; weatherHint: WeatherMode; label: string }> = {
  normal:      { spawnMultiplier: 1.0,  speedHint: 1.0, weatherHint: "clear",  label: "Normal Flow" },
  rush_hour:   { spawnMultiplier: 2.4,  speedHint: 1.0, weatherHint: "clear",  label: "Rush Hour" },
  off_peak:    { spawnMultiplier: 0.35, speedHint: 1.0, weatherHint: "clear",  label: "Off-Peak" },
  event_surge: { spawnMultiplier: 3.2,  speedHint: 1.0, weatherHint: "rain",   label: "Event Surge" },
};

export class SimulationEngine {
  private intersectionType: IntersectionType = "4way";
  private weights: SimulationWeights = DEFAULT_WEIGHTS;
  private running = true;
  private debug = false;
  private speed = 1;
  private weather: WeatherMode = "clear";
  private activeScenario: ScenarioPreset = "normal";
  private spawnMultiplier = 1.0;
  private vehiclesServedCount = 0;
  private metricsHistory: MetricSample[] = [];
  private metricsTimer = 0;
  private recentServedCount = 0;
  private isFixedCycle = false;
  private fixedCycleTimer = 0;
  private fixedCyclePhaseIndex = 0;
  private fixedCycleGreen = 30;
  private comparisonAdaptiveServed = 0;
  private comparisonFixedServed = 0;
  private comparisonAdaptiveWait = 0;
  private comparisonFixedWait = 0;
  private comparisonAdaptiveQueue = 0;
  private comparisonFixedQueue = 0;
  private comparisonSamples = 0;
  private intersection!: IntersectionState;
  private signalController = new SignalController(10, 3, 1.5, 1.08);
  private lastDecision = {
    key: "ns_left",
    label: "N/S Left",
    phase: ["north", "south"] as LaneId[],
    allowedMovements: [] as string[],
    score: 0,
    rankedPhases: [] as Array<{ key: string; label: string; phase: LaneId[]; allowedMovements: string[]; score: number }>,
    scores: {} as Record<string, number>,
    queues: {} as Record<string, number>,
    waits: {} as Record<string, number>,
    reasons: {} as Record<string, string>,
    emergency: null as EmergencyPriorityState | null,
  };
  private aiTimer = 0;
  private vehicleCounter = 0;
  private pedestrianCounter = 0;
  private vehicles = new Map<LaneId, VehicleAgentState[]>();
  private pedestrians = new Map<LaneId, PedestrianAgentState[]>();
  private pedestrianSpawnTimers = new Map<LaneId, number>();
  private routeCache = new Map<string, MovementRoute>();
  private conflictCache = new Map<string, boolean>();
  private routeCrosswalkCache = new Map<string, string[]>();
  private laneDemandLevels = new Map<LaneId, number>();
  private movementDemandLevels = new Map<string, number>();
  private laneWasGreen = new Map<LaneId, boolean>();
  private laneGreenElapsed = new Map<LaneId, number>();
  private lanePlatoonRemaining = new Map<LaneId, number>();
  private lanePlatoonAccumulator = new Map<LaneId, number>();
  private servedEmergencyIds = new Set<string>();

  constructor() {
    this.intersection = this.createIntersection(this.intersectionType);
    this.resetDynamicState(this.intersectionType);
  }

  dispatch(command: SimulationCommand) {
    if (command.type === "setIntersectionType") {
      this.intersectionType = command.intersectionType;
      this.intersection = this.createIntersection(command.intersectionType);
      this.resetDynamicState(command.intersectionType);
      this.aiTimer = 0;
      return;
    }
    if (command.type === "toggleRunning") {
      this.running = !this.running;
      return;
    }
    if (command.type === "toggleDebug") {
      this.debug = !this.debug;
      return;
    }
    if (command.type === "setSpeed") {
      this.speed = command.speed;
      return;
    }
    if (command.type === "setWeights") {
      this.weights = normalizeWeights(command.weights);
      return;
    }
    if (command.type === "cycleWeather") {
      const index = WEATHER_ORDER.indexOf(this.weather);
      this.weather = WEATHER_ORDER[(index + 1) % WEATHER_ORDER.length];
      return;
    }
    if (command.type === "spawnEmergency") {
      this.spawnEmergencyVehicle(getIntersectionLayout(this.intersectionType));
      return;
    }
    if (command.type === "setScenario") {
      const settings = SCENARIO_SETTINGS[command.scenario];
      this.activeScenario = command.scenario;
      this.spawnMultiplier = settings.spawnMultiplier;
      this.weather = settings.weatherHint;
      return;
    }
    if (command.type === "toggleControllerMode") {
      this.isFixedCycle = !this.isFixedCycle;
      this.fixedCycleTimer = 0;
      // Reset comparison counters for a fresh comparison
      this.comparisonAdaptiveServed = 0;
      this.comparisonFixedServed = 0;
      this.comparisonAdaptiveWait = 0;
      this.comparisonFixedWait = 0;
      this.comparisonAdaptiveQueue = 0;
      this.comparisonFixedQueue = 0;
      this.comparisonSamples = 0;
      return;
    }
  }

  tick(dtSeconds: number) {
    if (!this.running) {
      return;
    }

    const dt = dtSeconds * this.speed;
    const layout = getIntersectionLayout(this.intersectionType);
    const factors = weatherFactors(this.weather);

    this.aiTimer += dt;
    this.updateDemandPatterns(layout, dt);
    this.spawnVehicles(layout, dt, factors.spawn);
    this.spawnPedestrians(layout, dt);

    let lanes = this.buildLaneStates(layout);
    const movementDemand = this.buildMovementDemand(layout, lanes);
    const emergencyState = this.detectEmergencyPriority(layout);
    const scorer = new ScoringEngine(this.weights);
    lanes = scorer.scoreIntersection(lanes);

    if (this.aiTimer >= 0.6 || this.lastDecision.phase.length === 0 || emergencyState !== null) {
      this.lastDecision = scorer.selectPhase(layout, lanes, movementDemand, emergencyState);
      this.aiTimer = 0;
    }

    // Fixed-cycle mode: override AI decision with round-robin phases on a 30s timer
    let effectiveDecision = this.lastDecision;
    if (this.isFixedCycle) {
      this.fixedCycleTimer += dt;
      const phases = layout.phases;
      if (phases.length > 0) {
        const currentFixed = phases[this.fixedCyclePhaseIndex % phases.length];
        if (this.fixedCycleTimer >= this.fixedCycleGreen) {
          this.fixedCycleTimer = 0;
          this.fixedCyclePhaseIndex = (this.fixedCyclePhaseIndex + 1) % phases.length;
        }
        const fixedPhase = phases[this.fixedCyclePhaseIndex % phases.length];
        effectiveDecision = {
          ...this.lastDecision,
          key: fixedPhase.key,
          label: fixedPhase.label,
          phase: fixedPhase.approaches as LaneId[],
          allowedMovements: fixedPhase.approaches,
          score: 0,
          emergency: null,
          reasons: { [fixedPhase.key]: `Fixed cycle — ${this.fixedCycleGreen}s per phase` },
        };
      }
    }

    const nextState = this.signalController.tick(
      {
        ...this.intersection,
        tick: this.intersection.tick + 1,
        weatherMode: this.weather,
        lanes,
        controllerMode: this.isFixedCycle ? "fixed_cycle" : this.intersection.controllerMode,
      },
      effectiveDecision,
      dt,
    );

    this.intersection = {
      ...nextState,
      weatherMode: this.weather,
      emergencyState,
      controllerMode: this.isFixedCycle ? "fixed_cycle" : nextState.controllerMode,
      controllerReason: this.isFixedCycle
        ? `Fixed ${this.fixedCycleGreen}s cycle — ${Math.max(0, this.fixedCycleGreen - this.fixedCycleTimer).toFixed(0)}s remaining`
        : nextState.controllerReason,
      crosswalkSignals: this.buildCrosswalkSignals(layout, nextState.currentPhaseKey, nextState.stage, emergencyState),
    };

    this.updatePedestrians(layout, dt, factors.pedestrian);
    this.updateVehicles(layout, dt, factors);
    this.recordMetricsSample(layout, dt);
  }

  snapshot(): SimulationSnapshot {
    const layout = getIntersectionLayout(this.intersection.type);
    const dashboard = createSidebarSnapshot(
      this.intersection,
      this.weights,
      this.running,
      this.debug,
      this.speed,
      this.weather,
      this.vehiclesServedCount,
      this.metricsHistory,
      this.activeScenario,
      this.isFixedCycle,
      {
        adaptiveThroughput: this.comparisonAdaptiveServed,
        fixedThroughput: this.comparisonFixedServed,
        adaptiveAvgWait: Math.round(this.comparisonAdaptiveWait * 10) / 10,
        fixedAvgWait: Math.round(this.comparisonFixedWait * 10) / 10,
        adaptiveQueue: Math.round(this.comparisonAdaptiveQueue * 10) / 10,
        fixedQueue: Math.round(this.comparisonFixedQueue * 10) / 10,
      },
    );

    const debugPaths: SceneDebugPathSnapshot[] = layout.lanes.flatMap((laneLayout) =>
      laneLayout.movementLanes.map((movementLane) => {
        const route = this.getRoute(movementLane);
        return {
          id: route.id,
          label: route.id,
          color: routeColor(route.id),
          points: route.points,
        };
      }),
    );

    const reservedRoutes = new Set(this.activeReservedRouteIds(layout));
    const debugStops = layout.lanes.flatMap((laneLayout) =>
      laneLayout.movementLanes.map((movementLane) => {
        const route = this.getRoute(movementLane);
        const pose = this.routePose(route, route.holdProgress);
        return {
          id: `${route.id}-stop`,
          x: pose.point.x,
          y: pose.point.y,
          reserved: reservedRoutes.has(route.id),
          label: `${laneLayout.id}/${movementLane.lane}`,
        };
      }),
    );

    const scene: SceneSnapshot = {
      intersectionType: this.intersection.type,
      phaseLabel: this.intersection.currentPhaseLabel,
      signalStageLabel: stageDisplayLabel(this.intersection.stage),
      weatherMode: this.weather,
      debug: this.debug,
      roads: layout.roads,
      laneDividers: layout.laneDividers,
      roadEdges: layout.roadEdges,
      stopLines: layout.stopLines,
      crosswalks: layout.crosswalks.map((crosswalk) => ({
        ...crosswalk,
        state: this.intersection.crosswalkSignals[crosswalk.id] ?? "dont_walk",
      })),
      lanes: layout.lanes.map((laneLayout) => ({
        id: laneLayout.id,
        label: laneLayout.label,
        vehicles: (this.vehicles.get(laneLayout.id) ?? []).map((vehicle) => ({
          id: vehicle.id,
          pathId: vehicle.pathId,
          x: vehicle.x,
          y: vehicle.y,
          heading: vehicle.heading,
          color: vehicle.color,
          intent: vehicle.intent,
          movementLane: vehicle.movementLane,
          state: vehicle.state,
          committed: vehicle.committed,
          brakeLights: vehicle.speed < vehicle.maxSpeed * 0.15 && !vehicle.clearedStopLine,
          progress: vehicle.progress,
          inBox: vehicle.inBox,
          leadVehicleId: vehicle.leadVehicleId,
          gapToLeader: vehicle.gapToLeader,
          waitReason: vehicle.waitReason,
          emergencyType: vehicle.emergencyType,
          emergencyDetected: vehicle.emergencyDetected,
          bodyLength: vehicle.bodyLength,
          bodyWidth: vehicle.bodyWidth,
        })),
      })),
      signals: layout.lanes.map((laneLayout) => this.signalSnapshot(layout, laneLayout, laneLayout.signalX, laneLayout.signalY)),
      pedestrians: Array.from(this.pedestrians.values()).flat().map((pedestrian) => ({
        id: pedestrian.id,
        crossingId: pedestrian.crossingId,
        x: pedestrian.x,
        y: pedestrian.y,
        color: pedestrian.color,
        progress: pedestrian.progress,
        committed: pedestrian.committed,
        state: pedestrian.state,
      })),
      debugPaths,
      debugStops,
    };

    return { dashboard, scene };
  }

  private createIntersection(type: IntersectionType): IntersectionState {
    const layout = getIntersectionLayout(type);
    const initialPhase = layout.phases[0];
    const nextPhase = layout.phases[1] ?? layout.phases[0];
    const lanes: LaneState[] = layout.lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      direction: lane.direction,
      carCount: 0,
      queueLength: 0,
      pedestrianCount: 0,
      waitingTime: 0,
      score: 0,
      isGreen: initialPhase.approaches.includes(lane.id),
    }));

    this.lastDecision = {
      key: initialPhase.key,
      label: initialPhase.label,
      phase: [...initialPhase.approaches],
      allowedMovements: [...initialPhase.allowedMovements],
      score: 0,
      rankedPhases: [],
      scores: {},
      queues: {},
      waits: {},
      reasons: {},
      emergency: null,
    };

    return {
      type,
      tick: 0,
      stage: "green",
      controllerMode: "normal_adaptive",
      currentPhaseKey: initialPhase.key,
      currentPhaseLabel: initialPhase.label,
      currentPhase: [...initialPhase.approaches],
      nextPhaseKey: nextPhase.key,
      nextPhaseLabel: nextPhase.label,
      nextPhase: [...nextPhase.approaches],
      allowedMovements: [...initialPhase.allowedMovements],
      nextAllowedMovements: [...nextPhase.allowedMovements],
      crosswalkSignals: this.buildCrosswalkSignals(layout, initialPhase.key, "green", null),
      greenRemaining: 12,
      activePhaseElapsed: 0,
      controllerReason: "Initial adaptive release",
      phaseScores: {},
      phaseReasonMap: {},
      weatherMode: this.weather,
      lanes,
      emergencyState: null,
      emergencyServedCount: 0,
      pedestrianServedCount: 0,
    };
  }

  private resetDynamicState(type: IntersectionType) {
    const layout = getIntersectionLayout(type);
    this.vehicles = new Map();
    this.pedestrians = new Map();
    this.pedestrianSpawnTimers = new Map();
    this.routeCache = new Map();
    this.conflictCache = new Map();
    this.routeCrosswalkCache = new Map();
    this.laneDemandLevels = new Map();
    this.movementDemandLevels = new Map();
    this.laneWasGreen = new Map();
    this.laneGreenElapsed = new Map();
    this.lanePlatoonRemaining = new Map();
    this.lanePlatoonAccumulator = new Map();
    this.servedEmergencyIds = new Set();

    for (const lane of layout.lanes) {
      this.vehicles.set(lane.id, []);
      this.pedestrians.set(lane.id, []);
      this.pedestrianSpawnTimers.set(lane.id, 0);
      this.laneDemandLevels.set(lane.id, 0.95 + (this.hashLane(lane.id) % 5) * 0.05);
      this.laneWasGreen.set(lane.id, false);
      this.laneGreenElapsed.set(lane.id, 0);
      this.lanePlatoonRemaining.set(lane.id, 0);
      this.lanePlatoonAccumulator.set(lane.id, 0);

      for (const movementLane of lane.movementLanes) {
        this.movementDemandLevels.set(
          movementLane.id,
          movementLane.intent === "straight" ? 1.04 : movementLane.intent === "right" ? 0.9 : 0.72,
        );
        const route = this.getRoute(movementLane);
        for (let index = 0; index < 2; index += 1) {
          const seededProgress = Math.max(0, route.stopProgress - (172 + index * 44));
          this.vehicles.get(lane.id)!.push(this.createVehicle(lane, movementLane, seededProgress, route));
        }
      }

      for (let index = 0; index < 2; index += 1) {
        this.pedestrians.get(lane.id)!.push(this.createPedestrian(lane, index * 0.12));
      }
    }

    this.intersection = {
      ...this.intersection,
      lanes: this.buildLaneStates(layout),
    };
  }

  private recordMetricsSample(layout: IntersectionLayout, dt: number) {
    this.metricsTimer += dt;
    if (this.metricsTimer < 5) {
      return;
    }
    this.metricsTimer = 0;
    const allVehicles = Array.from(this.vehicles.values()).flat();
    const waitingVehicles = allVehicles.filter((v) => !v.clearedStopLine);
    const avgWait = waitingVehicles.length > 0
      ? waitingVehicles.reduce((sum, v) => {
          const lane = layout.lanes.find((l) => this.vehicles.get(l.id)?.includes(v));
          const route = lane ? this.getRoute(this.findMovementLane(lane, v)) : null;
          return sum + (route ? Math.max(0, (route.stopProgress - v.progress) / Math.max(0.1, v.maxSpeed)) : 0);
        }, 0) / waitingVehicles.length
      : 0;
    const totalQueue = waitingVehicles.length;
    const sample: MetricSample = {
      tick: this.intersection.tick,
      vehiclesServed: this.recentServedCount,
      avgWaitSeconds: Math.round(avgWait * 10) / 10,
      totalQueue,
    };
    // Update comparison running averages
    this.comparisonSamples += 1;
    if (this.isFixedCycle) {
      this.comparisonFixedServed += this.recentServedCount;
      this.comparisonFixedWait = (this.comparisonFixedWait * (this.comparisonSamples - 1) + avgWait) / this.comparisonSamples;
      this.comparisonFixedQueue = (this.comparisonFixedQueue * (this.comparisonSamples - 1) + totalQueue) / this.comparisonSamples;
    } else {
      this.comparisonAdaptiveServed += this.recentServedCount;
      this.comparisonAdaptiveWait = (this.comparisonAdaptiveWait * (this.comparisonSamples - 1) + avgWait) / this.comparisonSamples;
      this.comparisonAdaptiveQueue = (this.comparisonAdaptiveQueue * (this.comparisonSamples - 1) + totalQueue) / this.comparisonSamples;
    }
    this.recentServedCount = 0;
    this.metricsHistory.push(sample);
    if (this.metricsHistory.length > 60) {
      this.metricsHistory.shift();
    }
  }

  private buildLaneStates(layout: IntersectionLayout): LaneState[] {
    return layout.lanes.map((laneLayout) => {
      const vehicles = this.vehicles.get(laneLayout.id) ?? [];
      const pedestrians = this.pedestrians.get(laneLayout.id) ?? [];
      const queueLength = vehicles.filter((vehicle) => !vehicle.clearedStopLine && vehicle.stopProgress - vehicle.progress < 240).length;
      const green = this.intersection.stage === "green" && this.intersection.currentPhase.includes(laneLayout.id);
      const previous = this.intersection.lanes.find((lane) => lane.id === laneLayout.id);
      const previousWait = previous?.waitingTime ?? 0;
      const waitingTime =
        queueLength === 0
          ? 0
          : green
            ? Math.max(0, previousWait - 0.35)
            : previousWait + 0.15;

      return {
        id: laneLayout.id,
        label: laneLayout.label,
        direction: laneLayout.direction,
        carCount: vehicles.length,
        queueLength,
        pedestrianCount: pedestrians.length,
        waitingTime,
        score: previous?.score ?? 0,
        isGreen: green,
      };
    });
  }

  private buildMovementDemand(
    layout: IntersectionLayout,
    laneStates: LaneState[],
  ): Record<string, { score: number; queue: number; wait: number }> {
    const laneStateMap = new Map(laneStates.map((lane) => [lane.id, lane]));
    const movementDemand: Record<string, { score: number; queue: number; wait: number }> = {};

    for (const lane of layout.lanes) {
      const laneVehicles = this.vehicles.get(lane.id) ?? [];
      const laneState = laneStateMap.get(lane.id);
      for (const movementLane of lane.movementLanes) {
        const route = this.getRoute(movementLane);
        const queued = laneVehicles.filter(
          (vehicle) =>
            vehicle.movementLane === movementLane.lane &&
            vehicle.intent === movementLane.intent &&
            !vehicle.clearedStopLine &&
            route.stopProgress - vehicle.progress < 240,
        ).length;
        const wait = laneState?.waitingTime ?? 0;
        const density = Math.min(queued / 6, 1);
        const waitNorm = Math.min(wait / 45, 1);
        movementDemand[route.id] = {
          score: density * this.weights.density + waitNorm * this.weights.wait + ((laneState?.pedestrianCount ?? 0) / 8) * this.weights.pedestrian * 0.35,
          queue: queued,
          wait,
        };
      }
    }

    return movementDemand;
  }

  private detectEmergencyPriority(layout: IntersectionLayout): EmergencyPriorityState | null {
    let best: EmergencyPriorityState | null = null;

    for (const lane of layout.lanes) {
      for (const vehicle of this.vehicles.get(lane.id) ?? []) {
        if (!vehicle.emergencyType) {
          continue;
        }
        const movementLane = this.findMovementLane(lane, vehicle);
        const route = this.getRoute(movementLane);
        if (vehicle.progress > route.coreEndProgress + 6) {
          continue;
        }
        const distanceToStop = Math.max(0, route.stopProgress - vehicle.progress);
        if (!vehicle.clearedStopLine && distanceToStop > 620) {
          continue;
        }
        const phase = this.phaseForMovement(layout, route.id);
        if (!phase) {
          continue;
        }
        const priorityScore = vehicle.emergencyPriority + Math.max(0, 1.8 - distanceToStop / 150);
        const candidate: EmergencyPriorityState = {
          vehicleId: vehicle.id,
          type: vehicle.emergencyType,
          laneId: vehicle.laneId,
          movementLane: vehicle.movementLane,
          intent: vehicle.intent,
          movementId: route.id,
          phaseKey: phase.key,
          phaseLabel: phase.label,
          distanceToStop,
          priorityScore,
          detected: true,
          preemptionActive: this.intersection.controllerMode === "emergency_requested" || this.intersection.controllerMode === "preempt_transition" || this.intersection.controllerMode === "emergency_serving",
        };
        if (!best || candidate.priorityScore > best.priorityScore || candidate.distanceToStop < best.distanceToStop) {
          best = candidate;
        }
      }
    }

    for (const laneVehicles of this.vehicles.values()) {
      for (const vehicle of laneVehicles) {
        vehicle.emergencyDetected = !!best && best.vehicleId === vehicle.id;
      }
    }

    return best;
  }

  private phaseForMovement(layout: IntersectionLayout, movementId: string) {
    return layout.phases.find((phase) => phase.allowedMovements.includes(movementId)) ?? null;
  }

  private pickEmergencyType(): EmergencyVehicleType {
    return EMERGENCY_TYPES[Math.floor(Math.random() * EMERGENCY_TYPES.length)] ?? "ambulance";
  }

  private spawnEmergencyVehicle(layout: IntersectionLayout) {
    const currentPhaseApproaches = new Set(this.intersection.currentPhase);
    const candidates = layout.lanes.flatMap((lane) =>
      lane.movementLanes.map((movementLane) => {
        const route = this.getRoute(movementLane);
        const laneVehicles = this.vehicles.get(lane.id) ?? [];
        const sameTrackVehicles = laneVehicles
          .filter((vehicle) => this.findMovementLane(lane, vehicle).trackKey === movementLane.trackKey)
          .sort((a, b) => a.progress - b.progress);
        const nearestVehicle = sameTrackVehicles[0] ?? null;
        const preferredProgress = Math.max(0, route.stopProgress - 140);
        const safeProgress = nearestVehicle
          ? Math.max(0, Math.min(preferredProgress, nearestVehicle.progress - nearestVehicle.bodyLength - nearestVehicle.minimumGap - 18))
          : preferredProgress;
        const phase = this.phaseForMovement(layout, route.id);
        const offPhaseBonus = currentPhaseApproaches.has(lane.id) ? 0 : 80;
        const straightBonus = movementLane.intent === "straight" ? 40 : movementLane.intent === "left" ? 24 : 12;
        const viability = safeProgress + offPhaseBonus + straightBonus;
        return {
          lane,
          movementLane,
          route,
          safeProgress,
          viability,
          phaseKey: phase?.key ?? null,
        };
      }),
    )
      .filter((candidate) => candidate.safeProgress >= 12)
      .sort((a, b) => b.viability - a.viability);

    const candidate = candidates[0];
    if (!candidate) {
      return;
    }

    const laneVehicles = this.vehicles.get(candidate.lane.id) ?? [];
    laneVehicles.push(
      this.createVehicle(candidate.lane, candidate.movementLane, candidate.safeProgress, candidate.route, this.pickEmergencyType()),
    );
    laneVehicles.sort((a, b) => a.progress - b.progress);
    this.vehicles.set(candidate.lane.id, laneVehicles);
    this.aiTimer = 0.6;
  }

  private spawnVehicles(layout: IntersectionLayout, dt: number, spawnFactor: number) {
    for (const lane of layout.lanes) {
      const isGreen = this.intersection.stage === "green" && this.intersection.currentPhase.includes(lane.id);
      const wasGreen = this.laneWasGreen.get(lane.id) ?? false;
      const queueLength = this.approachQueueLength(lane);
      let greenElapsed = this.laneGreenElapsed.get(lane.id) ?? 0;
      let platoonRemaining = this.lanePlatoonRemaining.get(lane.id) ?? 0;
      let platoonAccumulator = this.lanePlatoonAccumulator.get(lane.id) ?? 0;

      if (isGreen) {
        if (!wasGreen) {
          greenElapsed = 0;
          platoonAccumulator = 0;
          platoonRemaining = queueLength >= 4 ? 2 + Math.floor(Math.random() * 2) : 0;
        }
        greenElapsed += dt;
        this.laneWasGreen.set(lane.id, true);
      } else {
        greenElapsed = 0;
        platoonRemaining = 0;
        platoonAccumulator = 0;
        this.laneWasGreen.set(lane.id, false);
      }

      if (isGreen && greenElapsed <= PLATOON_RELEASE_WINDOW && platoonRemaining > 0) {
        platoonAccumulator += dt;
        while (platoonAccumulator >= PLATOON_RELEASE_SPACING && platoonRemaining > 0) {
          if (!this.trySpawnVehicle(lane, spawnFactor)) {
            break;
          }
          platoonRemaining -= 1;
          platoonAccumulator -= PLATOON_RELEASE_SPACING;
        }
      }

      const laneDemand = this.laneDemandLevels.get(lane.id) ?? 1;
      const poissonRate = this.baseDemandRate(lane.id) * Math.max(0.35, laneDemand * spawnFactor * this.spawnMultiplier);
      if (Math.random() < Math.min(0.95, poissonRate * dt)) {
        this.trySpawnVehicle(lane, spawnFactor);
      }

      this.laneGreenElapsed.set(lane.id, greenElapsed);
      this.lanePlatoonRemaining.set(lane.id, platoonRemaining);
      this.lanePlatoonAccumulator.set(lane.id, platoonAccumulator);
    }
  }

  private baseDemandRate(laneId: LaneId) {
    if (laneId === "north" || laneId === "south") {
      return 0.52;
    }
    return 0.34;
  }

  private approachQueueLength(lane: LaneLayout) {
    const laneVehicles = this.vehicles.get(lane.id) ?? [];
    return laneVehicles.filter((vehicle) => !vehicle.clearedStopLine && vehicle.stopProgress - vehicle.progress < 240).length;
  }

  private trySpawnVehicle(lane: LaneLayout, spawnFactor: number) {
    if (this.approachQueueLength(lane) >= MAX_APPROACH_QUEUE) {
      return false;
    }

    const movementLane = this.pickMovementLane(lane);
    if (!movementLane) {
      return false;
    }

    const laneVehicles = this.vehicles.get(lane.id)!;
    const route = this.getRoute(movementLane);
    const sameMovementCount = laneVehicles.filter((vehicle) => this.findMovementLane(lane, vehicle).trackKey === movementLane.trackKey).length;
    const blockedSpawn = laneVehicles.some(
      (vehicle) => this.findMovementLane(lane, vehicle).trackKey === movementLane.trackKey && vehicle.progress < vehicle.bodyLength + vehicle.minimumGap,
    );
    if (sameMovementCount >= 7 || blockedSpawn) {
      return false;
    }

    const emergencyRoll = this.detectEmergencyPriority(getIntersectionLayout(this.intersectionType)) === null && Math.random() < 0.0015 * spawnFactor;
    laneVehicles.push(this.createVehicle(lane, movementLane, 0, route, emergencyRoll ? this.pickEmergencyType() : null));
    return true;
  }

  private updateVehicles(layout: IntersectionLayout, dt: number, factors: ReturnType<typeof weatherFactors>) {
    const reservedRouteIds = this.activeReservedRouteIds(layout);
    const currentAllowedMovements = this.currentAllowedMovementIds(layout);
    const blockedCrosswalks = this.activeBlockedCrosswalkIds();
    const occupiedCrosswalks = this.activeOccupiedCrosswalkIds();
    const stage = this.intersection.stage;
    const intersectionBox = this.intersectionBox(layout);
    const committedPedestrians = Array.from(this.pedestrians.values())
      .flat()
      .filter((pedestrian) => pedestrian.committed);

    for (const lane of layout.lanes) {
      const laneVehicles = this.vehicles.get(lane.id) ?? [];
      const retained: VehicleAgentState[] = [];

      for (const movementLane of lane.movementLanes) {
        const trackKey = movementLane.trackKey;
        const groupVehicles = laneVehicles
          .filter((vehicle) => this.findMovementLane(lane, vehicle).trackKey === trackKey)
          .sort((a, b) => b.progress - a.progress);

        if (groupVehicles.length === 0 || retained.some((vehicle) => this.findMovementLane(lane, vehicle).trackKey === trackKey)) {
          continue;
        }

        let leader: VehicleAgentState | null = null;

        for (const vehicle of groupVehicles) {
          const vehicleMovementLane = this.findMovementLane(lane, vehicle);
          const route = this.getRoute(vehicleMovementLane);
          const active = stage === "green" && currentAllowedMovements.has(route.id);
          const approachGreen = stage === "green" && this.intersection.currentPhase.includes(lane.id);
          const desiredGap = Math.max(vehicle.minimumGap, MIN_FOLLOWING_GAP * factors.headway);
          const comfortableGap = Math.max(vehicle.comfortableGap, COMFORTABLE_FOLLOWING_GAP * factors.headway);
          const currentGap = leader ? Math.max(0, leader.progress - vehicle.progress - leader.bodyLength) : Number.POSITIVE_INFINITY;
          let allowedProgress = route.length;
          let waitReason: VehicleAgentState["waitReason"] = "clear";

          if (leader) {
            allowedProgress = Math.min(allowedProgress, leader.progress - leader.bodyLength - desiredGap);
          }

          const canUseSignal = active || (approachGreen && vehicle.intent === "left");
          const exitClear = this.exitLaneHasRoom(layout, route, vehicle);
          const routeReserved = this.routeCanEnter(layout, route, reservedRouteIds);
          const conflictingCrosswalks = this.routeCrosswalkConflicts(route);
          const protectedCrosswalk =
            vehicle.intent === "straight"
              ? conflictingCrosswalks.every((crosswalkId) => !occupiedCrosswalks.has(crosswalkId))
              : vehicle.intent === "right"
                ? conflictingCrosswalks.every((crosswalkId) => !occupiedCrosswalks.has(crosswalkId))
                : conflictingCrosswalks.every((crosswalkId) => !blockedCrosswalks.has(crosswalkId));
          const atStopLine = vehicle.progress >= route.stopProgress - Math.max(10, vehicle.bodyLength * 0.4);
          const needsConflictHold = vehicle.intent !== "straight";
          const needsExitHold = true;

          if (!vehicle.clearedStopLine) {
            const holdCap = route.stopProgress;
            if (!canUseSignal) {
              allowedProgress = Math.min(allowedProgress, holdCap);
              waitReason = "movement_red";
            } else if (!protectedCrosswalk) {
              allowedProgress = Math.min(allowedProgress, holdCap);
              waitReason = "crosswalk";
            } else if (atStopLine && needsConflictHold && !routeReserved) {
              allowedProgress = Math.min(allowedProgress, holdCap);
              waitReason = "blocked_intersection";
            } else if (atStopLine && needsExitHold && !exitClear) {
              allowedProgress = Math.min(allowedProgress, holdCap);
              waitReason = "no_exit_space";
            }
          }

          if (this.vehicleHasCommittedPedestrianConflict(vehicleMovementLane, route, vehicle, committedPedestrians)) {
            allowedProgress = Math.min(allowedProgress, vehicle.progress);
            waitReason = "crosswalk";
          }

          if (leader && allowedProgress <= vehicle.progress + 2) {
            waitReason = "lead_vehicle";
          }

          const distanceToConstraint = Math.max(0, allowedProgress - vehicle.progress - vehicle.bodyLength * 0.32);
          const pathClearAhead = distanceToConstraint > vehicle.bodyLength * 0.55;
          if (pathClearAhead) {
            vehicle.reactionTimer = Math.min(vehicle.reactionDelay, vehicle.reactionTimer + dt);
          } else {
            vehicle.reactionTimer = 0;
          }

          const afterStop = vehicle.progress >= vehicle.stopProgress;
          const emergencySpeedFactor = vehicle.emergencyType ? 1.12 : 1;
          const targetCruise =
            vehicle.intent === "straight" || vehicle.progress > vehicle.stopProgress + 160
              ? vehicle.maxSpeed * emergencySpeedFactor
              : vehicle.turnSpeed * (vehicle.emergencyType ? 1.06 : 1);
          let targetSpeed = targetCruise * factors.speed;

          // IDM-inspired following: handled below; remove preliminary gapRatio override.

          const brakingEnvelope = Math.sqrt(Math.max(0, 2 * vehicle.braking * factors.braking * distanceToConstraint));
          targetSpeed = Math.min(targetSpeed, brakingEnvelope);

          if (leader) {
            // Smooth IDM-inspired car following.
            // s0  = hard minimum gap (stop here)
            // sc  = comfortable gap  (full free-road speed above this)
            // Between s0 and sc: smooth transition — match leader speed at s0, free speed at sc.
            const s  = Math.max(0.5, currentGap);
            const s0 = vehicle.minimumGap;
            const sc = vehicle.comfortableGap;
            const vL = Math.max(0, leader.speed);
            if (s <= s0) {
              // Within hard minimum — emergency stop
              targetSpeed = 0;
            } else if (s < sc) {
              // Following regime: smoothstep blend from vL (at s0) to free speed (at sc)
              const t = (s - s0) / Math.max(1, sc - s0);
              const smooth = t * t * (3 - 2 * t);  // smoothstep S-curve
              // Also account for approach rate: if closing fast, brake harder
              const deltaV = Math.max(0, vehicle.speed - vL);
              const brakingRoom = Math.max(0, s - s0);
              const approachPenalty = Math.min(deltaV * deltaV / Math.max(1, 2 * brakingRoom), vehicle.speed);
              const blendSpeed = vL + (targetSpeed - vL) * smooth;
              targetSpeed = Math.max(0, Math.min(blendSpeed, targetSpeed) - approachPenalty * 0.35);
            }
            // s >= sc: no leader constraint, free-road speed unchanged
          }

          const frontBumperProgress = vehicle.progress + vehicle.bodyLength * 0.5;
          const redAtStopLine = !canUseSignal && frontBumperProgress >= route.stopProgress - 2;
          if (redAtStopLine) {
            targetSpeed = 0;
          }

          if (stage === "all_red") {
            targetSpeed = 0;
          }

          if (!(pathClearAhead && (afterStop || active) && vehicle.reactionTimer >= vehicle.reactionDelay)) {
            targetSpeed = 0;
          }

          vehicle.desiredSpeed = targetSpeed;

          if (targetSpeed > vehicle.speed) {
            vehicle.speed = Math.min(targetSpeed, vehicle.speed + dt * vehicle.acceleration * factors.speed);
          } else {
            vehicle.speed = Math.max(targetSpeed, vehicle.speed - dt * vehicle.braking * factors.braking);
          }

          const step = vehicle.speed * dt * 60;
          vehicle.progress = Math.min(allowedProgress, vehicle.progress + step);
          vehicle.progress = Math.max(0, vehicle.progress);
          vehicle.clearedStopLine = vehicle.progress >= vehicle.stopProgress;
          vehicle.committed = vehicle.clearedStopLine;
          vehicle.inBox = this.progressOccupiesIntersectionBox(route, vehicle.progress, intersectionBox);
          if (vehicle.clearedStopLine && vehicle.progress <= route.coreEndProgress) {
            reservedRouteIds.add(route.id);
          }
          vehicle.emergencyDetected = !!this.intersection.emergencyState && this.intersection.emergencyState.vehicleId === vehicle.id;
          if (vehicle.emergencyType && vehicle.progress >= route.coreEndProgress && !this.servedEmergencyIds.has(vehicle.id)) {
            this.servedEmergencyIds.add(vehicle.id);
            this.intersection = {
              ...this.intersection,
              emergencyServedCount: this.intersection.emergencyServedCount + 1,
            };
          }
          vehicle.state =
            vehicle.progress < vehicle.stopProgress
              ? vehicle.speed < 0.08
                ? "queued"
                : "approach"
              : vehicle.progress < route.stopProgress + 54
                ? "entering"
                : vehicle.progress < route.coreEndProgress - 26
                  ? vehicle.intent === "straight"
                    ? "inside_junction"
                    : "turning"
                  : "exiting";

          const { point, heading } = this.routePose(route, vehicle.progress);
          const lockedPoint = this.lockVehicleToLaneAxis(vehicleMovementLane, route, vehicle.progress, point);
          vehicle.x = lockedPoint.x;
          vehicle.y = lockedPoint.y;
          vehicle.heading = heading;
          vehicle.routeLength = route.length;
          vehicle.holdProgress = route.holdProgress;
          vehicle.stopProgress = route.stopProgress;
          vehicle.leadVehicleId = leader?.id ?? null;
          vehicle.gapToLeader = leader ? Math.max(0, leader.progress - vehicle.progress - vehicle.bodyLength) : Number.POSITIVE_INFINITY;
          vehicle.waitReason = waitReason;

          if (vehicle.progress < route.length - 20) {
            retained.push(vehicle);
            leader = vehicle;
          } else {
            this.vehiclesServedCount += 1;
            this.recentServedCount += 1;
          }
        }
      }

      this.vehicles.set(lane.id, retained);
    }
  }

  private spawnPedestrians(layout: IntersectionLayout, dt: number) {
    for (const lane of layout.lanes) {
      const current = (this.pedestrianSpawnTimers.get(lane.id) ?? 0) + dt;
      const interval = 4.8 + (this.hashLane(lane.id) % 3) * 0.55;
      if (current >= interval) {
        this.pedestrianSpawnTimers.set(lane.id, 0);
        const lanePeds = this.pedestrians.get(lane.id)!;
        const availableSlots = Math.max(0, 5 - lanePeds.length);
        if (availableSlots > 0) {
          const burstSize = Math.min(availableSlots, 1 + ((this.pedestrianCounter + this.hashLane(lane.id)) % 2));
          for (let index = 0; index < burstSize; index += 1) {
            lanePeds.push(this.createPedestrian(lane, 0.28 + index * 0.34, lanePeds.length + index));
          }
        }
      } else {
        this.pedestrianSpawnTimers.set(lane.id, current);
      }
    }
  }

  private updatePedestrians(layout: IntersectionLayout, dt: number, speedFactor: number) {
    for (const lane of layout.lanes) {
      const lanePeds = this.pedestrians.get(lane.id) ?? [];
      const retained: PedestrianAgentState[] = [];
      for (const pedestrian of lanePeds) {
        const walkAllowed = this.intersection.crosswalkSignals[pedestrian.crossingId] === "walk";
        const safeToLeaveCurb = this.crosswalkStartIsSafe(layout, pedestrian.crossingId);
        if (pedestrian.state === "waiting") {
          pedestrian.waitTimer += dt;
          if (walkAllowed && safeToLeaveCurb && pedestrian.waitTimer >= pedestrian.startDelay) {
            pedestrian.state = "starting";
          }
        } else if (pedestrian.state === "starting") {
          if (!(walkAllowed && safeToLeaveCurb)) {
            pedestrian.state = "waiting";
            retained.push(pedestrian);
            continue;
          }
          pedestrian.committed = true;
          pedestrian.state = "crossing";
        } else if (pedestrian.state === "crossing" || pedestrian.state === "finishing") {
          if (!(walkAllowed || pedestrian.committed)) {
            retained.push(pedestrian);
            continue;
          }
          // Speed profile: accelerate for first 15%, cruise, then decelerate last 15%.
          // Committed pedestrians who see signal change rush (urgency ramp after 65%).
          const accelPhase = pedestrian.progress < 0.15 ? pedestrian.progress / 0.15 : 1.0;
          const decelPhase = pedestrian.progress > 0.85 ? Math.max(0.4, (1.0 - pedestrian.progress) / 0.15) : 1.0;
          const phaseMultiplier = accelPhase * decelPhase;
          const urgencyBoost = pedestrian.committed && pedestrian.progress > 0.65 ? 1.0 + (pedestrian.progress - 0.65) * 0.6 : 1.0;
          pedestrian.progress = Math.min(1.24, pedestrian.progress + dt * pedestrian.speed * speedFactor * phaseMultiplier * urgencyBoost);
          pedestrian.x = pedestrian.startX + (pedestrian.endX - pedestrian.startX) * pedestrian.progress;
          pedestrian.y = pedestrian.startY + (pedestrian.endY - pedestrian.startY) * pedestrian.progress;
          if (pedestrian.progress >= 1) {
            pedestrian.state = "finishing";
          }
          if (!this.pedestrianCompletedCrossing(pedestrian)) {
            retained.push(pedestrian);
            continue;
          }
          pedestrian.committed = false;
          this.intersection = {
            ...this.intersection,
            pedestrianServedCount: this.intersection.pedestrianServedCount + 1,
          };
          continue;
        }
        retained.push(pedestrian);
      }
      this.pedestrians.set(lane.id, retained);
    }
  }

  private crosswalkStartIsSafe(layout: IntersectionLayout, crosswalkId: string) {
    for (const lane of layout.lanes) {
      for (const vehicle of this.vehicles.get(lane.id) ?? []) {
        const movementLane = this.findMovementLane(lane, vehicle);
        const route = this.getRoute(movementLane);
        if (!this.routeCrosswalkConflicts(route).includes(crosswalkId)) {
          continue;
        }

        const stillMoving = vehicle.speed > 0.05;
        // Vehicle has entered the intersection box and hasn't exited yet
        const inIntersection = vehicle.clearedStopLine && vehicle.progress <= route.coreEndProgress + 18;

        // Only block pedestrians when a vehicle is physically moving through the conflict zone.
        // Approaching vehicles with green yield to committed pedestrians via vehicleHasCommittedPedestrianConflict.
        if (inIntersection && stillMoving) {
          return false;
        }
      }
    }
    return true;
  }

  private createVehicle(
    lane: LaneLayout,
    movementLane: MovementLaneLayout,
    initialProgress: number,
    route = this.getRoute(movementLane),
    emergencyType: EmergencyVehicleType | null = null,
  ): VehicleAgentState {
    this.vehicleCounter += 1;
    const vehicleIndex = this.vehicleCounter;
    const clampedProgress = Math.min(initialProgress, route.stopProgress - 36);
    const pose = this.routePose(route, clampedProgress);

    // Pick vehicle profile (weighted: compact 20%, sedan 40%, sport 10%, SUV 20%, truck 10%)
    const profile = VEHICLE_PROFILES[vehicleIndex % VEHICLE_PROFILES.length];
    // Per-driver speed variation: ±20% around the profile base
    const speedVariation = 0.82 + (vehicleIndex % 9) * 0.044;  // 0.82 → 1.17
    const maxSpeed = profile.maxSpeedBase * speedVariation;
    const emergencyPalette: Record<EmergencyVehicleType, string> = {
      ambulance: "#f3f4f6",
      police: "#1f2937",
      fire_truck: "#c62828",
    };
    // Reaction delay: 0.75–1.8 s. Emergency vehicles react instantly (0.25 s).
    // Longer delays model real perception-reaction time + decision lag.
    const reactionDelay = emergencyType ? 0.25 : 0.75 + (vehicleIndex % 7) * 0.15;
    return {
      id: `${lane.id}-${movementLane.lane}-${vehicleIndex}`,
      laneId: lane.id,
      movementLane: movementLane.lane,
      pathId: route.id,
      x: pose.point.x,
      y: pose.point.y,
      heading: pose.heading,
      color: emergencyType ? emergencyPalette[emergencyType] : lane.colors[vehicleIndex % lane.colors.length],
      intent: movementLane.intent,
      state: "approach",
      speed: 0,
      desiredSpeed: 0,
      maxSpeed,
      turnSpeed: maxSpeed * (movementLane.intent === "straight" ? 0.93 : movementLane.intent === "right" ? 0.70 : 0.58),
      acceleration: profile.accel,
      braking: profile.braking,
      minimumGap: profile.minGap,
      comfortableGap: profile.comfortGap,
      progress: clampedProgress,
      holdProgress: route.holdProgress,
      stopProgress: route.stopProgress,
      routeLength: route.length,
      committed: false,
      clearedStopLine: false,
      inBox: false,
      reactionDelay,
      reactionTimer: 0,
      bodyLength: profile.bodyLength,
      bodyWidth: profile.bodyWidth,
      leadVehicleId: null,
      gapToLeader: Number.POSITIVE_INFINITY,
      waitReason: "clear",
      emergencyType,
      emergencyPriority: emergencyType === "fire_truck" ? 1.45 : emergencyType === "ambulance" ? 1.35 : emergencyType === "police" ? 1.2 : 0,
      emergencyDetected: false,
    };
  }

  private createPedestrian(lane: LaneLayout, delayOffset = 0, slot = 0): PedestrianAgentState {
    this.pedestrianCounter += 1;
    const idx = this.pedestrianCounter;
    // Diverse skin tones + clothing colours
    const color = ["#fac775", "#f4a460", "#d2691e", "#c68642", "#a0522d", "#e8c39e", "#f5cba7", "#b5651d"][idx % 8];
    const stripeOffset = ((slot % 5) - 2) * 6;
    // Speed distribution: slow elderly (0.26-0.34), average (0.38-0.46), brisk (0.50-0.58)
    // idx % 9: 0-1 → slow, 2-5 → average, 6-7 → brisk, 8 → very slow
    const speedTier = idx % 9;
    const speed =
      speedTier < 2  ? 0.28 + (speedTier % 2) * 0.04  :   // slow
      speedTier < 6  ? 0.38 + (speedTier % 4) * 0.022 :   // average
      speedTier < 8  ? 0.50 + (speedTier % 2) * 0.04  :   // brisk
                       0.24;                                // very slow (elderly)
    // Bidirectional: odd-indexed pedestrians cross in reverse direction
    const reverse = idx % 2 === 1;
    if (lane.id === "north" || lane.id === "south") {
      const y = (lane.id === "north" ? 270 : 450) + stripeOffset;
      const leftEdge = 372;
      const rightEdge = 528;
      const startX = reverse ? rightEdge : leftEdge;
      const endX   = reverse ? leftEdge  : rightEdge;
      return {
        id: `ped-${lane.id}-${idx}`,
        laneId: lane.id,
        crossingId: `cross-${lane.id}`,
        x: startX,
        y,
        startX,
        startY: y,
        endX,
        endY: y,
        speed,
        state: "waiting",
        committed: false,
        progress: 0,
        waitTimer: 0,
        startDelay: delayOffset,
        color,
      };
    }
    const x = (lane.id === "east" ? 574 : 366) + stripeOffset;
    const topEdge = 282;
    const bottomEdge = 438;
    const startY = reverse ? bottomEdge : topEdge;
    const endY   = reverse ? topEdge   : bottomEdge;
    return {
      id: `ped-${lane.id}-${idx}`,
      laneId: lane.id,
      crossingId: `cross-${lane.id}`,
      x,
      y: startY,
      startX: x,
      startY,
      endX: x,
      endY,
      speed,
      state: "waiting",
      committed: false,
      progress: 0,
      waitTimer: 0,
      startDelay: delayOffset,
      color,
    };
  }

  private pedestrianCompletedCrossing(pedestrian: PedestrianAgentState) {
    const buffer = 6;
    const crossingIsHorizontal = Math.abs(pedestrian.endX - pedestrian.startX) >= Math.abs(pedestrian.endY - pedestrian.startY);

    if (crossingIsHorizontal) {
      if (pedestrian.endX >= pedestrian.startX) {
        return pedestrian.x >= pedestrian.endX + buffer;
      }
      return pedestrian.x <= pedestrian.endX - buffer;
    }

    if (pedestrian.endY >= pedestrian.startY) {
      return pedestrian.y >= pedestrian.endY + buffer;
    }
    return pedestrian.y <= pedestrian.endY - buffer;
  }

  private vehicleHasCommittedPedestrianConflict(
    movementLane: MovementLaneLayout,
    route: MovementRoute,
    vehicle: VehicleAgentState,
    pedestrians: PedestrianAgentState[],
  ) {
    if (pedestrians.length === 0) {
      return false;
    }

    const conflictingCrosswalks = new Set(this.routeCrosswalkConflicts(route));
    const blockingPedestrians = pedestrians.filter(
      (pedestrian) =>
        conflictingCrosswalks.has(pedestrian.crossingId) &&
        pedestrian.progress >= 0.03 &&
        pedestrian.progress <= 1.06,
    );

    if (blockingPedestrians.length === 0) {
      return false;
    }

    if (!vehicle.clearedStopLine || vehicle.progress <= route.coreEndProgress + 24) {
      return true;
    }

    const frontProgress = Math.min(route.length, vehicle.progress + vehicle.bodyLength * 0.5);
    const frontPoint = this.lockVehicleToLaneAxis(movementLane, route, frontProgress, this.routePose(route, frontProgress).point);
    const straightAheadProgress = Math.min(route.length, frontProgress + 30);
    const straightAheadPoint = this.lockVehicleToLaneAxis(
      movementLane,
      route,
      straightAheadProgress,
      this.routePose(route, straightAheadProgress).point,
    );

    if (route.intent === "straight") {
      const zone = this.boundingBoxFromPoints(frontPoint, straightAheadPoint, VEHICLE_COLLISION_BOX.width, VEHICLE_COLLISION_BOX.height);
      return blockingPedestrians.some((pedestrian) => this.boxesIntersect(zone, this.pedestrianBoundingBox(pedestrian)));
    }

    const samples = 6;
    for (let index = 0; index <= samples; index += 1) {
      const progress = frontProgress + (index / samples) * 42;
      const samplePoint = this.routePose(route, Math.min(route.length, progress)).point;
      const zone = this.centeredBox(samplePoint, VEHICLE_COLLISION_BOX.width + 18, VEHICLE_COLLISION_BOX.height + 18);
      if (blockingPedestrians.some((pedestrian) => this.boxesIntersect(zone, this.pedestrianBoundingBox(pedestrian)))) {
        return true;
      }
    }

    return false;
  }

  private pedestrianBoundingBox(pedestrian: PedestrianAgentState) {
    return this.centeredBox(pedestrian, PEDESTRIAN_COLLISION_BOX.size, PEDESTRIAN_COLLISION_BOX.size);
  }

  private centeredBox(point: Point, width: number, height: number) {
    return {
      left: point.x - width / 2,
      right: point.x + width / 2,
      top: point.y - height / 2,
      bottom: point.y + height / 2,
    };
  }

  private boundingBoxFromPoints(start: Point, end: Point, width: number, height: number) {
    return {
      left: Math.min(start.x, end.x) - width / 2,
      right: Math.max(start.x, end.x) + width / 2,
      top: Math.min(start.y, end.y) - height / 2,
      bottom: Math.max(start.y, end.y) + height / 2,
    };
  }

  private boxesIntersect(
    first: { left: number; right: number; top: number; bottom: number },
    second: { left: number; right: number; top: number; bottom: number },
  ) {
    return !(first.right < second.left || first.left > second.right || first.bottom < second.top || first.top > second.bottom);
  }

  private signalSnapshot(layout: IntersectionLayout, laneLayout: LaneLayout, x: number, y: number): SceneSignalSnapshot {
    const currentAllowedMovements = this.currentAllowedMovementIds(layout);
    const active = laneLayout.movementLanes.some((movementLane) => currentAllowedMovements.has(movementLane.id));
    const stage = this.intersection.stage;
    return {
      id: laneLayout.id,
      x,
      y,
      red: !active || stage === "all_red" ? "#ff3b30" : "#2a2a2a",
      amber: stage === "amber" ? "#ff9500" : "#2a2a2a",
      green: active && stage === "green" ? "#34c759" : "#2a2a2a",
    };
  }

  private currentAllowedMovementIds(layout: IntersectionLayout, source = this.intersection) {
    const phase = layout.phases.find((item) => item.key === source.currentPhaseKey);
    return new Set(phase?.allowedMovements ?? source.allowedMovements);
  }

  private buildCrosswalkSignals(
    layout: IntersectionLayout,
    phaseKey: string,
    stage: IntersectionState["stage"],
    emergency: EmergencyPriorityState | null,
  ): Record<string, CrosswalkSignalState> {
    const signals: Record<string, CrosswalkSignalState> = {};
    const releasedCrosswalks = this.releasedCrosswalksForPhase(layout, phaseKey);

    for (const crosswalk of layout.crosswalks) {
      const laneId = crosswalk.id.replace("cross-", "") as LaneId;
      const conflictsEmergency = !!emergency && emergency.laneId === laneId;
      signals[crosswalk.id] =
        stage === "green" && releasedCrosswalks.has(crosswalk.id) && !conflictsEmergency ? "walk" : "dont_walk";
    }
    return signals;
  }

  private releasedCrosswalksForPhase(layout: IntersectionLayout, phaseKey: string) {
    const phase = layout.phases.find((item) => item.key === phaseKey);
    if (!phase) {
      return new Set<string>();
    }

    if (phase.key.endsWith("_main")) {
      if (phase.approaches.includes("north") || phase.approaches.includes("south")) {
        return new Set(layout.crosswalks.filter((crosswalk) => crosswalk.id === "cross-east" || crosswalk.id === "cross-west").map((crosswalk) => crosswalk.id));
      }
      if (phase.approaches.includes("east") || phase.approaches.includes("west")) {
        return new Set(layout.crosswalks.filter((crosswalk) => crosswalk.id === "cross-north" || crosswalk.id === "cross-south").map((crosswalk) => crosswalk.id));
      }
    }

    return new Set<string>();
  }

  private activeBlockedCrosswalkIds() {
    const blocked = new Set<string>();
    for (const [crosswalkId, state] of Object.entries(this.intersection.crosswalkSignals)) {
      if (state === "walk") {
        blocked.add(crosswalkId);
      }
    }
    for (const pedestrian of Array.from(this.pedestrians.values()).flat()) {
      if (pedestrian.state === "starting" || pedestrian.state === "crossing" || pedestrian.state === "finishing") {
        blocked.add(pedestrian.crossingId);
      }
    }
    return blocked;
  }

  private activeOccupiedCrosswalkIds() {
    const occupied = new Set<string>();
    for (const pedestrian of Array.from(this.pedestrians.values()).flat()) {
      if (pedestrian.state === "starting" || pedestrian.state === "crossing" || pedestrian.state === "finishing") {
        occupied.add(pedestrian.crossingId);
      }
    }
    return occupied;
  }

  private routeCrosswalkConflicts(route: MovementRoute) {
    const cached = this.routeCrosswalkCache.get(route.id);
    if (cached) {
      return cached;
    }
    const layout = getIntersectionLayout(this.intersectionType);
    const crossings = layout.crosswalks
      .filter((crosswalk) => this.routeTouchesCrosswalk(route, crosswalk))
      .map((crosswalk) => crosswalk.id);
    this.routeCrosswalkCache.set(route.id, crossings);
    return crossings;
  }

  private crosswalkConflictingMovements(layout: IntersectionLayout, crosswalkId: string) {
    const conflicts: string[] = [];
    for (const lane of layout.lanes) {
      for (const movementLane of lane.movementLanes) {
        const route = this.getRoute(movementLane);
        if (route.intent !== "straight" && this.routeCrosswalkConflicts(route).includes(crosswalkId)) {
          conflicts.push(route.id);
        }
      }
    }
    return conflicts;
  }

  private routeTouchesCrosswalk(route: MovementRoute, crosswalk: { stripes: Array<{ x: number; y: number; width: number; height: number }> }) {
    const start = route.stopProgress;
    const end = route.coreEndProgress;
    const samples = 12;
    for (let index = 0; index <= samples; index += 1) {
      const point = this.routePose(route, lerp(start, end, index / samples)).point;
      if (
        crosswalk.stripes.some(
          (stripe) =>
            point.x >= stripe.x - 6 &&
            point.x <= stripe.x + stripe.width + 6 &&
            point.y >= stripe.y - 6 &&
            point.y <= stripe.y + stripe.height + 6,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private pickMovementLane(lane: LaneLayout) {
    const weighted = lane.movementLanes.map((movementLane) => ({
      movementLane,
      weight:
        (movementLane.intent === "straight"
          ? 0.58
          : movementLane.intent === "right"
            ? 0.25 + ((this.hashLane(lane.id) % 3) * 0.03)
            : 0.17 + ((this.hashLane(lane.id) % 2) * 0.04)) * (this.movementDemandLevels.get(movementLane.id) ?? 1),
    }));
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * totalWeight;
    for (const item of weighted) {
      cursor -= item.weight;
      if (cursor <= 0) {
        return item.movementLane;
      }
    }
    return weighted[weighted.length - 1]?.movementLane;
  }

  private updateDemandPatterns(layout: IntersectionLayout, dt: number) {
    const time = this.intersection.tick * 0.018;
    for (const lane of layout.lanes) {
      const laneWave =
        1 +
        Math.sin(time * 0.7 + this.hashLane(lane.id) * 0.19) * 0.28 +
        Math.sin(time * 0.23 + this.hashLane(lane.id) * 0.11) * 0.18;
      const laneNoise = (Math.random() - 0.5) * 0.16 * dt;
      const laneCurrent = this.laneDemandLevels.get(lane.id) ?? 1;
      const laneNext = Math.max(0.55, Math.min(1.75, laneCurrent + (laneWave - laneCurrent) * dt * 0.45 + laneNoise));
      this.laneDemandLevels.set(lane.id, laneNext);

      for (const movementLane of lane.movementLanes) {
        const movementBase =
          movementLane.intent === "straight" ? 1.02 : movementLane.intent === "right" ? 0.88 : 0.7;
        const movementWave =
          movementBase +
          Math.sin(time * 0.61 + (this.hashLane(lane.id) + movementLane.lane.length * 13) * 0.17) * 0.16 +
          Math.sin(time * 0.19 + (this.hashLane(lane.id) + movementLane.id.length) * 0.09) * 0.1;
        const movementNoise = (Math.random() - 0.5) * 0.12 * dt;
        const current = this.movementDemandLevels.get(movementLane.id) ?? movementBase;
        const next = Math.max(0.42, Math.min(1.45, current + (movementWave - current) * dt * 0.38 + movementNoise));
        this.movementDemandLevels.set(movementLane.id, next);
      }
    }
  }

  private findMovementLane(lane: LaneLayout, vehicle: VehicleAgentState) {
    return (
      lane.movementLanes.find((movementLane) => movementLane.lane === vehicle.movementLane && movementLane.intent === vehicle.intent) ??
      lane.movementLanes[0]
    );
  }

  private getRoute(movementLane: MovementLaneLayout): MovementRoute {
    const cached = this.routeCache.get(movementLane.id);
    if (cached) {
      return cached;
    }

    const start = { x: movementLane.spawnX, y: movementLane.spawnY };
    const stop = { x: movementLane.stopX, y: movementLane.stopY };
    const end = this.routeEndPoint(movementLane);

    const approachSegments = 36;
    const turnSegments = movementLane.intent === "straight" ? 42 : 64;
    const points: Point[] = [];

    for (let index = 0; index <= approachSegments; index += 1) {
      const t = index / approachSegments;
      points.push({
        x: lerp(start.x, stop.x, t),
        y: lerp(start.y, stop.y, t),
      });
    }

    for (let index = 1; index <= turnSegments; index += 1) {
      const t = index / turnSegments;
      if (movementLane.intent === "straight") {
        const control = { x: lerp(stop.x, end.x, 0.5), y: lerp(stop.y, end.y, 0.5) };
        points.push(quadraticPoint(stop, control, end, t));
        continue;
      }

      const turnDistance = Math.hypot(end.x - stop.x, end.y - stop.y);
      const controlLead = Math.max(
        movementLane.intent === "right" ? 70 : 110,
        Math.min(turnDistance * (movementLane.intent === "right" ? 0.22 : 0.3), movementLane.intent === "right" ? 120 : 180),
      );
      const entryVector = this.directionVector(movementLane.laneId);
      const exitVector = this.directionVector(movementLane.exitLaneId);
      const control1 = {
        x: stop.x + entryVector.x * controlLead,
        y: stop.y + entryVector.y * controlLead,
      };
      const control2 = {
        x: end.x - exitVector.x * controlLead,
        y: end.y - exitVector.y * controlLead,
      };

      points.push(cubicPoint(stop, control1, control2, end, t));
    }

    const cumulative = [0];
    for (let index = 1; index < points.length; index += 1) {
      const prev = points[index - 1];
      const current = points[index];
      cumulative[index] = cumulative[index - 1] + Math.hypot(current.x - prev.x, current.y - prev.y);
    }

    let holdIndex = 0;
    let bestHoldDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const distance = Math.hypot(points[index].x - movementLane.holdX, points[index].y - movementLane.holdY);
      if (distance < bestHoldDistance) {
        bestHoldDistance = distance;
        holdIndex = index;
      }
    }

    const route: MovementRoute = {
      id: movementLane.id,
      laneId: movementLane.laneId,
      movementLane: movementLane.lane,
      intent: movementLane.intent,
      exitLaneId: movementLane.exitLaneId,
      points,
      cumulative,
      length: cumulative[cumulative.length - 1] ?? 0,
      holdProgress: cumulative[holdIndex] ?? 0,
      stopProgress: cumulative[approachSegments] ?? 0,
      coreEndProgress: Math.min((cumulative[cumulative.length - 1] ?? 0) - 36, (cumulative[approachSegments] ?? 0) + 170),
    };

    this.routeCache.set(movementLane.id, route);
    return route;
  }

  private directionVector(laneId: LaneId): Point {
    if (laneId === "north") return { x: 0, y: 1 };
    if (laneId === "south") return { x: 0, y: -1 };
    if (laneId === "east") return { x: -1, y: 0 };
    return { x: 1, y: 0 };
  }

  private routePose(route: MovementRoute, progress: number) {
    const clamped = Math.max(0, Math.min(progress, route.length));
    const point = this.routePoint(route, clamped);
    const lookBehind = this.routePoint(route, Math.max(0, clamped - 4));
    const lookAhead = this.routePoint(route, Math.min(route.length, clamped + 6));
    return {
      point,
      heading: headingFromVector(lookAhead.x - lookBehind.x, lookAhead.y - lookBehind.y),
    };
  }

  private lockVehicleToLaneAxis(
    movementLane: MovementLaneLayout,
    route: MovementRoute,
    progress: number,
    point: Point,
  ) {
    const locked = { ...point };
    const onApproach = progress <= route.stopProgress + 1;
    const onStraightRoute = route.intent === "straight";
    const onExit = progress >= route.coreEndProgress - 12;
    const exitPoint = this.routeEndPoint(movementLane);

    if ((movementLane.laneId === "north" || movementLane.laneId === "south") && (onApproach || onStraightRoute)) {
      locked.x = movementLane.centerX;
    }

    if ((movementLane.laneId === "east" || movementLane.laneId === "west") && (onApproach || onStraightRoute)) {
      locked.y = movementLane.centerY;
    }

    if (onExit) {
      if (route.exitLaneId === "north" || route.exitLaneId === "south") {
        locked.x = exitPoint.x;
      } else {
        locked.y = exitPoint.y;
      }
    }

    return locked;
  }

  private routePoint(route: MovementRoute, progress: number) {
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
      x: lerp(start.x, end.x, ratio),
      y: lerp(start.y, end.y, ratio),
    };
  }

  private routeEndPoint(movementLane: MovementLaneLayout): Point {
    if (movementLane.exitLaneId === "north") {
      const x = movementLane.intent === "straight" ? movementLane.stopX : movementLane.intent === "left" ? 462 : 498;
      return { x, y: -120 };
    }
    if (movementLane.exitLaneId === "south") {
      const x = movementLane.intent === "straight" ? movementLane.stopX : movementLane.intent === "left" ? 438 : 402;
      return { x, y: 840 };
    }
    if (movementLane.exitLaneId === "east") {
      const y = movementLane.intent === "straight" ? movementLane.stopY : movementLane.intent === "left" ? 372 : 408;
      return { x: 1020, y };
    }
    const y = movementLane.intent === "straight" ? movementLane.stopY : movementLane.intent === "left" ? 348 : 312;
    return { x: -120, y };
  }

  private activeReservedRouteIds(layout: IntersectionLayout) {
    const reserved = new Set<string>();
    for (const lane of layout.lanes) {
      for (const vehicle of this.vehicles.get(lane.id) ?? []) {
        if (!vehicle.committed) {
          continue;
        }
        const route = this.getRoute(this.findMovementLane(lane, vehicle));
        if (vehicle.progress <= route.coreEndProgress) {
          reserved.add(route.id);
        }
      }
    }
    return reserved;
  }

  private routeCanEnter(layout: IntersectionLayout, candidate: MovementRoute, reservedRouteIds: Set<string>) {
    for (const routeId of reservedRouteIds) {
      if (routeId === candidate.id) {
        continue;
      }
      const reservedRoute = this.lookupRouteById(layout, routeId);
      if (reservedRoute && this.routesConflict(candidate, reservedRoute)) {
        return false;
      }
    }
    return true;
  }

  private exitLaneHasRoom(layout: IntersectionLayout, candidate: MovementRoute, vehicle: VehicleAgentState) {
    const exitZone = this.exitZoneForRoute(candidate, vehicle.bodyLength);
    for (const lane of layout.lanes) {
      for (const other of this.vehicles.get(lane.id) ?? []) {
        if (other.id === vehicle.id) {
          continue;
        }
        const route = this.getRoute(this.findMovementLane(lane, other));
        if (route.exitLaneId !== candidate.exitLaneId) {
          continue;
        }
        const otherPoint = this.routePose(route, other.progress).point;
        const otherStopped = other.speed < 0.12;
        if (otherStopped && this.boxesIntersect(exitZone, this.centeredBox(otherPoint, other.bodyWidth, other.bodyLength))) {
          return false;
        }
      }
    }
    return true;
  }

  private intersectionBox(layout: IntersectionLayout) {
    const verticalRoad = layout.roads.find((road) => road.height > road.width);
    const horizontalRoad = layout.roads.find((road) => road.width > road.height);

    if (verticalRoad && horizontalRoad) {
      return {
        left: Math.max(verticalRoad.x, horizontalRoad.x),
        right: Math.min(verticalRoad.x + verticalRoad.width, horizontalRoad.x + horizontalRoad.width),
        top: Math.max(verticalRoad.y, horizontalRoad.y),
        bottom: Math.min(verticalRoad.y + verticalRoad.height, horizontalRoad.y + horizontalRoad.height),
      };
    }

    return { left: 390, right: 510, top: 300, bottom: 420 };
  }

  private progressOccupiesIntersectionBox(
    route: MovementRoute,
    progress: number,
    intersectionBox: { left: number; right: number; top: number; bottom: number },
  ) {
    if (progress < route.stopProgress || progress > route.coreEndProgress) {
      return false;
    }
    const point = this.routePose(route, progress).point;
    return (
      point.x >= intersectionBox.left &&
      point.x <= intersectionBox.right &&
      point.y >= intersectionBox.top &&
      point.y <= intersectionBox.bottom
    );
  }

  private exitZoneForRoute(route: MovementRoute, vehicleLength: number) {
    const exitPoint = this.routePose(route, route.coreEndProgress + Math.max(vehicleLength * 0.5, 12)).point;
    const depth = vehicleLength + 10;

    if (route.exitLaneId === "north") {
      return { left: exitPoint.x - 10, right: exitPoint.x + 10, top: exitPoint.y - depth, bottom: exitPoint.y + 8 };
    }
    if (route.exitLaneId === "south") {
      return { left: exitPoint.x - 10, right: exitPoint.x + 10, top: exitPoint.y - 8, bottom: exitPoint.y + depth };
    }
    if (route.exitLaneId === "east") {
      return { left: exitPoint.x - 8, right: exitPoint.x + depth, top: exitPoint.y - 10, bottom: exitPoint.y + 10 };
    }
    return { left: exitPoint.x - depth, right: exitPoint.x + 8, top: exitPoint.y - 10, bottom: exitPoint.y + 10 };
  }

  private lookupRouteById(layout: IntersectionLayout, routeId: string) {
    for (const lane of layout.lanes) {
      const movementLane = lane.movementLanes.find((item) => item.id === routeId);
      if (movementLane) {
        return this.getRoute(movementLane);
      }
    }
    return null;
  }

  private routesConflict(a: MovementRoute, b: MovementRoute) {
    const key = [a.id, b.id].sort().join("|");
    const cached = this.conflictCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const aPoints = this.coreSamplePoints(a);
    const bPoints = this.coreSamplePoints(b);
    let conflict = false;
    for (const pointA of aPoints) {
      for (const pointB of bPoints) {
        if (Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) < 34) {
          conflict = true;
          break;
        }
      }
      if (conflict) {
        break;
      }
    }
    this.conflictCache.set(key, conflict);
    return conflict;
  }

  private coreSamplePoints(route: MovementRoute) {
    const points: Point[] = [];
    const start = route.stopProgress;
    const end = route.coreEndProgress;
    const segments = 10;
    for (let index = 0; index <= segments; index += 1) {
      const progress = lerp(start, end, index / segments);
      points.push(this.routePose(route, progress).point);
    }
    return points;
  }

  private phaseLabel(phase: LaneId[]) {
    return phase.map((laneId) => laneId[0].toUpperCase()).join(" + ") || "None";
  }

  private hashLane(laneId: LaneId) {
    return { north: 3, south: 11, east: 19, west: 27 }[laneId];
  }
}
