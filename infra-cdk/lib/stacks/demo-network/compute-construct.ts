import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ComputeConstructProps {
  prodVpc: ec2.Vpc;
  stagingVpc: ec2.Vpc;
  sharedVpc: ec2.Vpc;
  prodWebSg: ec2.SecurityGroup;
  prodAppSg: ec2.SecurityGroup;
  prodApiSg: ec2.SecurityGroup;
  prodCacheSg: ec2.SecurityGroup;
  prodAlbSg: ec2.SecurityGroup;
  prodNlbSg: ec2.SecurityGroup;
  stagingWebSg: ec2.SecurityGroup;
  stagingAppSg: ec2.SecurityGroup;
  stagingAlbSg: ec2.SecurityGroup;
  sharedMonitoringSg: ec2.SecurityGroup;
  sharedCiRunnerSg: ec2.SecurityGroup;
}

type Env = 'prod' | 'staging' | 'shared';
type Tier = 'web' | 'app' | 'api' | 'cache' | 'worker' | 'monitoring' | 'tools' | 'log-collector' | 'ci-runner';

interface InstanceSpec {
  id: string;
  name: string;
  env: Env;
  tier: Tier;
  az: number; // 0 or 1
}

// --- 36 Instance Definitions ---
const INSTANCE_SPECS: InstanceSpec[] = [
  // Production — Web (4)
  { id: 'ProdWeb01', name: 'netaiops-prod-web-01', env: 'prod', tier: 'web', az: 0 },
  { id: 'ProdWeb02', name: 'netaiops-prod-web-02', env: 'prod', tier: 'web', az: 1 },
  { id: 'ProdWeb03', name: 'netaiops-prod-web-03', env: 'prod', tier: 'web', az: 0 },
  { id: 'ProdWeb04', name: 'netaiops-prod-web-04', env: 'prod', tier: 'web', az: 1 },
  // Production — App (6)
  { id: 'ProdApp01', name: 'netaiops-prod-app-01', env: 'prod', tier: 'app', az: 0 },
  { id: 'ProdApp02', name: 'netaiops-prod-app-02', env: 'prod', tier: 'app', az: 1 },
  { id: 'ProdApp03', name: 'netaiops-prod-app-03', env: 'prod', tier: 'app', az: 0 },
  { id: 'ProdApp04', name: 'netaiops-prod-app-04', env: 'prod', tier: 'app', az: 1 },
  { id: 'ProdApp05', name: 'netaiops-prod-app-05', env: 'prod', tier: 'app', az: 0 },
  { id: 'ProdApp06', name: 'netaiops-prod-app-06', env: 'prod', tier: 'app', az: 1 },
  // Production — API (4)
  { id: 'ProdApi01', name: 'netaiops-prod-api-01', env: 'prod', tier: 'api', az: 0 },
  { id: 'ProdApi02', name: 'netaiops-prod-api-02', env: 'prod', tier: 'api', az: 1 },
  { id: 'ProdApi03', name: 'netaiops-prod-api-03', env: 'prod', tier: 'api', az: 0 },
  { id: 'ProdApi04', name: 'netaiops-prod-api-04', env: 'prod', tier: 'api', az: 1 },
  // Production — Cache (2)
  { id: 'ProdCache01', name: 'netaiops-prod-cache-01', env: 'prod', tier: 'cache', az: 0 },
  { id: 'ProdCache02', name: 'netaiops-prod-cache-02', env: 'prod', tier: 'cache', az: 1 },
  // Staging — Web (3)
  { id: 'StagingWeb01', name: 'netaiops-staging-web-01', env: 'staging', tier: 'web', az: 0 },
  { id: 'StagingWeb02', name: 'netaiops-staging-web-02', env: 'staging', tier: 'web', az: 1 },
  { id: 'StagingWeb03', name: 'netaiops-staging-web-03', env: 'staging', tier: 'web', az: 0 },
  // Staging — App (3)
  { id: 'StagingApp01', name: 'netaiops-staging-app-01', env: 'staging', tier: 'app', az: 0 },
  { id: 'StagingApp02', name: 'netaiops-staging-app-02', env: 'staging', tier: 'app', az: 1 },
  { id: 'StagingApp03', name: 'netaiops-staging-app-03', env: 'staging', tier: 'app', az: 0 },
  // Staging — API (2)
  { id: 'StagingApi01', name: 'netaiops-staging-api-01', env: 'staging', tier: 'api', az: 0 },
  { id: 'StagingApi02', name: 'netaiops-staging-api-02', env: 'staging', tier: 'api', az: 1 },
  // Staging — Worker (2)
  { id: 'StagingWorker01', name: 'netaiops-staging-worker-01', env: 'staging', tier: 'worker', az: 0 },
  { id: 'StagingWorker02', name: 'netaiops-staging-worker-02', env: 'staging', tier: 'worker', az: 1 },
  // Shared — Monitoring (2)
  { id: 'SharedMonitoring01', name: 'netaiops-shared-monitoring-01', env: 'shared', tier: 'monitoring', az: 0 },
  { id: 'SharedMonitoring02', name: 'netaiops-shared-monitoring-02', env: 'shared', tier: 'monitoring', az: 1 },
  // Shared — Tools (2)
  { id: 'SharedTools01', name: 'netaiops-shared-tools-01', env: 'shared', tier: 'tools', az: 0 },
  { id: 'SharedTools02', name: 'netaiops-shared-tools-02', env: 'shared', tier: 'tools', az: 1 },
  // Shared — Log Collector (2)
  { id: 'SharedLogCollector01', name: 'netaiops-shared-log-collector-01', env: 'shared', tier: 'log-collector', az: 0 },
  { id: 'SharedLogCollector02', name: 'netaiops-shared-log-collector-02', env: 'shared', tier: 'log-collector', az: 1 },
  // Shared — CI Runner (4)
  { id: 'SharedCiRunner01', name: 'netaiops-shared-ci-runner-01', env: 'shared', tier: 'ci-runner', az: 0 },
  { id: 'SharedCiRunner02', name: 'netaiops-shared-ci-runner-02', env: 'shared', tier: 'ci-runner', az: 1 },
  { id: 'SharedCiRunner03', name: 'netaiops-shared-ci-runner-03', env: 'shared', tier: 'ci-runner', az: 0 },
  { id: 'SharedCiRunner04', name: 'netaiops-shared-ci-runner-04', env: 'shared', tier: 'ci-runner', az: 1 },
];

export class ComputeConstruct extends Construct {
  public readonly prodAlb: elbv2.ApplicationLoadBalancer;
  public readonly prodNlb: elbv2.NetworkLoadBalancer;
  public readonly stagingAlb: elbv2.ApplicationLoadBalancer;
  public readonly instances: ec2.Instance[];

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    this.instances = [];

    // SSM-managed IAM role for all instances
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      roleName: 'netaiops-demo-ec2-role',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const al2023 = ec2.MachineImage.latestAmazonLinux2023();

    // --- UserData scripts ---
    const userDataMap = this.buildUserDataMap();

    // VPC/SG resolution maps
    const vpcMap: Record<Env, ec2.Vpc> = {
      prod: props.prodVpc,
      staging: props.stagingVpc,
      shared: props.sharedVpc,
    };

    const sgMap: Record<string, ec2.SecurityGroup> = {
      'prod:web': props.prodWebSg,
      'prod:app': props.prodAppSg,
      'prod:api': props.prodApiSg,
      'prod:cache': props.prodCacheSg,
      'staging:web': props.stagingWebSg,
      'staging:app': props.stagingAppSg,
      'staging:api': props.stagingAppSg,      // reuse staging app SG
      'staging:worker': props.stagingAppSg,    // reuse staging app SG
      'shared:monitoring': props.sharedMonitoringSg,
      'shared:tools': props.sharedMonitoringSg,
      'shared:log-collector': props.sharedMonitoringSg,
      'shared:ci-runner': props.sharedCiRunnerSg,
    };

    // Track instances by role for LB target groups
    const instancesByKey: Record<string, ec2.Instance[]> = {};

    // Create all 36 instances
    for (const spec of INSTANCE_SPECS) {
      const vpc = vpcMap[spec.env];
      const sg = sgMap[`${spec.env}:${spec.tier}`];
      const userData = userDataMap[spec.tier];
      const isIsolated = spec.env === 'staging';

      const subnets = isIsolated ? vpc.isolatedSubnets : vpc.privateSubnets;

      const instance = new ec2.Instance(this, spec.id, {
        vpc,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        machineImage: al2023,
        securityGroup: sg,
        role: instanceRole,
        userData,
        vpcSubnets: { subnets: [subnets[spec.az]] },
      });

      cdk.Tags.of(instance).add('Name', spec.name);
      cdk.Tags.of(instance).add('Environment', spec.env === 'prod' ? 'production' : spec.env);
      cdk.Tags.of(instance).add('Tier', spec.tier);

      this.instances.push(instance);

      const key = `${spec.env}:${spec.tier}`;
      if (!instancesByKey[key]) instancesByKey[key] = [];
      instancesByKey[key].push(instance);
    }

    // --- Load Balancers ---

    // Production ALB (internet-facing) → web tier
    this.prodAlb = new elbv2.ApplicationLoadBalancer(this, 'ProdAlb', {
      vpc: props.prodVpc,
      loadBalancerName: 'netaiops-prod-alb',
      internetFacing: true,
      securityGroup: props.prodAlbSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const prodWebTg = new elbv2.ApplicationTargetGroup(this, 'ProdWebTg', {
      vpc: props.prodVpc,
      targetGroupName: 'netaiops-prod-web-tg',
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: instancesByKey['prod:web'].map(i => new elbv2targets.InstanceTarget(i, 80)),
      healthCheck: { path: '/', healthyHttpCodes: '200' },
    });

    this.prodAlb.addListener('ProdHttpListener', {
      port: 80,
      defaultTargetGroups: [prodWebTg],
    });

    // Production NLB (internal) → app tier
    this.prodNlb = new elbv2.NetworkLoadBalancer(this, 'ProdNlb', {
      vpc: props.prodVpc,
      loadBalancerName: 'netaiops-prod-nlb',
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const prodAppTg = new elbv2.NetworkTargetGroup(this, 'ProdAppTg', {
      vpc: props.prodVpc,
      targetGroupName: 'netaiops-prod-app-tg',
      port: 8080,
      protocol: elbv2.Protocol.TCP,
      targets: instancesByKey['prod:app'].map(i => new elbv2targets.InstanceTarget(i, 8080)),
    });

    this.prodNlb.addListener('ProdNlbListener', {
      port: 8080,
      defaultTargetGroups: [prodAppTg],
    });

    // Staging ALB (internal) → staging web tier
    this.stagingAlb = new elbv2.ApplicationLoadBalancer(this, 'StagingAlb', {
      vpc: props.stagingVpc,
      loadBalancerName: 'netaiops-staging-alb',
      internetFacing: false,
      securityGroup: props.stagingAlbSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    const stagingWebTg = new elbv2.ApplicationTargetGroup(this, 'StagingWebTg', {
      vpc: props.stagingVpc,
      targetGroupName: 'netaiops-staging-web-tg',
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: instancesByKey['staging:web'].map(i => new elbv2targets.InstanceTarget(i, 80)),
      healthCheck: { path: '/', healthyHttpCodes: '200' },
    });

    this.stagingAlb.addListener('StagingHttpListener', {
      port: 80,
      defaultTargetGroups: [stagingWebTg],
    });
  }

  private buildUserDataMap(): Record<Tier, ec2.UserData> {
    // Web server: HTTP on :80
    const web = ec2.UserData.forLinux();
    web.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/server.py << \'PYEOF\'',
      'import http.server, socket, datetime',
      'class Handler(http.server.BaseHTTPRequestHandler):',
      '    def do_GET(self):',
      '        self.send_response(200)',
      '        self.send_header("Content-Type", "text/html")',
      '        self.end_headers()',
      '        body = f"<h1>{socket.gethostname()}</h1><p>{datetime.datetime.now()}</p><p>Path: {self.path}</p>"',
      '        self.wfile.write(body.encode())',
      '    def log_message(self, format, *args): pass',
      'http.server.HTTPServer(("0.0.0.0", 80), Handler).serve_forever()',
      'PYEOF',
      'nohup python3 /home/ec2-user/server.py &',
    );

    // App server: JSON echo on :8080
    const app = ec2.UserData.forLinux();
    app.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/server.py << \'PYEOF\'',
      'import http.server, json, socket, datetime',
      'class Handler(http.server.BaseHTTPRequestHandler):',
      '    def do_GET(self):',
      '        self.send_response(200)',
      '        self.send_header("Content-Type", "application/json")',
      '        self.end_headers()',
      '        body = json.dumps({"host": socket.gethostname(), "path": self.path, "time": str(datetime.datetime.now())})',
      '        self.wfile.write(body.encode())',
      '    def log_message(self, format, *args): pass',
      'http.server.HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()',
      'PYEOF',
      'nohup python3 /home/ec2-user/server.py &',
    );

    // API server: JSON echo on :8443
    const api = ec2.UserData.forLinux();
    api.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/server.py << \'PYEOF\'',
      'import http.server, json, socket, datetime',
      'class Handler(http.server.BaseHTTPRequestHandler):',
      '    def do_GET(self):',
      '        self.send_response(200)',
      '        self.send_header("Content-Type", "application/json")',
      '        self.end_headers()',
      '        body = json.dumps({"service": "api", "host": socket.gethostname(), "path": self.path, "time": str(datetime.datetime.now())})',
      '        self.wfile.write(body.encode())',
      '    def log_message(self, format, *args): pass',
      'http.server.HTTPServer(("0.0.0.0", 8443), Handler).serve_forever()',
      'PYEOF',
      'nohup python3 /home/ec2-user/server.py &',
    );

    // Cache: simulated Redis-like echo on :6379
    const cache = ec2.UserData.forLinux();
    cache.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/server.py << \'PYEOF\'',
      'import http.server, json, socket, datetime',
      'class Handler(http.server.BaseHTTPRequestHandler):',
      '    def do_GET(self):',
      '        self.send_response(200)',
      '        self.send_header("Content-Type", "application/json")',
      '        self.end_headers()',
      '        body = json.dumps({"service": "cache", "host": socket.gethostname(), "time": str(datetime.datetime.now())})',
      '        self.wfile.write(body.encode())',
      '    def log_message(self, format, *args): pass',
      'http.server.HTTPServer(("0.0.0.0", 6379), Handler).serve_forever()',
      'PYEOF',
      'nohup python3 /home/ec2-user/server.py &',
    );

    // Worker: background job processor (no listener, generates outbound traffic)
    const worker = ec2.UserData.forLinux();
    worker.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/worker.sh << \'SHEOF\'',
      '#!/bin/bash',
      'while true; do',
      '  curl -sf http://10.2.1.10:8080/health > /dev/null 2>&1',
      '  curl -sf http://10.1.1.10:8080/health > /dev/null 2>&1',
      '  sleep 30',
      'done',
      'SHEOF',
      'chmod +x /home/ec2-user/worker.sh',
      'nohup /home/ec2-user/worker.sh &',
    );

    // Monitoring: Prometheus-like on :9090 + cross-VPC pinger
    const monitoring = ec2.UserData.forLinux();
    monitoring.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/server.py << \'PYEOF\'',
      'import http.server, json, socket, datetime',
      'class Handler(http.server.BaseHTTPRequestHandler):',
      '    def do_GET(self):',
      '        self.send_response(200)',
      '        self.send_header("Content-Type", "application/json")',
      '        self.end_headers()',
      '        body = json.dumps({"service": "monitoring", "host": socket.gethostname(), "time": str(datetime.datetime.now())})',
      '        self.wfile.write(body.encode())',
      '    def log_message(self, format, *args): pass',
      'http.server.HTTPServer(("0.0.0.0", 9090), Handler).serve_forever()',
      'PYEOF',
      'nohup python3 /home/ec2-user/server.py &',
      'cat > /home/ec2-user/pinger.sh << \'SHEOF\'',
      '#!/bin/bash',
      'while true; do',
      '  for ip in 10.1.1.10 10.1.2.10 10.2.1.10 10.0.1.10; do',
      '    ping -c 1 -W 1 $ip > /dev/null 2>&1',
      '  done',
      '  sleep 30',
      'done',
      'SHEOF',
      'chmod +x /home/ec2-user/pinger.sh',
      'nohup /home/ec2-user/pinger.sh &',
    );

    // Tools: echo on :9090
    const tools = ec2.UserData.forLinux();
    tools.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/server.py << \'PYEOF\'',
      'import http.server, json, socket, datetime',
      'class Handler(http.server.BaseHTTPRequestHandler):',
      '    def do_GET(self):',
      '        self.send_response(200)',
      '        self.send_header("Content-Type", "application/json")',
      '        self.end_headers()',
      '        body = json.dumps({"service": "tools", "host": socket.gethostname(), "time": str(datetime.datetime.now())})',
      '        self.wfile.write(body.encode())',
      '    def log_message(self, format, *args): pass',
      'http.server.HTTPServer(("0.0.0.0", 9090), Handler).serve_forever()',
      'PYEOF',
      'nohup python3 /home/ec2-user/server.py &',
    );

    // Log collector: Logstash-like on :5044
    const logCollector = ec2.UserData.forLinux();
    logCollector.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/server.py << \'PYEOF\'',
      'import http.server, json, socket, datetime',
      'class Handler(http.server.BaseHTTPRequestHandler):',
      '    def do_GET(self):',
      '        self.send_response(200)',
      '        self.send_header("Content-Type", "application/json")',
      '        self.end_headers()',
      '        body = json.dumps({"service": "log-collector", "host": socket.gethostname(), "time": str(datetime.datetime.now())})',
      '        self.wfile.write(body.encode())',
      '    def log_message(self, format, *args): pass',
      'http.server.HTTPServer(("0.0.0.0", 5044), Handler).serve_forever()',
      'PYEOF',
      'nohup python3 /home/ec2-user/server.py &',
    );

    // CI Runner: pulls code, builds (outbound traffic generator)
    const ciRunner = ec2.UserData.forLinux();
    ciRunner.addCommands(
      'yum install -y python3',
      'cat > /home/ec2-user/runner.sh << \'SHEOF\'',
      '#!/bin/bash',
      'while true; do',
      '  curl -sf https://api.github.com > /dev/null 2>&1',
      '  curl -sf http://10.0.1.10:9090/health > /dev/null 2>&1',
      '  curl -sf http://10.1.1.10:8080/health > /dev/null 2>&1',
      '  sleep 60',
      'done',
      'SHEOF',
      'chmod +x /home/ec2-user/runner.sh',
      'nohup /home/ec2-user/runner.sh &',
    );

    return {
      web, app, api, cache, worker, monitoring, tools,
      'log-collector': logCollector,
      'ci-runner': ciRunner,
    };
  }
}
