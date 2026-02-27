import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export class K8sAgentCognitoStack extends Construct {
  public readonly agentAuth: CognitoAuth;
  public readonly runtimeAuth: CognitoAuth;
  public readonly executionRole: iam.Role;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cfg = CONFIG.k8sAgent;

    // ========== Agent User Pool (K8sAgentPool) ==========
    this.agentAuth = new CognitoAuth(this, 'AgentAuth', {
      poolName: cfg.agentPool.name,
      domainPrefix: cfg.agentPool.domainPrefix,
      resourceServerIdentifier: cfg.agentPool.resourceServerIdentifier,
      scopes: [
        { name: 'gateway:read', description: 'Read access' },
        { name: 'gateway:write', description: 'Write access' },
        { name: 'invoke', description: 'Invoke K8s agent runtime' },
      ],
      machineClientName: cfg.agentPool.machineClientName,
      webClientName: cfg.agentPool.webClientName,
      webCallbackUrl: cfg.agentPool.webCallbackUrl,
      ssmPrefix: cfg.ssmPrefix,
    });

    // ========== Runtime User Pool (EksMcpServerPool) ==========
    this.runtimeAuth = new CognitoAuth(this, 'RuntimeAuth', {
      poolName: cfg.runtimePool.name,
      domainPrefix: cfg.runtimePool.domainPrefix,
      resourceServerIdentifier: cfg.runtimePool.resourceServerIdentifier,
      scopes: [
        { name: 'invoke', description: 'Invoke EKS MCP Server' },
      ],
      machineClientName: cfg.runtimePool.machineClientName,
      ssmPrefix: cfg.ssmPrefix,
      ssmKeyPrefix: 'eks_mcp_',
    });

    // ========== IAM Execution Role ==========
    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'netaiops-m5-gateway-execution-role',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        new iam.ServicePrincipal('lambda.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECR',
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockAgentCore',
        actions: [
          'bedrock-agentcore-control:*',
          'bedrock-agentcore:*',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
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
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EKSReadOnly',
        actions: [
          'eks:DescribeCluster',
          'eks:ListClusters',
          'eks:DescribeNodegroup',
          'eks:ListNodegroups',
          'eks:DescribeFargateProfile',
          'eks:ListFargateProfiles',
          'eks:DescribeAddon',
          'eks:ListAddons',
          'eks:DescribeUpdate',
          'eks:ListUpdates',
          'eks:ListInsights',
          'eks:DescribeInsight',
          'eks:AccessKubernetesApi',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
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
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EC2VPC',
        actions: [
          'ec2:DescribeVpcs',
          'ec2:DescribeSubnets',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeRouteTables',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DescribeNetworkAcls',
          'ec2:DescribeAvailabilityZones',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'IAM',
        actions: [
          'iam:GetRole',
          'iam:PassRole',
          'iam:ListAttachedRolePolicies',
          'iam:ListRolePolicies',
          'iam:GetRolePolicy',
          'iam:GetPolicy',
          'iam:GetPolicyVersion',
          'iam:CreateServiceLinkedRole',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SSM',
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParametersByPath',
          'ssm:PutParameter',
        ],
        resources: [
          `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/a2a/app/k8s/*`,
        ],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFormation',
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:ListStacks',
          'cloudformation:DescribeStackResources',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsKMS',
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
          'kms:Decrypt',
          'kms:DescribeKey',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'XRay',
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
        ],
        resources: ['*'],
      })
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'Memory',
        actions: ['bedrock-agentcore-memory:*'],
        resources: [
          `arn:aws:bedrock-agentcore:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:memory/*`,
        ],
      })
    );

    // Store execution role ARN in SSM
    new ssm.StringParameter(this, 'ExecutionRoleParam', {
      parameterName: `${cfg.ssmPrefix}/gateway_iam_role`,
      stringValue: this.executionRole.roleArn,
    });
  }
}
