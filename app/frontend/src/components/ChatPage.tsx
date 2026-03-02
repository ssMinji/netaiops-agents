import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Agent, Model, Message, MessageMetrics } from "../types";
import ChaosPanel from "./ChaosPanel";
import FaultPanel from "./FaultPanel";
import AgentIcon from "./AgentIcon";

interface Session {
  id: string;
  messages: Message[];
}

interface Props {
  agent: Agent;
  models: Model[];
  selectedModel: string;
  onModelChange: (id: string) => void;
  session: Session;
  isStreaming: boolean;
  activeChaos: string[];
  onActiveChaosChange: (chaos: string[]) => void;
  activeFaults: string[];
  onActiveFaultsChange: (faults: string[]) => void;
  onSend: (text: string) => void;
  onNewConversation: () => void;
  suggestions?: { text: string; index: number }[];
  onSuggestionClick?: (text: string, index: number) => void;
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolBadges({ tools }: { tools: string[] }) {
  return (
    <div className="tool-badges">
      {tools.map((tool) => (
        <span key={tool} className="tool-badge">
          <svg className="tool-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={12} height={12}>
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          {tool}
        </span>
      ))}
    </div>
  );
}

function MessageMetricsFooter({ metrics }: { metrics: MessageMetrics }) {
  const { t } = useTranslation();
  const ttfb = metrics.ttfb_ms ?? metrics.client_ttfb_ms;
  const total = metrics.total_ms ?? metrics.client_total_ms;
  const hasTokens = metrics.input_tokens != null || metrics.output_tokens != null;

  const parts: string[] = [];
  if (ttfb != null) parts.push(`TTFB ${formatDuration(ttfb)}`);
  if (total != null) parts.push(`Total ${formatDuration(total)}`);
  if (metrics.input_tokens != null) parts.push(`In ${metrics.input_tokens.toLocaleString()}`);
  if (metrics.output_tokens != null) parts.push(`Out ${metrics.output_tokens.toLocaleString()}`);
  if (metrics.cache_read_tokens != null) parts.push(`Cache read ${metrics.cache_read_tokens.toLocaleString()}`);
  if (metrics.cache_creation_tokens != null) parts.push(`Cache write ${metrics.cache_creation_tokens.toLocaleString()}`);

  if (parts.length === 0 && !metrics.tools_used?.length) return null;

  const isServerTiming = metrics.ttfb_ms != null || metrics.total_ms != null;

  return (
    <div className="message-metrics">
      {metrics.tools_used && metrics.tools_used.length > 0 && (
        <ToolBadges tools={metrics.tools_used} />
      )}
      {parts.length > 0 && (
        <div className="message-metrics-timing">
          {parts.join(" · ")}
          {hasTokens && ` ${t("metrics.tokens")}`}
          {!isServerTiming && ttfb != null && <span className="message-metrics-note"> {t("metrics.client")}</span>}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  );
}

export default function ChatPage({
  agent,
  models,
  selectedModel,
  onModelChange,
  session,
  isStreaming,
  activeChaos,
  onActiveChaosChange,
  activeFaults,
  onActiveFaultsChange,
  onSend,
  onNewConversation,
  suggestions = [],
  onSuggestionClick,
}: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, []);

  useEffect(() => {
    adjustTextarea();
  }, [input, adjustTextarea]);

  // Focus input on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    onSend(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isIncident = agent.id === "incident" || agent.id === "incident-cached";
  const isIstio = agent.id === "istio";
  const isEmpty = session.messages.length === 0;

  const agentName = t(`agents.${agent.id}.name`, { defaultValue: agent.name });
  const agentDesc = t(`agents.${agent.id}.description`, { defaultValue: agent.description });
  const agentPlaceholder = t(`agents.${agent.id}.placeholder`, { defaultValue: agent.placeholder });

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-title">
            <AgentIcon agentId={agent.id} size={18} className="chat-header-agent-icon" />
            {agentName}
          </div>
        </div>
        <div className="chat-header-controls">
          {isIncident && (
            <ChaosPanel
              activeChaos={activeChaos}
              onActiveChaosChange={onActiveChaosChange}
            />
          )}
          {isIstio && (
            <FaultPanel
              activeFaults={activeFaults}
              onActiveFaultsChange={onActiveFaultsChange}
            />
          )}
          <select
            className="model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button className="header-btn" onClick={onNewConversation}>
            {t("chat.newChat")}
          </button>
        </div>
      </div>

      {isEmpty ? (
        /* Centered layout — no messages yet */
        <div className="chat-center">
          <div className="chat-center-content">
            <div className="messages-empty-icon"><AgentIcon agentId={agent.id} size={40} /></div>
            <div className="chat-center-title">{agentName}</div>
            <div className="chat-center-hint">{agentDesc}</div>
          </div>
          <div className="chat-center-input">
            <div className="chat-input-container">
              <div className="chat-input-wrapper">
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={agentPlaceholder}
                  rows={1}
                  disabled={isStreaming}
                />
                <button
                  className="send-button"
                  onClick={handleSubmit}
                  disabled={!input.trim() || isStreaming}
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="messages-area" ref={messagesAreaRef}>
            {session.messages.map((msg, i) => {
              const isLastAssistant =
                msg.role === "assistant" && i === session.messages.length - 1;
              return (
                <div key={i} className="message">
                  <div className={`message-avatar ${msg.role}`}>
                    {msg.role === "user" ? "U" : <AgentIcon agentId={agent.id} size={18} />}
                  </div>
                  <div className="message-content">
                    {msg.role === "assistant" && msg.content === "" && isStreaming ? (
                      <TypingIndicator />
                    ) : (
                      <>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                        {isLastAssistant && isStreaming && (
                          <TypingIndicator />
                        )}
                        {msg.role === "assistant" && msg.metrics && !(isLastAssistant && isStreaming) && (
                          <MessageMetricsFooter metrics={msg.metrics} />
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input — bottom */}
          <div className="chat-bottom">
            {suggestions.length > 0 && !isStreaming && (
              <div className="suggestion-chips">
                {suggestions.map((s) => (
                  <button
                    key={s.index}
                    className="suggestion-chip"
                    onClick={() => onSuggestionClick?.(s.text, s.index)}
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            )}
            <div className="chat-input-container">
              <div className="chat-input-wrapper">
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={agentPlaceholder}
                  rows={1}
                  disabled={isStreaming}
                />
                <button
                  className="send-button"
                  onClick={handleSubmit}
                  disabled={!input.trim() || isStreaming}
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
