# NetAIOps Agent

AI-powered network and infrastructure operations agents built on AWS Bedrock AgentCore.

## Agents

### k8s-agent
EKS cluster diagnostics agent with MCP Gateway integration for Kubernetes resource management, pod troubleshooting, CloudWatch metrics, and VPC networking analysis.

### incident-agent
Automated incident investigation agent with multi-source observability integration (Datadog, OpenSearch, Container Insights). Creates GitHub issues, performs root cause analysis, and auto-remediates known chaos scenarios.

### istio-agent
Istio service mesh diagnostics agent for traffic management, fault injection analysis, and Prometheus metrics correlation.

## Structure

```
netaiops-agent/
├── app/                    # React + Flask integrated UI
├── docs/                   # Architecture and deployment documentation
├── infra-cdk/              # CDK infrastructure
├── sample-workloads/       # Test workloads (EKS cluster, Istio bookinfo)
├── k8s-agent/              # K8s Diagnostics Agent
│   ├── agent/              # Agent source code
│   └── prerequisite/       # EKS MCP Server + Cognito setup
├── incident-agent/         # Incident Analysis Agent
│   ├── agent/              # Agent source code
│   └── prerequisite/       # Lambda functions + Cognito setup
└── istio-agent/            # Istio Mesh Agent
    ├── agent/              # Agent source code
    └── prerequisite/       # Lambda functions + Cognito setup
```

## Prerequisites

- AWS Account with Bedrock AgentCore access
- EKS cluster (see `sample-workloads/eks-cluster/`)
- Cognito User Pool for each agent (see `*/prerequisite/`)
- SSM Parameter Store entries for agent configuration

## Deployment

Refer to `docs/DEPLOYMENT.md` and `docs/DEPLOYMENT-CDK.md` for detailed instructions.
