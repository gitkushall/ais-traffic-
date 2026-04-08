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
  PedestrianAgentState,
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

export class SimulationEngine {
  private intersectionType: IntersectionType = "4way";
  private weights: SimulationWeights = DEFAULT_WEIGHTS;
  private running = true;
  private debug = false;
  private speed = 1;
  private weather: WeatherMode = "clear";
  private intersection!: IntersectionState;
  private signalController = new SignalController(10, 3, 1.5, 1.08);
  private lastDecision = {
    key: "ns_left",
    label: "N/S Left",
    phase: ["north", "south"] as LaneId[],
    allowedMovements: [] as string[],
    score: 0,
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
  private vehicleSpawnTimers = new Map<LaneId, number>();
  private pedestrianSpawnTimers = new Map<LaneId, number>();
  private routeCache = new Map<string, MovementRoute>();
  private conflictCache = new Map<string, boolean>();
  private routeCrosswalkCache = new Map<string, string[]>();
  private laneDemandLevels = new Map<LaneId, number>();
  private movementDemandLevels = new Map<string, number>();
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

    const nextState = this.signalController.tick(
      {
        ...this.intersection,
        tick: this.intersection.tick + 1,
        weatherMode: this.weather,
        lanes,
      },
      this.lastDecision,
      dt,
    );

    this.intersection = {
      ...nextState,
      weatherMode: this.weather,
      emergencyState,
      crosswalkSignals: this.buildCrosswalkSignals(layout, this.currentAllowedMovementIds(layout, nextState), nextState.stage, emergencyState),
    };

    this.updatePedestrians(layout, dt, factors.pedestrian);
    this.updateVehicles(layout, dt, factors);
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
      signalStageLabel: this.intersection.stage.toUpperCase(),
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
          brakeLights: vehicle.speed < 0.35 && !vehicle.clearedStopLine,
          progress: vehicle.progress,
          leadVehicleId: vehicle.leadVehicleId,
          gapToLeader: vehicle.gapToLeader,
          waitReason: vehicle.waitReason,
          emergencyType: vehicle.emergencyType,
          emergencyDetected: vehicle.emergencyDetected,
        })),
      })),
      signals: layout.lanes.map((laneLayout) => this.signalSnapshot(layout, laneLayout, laneLayout.signalX, laneLayout.signalY)),
      pedestrians: Array.from(this.pedestrians.values()).flat().map((pedestrian) => ({
        id: pedestrian.id,
        crossingId: pedestrian.crossingId,
        x: pedestrian.x,
        y: pedestrian.y,
        color: pedestrian.color,
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
    const lanes: LaneState[] = layout.lanes.map((lane, index) => ({
      id: lane.id,
      label: lane.label,
      direction: lane.direction,
      carCount: 0,
      queueLength: 0,
      pedestrianCount: 0,
      waitingTime: 3 + index * 2,
      score: 0,
      isGreen: initialPhase.approaches.includes(lane.id),
    }));

    this.lastDecision = {
      key: initialPhase.key,
      label: initialPhase.label,
      phase: [...initialPhase.approaches],
      allowedMovements: [...initialPhase.allowedMovements],
      score: 0,
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
      crosswalkSignals: this.buildCrosswalkSignals(layout, new Set(initialPhase.allowedMovements), "green", null),
      greenRemaining: 12,
      activePhaseElapsed: 0,
      controllerReason: "Initial adaptive release",
      phaseScores: {},
      phaseReasonMap: {},
      weatherMode: this.weather,
      lanes,
      emergencyState: null,
      emergencyServedCount: 0,
    };
  }

  private resetDynamicState(type: IntersectionType) {
    const layout = getIntersectionLayout(type);
    this.vehicles = new Map();
    this.pedestrians = new Map();
    this.vehicleSpawnTimers = new Map();
    this.pedestrianSpawnTimers = new Map();
    this.routeCache = new Map();
    this.conflictCache = new Map();
    this.routeCrosswalkCache = new Map();
    this.laneDemandLevels = new Map();
    this.movementDemandLevels = new Map();
    this.servedEmergencyIds = new Set();

    for (const lane of layout.lanes) {
      this.vehicles.set(lane.id, []);
      this.pedestrians.set(lane.id, []);
      this.vehicleSpawnTimers.set(lane.id, 0);
      this.pedestrianSpawnTimers.set(lane.id, 0);
      this.laneDemandLevels.set(lane.id, 0.95 + (this.hashLane(lane.id) % 5) * 0.05);

      for (const movementLane of lane.movementLanes) {
        this.movementDemandLevels.set(
          movementLane.id,
          movementLane.intent === "straight" ? 1.04 : movementLane.intent === "right" ? 0.9 : 0.72,
        );
        for (let index = 0; index < 2; index += 1) {
          this.vehicles.get(lane.id)!.push(this.createVehicle(lane, movementLane, 150 + index * 40));
        }
      }

      for (let index = 0; index < 2; index += 1) {
        this.pedestrians.get(lane.id)!.push(this.createPedestrian(lane, index * 0.12));
      }
    }
  }

  private buildLaneStates(layout: IntersectionLayout): LaneState[] {
    return layout.lanes.map((laneLayout) => {
      const vehicles = this.vehicles.get(laneLayout.id) ?? [];
      const pedestrians = this.pedestrians.get(laneLayout.id) ?? [];
      const queueLength = vehicles.filter((vehicle) => !vehicle.clearedStopLine && vehicle.stopProgress - vehicle.progress < 240).length;
      const green = this.intersection.stage === "green" && this.intersection.currentPhase.includes(laneLayout.id);
      const previous = this.intersection.lanes.find((lane) => lane.id === laneLayout.id);
      return {
        id: laneLayout.id,
        label: laneLayout.label,
        direction: laneLayout.direction,
        carCount: vehicles.length,
        queueLength,
        pedestrianCount: pedestrians.length,
        waitingTime: green ? Math.max(0, (previous?.waitingTime ?? 0) - 0.35) : (previous?.waitingTime ?? 0) + 0.15,
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
    const candidatePairs = layout.lanes.flatMap((lane) =>
      lane.movementLanes.map((movementLane) => ({
        lane,
        movementLane,
      })),
    );
    const candidate = candidatePairs[Math.floor(Math.random() * candidatePairs.length)];
    if (!candidate) {
      return;
    }
    const laneVehicles = this.vehicles.get(candidate.lane.id) ?? [];
    const candidateTrackKey = candidate.movementLane.trackKey;
    const blockedSpawn = laneVehicles.some(
      (vehicle) => this.findMovementLane(candidate.lane, vehicle).trackKey === candidateTrackKey && vehicle.progress < vehicle.bodyLength + vehicle.minimumGap + 24,
    );
    if (blockedSpawn) {
      return;
    }
    laneVehicles.push(this.createVehicle(candidate.lane, candidate.movementLane, 0, this.getRoute(candidate.movementLane), this.pickEmergencyType()));
    this.vehicles.set(candidate.lane.id, laneVehicles);
    this.aiTimer = 0.6;
  }

  private spawnVehicles(layout: IntersectionLayout, dt: number, spawnFactor: number) {
    for (const lane of layout.lanes) {
      const current = (this.vehicleSpawnTimers.get(lane.id) ?? 0) + dt;
      const laneDemand = this.laneDemandLevels.get(lane.id) ?? 1;
      const interval = (1.5 + (this.hashLane(lane.id) % 3) * 0.16) / Math.max(0.45, spawnFactor * laneDemand);
      if (current >= interval) {
        this.vehicleSpawnTimers.set(lane.id, 0);
        const movementLane = this.pickMovementLane(lane);
        if (!movementLane) {
          continue;
        }
        const laneVehicles = this.vehicles.get(lane.id)!;
        const route = this.getRoute(movementLane);
        const sameMovementCount = laneVehicles.filter((vehicle) => this.findMovementLane(lane, vehicle).trackKey === movementLane.trackKey).length;
        const blockedSpawn = laneVehicles.some(
          (vehicle) => this.findMovementLane(lane, vehicle).trackKey === movementLane.trackKey && vehicle.progress < vehicle.bodyLength + vehicle.minimumGap,
        );
        if (sameMovementCount < 7 && !blockedSpawn) {
          const emergencyRoll = this.detectEmergencyPriority(layout) === null && Math.random() < 0.001;
          laneVehicles.push(this.createVehicle(lane, movementLane, 0, route, emergencyRoll ? this.pickEmergencyType() : null));
        }
      } else {
        this.vehicleSpawnTimers.set(lane.id, current);
      }
    }
  }

  private updateVehicles(layout: IntersectionLayout, dt: number, factors: ReturnType<typeof weatherFactors>) {
    const reservedRouteIds = this.activeReservedRouteIds(layout);
    const currentAllowedMovements = this.currentAllowedMovementIds(layout);
    const blockedCrosswalks = this.activeBlockedCrosswalkIds();
    const occupiedCrosswalks = this.activeOccupiedCrosswalkIds();

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
          const active = this.intersection.stage === "green" && currentAllowedMovements.has(route.id);
          const approachGreen = this.intersection.stage === "green" && this.intersection.currentPhase.includes(lane.id);
          const desiredGap = vehicle.minimumGap * factors.headway;
          const comfortableGap = vehicle.comfortableGap * factors.headway;
          const currentGap = leader ? Math.max(0, leader.progress - vehicle.progress - leader.bodyLength) : Number.POSITIVE_INFINITY;
          let allowedProgress = route.length;
          let waitReason: VehicleAgentState["waitReason"] = "clear";

          if (leader) {
            allowedProgress = Math.min(allowedProgress, leader.progress - desiredGap);
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
          const atStopLine = vehicle.progress >= route.holdProgress - Math.max(10, vehicle.bodyLength * 0.4);
          const needsConflictHold = vehicle.intent !== "straight";
          const needsExitHold = vehicle.intent !== "straight";

          if (!vehicle.clearedStopLine) {
            const holdCap = route.holdProgress;
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

          if (leader) {
            const gapRatio = Math.max(0, Math.min(1, currentGap / Math.max(comfortableGap, 1)));
            targetSpeed *= gapRatio;
            if (currentGap < desiredGap * 0.68) {
              targetSpeed = 0;
            }
          }

          const brakingEnvelope = Math.sqrt(Math.max(0, 2 * vehicle.braking * factors.braking * distanceToConstraint));
          targetSpeed = Math.min(targetSpeed, brakingEnvelope);

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
          vehicle.x = point.x;
          vehicle.y = point.y;
          vehicle.heading = heading;
          vehicle.routeLength = route.length;
          vehicle.holdProgress = route.holdProgress;
          vehicle.stopProgress = route.stopProgress;
          vehicle.leadVehicleId = leader?.id ?? null;
          vehicle.gapToLeader = leader ? Math.max(0, leader.progress - vehicle.progress - vehicle.bodyLength) : Number.POSITIVE_INFINITY;
          vehicle.waitReason = waitReason;

          if (vehicle.progress < route.length - 4) {
            retained.push(vehicle);
            leader = vehicle;
          }
        }
      }

      this.vehicles.set(lane.id, retained);
    }
  }

  private spawnPedestrians(layout: IntersectionLayout, dt: number) {
    for (const lane of layout.lanes) {
      const current = (this.pedestrianSpawnTimers.get(lane.id) ?? 0) + dt;
      const interval = 5.8 + (this.hashLane(lane.id) % 3) * 0.6;
      if (current >= interval) {
        this.pedestrianSpawnTimers.set(lane.id, 0);
        const lanePeds = this.pedestrians.get(lane.id)!;
        if (lanePeds.length < 4) {
          lanePeds.push(this.createPedestrian(lane, Math.min(0.4, lanePeds.length * 0.12)));
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
          pedestrian.state = "crossing";
        } else if (pedestrian.state === "crossing" || pedestrian.state === "finishing") {
          pedestrian.progress = Math.min(1.15, pedestrian.progress + dt * 0.24 * speedFactor);
          pedestrian.x = pedestrian.startX + (pedestrian.endX - pedestrian.startX) * pedestrian.progress;
          pedestrian.y = pedestrian.startY + (pedestrian.endY - pedestrian.startY) * pedestrian.progress;
          if (pedestrian.progress >= 1) {
            pedestrian.state = "finishing";
          }
          if (pedestrian.progress < 1.12) {
            retained.push(pedestrian);
            continue;
          }
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

        const nearCrosswalk = vehicle.progress >= route.stopProgress - 90 && vehicle.progress <= route.coreEndProgress + 18;
        const stillMoving = vehicle.speed > 0.08;
        const rolledPastYield = vehicle.progress > route.holdProgress + 6;

        if (nearCrosswalk && (stillMoving || rolledPastYield)) {
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
    const maxSpeed = 2.15 + (vehicleIndex % 5) * 0.18;
    const emergencyPalette: Record<EmergencyVehicleType, string> = {
      ambulance: "#f3f4f6",
      police: "#1f2937",
      fire_truck: "#c62828",
    };
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
      turnSpeed: maxSpeed * (movementLane.intent === "straight" ? 0.92 : movementLane.intent === "right" ? 0.72 : 0.62),
      acceleration: 4.2 + (vehicleIndex % 4) * 0.45,
      braking: 6.6 + (vehicleIndex % 3) * 0.55,
      minimumGap: 29 + (vehicleIndex % 4) * 3,
      comfortableGap: 40 + (vehicleIndex % 4) * 4,
      progress: clampedProgress,
      holdProgress: route.holdProgress,
      stopProgress: route.stopProgress,
      routeLength: route.length,
      committed: false,
      clearedStopLine: false,
      reactionDelay: 0.12 + (vehicleIndex % 5) * 0.045,
      reactionTimer: 0,
      bodyLength: 24 + (vehicleIndex % 3),
      bodyWidth: 13 + (vehicleIndex % 2),
      leadVehicleId: null,
      gapToLeader: Number.POSITIVE_INFINITY,
      waitReason: "clear",
      emergencyType,
      emergencyPriority: emergencyType === "fire_truck" ? 1.45 : emergencyType === "ambulance" ? 1.35 : emergencyType === "police" ? 1.2 : 0,
      emergencyDetected: false,
    };
  }

  private createPedestrian(lane: LaneLayout, delayOffset = 0): PedestrianAgentState {
    this.pedestrianCounter += 1;
    const color = ["#fac775", "#f4a460", "#d2691e", "#c68642"][this.pedestrianCounter % 4];
    if (lane.id === "north" || lane.id === "south") {
      const y = lane.id === "north" ? 270 : 450;
      return {
        id: `ped-${lane.id}-${this.pedestrianCounter}`,
        laneId: lane.id,
        crossingId: `cross-${lane.id}`,
        x: 390,
        y,
        startX: 390,
        startY: y,
        endX: 510,
        endY: y,
        speed: 0.5,
        state: "waiting",
        progress: 0,
        waitTimer: 0,
        startDelay: 0.2 + delayOffset,
        color,
      };
    }
    const x = lane.id === "east" ? 540 : 360;
    return {
      id: `ped-${lane.id}-${this.pedestrianCounter}`,
      laneId: lane.id,
      crossingId: `cross-${lane.id}`,
      x,
      y: 320,
      startX: x,
      startY: 320,
      endX: x,
      endY: 400,
      speed: 0.5,
      state: "waiting",
      progress: 0,
      waitTimer: 0,
      startDelay: 0.2 + delayOffset,
      color,
    };
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
    allowedMovements: Set<string>,
    stage: IntersectionState["stage"],
    emergency: EmergencyPriorityState | null,
  ): Record<string, CrosswalkSignalState> {
    const signals: Record<string, CrosswalkSignalState> = {};
    const activeApproaches = new Set(
      layout.lanes
        .filter((lane) => lane.movementLanes.some((movementLane) => allowedMovements.has(movementLane.id)))
        .map((lane) => lane.id),
    );

    for (const crosswalk of layout.crosswalks) {
      const laneId = crosswalk.id.replace("cross-", "") as LaneId;
      const crossingApproachIsRed = !activeApproaches.has(laneId);
      const conflictsEmergency = !!emergency && emergency.laneId === laneId;
      const conflictingActiveMovement = this.crosswalkConflictingMovements(layout, crosswalk.id).some((movementId) => allowedMovements.has(movementId));
      signals[crosswalk.id] =
        stage === "green" && crossingApproachIsRed && !conflictsEmergency && !conflictingActiveMovement ? "walk" : "dont_walk";
    }
    return signals;
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
    const clearance = vehicle.minimumGap + vehicle.bodyLength + 34;
    for (const lane of layout.lanes) {
      for (const other of this.vehicles.get(lane.id) ?? []) {
        if (other.id === vehicle.id) {
          continue;
        }
        const route = this.getRoute(this.findMovementLane(lane, other));
        if (route.exitLaneId !== candidate.exitLaneId) {
          continue;
        }
        if (other.progress >= route.stopProgress && other.progress <= route.stopProgress + clearance) {
          return false;
        }
      }
    }
    return true;
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
