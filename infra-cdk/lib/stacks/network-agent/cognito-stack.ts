import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export class NetworkAgentCognitoStack extends Construct {
  public readonly agentAuth: CognitoAuth;
  public readonly runtimeAuth: CognitoAuth;
  public readonly executionRole: iam.Role;
  public readonly lambdaRole: iam.Role;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cfg = CONFIG.networkAgent;

    // ========== Agent User Pool (NetworkAgentPool) ==========
    this.agentAuth = new CognitoAuth(this, 'AgentAuth', {
      poolName: cfg.agentPool.name,
      domainPrefix: cfg.agentPool.domainPrefix,
      resourceServerIdentifier: cfg.agentPool.resourceServerIdentifier,
      scopes: [
        { name: 'gateway:read', description: 'Read access' },
        { name: 'gateway:write', description: 'Write access' },
      ],
      machineClientName: cfg.agentPool.machineClientName,
      webClientName: cfg.agentPool.webClientName,
      webCallbackUrl: cfg.agentPool.webCallbackUrl,
      ssmPrefix: cfg.ssmPrefix,
    });

    // ========== Runtime User Pool (NetworkMcpServerPool) ==========
    this.runtimeAuth = new CognitoAuth(this, 'RuntimeAuth', {
      poolName: cfg.runtimePool.name,
      domainPrefix: cfg.runtimePool.domainPrefix,
      resourceServerIdentifier: cfg.runtimePool.resourceServerIdentifier,
      scopes: [
        { name: 'invoke', description: 'Invoke Network MCP Server' },
      ],
      machineClientName: cfg.runtimePool.machineClientName,
      ssmPrefix: cfg.ssmPrefix,
      ssmKeyPrefix: 'network_mcp_',
    });

    // ========== Gateway Execution Role ==========
    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'network-gateway-execution-role',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        new iam.ServicePrincipal('lambda.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // ECR
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ECR',
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchCheckLayerAvailability',
      ],
      resources: ['*'],
    }));

    // BedrockAgentCore
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockAgentCore',
      actions: [
        'bedrock-agentcore-control:*',
        'bedrock-agentcore:*',
      ],
      resources: ['*'],
    }));

    // Bedrock models
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockModels',
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
        'bedrock:GetInferenceProfile',
        'bedrock:ListInferenceProfiles',
      ],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        `arn:aws:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/*`,
      ],
    }));

    // CloudWatch Logs & Metrics
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudWatchLogsMetrics',
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
        'logs:StartQuery',
        'logs:StopQuery',
        'logs:GetQueryResults',
        'logs:FilterLogEvents',
        'logs:GetLogEvents',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:GetMetricData',
        'cloudwatch:ListMetrics',
        'cloudwatch:DescribeAlarms',
      ],
      resources: ['*'],
    }));

    // EC2/VPC extended for network diagnostics
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EC2VPCNetwork',
      actions: [
        'ec2:DescribeVpcs',
        'ec2:DescribeSubnets',
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeRouteTables',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeNetworkAcls',
        'ec2:DescribeAvailabilityZones',
        'ec2:DescribeTransitGateways',
        'ec2:DescribeTransitGatewayAttachments',
        'ec2:DescribeTransitGatewayRouteTables',
        'ec2:DescribeTransitGatewayVpcAttachments',
        'ec2:SearchTransitGatewayRoutes',
        'ec2:DescribeNatGateways',
        'ec2:DescribeVpnConnections',
        'ec2:DescribeVpnGateways',
        'ec2:DescribeCustomerGateways',
        'ec2:DescribeVpcEndpoints',
        'ec2:DescribeVpcPeeringConnections',
        'ec2:DescribeFlowLogs',
        'ec2:DescribeInstances',
        'ec2:DescribeAddresses',
        'ec2:DescribePrefixLists',
        'ec2:DescribeManagedPrefixLists',
        'ec2:GetManagedPrefixListEntries',
      ],
      resources: ['*'],
    }));

    // Network Firewall
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'NetworkFirewall',
      actions: [
        'network-firewall:DescribeFirewall',
        'network-firewall:DescribeFirewallPolicy',
        'network-firewall:DescribeRuleGroup',
        'network-firewall:ListFirewalls',
        'network-firewall:ListFirewallPolicies',
        'network-firewall:ListRuleGroups',
      ],
      resources: ['*'],
    }));

    // Network Manager (Cloud WAN)
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'NetworkManager',
      actions: [
        'networkmanager:DescribeGlobalNetworks',
        'networkmanager:GetCoreNetwork',
        'networkmanager:ListCoreNetworks',
        'networkmanager:GetConnectAttachment',
        'networkmanager:ListAttachments',
      ],
      resources: ['*'],
    }));

    // IAM
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'IAM',
      actions: [
        'iam:GetRole',
        'iam:PassRole',
        'iam:ListAttachedRolePolicies',
        'iam:ListRolePolicies',
        'iam:GetRolePolicy',
        'iam:CreateServiceLinkedRole',
      ],
      resources: ['*'],
    }));

    // SSM
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSM',
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
        'ssm:PutParameter',
      ],
      resources: [
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/app/network/*`,
      ],
    }));

    // Lambda invoke
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'LambdaInvoke',
      actions: [
        'lambda:InvokeFunction',
        'lambda:GetFunction',
        'lambda:ListFunctions',
      ],
      resources: [
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:network-*`,
      ],
    }));

    // Secrets Manager + KMS
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SecretsKMS',
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
        'kms:Decrypt',
        'kms:DescribeKey',
      ],
      resources: ['*'],
    }));

    // X-Ray
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'XRay',
      actions: [
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets',
      ],
      resources: ['*'],
    }));

    // Memory
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'Memory',
      actions: ['bedrock-agentcore-memory:*'],
      resources: [
        `arn:aws:bedrock-agentcore:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:memory/*`,
      ],
    }));

    // Store execution role ARN in SSM
    new ssm.StringParameter(this, 'ExecutionRoleParam', {
      parameterName: `${cfg.ssmPrefix}/gateway_iam_role`,
      stringValue: this.executionRole.roleArn,
    });

    // ========== Lambda Execution Role ==========
    this.lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'network-tools-lambda-role',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Route 53 read for DNS Lambda
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'Route53Read',
      actions: [
        'route53:ListHostedZones',
        'route53:GetHostedZone',
        'route53:ListResourceRecordSets',
        'route53:ListHealthChecks',
        'route53:GetHealthCheck',
        'route53:GetHealthCheckStatus',
      ],
      resources: ['*'],
    }));

    // CloudWatch read for Network Metrics Lambda
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudWatchRead',
      actions: [
        'cloudwatch:GetMetricData',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:ListMetrics',
      ],
      resources: ['*'],
    }));

    // CloudWatch Logs read for Flow Logs Insights
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudWatchLogsRead',
      actions: [
        'logs:StartQuery',
        'logs:StopQuery',
        'logs:GetQueryResults',
        'logs:DescribeLogGroups',
      ],
      resources: ['*'],
    }));

    // EC2 describe for context
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EC2Describe',
      actions: [
        'ec2:DescribeInstances',
        'ec2:DescribeNatGateways',
        'ec2:DescribeTransitGateways',
        'ec2:DescribeVpnConnections',
      ],
      resources: ['*'],
    }));

    // ELB describe for load balancer discovery
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ELBDescribe',
      actions: [
        'elasticloadbalancing:DescribeLoadBalancers',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:DescribeTargetHealth',
        'elasticloadbalancing:DescribeListeners',
      ],
      resources: ['*'],
    }));

    // SSM parameter access
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSMParameterAccess',
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [`arn:aws:ssm:*:*:parameter/app/network/*`],
    }));
  }
}
