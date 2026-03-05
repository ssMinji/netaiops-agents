/**
 * Shared configuration constants for NetAIOps CDK infrastructure.
 */

export const CONFIG = {
  account: '175678592674',
  primaryRegion: 'us-east-1',
  alarmRegion: 'us-east-1',
  profile: 'netaiops-deploy',
  eksClusterName: 'netaiops-eks-cluster',

  k8sAgent: {
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

  incidentAgent: {
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

  istioAgent: {
    ssmPrefix: '/app/istio/agentcore',
    cognitoPool: {
      name: 'IstioMeshPool',
      domainPrefix: 'istioagent',
      resourceServerIdentifier: 'istio-mesh-server',
      machineClientName: 'IstioMachineClient',
      webClientName: 'IstioWebClient',
      webCallbackUrl: 'http://localhost:8501/',
    },
    lambdas: {
      prometheus: { name: 'istio-prometheus-tools', dir: 'prometheus' },
      fault: { name: 'istio-fault-tools', dir: 'fault' },
    },
    gateway: {
      name: 'istio-mesh-gateway',
      description: 'AgentCore Istio Mesh Diagnostics Gateway',
      oauthProviderName: 'istio-eks-mcp-server-oauth',
      k8sSsmPrefix: '/a2a/app/k8s/agentcore',
    },
    runtime: {
      name: 'a2a_istio_mesh_agent_runtime',
    },
  },

  anomalyAgent: {
    ssmPrefix: '/app/anomaly/agentcore',
    cognitoPool: {
      name: 'AnomalyDetectionPool',
      domainPrefix: 'anomaly-detection',
      resourceServerIdentifier: 'anomaly-resource-server',
      machineClientName: 'AnomalyDetectionMachineClient',
      webClientName: 'AnomalyDetectionWebClient',
      webCallbackUrl: 'http://localhost:8501/',
    },
    lambdas: {
      cloudwatchAnomaly: { name: 'anomaly-cloudwatch-tools', dir: 'cloudwatch-anomaly' },
      networkAnomaly: { name: 'anomaly-network-tools', dir: 'network-anomaly' },
    },
    gateway: {
      name: 'anomaly-detection-gateway',
      description: 'AgentCore Anomaly Detection Gateway',
    },
    runtime: {
      name: 'anomaly_detection_agent_runtime',
      memoryStrategy: 'NO_MEMORY',
    },
  },

  networkAgent: {
    ssmPrefix: '/app/network/agentcore',
    agentPool: {
      name: 'NetworkAgentPool',
      domainPrefix: 'networkagent',
      resourceServerIdentifier: 'network-diagnostics-server',
      machineClientName: 'NetworkMachineClient',
      webClientName: 'NetworkWebClient',
      webCallbackUrl: 'http://localhost:8501/',
    },
    runtimePool: {
      name: 'NetworkMcpServerPool',
      domainPrefix: 'network-mcp',
      resourceServerIdentifier: 'network-mcp-server',
      machineClientName: 'NetworkMcpServerClient',
    },
    lambdas: {
      dns: { name: 'network-dns-tools', dir: 'dns' },
      networkMetrics: { name: 'network-metrics-tools', dir: 'network-metrics' },
    },
    gateway: {
      name: 'network-diagnostics-gateway',
      description: 'AgentCore Network Diagnostics Gateway',
      oauthProviderName: 'network-mcp-server-oauth',
    },
    runtime: {
      name: 'network_diagnostics_agent_runtime',
    },
  },

  // Tool schemas for Lambda gateway targets
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
            priority: { type: 'string', description: "Event priority filter. Allowed values: 'normal', 'low'. Default: all" },
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
            status: { type: 'string', description: "Trace status filter. Allowed values: 'error', 'ok'" },
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
    dns: [
      {
        name: 'dns-list-hosted-zones',
        description: 'List all Route 53 hosted zones.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "dns-list-hosted-zones".' },
            max_items: { type: 'integer', description: 'Maximum number of hosted zones to return. Default: 100' },
          },
          required: ['_tool'],
        },
      },
      {
        name: 'dns-query-records',
        description: 'Query DNS records in a specific hosted zone.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "dns-query-records".' },
            zone_id: { type: 'string', description: 'Route 53 hosted zone ID' },
            record_name: { type: 'string', description: 'DNS record name filter (optional)' },
            record_type: { type: 'string', description: 'DNS record type filter. Allowed values: A, AAAA, CNAME, MX, TXT, NS, SOA, SRV, PTR, CAA' },
            max_items: { type: 'integer', description: 'Maximum number of records to return. Default: 100' },
          },
          required: ['_tool', 'zone_id'],
        },
      },
      {
        name: 'dns-check-health',
        description: 'Check Route 53 health check statuses.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "dns-check-health".' },
            health_check_id: { type: 'string', description: 'Specific health check ID to query (optional, returns all if not specified)' },
          },
          required: ['_tool'],
        },
      },
      {
        name: 'dns-resolve',
        description: 'Resolve a DNS name using public DNS resolvers.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "dns-resolve".' },
            hostname: { type: 'string', description: "Hostname to resolve (e.g., 'example.com')" },
            record_type: { type: 'string', description: 'DNS record type to query. Allowed values: A, AAAA, CNAME, MX, TXT, NS, SOA, SRV, PTR. Default: A' },
            nameserver: { type: 'string', description: "Custom nameserver to use (optional, e.g., '8.8.8.8')" },
          },
          required: ['_tool', 'hostname'],
        },
      },
    ],
    networkMetrics: [
      {
        name: 'network-list-load-balancers',
        description: 'List all ALB/NLB load balancers in a region with ARN, DNS name, VPC, type, and state.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "network-list-load-balancers".' },
            region: { type: 'string', description: "AWS region (e.g., 'us-west-2'). Default: us-east-1" },
          },
          required: ['_tool'],
        },
      },
      {
        name: 'network-list-instances',
        description: 'List EC2 instances in a region with instance ID, type, state, VPC, subnet, private/public IP.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "network-list-instances".' },
            region: { type: 'string', description: "AWS region (e.g., 'us-west-2'). Default: us-east-1" },
            vpc_id: { type: 'string', description: 'Filter by VPC ID (optional)' },
          },
          required: ['_tool'],
        },
      },
      {
        name: 'network-get-instance-metrics',
        description: 'Get EC2 instance network metrics (NetworkIn/Out, PacketsIn/Out).',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "network-get-instance-metrics".' },
            instance_id: { type: 'string', description: "EC2 instance ID (e.g., 'i-0123456789abcdef0')" },
            region: { type: 'string', description: "AWS region (e.g., 'us-west-2'). Default: us-east-1" },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 60' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['_tool', 'instance_id'],
        },
      },
      {
        name: 'network-get-gateway-metrics',
        description: 'Get NAT Gateway, Transit Gateway, or VPN connection metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "network-get-gateway-metrics".' },
            gateway_type: { type: 'string', description: "Gateway type. Allowed values: 'natgw', 'tgw', 'vpn'" },
            gateway_id: { type: 'string', description: "Gateway resource ID (e.g., 'nat-xxx', 'tgw-xxx', 'vpn-xxx')" },
            region: { type: 'string', description: "AWS region (e.g., 'us-west-2'). Default: us-east-1" },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 60' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['_tool', 'gateway_type', 'gateway_id'],
        },
      },
      {
        name: 'network-get-elb-metrics',
        description: 'Get ALB or NLB metrics (TargetResponseTime, ActiveConnectionCount, ProcessedBytes).',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "network-get-elb-metrics".' },
            load_balancer_arn: { type: 'string', description: 'Load balancer ARN or the app/xxx/yyy or net/xxx/yyy portion' },
            lb_type: { type: 'string', description: "Load balancer type. Allowed values: 'alb', 'nlb'. Default: 'alb'" },
            region: { type: 'string', description: "AWS region (e.g., 'us-west-2'). Default: us-east-1" },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 60' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['_tool', 'load_balancer_arn'],
        },
      },
      {
        name: 'network-query-flow-logs',
        description: 'Query VPC Flow Logs using CloudWatch Logs Insights.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "network-query-flow-logs".' },
            log_group_name: { type: 'string', description: 'CloudWatch Logs group name for VPC Flow Logs' },
            query: { type: 'string', description: 'CloudWatch Logs Insights query. Default: top rejected flows' },
            region: { type: 'string', description: "AWS region (e.g., 'us-west-2'). Default: us-east-1" },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 60' },
            limit: { type: 'integer', description: 'Maximum number of results. Default: 50' },
          },
          required: ['_tool', 'log_group_name'],
        },
      },
    ],
    cloudwatchAnomaly: [
      {
        name: 'anomaly-detect-metrics',
        description: 'Detect metric anomalies using CloudWatch ANOMALY_DETECTION_BAND. Returns time windows where metric values breach the expected band. Falls back to statistical analysis if detector is not trained.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "anomaly-detect-metrics".' },
            namespace: { type: 'string', description: 'CloudWatch namespace. Allowed values: AWS/EC2, AWS/ELB, AWS/ApplicationELB, AWS/NetworkELB, AWS/NATGateway, ContainerInsights, AWS/VPN, AWS/TransitGateway' },
            metric_name: { type: 'string', description: 'CloudWatch metric name (e.g., CPUUtilization, NetworkIn, ActiveFlowCount)' },
            dimensions: { type: 'array', items: { type: 'object' }, description: 'CloudWatch dimensions as [{"Name":"key","Value":"val"}]' },
            stat: { type: 'string', description: 'Statistic. Allowed values: Average, Sum, Maximum, Minimum, SampleCount. Default: Average' },
            band_width: { type: 'number', description: 'Anomaly detection band width (standard deviations). Default: 2' },
            minutes: { type: 'integer', description: 'How many minutes back to analyze. Default: 120' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['_tool', 'namespace', 'metric_name'],
        },
      },
      {
        name: 'anomaly-get-alarms',
        description: 'Get CloudWatch anomaly detection alarm statuses. Filters alarms that use anomaly detection (ThresholdMetricId present).',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "anomaly-get-alarms".' },
            alarm_name_prefix: { type: 'string', description: 'Filter alarms by name prefix (optional)' },
            state_value: { type: 'string', description: 'Filter by alarm state. Allowed values: OK, ALARM, INSUFFICIENT_DATA. Default: all states' },
          },
          required: ['_tool'],
        },
      },
    ],
    networkAnomaly: [
      {
        name: 'anomaly-flowlog-analysis',
        description: 'Analyze VPC Flow Logs for anomalies: denied traffic spikes, port scan patterns, volume anomalies, and top talkers.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "anomaly-flowlog-analysis".' },
            log_group_name: { type: 'string', description: 'CloudWatch Logs group name for VPC Flow Logs' },
            analysis_type: { type: 'string', description: 'Analysis type. Allowed values: denied_spike, port_scan, volume_anomaly, top_talkers, all. Default: all' },
            minutes: { type: 'integer', description: 'How many minutes back to analyze. Default: 60' },
            bucket_minutes: { type: 'integer', description: 'Time bucket size in minutes for trend analysis. Default: 5' },
          },
          required: ['_tool', 'log_group_name'],
        },
      },
      {
        name: 'anomaly-interaz-traffic',
        description: 'Analyze Inter-AZ vs Intra-AZ traffic ratio from VPC Flow Logs. Calculates cross-AZ percentage and estimates data transfer cost ($0.01/GB).',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "anomaly-interaz-traffic".' },
            log_group_name: { type: 'string', description: 'CloudWatch Logs group name for VPC Flow Logs' },
            vpc_id: { type: 'string', description: 'VPC ID to analyze (optional, auto-detected from flow logs if not specified)' },
            minutes: { type: 'integer', description: 'How many minutes back to analyze. Default: 60' },
            top_n: { type: 'integer', description: 'Number of top cross-AZ pairs to return. Default: 10' },
          },
          required: ['_tool', 'log_group_name'],
        },
      },
      {
        name: 'anomaly-elb-shift',
        description: 'Detect ALB/NLB metric shifts by comparing current period against baseline. Calculates percentage change and flags metrics exceeding threshold.',
        inputSchema: {
          type: 'object',
          properties: {
            _tool: { type: 'string', description: 'Tool identifier. Must be "anomaly-elb-shift".' },
            load_balancer_arn: { type: 'string', description: 'Full ARN or the app/xxx/yyy or net/xxx/yyy portion of the load balancer' },
            lb_type: { type: 'string', description: 'Load balancer type. Allowed values: alb, nlb. Default: alb' },
            baseline_start_minutes_ago: { type: 'integer', description: 'Baseline period start (minutes ago). Default: 120' },
            baseline_end_minutes_ago: { type: 'integer', description: 'Baseline period end (minutes ago). Default: 60' },
            current_minutes: { type: 'integer', description: 'Current period length in minutes. Default: 60' },
            shift_threshold_pct: { type: 'number', description: 'Percentage change threshold to flag as shift. Default: 50' },
            period: { type: 'integer', description: 'Metric period in seconds. Default: 300' },
          },
          required: ['_tool', 'load_balancer_arn'],
        },
      },
    ],
    istioPrometheus: [
      {
        name: 'istio-query-workload-metrics',
        description: 'Query Istio RED (Rate, Error, Duration) metrics per workload.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: 'Kubernetes namespace filter (optional, default: all)' },
            workload: { type: 'string', description: 'Specific workload name filter (optional)' },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 15' },
            step: { type: 'string', description: "Query step/resolution (e.g., '1m', '5m'). Default: '1m'" },
          },
          required: [],
        },
      },
      {
        name: 'istio-query-service-topology',
        description: 'Query Istio service-to-service traffic topology showing request rates and error codes between services.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: 'Kubernetes namespace filter (optional)' },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 15' },
          },
          required: [],
        },
      },
      {
        name: 'istio-query-tcp-metrics',
        description: 'Query Istio TCP connection metrics (connections opened/closed, bytes sent/received).',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: 'Kubernetes namespace filter (optional)' },
            workload: { type: 'string', description: 'Specific workload name filter (optional)' },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 15' },
          },
          required: [],
        },
      },
      {
        name: 'istio-query-control-plane-health',
        description: 'Query Istio control plane (istiod) health metrics including xDS push latency, errors, and config conflicts.',
        inputSchema: {
          type: 'object',
          properties: {
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 30' },
          },
          required: [],
        },
      },
      {
        name: 'istio-query-proxy-resource-usage',
        description: 'Query Envoy sidecar proxy resource usage (CPU, memory) across workloads.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: 'Kubernetes namespace filter (optional)' },
            minutes: { type: 'integer', description: 'How many minutes back to query. Default: 15' },
          },
          required: [],
        },
      },
    ],
  },
} as const;
