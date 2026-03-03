# NetAIOps Agent Hub

AWS Bedrock AgentCore-based infrastructure diagnostics platform featuring four specialized AI agents for network, incident, Kubernetes, and Istio service mesh analysis.

## What is NetAIOps?

NetAIOps (Network AI Operations) is a multi-agent system that provides autonomous infrastructure diagnosis through AI agents. Each agent integrates with multi-source observability tools (Datadog, OpenSearch, Container Insights, CloudWatch) and AWS infrastructure APIs to deliver real-time analysis and recommendations.

## Key Capabilities

- **Automated Incident Investigation**: Multi-source metric correlation and root cause estimation
- **Kubernetes Diagnostics**: EKS cluster health monitoring, pod/node analysis, resource management
- **Istio Service Mesh Analysis**: mTLS audit, traffic routing inspection, canary deployment analysis
- **Network Diagnostics**: VPC topology, DNS resolution, flow log analysis, load balancer metrics
- **Chaos Engineering**: CPU stress, error injection, latency injection, pod crash simulation
- **Multi-language UI**: English, Korean, Japanese with real-time language switching

## Architecture Overview

![Architecture Overview](../architecture-overview.png)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Model | Claude (Opus 4.6, Sonnet 4.6), Qwen, Nova |
| Agent Framework | Strands SDK + Bedrock AgentCore |
| Backend | FastAPI (Python) |
| Frontend | React 18 + TypeScript + Vite |
| Infrastructure | AWS CDK (TypeScript) |
| Auth | Amazon Cognito (M2M client credentials) |
| Observability | Datadog, OpenSearch, Container Insights, CloudWatch |

## Getting Started

1. [Architecture](architecture/) - Understand the system design
2. [Agents](agents/) - Learn about each AI agent
3. [Deployment](deployment/) - Deploy the platform
4. [Frontend](frontend/) - Web UI features
5. [Backend](backend/) - API reference
6. [Troubleshooting](troubleshooting/) - Common issues and fixes
