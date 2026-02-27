import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export class IncidentAgentCognitoStack extends Construct {
  public readonly auth: CognitoAuth;
  public readonly executionRole: iam.Role;
  public readonly lambdaRole: iam.Role;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cfg = CONFIG.incidentAgent;

    // ========== Cognito User Pool (IncidentAnalysisPool) ==========
    this.auth = new CognitoAuth(this, 'Auth', {
      poolName: cfg.cognitoPool.name,
      domainPrefix: cfg.cognitoPool.domainPrefix,
      resourceServerIdentifier: cfg.cognitoPool.resourceServerIdentifier,
      scopes: [
        { name: 'invoke', description: 'Invoke Incident Analysis agent runtime' },
      ],
      machineClientName: cfg.cognitoPool.machineClientName,
      webClientName: cfg.cognitoPool.webClientName,
      webCallbackUrl: cfg.cognitoPool.webCallbackUrl,
      ssmPrefix: cfg.ssmPrefix,
    });

    // ========== Gateway Execution Role ==========
    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'incident-gateway-execution-role',
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
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:incident-*`,
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:netops-*`,
      ],
    }));

    // CloudWatch
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudwatch:GetMetricData',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:ListMetrics',
        'cloudwatch:DescribeAlarms',
        'cloudwatch:GetDashboard',
        'cloudwatch:ListDashboards',
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

    // OpenSearch
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpDelete',
        'es:ESHttpHead',
        'es:DescribeElasticsearchDomains',
        'es:ListDomainNames',
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
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/app/incident/*`,
        `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/app/netops/*`,
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
        `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/incident-gateway-execution-role`,
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

    // Memory
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock-agentcore-memory:CreateMemory',
        'bedrock-agentcore-memory:DeleteMemory',
        'bedrock-agentcore-memory:GetMemory',
        'bedrock-agentcore-memory:ListMemories',
        'bedrock-agentcore-memory:UpdateMemory',
        'bedrock-agentcore-memory:PutMemoryData',
        'bedrock-agentcore-memory:GetMemoryData',
        'bedrock-agentcore-memory:DeleteMemoryData',
        'bedrock-agentcore:CreateEvent',
        'bedrock-agentcore:GetEvent',
        'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:DeleteEvent',
      ],
      resources: [
        `arn:aws:bedrock-agentcore:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:memory/IncidentAnalysisAgentMemory*`,
        `arn:aws:bedrock-agentcore:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:memory/IncidentAnalysisAgentMemory*/*`,
      ],
    }));

    // Secrets Manager + KMS
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
        'secretsmanager:ListSecrets',
        'kms:Decrypt',
        'kms:DescribeKey',
        'kms:GenerateDataKey',
      ],
      resources: [
        `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:*`,
        `arn:aws:kms:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:key/*`,
      ],
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

    // ========== Lambda Execution Role (shared across all 6 Lambdas) ==========
    this.lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'incident-tools-lambda-role',
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudWatchReadForContainerInsight',
      actions: [
        'cloudwatch:DescribeAlarms',
        'cloudwatch:DescribeAlarmsForMetric',
        'cloudwatch:GetMetricData',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:ListMetrics',
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

    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'OpenSearchAccess',
      actions: [
        'es:ESHttpGet',
        'es:ESHttpHead',
        'es:ESHttpPost',
        'es:ESHttpPut',
        'es:ESHttpDelete',
        'es:ESHttpPatch',
      ],
      resources: ['*'],
    }));

    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SSMParameterAccess',
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: ['arn:aws:ssm:*:*:parameter/app/incident/*'],
    }));

    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'EKSAccessForChaosLambda',
      actions: ['eks:DescribeCluster', 'eks:ListClusters'],
      resources: ['*'],
    }));

    this.lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'STSForEKSAuth',
      actions: ['sts:GetCallerIdentity'],
      resources: ['*'],
    }));
  }
}
