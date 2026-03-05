import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { fetchConfig, streamChat } from "./api";
import type { Agent, Model, Message, MessageMetrics } from "./types";
import ChatPage from "./components/ChatPage";
import Dashboard from "./components/Dashboard";
import AgentIcon from "./components/AgentIcon";
import { DashboardIcon } from "./components/AgentIcon";
import WelcomeLogo from "./components/WelcomeLogo";
import LoginPage from "./components/LoginPage";

interface Session {
  id: string;
  messages: Message[];
}

function generateId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ko", label: "Korean" },
  { code: "ja", label: "Japanese" },
];

export default function App() {
  const { t, i18n } = useTranslation();
  const [userAlias, setUserAlias] = useState<string | null>(() => localStorage.getItem("userAlias"));
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [activeView, setActiveView] = useState<"welcome" | "dashboard" | "chat">("dashboard");
  const [selectedModel, setSelectedModel] = useState("");
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeChaos, setActiveChaos] = useState<string[]>([]);
  const [activeFaults, setActiveFaults] = useState<string[]>([]);
  const [scenarioContext, setScenarioContext] = useState<{ agentId: string; scenarioId: string; usedFollowUps: Set<number> } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const handleLogin = useCallback((alias: string) => {
    localStorage.setItem("userAlias", alias);
    setUserAlias(alias);
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias }),
    }).catch(() => {});
  }, []);

  // Load config on mount
  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        setAgents(cfg.agents);
        setModels(cfg.models);
        if (cfg.models.length > 0) setSelectedModel(cfg.models[0].id);
      })
      .catch(console.error);
  }, []);

  const currentLang = i18n.language?.startsWith("ko")
    ? "ko"
    : i18n.language?.startsWith("ja")
      ? "ja"
      : "en";

  const currentLangLabel = LANGUAGES.find((l) => l.code === currentLang)?.label ?? "English";

  // Close language dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getSession = useCallback(
    (agentId: string): Session => {
      if (sessions[agentId]) return sessions[agentId];
      return { id: generateId(), messages: [] };
    },
    [sessions],
  );

  const handleSelectAgent = useCallback(
    (agent: Agent) => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
      setIsStreaming(false);
      setSelectedAgent(agent);
      setActiveView("chat");
      setScenarioContext(null);
      if (!sessions[agent.id]) {
        setSessions((prev) => ({
          ...prev,
          [agent.id]: { id: generateId(), messages: [] },
        }));
      }
    },
    [sessions],
  );

  const handleNewConversation = useCallback(() => {
    if (!selectedAgent) return;
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setIsStreaming(false);
    setScenarioContext(null);
    setSessions((prev) => ({
      ...prev,
      [selectedAgent.id]: { id: generateId(), messages: [] },
    }));
  }, [selectedAgent]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!selectedAgent || isStreaming) return;

      const agentId = selectedAgent.id;
      const session = getSession(agentId);

      // Add user message (display original text)
      const userMsg: Message = { role: "user", content: text };
      const updatedMessages = [...session.messages, userMsg];
      setSessions((prev) => ({
        ...prev,
        [agentId]: { ...session, messages: updatedMessages },
      }));

      // Prepend language and style instruction for the agent
      const langPrefix = currentLang === "ko"
        ? "[한국어로 답변하세요. 핵심 내용 위주로 간결하되, 중요한 세부사항은 포함하세요.] "
        : currentLang === "ja"
        ? "[日本語で回答してください。要点を中心に簡潔に、ただし重要な詳細は含めてください。] "
        : "[Respond in English. Be concise and focus on key findings, but include important details.] ";
      const textForAgent = langPrefix + text;

      // Start streaming
      setIsStreaming(true);
      let assistantContent = "";

      // Add empty assistant message
      setSessions((prev) => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          messages: [...updatedMessages, { role: "assistant", content: "" }],
        },
      }));

      const ctrl = await streamChat(
        agentId,
        session.id,
        textForAgent,
        selectedModel,
        (chunk) => {
          assistantContent += chunk;
          setSessions((prev) => {
            const s = prev[agentId];
            const msgs = [...s.messages];
            msgs[msgs.length - 1] = { role: "assistant", content: assistantContent };
            return { ...prev, [agentId]: { ...s, messages: msgs } };
          });
        },
        (metrics?: MessageMetrics) => {
          if (metrics) {
            setSessions((prev) => {
              const s = prev[agentId];
              const msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (last && last.role === "assistant") {
                msgs[msgs.length - 1] = { ...last, metrics };
              }
              return { ...prev, [agentId]: { ...s, messages: msgs } };
            });
          }
          setIsStreaming(false);
        },
        (err) => {
          assistantContent += `\n\n_Error: ${err}_`;
          setSessions((prev) => {
            const s = prev[agentId];
            const msgs = [...s.messages];
            msgs[msgs.length - 1] = { role: "assistant", content: assistantContent };
            return { ...prev, [agentId]: { ...s, messages: msgs } };
          });
        },
      );
      controllerRef.current = ctrl;
    },
    [selectedAgent, selectedModel, isStreaming, getSession, currentLang],
  );

  const handleScenarioClick = useCallback(
    (prompt: string, scenarioId: string) => {
      if (isStreaming || !selectedAgent) return;
      setScenarioContext({ agentId: selectedAgent.id, scenarioId, usedFollowUps: new Set() });
      handleSend(prompt);
    },
    [isStreaming, handleSend, selectedAgent],
  );

  const handleSuggestionClick = useCallback(
    (text: string, index: number) => {
      if (isStreaming || !scenarioContext) return;
      setScenarioContext((prev) => {
        if (!prev) return prev;
        const next = new Set(prev.usedFollowUps);
        next.add(index);
        return { ...prev, usedFollowUps: next };
      });
      handleSend(text);
    },
    [isStreaming, scenarioContext, handleSend],
  );

  // Compute suggestion chips from i18n follow-ups
  const suggestions: { text: string; index: number }[] = [];
  if (scenarioContext && selectedAgent && scenarioContext.agentId === selectedAgent.id) {
    const key = `agents.${scenarioContext.agentId}.scenarios.${scenarioContext.scenarioId}.followUps`;
    const followUps = t(key, { returnObjects: true });
    if (Array.isArray(followUps)) {
      followUps.forEach((text: string, i: number) => {
        if (!scenarioContext.usedFollowUps.has(i)) {
          suggestions.push({ text, index: i });
        }
      });
    }
  }

  if (!userAlias) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo" onClick={() => { setSelectedAgent(null); setActiveView("welcome"); }} style={{ cursor: "pointer" }}>
            <span className="sidebar-logo-text">{t("app.title")}</span>
          </div>
          <div className="lang-dropdown" ref={langRef}>
            <button className="lang-dropdown-toggle" onClick={() => setLangOpen((v) => !v)}>
              <svg className="lang-globe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
                <circle cx="12" cy="12" r="10" />
                <ellipse cx="12" cy="12" rx="4" ry="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
              <span>{currentLangLabel}</span>
              <svg className="lang-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={10} height={10}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {langOpen && (
              <div className="lang-dropdown-menu">
                {LANGUAGES.filter((l) => l.code !== currentLang).map((l) => (
                  <button
                    key={l.code}
                    className="lang-dropdown-item"
                    onClick={() => { i18n.changeLanguage(l.code); setLangOpen(false); }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-nav">
          <button
            className={`sidebar-dashboard ${activeView === "dashboard" ? "active" : ""}`}
            onClick={() => { setSelectedAgent(null); setActiveView("dashboard"); }}
          >
            <DashboardIcon size={18} />
            <span>{t("dashboard.title")}</span>
          </button>
        </div>

        <div className="sidebar-section-title">{t("sidebar.agents")}</div>
        <div className="sidebar-agent-list">
          {agents.filter((a) => !a.parentId).map((a) => {
            const children = agents.filter((c) => c.parentId === a.id);
            return (
              <div key={a.id}>
                <button
                  className={`sidebar-agent ${selectedAgent?.id === a.id ? "active" : ""}`}
                  onClick={() => handleSelectAgent(a)}
                >
                  <AgentIcon agentId={a.id} size={22} className="sidebar-agent-icon" />
                  <div className="sidebar-agent-info">
                    <div className="sidebar-agent-name">{t(`agents.${a.id}.name`, { defaultValue: a.name })}</div>
                    <div className="sidebar-agent-desc">{t(`agents.${a.id}.description`, { defaultValue: a.description })}</div>
                  </div>
                </button>
                {children.map((child) => (
                  <button
                    key={child.id}
                    className={`sidebar-agent sidebar-agent-child ${selectedAgent?.id === child.id ? "active" : ""}`}
                    onClick={() => handleSelectAgent(child)}
                  >
                    <AgentIcon agentId={child.id} size={18} className="sidebar-agent-icon" />
                    <div className="sidebar-agent-info">
                      <div className="sidebar-agent-name">{t(`agents.${child.id}.name`, { defaultValue: child.name })}</div>
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {selectedAgent && selectedAgent.scenarios.length > 0 && (
          <>
            <div className="sidebar-section-title">{t("sidebar.scenarios")}</div>
            <div className="sidebar-scenario-list">
              {selectedAgent.scenarios.map((s) => (
                <button
                  key={s.id}
                  className="sidebar-scenario"
                  onClick={() => handleScenarioClick(t(`agents.${selectedAgent.id}.scenarios.${s.id}.prompt`, { defaultValue: s.prompt }), s.id)}
                >
                  <span className="sidebar-scenario-arrow">▸</span>
                  {t(`agents.${selectedAgent.id}.scenarios.${s.id}.name`, { defaultValue: s.name })}
                </button>
              ))}
            </div>
          </>
        )}

      </aside>

      {/* Main Area */}
      <main className="main-area">
        <div className="topbar">
          <span className="topbar-welcome">Welcome, <strong>{userAlias}</strong></span>
        </div>
        {activeView === "chat" && selectedAgent ? (
          <ChatPage
            agent={selectedAgent}
            models={models}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            session={getSession(selectedAgent.id)}
            isStreaming={isStreaming}
            activeChaos={activeChaos}
            onActiveChaosChange={setActiveChaos}
            activeFaults={activeFaults}
            onActiveFaultsChange={setActiveFaults}
            onSend={handleSend}
            onNewConversation={handleNewConversation}
            suggestions={suggestions}
            onSuggestionClick={handleSuggestionClick}
          />
        ) : activeView === "dashboard" ? (
          <Dashboard
            onNavigateToAgent={(agentId) => {
              const agent = agents.find(a => a.id === agentId);
              if (agent) handleSelectAgent(agent);
            }}
            modelId={selectedModel}
          />
        ) : (
          <div className="welcome-screen">
            <WelcomeLogo />
            <h1 className="welcome-title">{t("app.title")}</h1>
            <p className="welcome-subtitle">{t("welcome.subtitle")}</p>
            <p className="welcome-hint">{t("welcome.hint")}</p>
          </div>
        )}
      </main>
    </div>
  );
}
