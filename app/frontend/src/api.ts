import type { AppConfig, MessageMetrics, DashboardData } from "./types";

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch("./api/config");
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function streamChat(
  agentId: string,
  sessionId: string,
  message: string,
  modelId: string,
  onChunk: (text: string) => void,
  onDone: (metrics?: MessageMetrics) => void,
  onError: (err: string) => void,
) {
  const controller = new AbortController();

  try {
    const clientStart = performance.now();
    let clientFirstChunk: number | null = null;
    let serverMetrics: MessageMetrics | undefined;

    const res = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        session_id: sessionId,
        message,
        model_id: modelId,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      onError(`Error (${res.status}): ${text}`);
      onDone();
      return controller;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === "data: [DONE]") {
          const clientTotal = Math.round(performance.now() - clientStart);
          const combined: MessageMetrics = {
            ...serverMetrics,
            client_ttfb_ms: clientFirstChunk ? Math.round(clientFirstChunk - clientStart) : undefined,
            client_total_ms: clientTotal,
          };
          onDone(combined);
          return controller;
        }
        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.metrics) {
              serverMetrics = data.metrics;
            } else if (data.content) {
              if (clientFirstChunk === null) {
                clientFirstChunk = performance.now();
              }
              onChunk(data.content);
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    }

    const clientTotal = Math.round(performance.now() - clientStart);
    const combined: MessageMetrics = {
      ...serverMetrics,
      client_ttfb_ms: clientFirstChunk ? Math.round(clientFirstChunk - clientStart) : undefined,
      client_total_ms: clientTotal,
    };
    onDone(combined);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return controller;
    onError(String(err));
    onDone();
  }

  return controller;
}

export async function triggerChaos(scenario: string): Promise<Record<string, unknown>> {
  const res = await fetch("./api/chaos/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  return res.json();
}

export async function cleanupChaos(): Promise<Record<string, unknown>> {
  const res = await fetch("./api/chaos/cleanup", { method: "POST" });
  return res.json();
}

export async function getChaosStatus(): Promise<{ active: string[] }> {
  const res = await fetch("./api/chaos/status");
  return res.json();
}

// -- Istio fault injection -------------------------------------------------
export async function applyFault(faultType: string): Promise<Record<string, unknown>> {
  const res = await fetch("./api/fault/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fault_type: faultType }),
  });
  return res.json();
}

export async function removeFault(faultType: string): Promise<Record<string, unknown>> {
  const res = await fetch("./api/fault/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fault_type: faultType }),
  });
  return res.json();
}

export async function cleanupFaults(): Promise<Record<string, unknown>> {
  const res = await fetch("./api/fault/cleanup", { method: "POST" });
  return res.json();
}

export async function getFaultStatus(): Promise<{ active: string[] }> {
  const res = await fetch("./api/fault/status");
  return res.json();
}

// -- Dashboard --------------------------------------------------------------
export async function fetchDashboard(region?: string): Promise<DashboardData> {
  const params = region ? `?region=${encodeURIComponent(region)}` : "";
  const res = await fetch(`./api/dashboard${params}`);
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
}
