import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fetchDashboard } from "../api";
import type { DashboardData } from "../types";

function StateBadge({ state }: { state: string }) {
  const s = state.toLowerCase();
  let cls = "state-badge";
  if (s === "running" || s === "available" || s === "active") cls += " state-ok";
  else if (s === "stopped" || s === "failed" || s === "deleted" || s === "terminated") cls += " state-error";
  else if (s === "pending" || s === "deleting" || s === "shutting-down" || s === "stopping") cls += " state-warn";
  return <span className={cls}>{state}</span>;
}

/* Summary card icons */
function VpcCardIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 12h4M14 12h4" /><circle cx="12" cy="12" r="1" />
    </svg>
  );
}
function Ec2CardIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
    </svg>
  );
}
function LbCardIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}>
      <circle cx="12" cy="5" r="3" /><circle cx="6" cy="19" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="12" y1="8" x2="6" y2="16" /><line x1="12" y1="8" x2="18" y2="16" />
    </svg>
  );
}
function NatCardIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="dashboard-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" opacity={0.25}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [region, setRegion] = useState("");

  const load = useCallback((r?: string) => {
    setLoading(true);
    setError("");
    fetchDashboard(r || region || undefined)
      .then((d) => {
        setData(d);
        if (!region && d.region) setRegion(d.region);
      })
      .catch(() => setError(t("dashboard.error")))
      .finally(() => setLoading(false));
  }, [t, region]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegionChange = (newRegion: string) => {
    setRegion(newRegion);
    load(newRegion);
  };

  // Compute status summaries
  const vpcAvailable = data?.vpcs.filter((v) => v.state === "available").length ?? 0;
  const ec2Running = data?.ec2_instances.filter((i) => i.state === "running").length ?? 0;
  const ec2Stopped = data?.ec2_instances.filter((i) => i.state === "stopped").length ?? 0;
  const lbActive = data?.load_balancers.filter((lb) => lb.state === "active").length ?? 0;
  const natAvailable = data?.nat_gateways.filter((ng) => ng.state === "available").length ?? 0;

  if (loading && !data) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-loading">
          <div className="dashboard-spinner" />
          <span>{t("dashboard.loading")}</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="dashboard-page">
        <div className="dashboard-error-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.4}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p>{error}</p>
          <button className="dashboard-btn" onClick={() => load()}>{t("dashboard.refresh")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="dashboard-toolbar">
        <div className="dashboard-toolbar-left">
          <h2 className="dashboard-title">{t("dashboard.title")}</h2>
          <p className="dashboard-subtitle">AWS Infrastructure Status</p>
        </div>
        <div className="dashboard-toolbar-right">
          <select
            className="dashboard-region-select"
            value={region}
            onChange={(e) => handleRegionChange(e.target.value)}
          >
            {(data?.regions ?? [region]).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button className="dashboard-btn" onClick={() => load()} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={loading ? "spin" : ""}>
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t("dashboard.refresh")}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="dashboard-summary">
        <div className="summary-card summary-blue">
          <div className="summary-card-icon"><VpcCardIcon /></div>
          <div className="summary-card-body">
            <span className="summary-card-label">{t("dashboard.vpcs")}</span>
            <span className="summary-card-count">{data?.vpcs.length ?? 0}</span>
          </div>
          <div className="summary-card-divider" />
          <div className="summary-card-footer">
            <span>Available: {vpcAvailable}</span>
          </div>
        </div>

        <div className="summary-card summary-green">
          <div className="summary-card-icon"><Ec2CardIcon /></div>
          <div className="summary-card-body">
            <span className="summary-card-label">{t("dashboard.ec2")}</span>
            <span className="summary-card-count">{data?.ec2_instances.length ?? 0}</span>
          </div>
          <div className="summary-card-divider" />
          <div className="summary-card-footer">
            <span>Running: {ec2Running}</span>
            <span>Stopped: {ec2Stopped}</span>
          </div>
        </div>

        <div className="summary-card summary-orange">
          <div className="summary-card-icon"><LbCardIcon /></div>
          <div className="summary-card-body">
            <span className="summary-card-label">{t("dashboard.loadBalancers")}</span>
            <span className="summary-card-count">{data?.load_balancers.length ?? 0}</span>
          </div>
          <div className="summary-card-divider" />
          <div className="summary-card-footer">
            <span>Active: {lbActive}</span>
          </div>
        </div>

        <div className="summary-card summary-purple">
          <div className="summary-card-icon"><NatCardIcon /></div>
          <div className="summary-card-body">
            <span className="summary-card-label">{t("dashboard.natGateways")}</span>
            <span className="summary-card-count">{data?.nat_gateways.length ?? 0}</span>
          </div>
          <div className="summary-card-divider" />
          <div className="summary-card-footer">
            <span>Available: {natAvailable}</span>
          </div>
        </div>
      </div>

      {/* Detail Tables */}
      <div className="dashboard-details">
        {/* VPCs */}
        <div className="detail-section">
          <h3 className="detail-section-title">{t("dashboard.vpcs")}</h3>
          {data?.vpcs.length ? (
            <div className="detail-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>{t("dashboard.id")}</th>
                    <th>{t("dashboard.name")}</th>
                    <th>{t("dashboard.cidr")}</th>
                    <th>{t("dashboard.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vpcs.map((v) => (
                    <tr key={v.id}>
                      <td className="mono">{v.id}</td>
                      <td>{v.name}</td>
                      <td className="mono">{v.cidr}</td>
                      <td><StateBadge state={v.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState label={t("dashboard.noData")} />
          )}
        </div>

        {/* EC2 Instances */}
        <div className="detail-section">
          <h3 className="detail-section-title">{t("dashboard.ec2")}</h3>
          {data?.ec2_instances.length ? (
            <div className="detail-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>{t("dashboard.id")}</th>
                    <th>{t("dashboard.name")}</th>
                    <th>{t("dashboard.type")}</th>
                    <th>{t("dashboard.state")}</th>
                    <th>{t("dashboard.privateIp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ec2_instances.map((i) => (
                    <tr key={i.id}>
                      <td className="mono">{i.id}</td>
                      <td>{i.name}</td>
                      <td className="mono">{i.type}</td>
                      <td><StateBadge state={i.state} /></td>
                      <td className="mono">{i.private_ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState label={t("dashboard.noData")} />
          )}
        </div>

        {/* Load Balancers & NAT Gateways side by side */}
        <div className="detail-row">
          <div className="detail-section">
            <h3 className="detail-section-title">{t("dashboard.loadBalancers")}</h3>
            {data?.load_balancers.length ? (
              <div className="detail-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>{t("dashboard.name")}</th>
                      <th>{t("dashboard.type")}</th>
                      <th>{t("dashboard.scheme")}</th>
                      <th>{t("dashboard.state")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.load_balancers.map((lb) => (
                      <tr key={lb.name}>
                        <td>{lb.name}</td>
                        <td className="badge-type">{lb.type}</td>
                        <td>{lb.scheme}</td>
                        <td><StateBadge state={lb.state} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState label={t("dashboard.noData")} />
            )}
          </div>

          <div className="detail-section">
            <h3 className="detail-section-title">{t("dashboard.natGateways")}</h3>
            {data?.nat_gateways.length ? (
              <div className="detail-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>{t("dashboard.id")}</th>
                      <th>{t("dashboard.state")}</th>
                      <th>{t("dashboard.subnet")}</th>
                      <th>{t("dashboard.publicIp")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.nat_gateways.map((ng) => (
                      <tr key={ng.id}>
                        <td className="mono">{ng.id}</td>
                        <td><StateBadge state={ng.state} /></td>
                        <td className="mono">{ng.subnet}</td>
                        <td className="mono">{ng.public_ip}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState label={t("dashboard.noData")} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
