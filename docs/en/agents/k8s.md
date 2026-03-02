# K8s Diagnostics Agent

## Purpose

EKS cluster diagnostics and Kubernetes resource management. The K8s Agent provides comprehensive cluster health monitoring, pod/node analysis, resource CRUD operations, and manifest generation through the AWS Labs EKS MCP Server.

## Location

```
agents/k8s-agent/
├── agent/                        # Agent runtime
└── prerequisite/eks-mcp-server/  # EKS MCP Server deployment
```

## MCP Tools

The K8s Agent uses the **AWS Labs EKS MCP Server**, which provides a comprehensive set of Kubernetes operations:

- Cluster discovery (multi-region)
- Pod/Node/Deployment/Service CRUD
- Log retrieval and filtering
- Metrics collection
- Namespace-based workload analysis
- Manifest generation and YAML application

### Region-Aware Operation

The agent is configured to verify cluster existence before operations, preventing hallucination of non-existent clusters. It supports dynamic region switching for multi-region EKS deployments.

## Scenarios

| Scenario | Description |
|----------|-------------|
| Cluster Health Check | Comprehensive EKS cluster status review |
| Abnormal Pod Diagnosis | Investigate pods in CrashLoopBackOff, Pending, or Error states |
| Resource Usage Analysis | CPU/memory utilization across namespaces |
| Workload Overview | List deployments, services, and their health status |

## AWS Service Permissions

| Component | Required AWS Services | Notes |
|-----------|----------------------|-------|
| **Agent Runtime** | Bedrock, SSM, CloudWatch | Gateway execution role |
| **EKS MCP Server** | EKS, Kubernetes API, CloudWatch Logs, EC2/VPC, IAM (read-only) | MCP Server runtime role — all K8s operations run here |

The agent runtime does not directly access EKS. All Kubernetes operations are performed by the **EKS MCP Server runtime**, which holds EKS and Kubernetes API permissions. The agent communicates with the MCP Server through the MCP Gateway.

## Prerequisites

### EKS MCP Server

The K8s Agent requires an EKS MCP Server deployed as a Bedrock AgentCore runtime:

```bash
cd agents/k8s-agent/prerequisite/eks-mcp-server
./deploy-eks-mcp-server.sh
```

This deploys the `awslabs/eks-mcp-server` as an AgentCore runtime, which the agent accesses through the MCP Gateway as an `mcpServer` target.

### EKS MCP Server RBAC

The K8s Agent itself does not need RBAC — the **EKS MCP Server runtime's IAM role** must be mapped to a Kubernetes RBAC role via the `aws-auth` ConfigMap. The MCP Server handles this automatically through its own EKS access configuration.

> **Note**: The `setup-eks-rbac.sh` script in `agents/incident-agent/prerequisite/` is for the **Incident Agent's Chaos Lambda**, not for the K8s Agent. It grants the Chaos Lambda's IAM role permission to create/delete pods and scale deployments.
