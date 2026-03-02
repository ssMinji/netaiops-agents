import { useTranslation } from "react-i18next";
import type { Agent } from "../types";

interface Props {
  agents: Agent[];
  onSelectAgent: (agent: Agent) => void;
}

export default function HomePage({ agents, onSelectAgent }: Props) {
  const { t } = useTranslation();

  return (
    <div className="home">
      <div className="home-header">
        <span className="home-logo">🤖</span>
        <h1 className="home-title">{t("app.title")}</h1>
        <p className="home-subtitle">{t("welcome.subtitle")}</p>
      </div>

      <div className="agent-cards">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="agent-card"
            onClick={() => onSelectAgent(agent)}
          >
            <span className="agent-card-icon">{agent.icon}</span>
            <div className="agent-card-name">{t(`agents.${agent.id}.name`, { defaultValue: agent.name })}</div>
            <div className="agent-card-desc">{t(`agents.${agent.id}.description`, { defaultValue: agent.description })}</div>
            <div className="agent-card-arrow">
              {t("welcome.getStarted")}
            </div>
          </div>
        ))}
      </div>

      <p className="home-hint">{t("welcome.hint")}</p>
    </div>
  );
}
