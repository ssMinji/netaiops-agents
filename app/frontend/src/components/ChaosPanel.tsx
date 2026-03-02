import { useState } from "react";
import { useTranslation } from "react-i18next";
import { triggerChaos, cleanupChaos } from "../api";

interface Props {
  activeChaos: string[];
  onActiveChaosChange: (chaos: string[]) => void;
}

const CHAOS_SCENARIOS = [
  { tool: "chaos-cpu-stress", key: "chaos.cpuStress", icon: "🔥" },
  { tool: "chaos-error-injection", key: "chaos.errorInjection", icon: "💥" },
  { tool: "chaos-latency-injection", key: "chaos.latencyInjection", icon: "🐌" },
  { tool: "chaos-pod-crash", key: "chaos.podCrash", icon: "💀" },
];

export default function ChaosPanel({ activeChaos, onActiveChaosChange }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const handleTrigger = async (tool: string, label: string) => {
    setLoading(tool);
    try {
      const result = await triggerChaos(tool);
      if (result.status === "success") {
        onActiveChaosChange([...activeChaos, label]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
  };

  const handleCleanup = async () => {
    setLoading("cleanup");
    try {
      const result = await cleanupChaos();
      if (result.status === "success" || result.status === "partial") {
        onActiveChaosChange([]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <button
        className={`chaos-toggle ${activeChaos.length > 0 ? "has-active" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        ⚡ {t("chaos.trigger")}{activeChaos.length > 0 ? ` (${activeChaos.length})` : ""}
      </button>

      <div className={`chaos-panel ${expanded ? "expanded" : ""}`}>
        <div className="chaos-content">
          <span className="chaos-label">{t("chaos.scenarios")}</span>
          {CHAOS_SCENARIOS.map(({ tool, key, icon }) => {
            const label = t(key);
            const isActive = activeChaos.includes(label);
            return (
              <button
                key={tool}
                className={`chaos-btn ${isActive ? "active" : ""}`}
                onClick={() => handleTrigger(tool, label)}
                disabled={loading !== null}
              >
                {icon} {label}
                {loading === tool && " ..."}
                {isActive && " ●"}
              </button>
            );
          })}
          {activeChaos.length > 0 && (
            <button
              className="chaos-btn cleanup"
              onClick={handleCleanup}
              disabled={loading !== null}
            >
              🧹 {t("chaos.cleanupAll")}
              {loading === "cleanup" && " ..."}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
