import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export class IstioAgentCognitoStack extends Construct {
  public readonly auth: CognitoAuth;
  public readonly executionRole: iam.Role;
  public readonly lambdaRole: iam.Role;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cfg = CONFIG.istioAgent;

    // ========== Cognito User Pool (IstioMeshPool) ==========
    this.auth = new CognitoAuth(this, 'Auth', {
      poolName: cfg.cognitoPool.name,
      domainPrefix: cfg.cognitoPool.domainPrefix,
      resourceServerIdentifier: cfg.cognitoPool.resourceServerIdentifier,
      scopes: [
        { name: 'gateway:read', description: 'Read access' },
        { name: 'gateway:write', description: 'Write access' },
      ],
      machineClientName: cfg.cognitoPool.machineClientName,
      webClientName: cfg.cognitoPool.webClientName,
      webCallbackUrl: cfg.cognitoPool.webCallbackUrl,
      ssmPrefix: cfg.ssmPrefix,
    });

    // ========== Gateway Execution Role ==========
    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'istio-gateway-execution-role',
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
      actions: [
        'bedrock-agentcore-control:*',
        'bedrock-agentcore:*',
      ],
      resources: ['*'],
    }));

    // Bedrock models
    this.executionRole.addToPolicy(new iam.PolicyStatement({
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

    // EKS read-only
    this.executionRole.addToPolicy(new iam.PolicyStatement({
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
    }));

    // AMP (Amazon Managed Prometheus)
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'aps:QueryMetrics',
        'aps:GetMetricMetadata',
        'aps:GetLabels',
        'aps:GetSeries',
        'aps:ListWorkspaces',
        'aps:DescribeWorkspace',
      ],
      resources: ['*'],
    }));

    // CloudWatch Logs & Metrics
    this.executionRole.addToPolicy(new iam.PolicyStatement({
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

    // EC2/VPC
    this.executionRole.addToPolicy(new iam.PolicyStatement({
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
    }));

    // IAM
    this.executionRole.addToPolicy(new iam.PolicyStatement({
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

    // SSM — Istio + K8s prefixes (K8s needed for cross-stack EKS MCP Server lookup)
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
        'ssm:PutParameter',
      ],
      resources: [
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/app/istio/*`,
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/a2a/app/k8s/*`,
      ],
    }));

    // Lambda invoke
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'lambda:InvokeFunction',
        'lambda:GetFunction',
        'lambda:ListFunctions',
      ],
      resources: [
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:istio-*`,
      ],
    }));

    // Secrets Manager + KMS
    this.executionRole.addToPolicy(new iam.PolicyStatement({
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
      roleName: 'istio-tools-lambda-role',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // AMP query for Prometheus Lambda
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AMPQueryForPrometheus',
      actions: [
        'aps:QueryMetrics',
        'aps:GetMetricMetadata',
        'aps:GetLabels',
        'aps:GetSeries',
        'aps:ListWorkspaces',
        'aps:DescribeWorkspace',
      ],
      resources: ['*'],
    }));

    // SSM parameter access
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSMParameterAccess',
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [`arn:aws:ssm:*:*:parameter/app/istio/*`],
    }));

    // EKS access for fault injection Lambda
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EKSAccessForFaultLambda',
      actions: ['eks:DescribeCluster', 'eks:ListClusters'],
      resources: ['*'],
    }));

    // STS for EKS auth
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'STSForEKSAuth',
      actions: ['sts:GetCallerIdentity'],
      resources: ['*'],
    }));
  }
}
