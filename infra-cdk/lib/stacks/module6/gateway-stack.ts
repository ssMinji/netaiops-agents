import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { McpGateway, LambdaTargetConfig } from '../../constructs/mcp-gateway';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { Module6LambdaStack } from './lambda-stack';
import { CONFIG } from '../../config';

export interface Module6GatewayStackProps {
  auth: CognitoAuth;
  executionRoleArn: string;
  lambdas: Module6LambdaStack;
}

/**
 * Module 6 Gateway - Lambda targets for Datadog, OpenSearch, ContainerInsight tools.
 *
 * Each Lambda target includes inline tool schemas so the Gateway can route
 * tool calls to the correct Lambda function.
 */
export class Module6GatewayStack extends Construct {
  public readonly gateway: McpGateway;

  constructor(scope: Construct, id: string, props: Module6GatewayStackProps) {
    super(scope, id);

    const cfg = CONFIG.module6;
    const schemas = CONFIG.toolSchemas;

    // Build Lambda targets (3 MCP tool targets - alarm-trigger, chaos, github are not gateway targets)
    const lambdaTargets: LambdaTargetConfig[] = [
      {
        name: 'DatadogTools',
        description: 'Datadog metrics, events, traces, and monitor tools',
        lambdaArn: props.lambdas.datadogLambda.fn.functionArn,
        toolSchemas: schemas.datadog as any,
      },
      {
        name: 'OpenSearchTools',
        description: 'OpenSearch log search, anomaly detection, and error summary tools',
        lambdaArn: props.lambdas.opensearchLambda.fn.functionArn,
        toolSchemas: schemas.opensearch as any,
      },
      {
        name: 'ContainerInsightTools',
        description: 'EKS Container Insights pod, node, and cluster metrics tools',
        lambdaArn: props.lambdas.containerInsightLambda.fn.functionArn,
        toolSchemas: schemas.containerInsight as any,
      },
    ];

    this.gateway = new McpGateway(this, 'Gateway', {
      gatewayName: cfg.gateway.name,
      description: cfg.gateway.description,
      executionRoleArn: props.executionRoleArn,
      allowedClientId: props.auth.machineClient.userPoolClientId,
      discoveryUrl: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${props.auth.userPool.userPoolId}/.well-known/openid-configuration`,
      lambdaTargets,
      ssmPrefix: cfg.ssmPrefix,
    });
  }
}
