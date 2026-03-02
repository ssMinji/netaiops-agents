# Istio Mesh Diagnostics Agent

## Purpose

Service mesh analysis and traffic management for Istio-based environments. The Istio Agent inspects control plane health, mTLS configurations, traffic routing rules, and provides canary deployment analysis with latency hotspot detection.

## Location

```
agents/istio-agent/
├── agent/                   # Agent runtime
└── prerequisite/            # Prometheus Lambda, Fault injection Lambda
```

## MCP Tools

### EKS MCP Server
Shared with the K8s Agent for Kubernetes object inspection:
- VirtualService, DestinationRule, Gateway resources
- Envoy sidecar configuration
- Istio control plane pods

### Prometheus Tools
- `prometheus-query` - PromQL metrics queries
- `prometheus-range-query` - Time-range metric analysis

## Direct-Invoked Lambda (Non-MCP)

The **Fault Injection Lambda** (`istio-fault-tools`) is not an agent MCP tool. The backend invokes the Lambda directly from the UI's FaultPanel via `/api/fault/*` API.

- `fault-delay` - Add latency to service-to-service calls
- `fault-abort` - Inject HTTP error responses
- `fault-circuit-breaker` - Enable circuit breaking

## Scenarios

| Scenario | Description |
|----------|-------------|
| Service Connectivity Failure | Diagnose communication failures between services |
| mTLS Audit | Verify mutual TLS configuration across the mesh |
| Canary Deployment Analysis | Analyze traffic splitting and canary health |
| Control Plane Status | Inspect istiod, pilot, and control plane health |
| Latency Hotspot Detection | Identify services causing latency spikes |

## AWS Service Permissions

| Component | Required AWS Services | Notes |
|-----------|----------------------|-------|
| **Agent Runtime** | Bedrock, SSM, CloudWatch | Gateway execution role |
| **EKS MCP Server** | EKS, Kubernetes API, CloudWatch Logs, EC2/VPC | Shared with K8s Agent — Istio CRD inspection runs here |
| **Lambda (Prometheus)** | AMP (Amazon Managed Prometheus) | Lambda execution role |
| **Lambda (Fault)** | EKS | Lambda execution role |

Istio CRD inspection (VirtualService, DestinationRule, etc.) is performed by the **shared EKS MCP Server**, not the agent runtime itself. Prometheus metrics and fault injection are handled by dedicated Lambda functions.

## Fault Injection Integration

The UI provides a dedicated FaultPanel for the Istio Agent:

1. **Delay Injection**: Add configurable latency (e.g., 5s delay to 50% of traffic)
2. **Abort Injection**: Return HTTP errors (e.g., 503 to 30% of requests)
3. **Circuit Breaker**: Configure outlier detection thresholds

Each fault can be individually applied, removed, or bulk-cleaned through the UI.

## Docker Configuration

The Istio Agent uses ECR Public Gallery for the base image to avoid Docker Hub rate limits in CodeBuild:

```dockerfile
FROM public.ecr.aws/docker/library/python:3.12-slim
```
