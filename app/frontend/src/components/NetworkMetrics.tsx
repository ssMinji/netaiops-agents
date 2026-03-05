import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { fetchDashboardMetrics } from "../api";
import type { DashboardMetrics as MetricsData } from "../types";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toChartData(
  timestamps: string[],
  ...series: { key: string; values: number[] }[]
): Record<string, unknown>[] {
  return timestamps.map((ts, i) => {
    const point: Record<string, unknown> = { time: formatTime(ts) };
    for (const s of series) {
      point[s.key] = s.values[i] ?? 0;
    }
    return point;
  });
}

const COLORS = ["#2563eb", "#f97316", "#16a34a", "#a855f7", "#ef4444", "#06b6d4"];

interface Props {
  region: string;
}

export default function NetworkMetrics({ region }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetchDashboardMetrics(region)
      .then(setData)
      .catch(() => setError(t("dashboard.metricsError", "Failed to load metrics")))
      .finally(() => setLoading(false));
  }, [region, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 60000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, load]);

  if (loading && !data) {
    return (
      <div className="metrics-section">
        <div className="metrics-header">
          <h3 className="metrics-title">{t("dashboard.networkHealth", "Network Health")}</h3>
        </div>
        <div className="metrics-loading">
          <div className="dashboard-spinner" />
          <span>{t("dashboard.metricsLoading", "Loading metrics...")}</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="metrics-section">
        <div className="metrics-header">
          <h3 className="metrics-title">{t("dashboard.networkHealth", "Network Health")}</h3>
        </div>
        <div className="metrics-loading">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Prepare chart data
  const ec2Data = toChartData(
    data.ec2_traffic.timestamps,
    { key: "in", values: data.ec2_traffic.network_in_bytes },
    { key: "out", values: data.ec2_traffic.network_out_bytes },
  );

  // ALB: pick the ALB with the most traffic (prefer application type over network)
  const firstAlb = [...data.alb_performance]
    .sort((a, b) => {
      // Prefer application LBs over network LBs
      if (a.type === "application" && b.type !== "application") return -1;
      if (b.type === "application" && a.type !== "application") return 1;
      // Then pick the one with more data
      const aSum = a.request_count.reduce((s, v) => s + v, 0);
      const bSum = b.request_count.reduce((s, v) => s + v, 0);
      return bSum - aSum;
    })[0] ?? null;
  const albData = firstAlb
    ? toChartData(
        firstAlb.timestamps,
        { key: "requests", values: firstAlb.request_count },
        { key: "latency", values: firstAlb.response_time_ms },
        { key: "2xx", values: firstAlb.http_2xx },
        { key: "5xx", values: firstAlb.http_5xx },
      )
    : [];

  // NAT: combine all NAT GWs into one chart
  const firstNat = data.nat_gateways[0];
  const natData = firstNat
    ? toChartData(
        firstNat.timestamps,
        ...data.nat_gateways.flatMap((ng, i) => [
          { key: `conns_${i}`, values: ng.active_connections },
          { key: `bytes_${i}`, values: ng.bytes_out },
        ]),
      )
    : [];

  // TGW: combine all attachments
  const tgwAtts = data.transit_gateway.attachments;
  const firstAtt = tgwAtts[0];
  const tgwData = firstAtt
    ? toChartData(
        firstAtt.timestamps,
        ...tgwAtts.flatMap((att, i) => [
          { key: `in_${i}`, values: att.bytes_in },
          { key: `out_${i}`, values: att.bytes_out },
        ]),
      )
    : [];

  return (
    <div className="metrics-section">
      <div className="metrics-header">
        <h3 className="metrics-title">{t("dashboard.networkHealth", "Network Health")}</h3>
        <div className="metrics-controls">
          <label className="metrics-auto-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            {t("dashboard.autoRefresh", "Auto-refresh")}
          </label>
          {data.cached_at && (
            <span className="metrics-timestamp">
              {new Date(data.cached_at * 1000).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="metrics-grid">
        {/* EC2 Network Traffic */}
        <div className="metrics-chart-card">
          <h4 className="metrics-chart-title">{t("dashboard.ec2Traffic", "EC2 Network Traffic")}</h4>
          {ec2Data.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={ec2Data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => formatBytes(v)} />
                <Tooltip formatter={(v: number | undefined) => formatBytes(v ?? 0)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="in" name="Network In" stroke="#2563eb" fill="url(#gradIn)" strokeWidth={2} />
                <Area type="monotone" dataKey="out" name="Network Out" stroke="#f97316" fill="url(#gradOut)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="metrics-no-data">{t("dashboard.noData")}</div>
          )}
        </div>

        {/* ALB Performance */}
        <div className="metrics-chart-card">
          <h4 className="metrics-chart-title">
            {t("dashboard.albPerformance", "ALB Performance")}
            {firstAlb && <span className="metrics-chart-subtitle"> — {firstAlb.name}</span>}
          </h4>
          {albData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={albData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#9ca3af" unit="ms" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="requests" name="Requests" fill="#2563eb" opacity={0.7} />
                <Line yAxisId="right" type="monotone" dataKey="latency" name="Latency (ms)" stroke="#ef4444" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="metrics-no-data">{t("dashboard.noData")}</div>
          )}
        </div>

        {/* NAT Gateway */}
        <div className="metrics-chart-card">
          <h4 className="metrics-chart-title">{t("dashboard.natGateway", "NAT Gateway")}</h4>
          {natData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={natData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => formatBytes(v)} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {data.nat_gateways.map((ng, i) => (
                  <Line
                    key={`conns_${i}`}
                    yAxisId="left"
                    type="monotone"
                    dataKey={`conns_${i}`}
                    name={`${ng.name || ng.id} Conns`}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
                {data.nat_gateways.map((ng, i) => (
                  <Line
                    key={`bytes_${i}`}
                    yAxisId="right"
                    type="monotone"
                    dataKey={`bytes_${i}`}
                    name={`${ng.name || ng.id} Bytes`}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="metrics-no-data">{t("dashboard.noData")}</div>
          )}
        </div>

        {/* Transit Gateway */}
        <div className="metrics-chart-card">
          <h4 className="metrics-chart-title">{t("dashboard.transitGateway", "Transit Gateway")}</h4>
          {tgwData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={tgwData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => formatBytes(v)} />
                <Tooltip formatter={(v: number | undefined) => formatBytes(v ?? 0)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {tgwAtts.map((att, i) => (
                  <Area
                    key={`in_${i}`}
                    type="monotone"
                    dataKey={`in_${i}`}
                    name={`${att.name || att.id} In`}
                    stroke={COLORS[i * 2 % COLORS.length]}
                    fill={COLORS[i * 2 % COLORS.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    stackId={`stack_${i}`}
                  />
                ))}
                {tgwAtts.map((att, i) => (
                  <Area
                    key={`out_${i}`}
                    type="monotone"
                    dataKey={`out_${i}`}
                    name={`${att.name || att.id} Out`}
                    stroke={COLORS[(i * 2 + 1) % COLORS.length]}
                    fill={COLORS[(i * 2 + 1) % COLORS.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    stackId={`stack_${i}`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="metrics-no-data">{t("dashboard.noData")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
