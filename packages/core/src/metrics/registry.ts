/**
 * Production-grade Prometheus Metrics Registry for HRMS.
 * Formats metrics in standard Prometheus text exposition format (0.0.4).
 */

interface CounterMetric {
  name: string;
  help: string;
  labels: Record<string, number>;
}

interface HistogramMetric {
  name: string;
  help: string;
  buckets: number[];
  observations: Map<string, { count: number; sum: number; bucketCounts: number[] }>;
}

interface GaugeMetric {
  name: string;
  help: string;
  labels: Record<string, number>;
}

export class MetricsRegistry {
  private counters: Map<string, CounterMetric> = new Map();
  private histograms: Map<string, HistogramMetric> = new Map();
  private gauges: Map<string, GaugeMetric> = new Map();

  constructor() {
    this.initDefaultMetrics();
  }

  private initDefaultMetrics() {
    this.registerCounter('http_requests_total', 'Total HTTP requests processed by method, route, and status');
    this.registerHistogram(
      'http_request_duration_seconds',
      'HTTP request latency in seconds',
      [0.025, 0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3.0, 5.0],
    );
    this.registerCounter('db_queries_total', 'Total database queries executed by operation');
    this.registerHistogram(
      'db_query_duration_seconds',
      'Database query execution duration in seconds',
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0],
    );
    this.registerGauge('db_pool_total', 'Total number of database pool connections');
    this.registerGauge('db_pool_idle', 'Number of idle database pool connections');
    this.registerGauge('db_pool_waiting', 'Number of requests waiting for a database connection');
    this.registerGauge('active_sessions_count', 'Estimated active sessions count');
    this.registerCounter('audit_events_total', 'Total audit events logged by action');
    this.registerCounter('auth_attempts_total', 'Total authentication attempts by status');
  }

  private formatLabels(labels: Record<string, string | number>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    const formatted = entries
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
      .join(',');
    return `{${formatted}}`;
  }

  registerCounter(name: string, help: string): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, { name, help, labels: {} });
    }
  }

  registerHistogram(name: string, help: string, buckets: number[]): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, {
        name,
        help,
        buckets: [...buckets].sort((a, b) => a - b),
        observations: new Map(),
      });
    }
  }

  registerGauge(name: string, help: string): void {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, { name, help, labels: {} });
    }
  }

  incCounter(name: string, labels: Record<string, string | number> = {}, value = 1): void {
    const counter = this.counters.get(name);
    if (!counter) return;
    const labelKey = this.formatLabels(labels);
    counter.labels[labelKey] = (counter.labels[labelKey] || 0) + value;
  }

  setGauge(name: string, labels: Record<string, string | number> = {}, value: number): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;
    const labelKey = this.formatLabels(labels);
    gauge.labels[labelKey] = value;
  }

  observeHistogram(name: string, labels: Record<string, string | number> = {}, value: number): void {
    const hist = this.histograms.get(name);
    if (!hist) return;
    const labelKey = this.formatLabels(labels);
    let obs = hist.observations.get(labelKey);
    if (!obs) {
      obs = {
        count: 0,
        sum: 0,
        bucketCounts: new Array(hist.buckets.length).fill(0),
      };
      hist.observations.set(labelKey, obs);
    }

    obs.count += 1;
    obs.sum += value;
    for (let i = 0; i < hist.buckets.length; i++) {
      if (value <= (hist.buckets[i] ?? 0)) {
        obs.bucketCounts[i] = (obs.bucketCounts[i] ?? 0) + 1;
      }
    }
  }

  /**
   * Generates Prometheus exposition format 0.0.4.
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    // Gauges
    for (const [name, gauge] of this.gauges.entries()) {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [labels, val] of Object.entries(gauge.labels)) {
        lines.push(`${name}${labels} ${val}`);
      }
    }

    // Counters
    for (const [name, counter] of this.counters.entries()) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, val] of Object.entries(counter.labels)) {
        lines.push(`${name}${labels} ${val}`);
      }
    }

    // Histograms
    for (const [name, hist] of this.histograms.entries()) {
      lines.push(`# HELP ${name} ${hist.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labelKey, obs] of hist.observations.entries()) {
        const rawLabel = labelKey.length > 2 ? labelKey.slice(1, -1) : '';
        const baseLabels = rawLabel ? `${rawLabel},` : '';

        for (let i = 0; i < hist.buckets.length; i++) {
          const le = hist.buckets[i];
          const count = obs.bucketCounts[i] ?? 0;
          lines.push(`${name}_bucket{${baseLabels}le="${le}"} ${count}`);
        }
        lines.push(`${name}_bucket{${baseLabels}le="+Inf"} ${obs.count}`);
        lines.push(`${name}_sum${labelKey} ${obs.sum.toFixed(6)}`);
        lines.push(`${name}_count${labelKey} ${obs.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }
}

// Singleton global metrics registry
let globalRegistry: MetricsRegistry | null = null;

export function getMetricsRegistry(): MetricsRegistry {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistry();
  }
  return globalRegistry;
}
