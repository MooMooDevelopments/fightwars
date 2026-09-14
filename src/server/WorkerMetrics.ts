import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as dotenv from "dotenv";
import { desyncEventCount } from "./DesyncAlert";
import { GameManager } from "./GameManager";
import { ATTR_PREFIX, getOtelResource, getPromLabels } from "./OtelResource";
import { ServerEnv } from "./ServerEnv";

dotenv.config();

export function initWorkerMetrics(gameManager: GameManager): void {
  // Create resource with worker information
  const resource = getOtelResource();

  // Configure auth headers
  const headers: Record<string, string> = {};
  if (ServerEnv.otelEnabled()) {
    headers["Authorization"] = "Basic " + ServerEnv.otelAuthHeader();
  }

  // Create metrics exporter
  const metricExporter = new OTLPMetricExporter({
    url: `${ServerEnv.otelEndpoint()}/v1/metrics`,
    headers,
  });

  // Configure the metric reader
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15000, // Export metrics every 15 seconds
  });

  // Create a meter provider
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });

  // Get meter for creating metrics
  const meter = meterProvider.getMeter("worker-metrics");

  // Create observable gauges
  const activeGamesGauge = meter.createObservableGauge(
    `${ATTR_PREFIX}.active_games.gauge`,
    {
      description: "Number of active games on this worker",
    },
  );

  const connectedClientsGauge = meter.createObservableGauge(
    `${ATTR_PREFIX}.connected_clients.gauge`,
    {
      description: "Number of connected clients on this worker",
    },
  );

  const desyncsGauge = meter.createObservableGauge(
    `${ATTR_PREFIX}.desyncs.gauge`,
    {
      description: "Number of detected desyncs on active games on this worker",
    },
  );

  // FightWars: every desync event alerted since the worker started (a
  // counter, unlike desyncs.gauge which tracks active games only).
  const desyncEventsGauge = meter.createObservableGauge(
    `${ATTR_PREFIX}.desync_events.total`,
    {
      description: "Desync events alerted on this worker since start",
    },
  );

  // FightWars: gameplay intents the shadow simulations refused (ShadowSim).
  const shadowRefusalsGauge = meter.createObservableGauge(
    `${ATTR_PREFIX}.shadow_refusals.total`,
    {
      description:
        "Gameplay intents refused by the server-side shadow simulation",
    },
  );

  const memoryUsageGauge = meter.createObservableGauge(
    `${ATTR_PREFIX}.memory_usage.bytes`,
    {
      description: "Current memory usage of the worker process in bytes",
    },
  );

  activeGamesGauge.addCallback((result) => {
    const count = gameManager.activeGames();
    result.observe(count, getPromLabels());
  });

  connectedClientsGauge.addCallback((result) => {
    const count = gameManager.activeClients();
    result.observe(count, getPromLabels());
  });

  desyncsGauge.addCallback((result) => {
    const count = gameManager.desyncCount();
    result.observe(count, getPromLabels());
  });

  desyncEventsGauge.addCallback((result) => {
    result.observe(desyncEventCount(), getPromLabels());
  });

  shadowRefusalsGauge.addCallback((result) => {
    result.observe(gameManager.shadowRefusalCount(), getPromLabels());
  });

  memoryUsageGauge.addCallback((result) => {
    const memoryUsage = process.memoryUsage();
    result.observe(memoryUsage.heapUsed, getPromLabels());
  });

  console.log("Metrics initialized with GameManager");
}
