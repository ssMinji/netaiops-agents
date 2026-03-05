# NetAIOps Agent

AI-powered network and infrastructure operations agents built on AWS Bedrock AgentCore.

## Architecture

![NetAIOps Architecture Overview](docs/architecture-overview.png)

## Agents

| Agent | Domain | MCP Tools | Description |
|-------|--------|-----------|-------------|
| **K8s Agent** | Kubernetes/EKS | EKS MCP Server | EKS cluster diagnostics, Pod troubleshooting, resource management |
| **Incident Agent** | Incident Analysis | Datadog, OpenSearch, Container Insights | Multi-source incident investigation, root cause analysis, automated GitHub issue creation |
| **Istio Agent** | Service Mesh | EKS MCP Server, Prometheus | Traffic management, metric correlation analysis, service mesh diagnostics |
| **Network Agent** | AWS Networking | Network MCP Server, DNS, CloudWatch | VPC/subnet analysis, DNS diagnostics, network metric queries |
| **Anomaly Agent** | Anomaly Detection | CloudWatch | Network anomaly detection and analysis across demo infrastructure |

## Project Structure

```
netaiops-agent/
├── agents/
│   ├── k8s-agent/          # Kubernetes diagnostics agent
│   │   ├── agent/          #   Agent source code
│   │   └── prerequisite/   #   EKS MCP Server config
│   ├── incident-agent/     # Incident analysis agent
│   │   ├── agent/          #   Agent source code
│   │   ├── agent-cached/   #   Prompt caching enabled version
│   │   └── prerequisite/   #   Lambda functions + alarm config
│   ├── istio-agent/        # Istio mesh agent
│   │   ├── agent/          #   Agent source code
│   │   └── prerequisite/   #   Lambda function config
│   ├── network-agent/      # Network diagnostics agent
│   │   ├── agent/          #   Agent source code
│   │   └── prerequisite/   #   Network MCP Server config
│   └── anomaly-agent/      # Anomaly detection agent
│       └── agent/          #   Agent source code
├── app/
│   ├── backend/            # FastAPI backend (API + static serving)
│   └── frontend/           # React frontend (Vite + TypeScript)
├── infra-cdk/              # CDK infrastructure (Cognito, IAM, Lambda, SSM)
│   └── lib/stacks/
│       ├── k8s-agent/      #   K8s agent CDK stack
│       ├── incident-agent/ #   Incident agent CDK stack
│       ├── istio-agent/    #   Istio agent CDK stack
│       ├── network-agent/  #   Network agent CDK stack
│       ├── anomaly-agent/  #   Anomaly agent CDK stack
│       └── demo-network/   #   Demo network infrastructure (VPC, EC2, LB, TGW)
├── sample-workloads/
│   ├── retail-store/       # EKS Retail Store sample app
│   └── istio-sample/       # Istio Bookinfo sample app
├── docs/                   # Documentation (GitBook, ko/en)
└── deploy.sh               # Unified deploy script (Phase 1~4)
```

## Prerequisites

- AWS CLI with configured profile
- Node.js 18+ (CDK)
- Python 3.12+ (agents)
- AgentCore CLI (`agentcore`)
- Docker (Lambda image builds)
- `kubectl` (EKS RBAC setup)

## Deployment

```bash
# Full deployment (CDK → EKS RBAC → MCP Server → Agent Runtime)
./deploy.sh
```

See the [Deployment Guide](docs/ko/deployment/README.md) for detailed instructions.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ko/architecture/README.md) | System architecture details |
| [Agents](docs/ko/agents/README.md) | Per-agent configuration and tools |
| [Deployment Guide](docs/ko/deployment/README.md) | Full deployment procedure |
| [English Docs](docs/en/) | English documentation |

## Sample Workloads

| Workload | Description | Used By |
|----------|-------------|---------|
| [retail-store](sample-workloads/retail-store/) | EKS Retail Store microservices app | K8s Agent, Incident Agent |
| [istio-sample](sample-workloads/istio-sample/) | Istio Bookinfo sample app | Istio Agent |
