import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, fetchDashboardMetrics } from "../api";
import type { DashboardMetrics } from "../types";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  report: string;
  cachedAt: number;
}

function getCached(region: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(`anomaly-report-${region}`);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > CACHE_TTL) {
      localStorage.removeItem(`anomaly-report-${region}`);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function setCache(region: string, report: string) {
  try {
    localStorage.setItem(
      `anomaly-report-${region}`,
      JSON.stringify({ report, cachedAt: Date.now() }),
    );
  } catch {
    // storage full — ignore
  }
}

function buildResourceContext(metrics: DashboardMetrics): string {
  const parts: string[] = [];

  // Load Balancers with ARN suffixes
  const lbs = metrics.alb_performance.filter((lb) => lb.arn_suffix);
  if (lbs.length > 0) {
    parts.push("Load Balancers:");
    for (const lb of lbs) {
      parts.push(`  - ${lb.name} (${lb.type}) — ARN suffix: ${lb.arn_suffix}`);
    }
  }

  // NAT Gateways
  if (metrics.nat_gateways.length > 0) {
    parts.push("NAT Gateways:");
    for (const ng of metrics.nat_gateways) {
      parts.push(`  - ${ng.name || ng.id} — ID: ${ng.id}`);
    }
  }

  // Transit Gateway
  if (metrics.transit_gateway.tgw_id) {
    parts.push(`Transit Gateway: ${metrics.transit_gateway.tgw_id}`);
    for (const att of metrics.transit_gateway.attachments) {
      parts.push(`  - ${att.name || att.id} — Attachment ID: ${att.id}`);
    }
  }

  // VPC Flow Log groups
  if (metrics.flow_log_groups && metrics.flow_log_groups.length > 0) {
    parts.push("VPC Flow Log Groups:");
    for (const lg of metrics.flow_log_groups) {
      parts.push(`  - ${lg}`);
    }
  }

  return parts.join("\n");
}

interface Props {
  region: string;
  modelId?: string;
  onNavigateToAgent?: (agentId: string) => void;
}

export default function AnomalyReport({ region, modelId, onNavigateToAgent }: Props) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const metricsRef = useRef<DashboardMetrics | null>(null);

  const currentLang = i18n.language?.startsWith("ko")
    ? "ko"
    : i18n.language?.startsWith("ja")
      ? "ja"
      : "en";

  const runScan = useCallback(async () => {
    setScanning(true);
    setError("");
    setReport("");
    setFromCache(false);

    // Fetch resource info for the prompt
    let resourceContext = "";
    try {
      if (!metricsRef.current) {
        metricsRef.current = await fetchDashboardMetrics(region);
      }
      resourceContext = buildResourceContext(metricsRef.current);
    } catch {
      // proceed without resource context
    }

    let prompt: string;
    if (currentLang === "ko") {
      prompt = `[한국어로 답변하세요. 핵심 내용 위주로 간결하되, 중요한 세부사항은 포함하세요.] ` +
        `${region} 리전의 네트워크 인프라에 대해 종합 이상 탐지 스캔을 실행해주세요. ` +
        `CloudWatch 메트릭 이상탐지, VPC Flow Logs 분석, ELB 상태 변화를 포함하여 분석하고, ` +
        `발견된 이상 징후를 심각도별로 정리해주세요.`;
      if (resourceContext) {
        prompt += `\n\n아래는 ${region} 리전에서 실제 발견된 리소스입니다. 도구 호출 시 이 정확한 식별자를 사용하세요:\n${resourceContext}`;
      }
    } else if (currentLang === "ja") {
      prompt = `[日本語で回答してください。要点を中心に簡潔に、ただし重要な詳細は含めてください。] ` +
        `${region} リージョンのネットワークインフラに対して総合異常検出スキャンを実行してください。` +
        `CloudWatchメトリクス異常検出、VPC Flow Logs分析、ELB状態変化を含めて分析し、` +
        `検出された異常を重大度別に整理してください。`;
      if (resourceContext) {
        prompt += `\n\n以下は${region}リージョンで実際に検出されたリソースです。ツール呼び出し時にこの正確な識別子を使用してください:\n${resourceContext}`;
      }
    } else {
      prompt = `[Respond in English. Be concise and focus on key findings, but include important details.] ` +
        `Run a comprehensive anomaly detection scan on the network infrastructure in the ${region} region. ` +
        `Include CloudWatch metric anomaly detection, VPC Flow Logs analysis, and ELB status changes. ` +
        `Organize findings by severity.`;
      if (resourceContext) {
        prompt += `\n\nBelow are the actual resources discovered in the ${region} region. Use these exact identifiers when calling tools:\n${resourceContext}`;
      }
    }

    let content = "";

    const sessionId = `dashboard-anomaly-report-${region}-${Date.now()}`;
    streamChat(
      "anomaly",
      sessionId,
      prompt,
      modelId || "",
      (chunk) => {
        content += chunk;
        setReport(content);
      },
      () => {
        setScanning(false);
        if (content) {
          setCache(region, content);
        }
      },
      (err) => {
        setScanning(false);
        if (err.includes("503") || err.includes("ARN not found")) {
          setError(t("dashboard.anomalyNotDeployed", "Anomaly agent is not deployed"));
        } else {
          setError(err);
        }
      },
    ).then((ctrl) => {
      controllerRef.current = ctrl;
    });
  }, [region, modelId, currentLang, t]);

  useEffect(() => {
    // Check cache first
    const cached = getCached(region);
    if (cached) {
      setReport(cached.report);
      setFromCache(true);
      return;
    }
    runScan();

    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
    };
  }, [region]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRescan = () => {
    localStorage.removeItem(`anomaly-report-${region}`);
    metricsRef.current = null; // refresh resource info too
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    runScan();
  };

  return (
    <div className="anomaly-report">
      <div className="anomaly-report-header">
        <div className="anomaly-report-title-row">
          <h3 className="metrics-title">{t("dashboard.anomalyReport", "Anomaly Detection Report")}</h3>
          {fromCache && (
            <span className="anomaly-cached-badge">
              {t("dashboard.anomalyCached", "Cached")}
            </span>
          )}
          {scanning && (
            <span className="anomaly-scanning-badge">
              {t("dashboard.anomalyScanning", "Scanning...")}
            </span>
          )}
        </div>
        <div className="anomaly-report-actions">
          <button
            className="dashboard-btn"
            onClick={handleRescan}
            disabled={scanning}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={scanning ? "spin" : ""}>
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t("dashboard.anomalyRescan", "Re-scan")}
          </button>
          {onNavigateToAgent && (
            <button
              className="anomaly-btn-chat"
              onClick={() => onNavigateToAgent("anomaly")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {t("dashboard.anomalyDiscuss", "Discuss in Chat")}
            </button>
          )}
        </div>
      </div>

      <div className={`anomaly-report-content${scanning ? " anomaly-streaming" : ""}`}>
        {error ? (
          <div className="anomaly-error">{error}</div>
        ) : report ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
        ) : scanning ? (
          <div className="metrics-loading">
            <div className="dashboard-spinner" />
            <span>{t("dashboard.anomalyScanning", "Scanning...")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
