import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export class AnomalyAgentCognitoStack extends Construct {
  public readonly auth: CognitoAuth;
  public readonly executionRole: iam.Role;
  public readonly lambdaRole: iam.Role;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cfg = CONFIG.anomalyAgent;

    // ========== Cognito User Pool (AnomalyDetectionPool) ==========
    this.auth = new CognitoAuth(this, 'Auth', {
      poolName: cfg.cognitoPool.name,
      domainPrefix: cfg.cognitoPool.domainPrefix,
      resourceServerIdentifier: cfg.cognitoPool.resourceServerIdentifier,
      scopes: [
        { name: 'invoke', description: 'Invoke Anomaly Detection agent runtime' },
      ],
      machineClientName: cfg.cognitoPool.machineClientName,
      webClientName: cfg.cognitoPool.webClientName,
      webCallbackUrl: cfg.cognitoPool.webCallbackUrl,
      ssmPrefix: cfg.ssmPrefix,
    });

    // ========== Gateway Execution Role ==========
    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'anomaly-gateway-execution-role',
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
        'bedrock-agentcore-control:CreateOAuth2CredentialProvider',
        'bedrock-agentcore-control:DeleteOAuth2CredentialProvider',
        'bedrock-agentcore-control:GetOAuth2CredentialProvider',
        'bedrock-agentcore-control:ListOAuth2CredentialProviders',
        'bedrock-agentcore-control:UpdateOAuth2CredentialProvider',
        'bedrock-agentcore-control:CreateGateway',
        'bedrock-agentcore-control:DeleteGateway',
        'bedrock-agentcore-control:GetGateway',
        'bedrock-agentcore-control:ListGateways',
        'bedrock-agentcore-control:UpdateGateway',
        'bedrock-agentcore-control:CreateRuntime',
        'bedrock-agentcore-control:DeleteRuntime',
        'bedrock-agentcore-control:GetRuntime',
        'bedrock-agentcore-control:ListRuntimes',
        'bedrock-agentcore-control:UpdateRuntime',
        'bedrock-agentcore:InvokeRuntime',
        'bedrock-agentcore:GetResourceOauth2Token',
        'bedrock-agentcore:CreateMemory',
        'bedrock-agentcore:DeleteMemory',
        'bedrock-agentcore:GetMemory',
        'bedrock-agentcore:ListMemories',
        'bedrock-agentcore:UpdateMemory',
      ],
      resources: ['*'],
    }));

    // Lambda invoke
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'lambda:InvokeFunction',
        'lambda:GetFunction',
        'lambda:ListFunctions',
      ],
      resources: [
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:anomaly-*`,
      ],
    }));

    // CloudWatch (read + anomaly detection)
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudwatch:GetMetricData',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:ListMetrics',
        'cloudwatch:DescribeAlarms',
        'cloudwatch:DescribeAnomalyDetectors',
        'logs:GetLogEvents',
        'logs:FilterLogEvents',
        'logs:GetLogGroupFields',
        'logs:GetQueryResults',
        'logs:StartQuery',
        'logs:StopQuery',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['*'],
    }));

    // SSM
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
        'ssm:PutParameter',
      ],
      resources: [
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/app/anomaly/*`,
      ],
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
      resources: [
        `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/anomaly-gateway-execution-role`,
        `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/aws-service-role/*`,
      ],
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

    // Store execution role ARN in SSM
    new ssm.StringParameter(this, 'ExecutionRoleParam', {
      parameterName: `${cfg.ssmPrefix}/gateway_iam_role`,
      stringValue: this.executionRole.roleArn,
    });

    // ========== Lambda Execution Role (shared across anomaly Lambdas) ==========
    this.lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'anomaly-tools-lambda-role',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // CloudWatch + Anomaly Detection
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudWatchAndAnomalyDetection',
      actions: [
        'cloudwatch:GetMetricData',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:ListMetrics',
        'cloudwatch:DescribeAlarms',
        'cloudwatch:DescribeAnomalyDetectors',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
        'logs:GetLogEvents',
        'logs:FilterLogEvents',
        'logs:StartQuery',
        'logs:StopQuery',
        'logs:GetQueryResults',
        'logs:DescribeQueries',
      ],
      resources: ['*'],
    }));

    // EC2 (VPC, Subnet, AZ, Flow Logs)
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EC2NetworkRead',
      actions: [
        'ec2:DescribeInstances',
        'ec2:DescribeVpcs',
        'ec2:DescribeSubnets',
        'ec2:DescribeAvailabilityZones',
        'ec2:DescribeFlowLogs',
      ],
      resources: ['*'],
    }));

    // ELB
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ELBRead',
      actions: [
        'elasticloadbalancing:DescribeLoadBalancers',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:DescribeTargetHealth',
      ],
      resources: ['*'],
    }));

    // SSM
    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSMParameterAccess',
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: ['arn:aws:ssm:*:*:parameter/app/anomaly/*'],
    }));
  }
}
