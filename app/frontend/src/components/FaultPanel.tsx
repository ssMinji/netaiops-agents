import { useState } from "react";
import { useTranslation } from "react-i18next";
import { applyFault, removeFault, cleanupFaults } from "../api";

interface Props {
  activeFaults: string[];
  onActiveFaultsChange: (faults: string[]) => void;
}

const FAULT_SCENARIOS = [
  { type: "delay", key: "fault.reviewsDelay", icon: "🐌" },
  { type: "abort", key: "fault.ratings503", icon: "💥" },
  { type: "circuit-breaker", key: "fault.circuitBreaker", icon: "🔌" },
];

export default function FaultPanel({ activeFaults, onActiveFaultsChange }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const handleToggle = async (type: string, label: string) => {
    setLoading(type);
    const isActive = activeFaults.includes(label);
    try {
      if (isActive) {
        const result = await removeFault(type);
        if (result.status === "success") {
          onActiveFaultsChange(activeFaults.filter((f) => f !== label));
        }
      } else {
        const result = await applyFault(type);
        if (result.status === "success") {
          onActiveFaultsChange([...activeFaults, label]);
        }
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
      const result = await cleanupFaults();
      if (result.status === "success") {
        onActiveFaultsChange([]);
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
        className={`fault-toggle ${activeFaults.length > 0 ? "has-active" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        🔧 {t("fault.title")}{activeFaults.length > 0 ? ` (${activeFaults.length})` : ""}
      </button>

      <div className={`fault-panel ${expanded ? "expanded" : ""}`}>
        <div className="fault-content">
          <span className="fault-label">{t("fault.faults")}</span>
          {FAULT_SCENARIOS.map(({ type, key, icon }) => {
            const label = t(key);
            const isActive = activeFaults.includes(label);
            return (
              <button
                key={type}
                className={`fault-btn ${isActive ? "active" : ""}`}
                onClick={() => handleToggle(type, label)}
                disabled={loading !== null}
              >
                {icon} {label}
                {loading === type && " ..."}
                {isActive && " ●"}
              </button>
            );
          })}
          {activeFaults.length > 0 && (
            <button
              className="fault-btn cleanup"
              onClick={handleCleanup}
              disabled={loading !== null}
            >
              🧹 {t("fault.removeAll")}
              {loading === "cleanup" && " ..."}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
