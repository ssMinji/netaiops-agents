/**
 * Shared configuration constants for NetAIOps CDK infrastructure.
 */

export const CONFIG = {
  account: '175678592674',
  primaryRegion: 'us-east-1',
  alarmRegion: 'us-west-2',
  profile: 'netaiops-deploy',
  eksClusterName: 'netaiops-eks-cluster',

  module5: {
    ssmPrefix: '/a2a/app/k8s/agentcore',
    agentPool: {
      name: 'K8sAgentPool',
      domainPrefix: 'k8sagent',
      resourceServerIdentifier: 'netops-a2a-server',
      machineClientName: 'K8sMachineClient',
      webClientName: 'K8sWebClient',
      webCallbackUrl: 'http://localhost:8501/',
    },
    runtimePool: {
      name: 'EksMcpServerPool',
      domainPrefix: 'eks-mcp',
      resourceServerIdentifier: 'eks-mcp-server',
      machineClientName: 'EksMcpServerClient',
    },
    gateway: {
      name: 'k8s-diagnostics-gateway',
      description: 'AgentCore K8s Diagnostics Gateway',
      targetName: 'EksMcpServer',
      targetDescription: 'Official AWS Labs EKS MCP Server - cluster diagnostics, resource management, logs, metrics',
      oauthProviderName: 'eks-mcp-server-oauth',
    },
    runtime: {
      name: 'a2a_k8s_agent_runtime',
      memoryStrategy: 'SESSION_SUMMARY',
    },
  },

  module6: {
    ssmPrefix: '/app/incident/agentcore',
    cognitoPool: {
      name: 'IncidentAnalysisPool',
      domainPrefix: 'incident-analysis',
      resourceServerIdentifier: 'incident-resource-server',
      machineClientName: 'IncidentAnalysisMachineClient',
      webClientName: 'IncidentAnalysisWebClient',
      webCallbackUrl: 'http://localhost:8502/',
    },
    lambdas: {
      datadog: { name: 'incident-datadog-tools', dir: 'datadog' },
      opensearch: { name: 'incident-opensearch-tools', dir: 'opensearch' },
      containerInsight: { name: 'incident-container-insight-tools', dir: 'container-insight' },
      chaos: { name: 'incident-chaos-tools', dir: 'chaos' },
      alarmTrigger: { name: 'incident-alarm-trigger', dir: 'alarm-trigger' },
      github: { name: 'incident-github-tools', dir: 'github' },
    },
    gateway: {
      name: 'incident-analysis-gateway',
      description: 'AgentCore Incident Analysis Gateway',
    },
    runtime: {
      name: 'incident_analysis_agent_runtime',
      memoryStrategy: 'NO_MEMORY',
    },
    monitoring: {
      snsTopicName: 'netaiops-incident-alarm-topic',
      alarms: [
        {
          name: 'netaiops-cpu-spike',
          description: 'EKS pod CPU utilization exceeds 80% - possible CPU stress incident',
          metricName: 'pod_cpu_utilization',
          statistic: 'Average',
          period: 60,
          evaluationPeriods: 3,
          datapointsToAlarm: 2,
          threshold: 80,
          comparisonOperator: 'GreaterThanThreshold',
        },
        {
          name: 'netaiops-pod-restarts',
          description: 'EKS pod container restarts exceed 3 in 5 minutes - possible CrashLoopBackOff',
          metricName: 'pod_number_of_container_restarts',
          statistic: 'Sum',
          period: 300,
          evaluationPeriods: 1,
          datapointsToAlarm: 1,
          threshold: 3,
          comparisonOperator: 'GreaterThanThreshold',
        },
        {
          name: 'netaiops-node-cpu-high',
          description: 'EKS node CPU utilization exceeds 85% - possible node-level resource pressure',
          metricName: 'node_cpu_utilization',
          statistic: 'Average',
          period: 60,
          evaluationPeriods: 3,
          datapointsToAlarm: 2,
          threshold: 85,
          comparisonOperator: 'GreaterThanThreshold',
        },
      ],
    },
  },

  // Tool schemas for Module 6 Lambda gateway targets
  toolSchemas: {
    datadog: [
      {
        name: 'datadog-query-metrics',
        description: 'Query Datadog timeseries metrics (CPU, Memory, Latency, Error Rate).',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: "Datadog metrics query (e.g., 'avg:system.cpu.user{service:web-app}')" },
            from_ts: { type: 'integer', description: 'Start timestamp (Unix epoch seconds). Default: 1 hour ago' },
            to_ts: { type: 'integer', description: 'End timestamp (Unix epoch seconds). Default: now' },
          },
          required: ['query'],
        },
      },
      {
        name: 'datadog-get-events',
        description: 'Get Datadog events and alert history.',
        inputSchema: {
          type: 'object',
          properties: {
            tags: { type: 'string', description: "Comma-separated tags to filter events (e.g., 'service:web-app,env:prod')" },
            priority: { type: 'string', description: "Event priority filter: 'normal' or 'low'. Default: all", enum: ['normal', 'low'] },
            hours: { type: 'integer', description: 'How many hours back to search. Default: 24' },
          },
          required: [],
        },
      },
      {
        name: 'datadog-get-traces',
        description: 'Get APM traces for slow or error requests.',
        inputSchema: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'Service name to filter traces' },
            operation: { type: 'string', description: 'Operation name filter (optional)' },
            min_duration_ms: { type: 'integer', description: 'Minimum trace duration in milliseconds. Default: 1000' },
            hours: { type: 'integer', description: 'How many hours back to search. Default: 1' },
            status: { type: 'string', description: "Trace status filter: 'error' or 'ok'", enum: ['error', 'ok'] },
          },
          required: ['service'],
        },
      },
      {
        name: 'datadog-get-monitors',
        description: 'Get Datadog monitor statuses.',
        inputSchema: {
          type: 'object',
          properties: {
            monitor_tags: { type: 'string', description: 'Comma-separated tags to filter monitors' },
            name_filter: { type: 'string', description: 'Filter monitors by name substring' },
          },
          required: [],
        },
      },
    ],
    opensearch: [
      {
        name: 'opensearch-search-logs',
        description: 'Search application logs by keyword or pattern.',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: "OpenSearch index name or pattern (e.g., 'app-logs-*')" },
            query: { type: 'string', description: "Search query string (e.g., 'error AND timeout')" },
            hours: { type: 'integer', description: 'How many hours back to search. Default: 1' },
            size: { type: 'integer', description: 'Maximum number of results. Default: 50' },
          },
          required: ['index', 'query'],
        },
      },
      {
        name: 'opensearch-anomaly-detection',
        description: 'Detect anomalous log volume patterns over time.',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'OpenSearch index name or pattern' },
            field: { type: 'string', description: "Field to analyze for anomalies (e.g., 'level', 'status_code'). Default: 'level'" },
            hours: { type: 'integer', description: 'How many hours back to analyze. Default: 6' },
            interval: { type: 'string', description: "Bucket interval (e.g., '5m', '15m', '1h'). Default: '5m'" },
          },
          required: ['index'],
        },
      },
      {
        name: 'opensearch-get-error-summary',
        description: 'Get error log statistics grouped by type.',
        inputSchema: {
          type: 'object',
          properties: {
            index: { type: 'string', description: 'OpenSearch index name or pattern' },
            hours: { type: 'integer', description: 'How many hours back to search. Default: 24' },
            group_by: { type: 'string', description: "Field to group errors by. Default: 'error_type'" },
          },
          required: ['index'],
        },
      },
    ],
    containerInsight: [
      {
        name: 'container-insight-pod-metrics',
        description: 'Get EKS pod CPU, Memory, Network metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            cluster_name: { type: 'string', description: 'EKS cluster name' },
            namespace: { type: 'string', description: 'Kubernetes namespace. Default: all namespaces' },
            pod_name: { type: 'string', description: 'Specific pod name filter (optional)' },
            minutes: { type: 'integer', description: 'How many minutes back. Default: 60' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['cluster_name'],
        },
      },
      {
        name: 'container-insight-node-metrics',
        description: 'Get EKS node resource utilization.',
        inputSchema: {
          type: 'object',
          properties: {
            cluster_name: { type: 'string', description: 'EKS cluster name' },
            node_name: { type: 'string', description: 'Specific node name (optional)' },
            minutes: { type: 'integer', description: 'How many minutes back. Default: 60' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['cluster_name'],
        },
      },
      {
        name: 'container-insight-cluster-overview',
        description: 'Get cluster-wide health overview including node/pod counts and resource usage.',
        inputSchema: {
          type: 'object',
          properties: {
            cluster_name: { type: 'string', description: 'EKS cluster name' },
            minutes: { type: 'integer', description: 'How many minutes back. Default: 30' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['cluster_name'],
        },
      },
    ],
  },
} as const;
