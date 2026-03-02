# Frontend Guide

## Overview

The NetAIOps Web UI is a React 18 SPA built with TypeScript and Vite. It provides a chat-based interface for interacting with AI agents, along with specialized controls for chaos engineering and fault injection.

## Tech Stack

- **React 18** with TypeScript
- **Vite** for build tooling
- **react-i18next** for internationalization
- **react-markdown** + **remark-gfm** for message rendering

## Project Structure

```
app/frontend/src/
├── App.tsx              # Main router, state management
├── App.css              # Global styles
├── main.tsx             # React entry point + i18n init
├── types.ts             # TypeScript interfaces
├── api.ts               # Backend API client
├── components/
│   ├── HomePage.tsx     # Agent selection cards
│   ├── ChatPage.tsx     # Chat interface
│   ├── ChaosPanel.tsx   # Incident chaos controls
│   ├── FaultPanel.tsx   # Istio fault injection
│   ├── Dashboard.tsx    # AWS resource overview
│   └── AgentIcon.tsx    # Agent emoji rendering
└── i18n/
    ├── index.ts         # i18next configuration
    └── locales/
        ├── en.json      # English
        ├── ko.json      # Korean
        └── ja.json      # Japanese
```

## Key Features

### Internationalization (i18n)

Three languages supported with automatic browser detection:

- **English** (default fallback)
- **Korean** (ko)
- **Japanese** (ja)

Language selector in the header allows runtime switching. Selection persisted in `localStorage`.

Translation keys cover:
- Agent names and descriptions
- Scenario names and prompts
- UI labels and buttons
- Follow-up suggestion chips

### Chat Interface

The ChatPage component provides:

- **Real-time streaming**: SSE-based response rendering
- **Markdown support**: Full GFM with syntax highlighting
- **Model selector**: Switch between Claude, Qwen, Nova models per conversation
- **Scenario quick-links**: Pre-built diagnostic prompts
- **Follow-up chips**: Context-aware follow-up suggestions after scenario responses
- **Centered layout**: Chat input centered with max-width constraint

### Message Metrics Footer

Each agent response displays:

```
┌─────────────────────────────────────┐
│ Tool Badges: [dns-resolve] [dns-check-health] │
│ TTFB 245ms · Total 3.2s                       │
│ In 1,234 tokens · Out 456 tokens               │
│ Cache Read 100 · Cache Write 50                │
└─────────────────────────────────────┘
```

- **Tool badges**: MCP tools used during the response (wrench icon)
- **Timing**: Time To First Byte and total response time
- **Token usage**: Input/output token counts
- **Cache metrics**: Prompt cache read/write tokens (when caching enabled)

### Agent-Specific Panels

**ChaosPanel** (Incident Agent):
- 4 chaos scenarios with trigger/cleanup buttons
- Active chaos status indicators
- Bulk cleanup capability

**FaultPanel** (Istio Agent):
- 3 fault types (delay, abort, circuit-breaker)
- Individual apply/remove controls
- Bulk cleanup capability

### Dashboard

AWS infrastructure overview with:
- Multi-region support with region switcher
- VPC, EC2, Load Balancer, NAT Gateway listings
- Per-region data caching (60s TTL)

## Build & Deploy

```bash
# Development
cd app/frontend
npm install
npm run dev

# Production build
npm run build
# Output: app/frontend/dist/ → copied to app/backend/static/
```
