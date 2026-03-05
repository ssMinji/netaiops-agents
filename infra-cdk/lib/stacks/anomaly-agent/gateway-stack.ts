import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { McpGateway } from '../../constructs/mcp-gateway';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export interface AnomalyAgentGatewayStackProps {
  auth: CognitoAuth;
  executionRoleArn: string;
}

/**
 * Anomaly Agent Gateway - MCP Gateway only.
 * Lambda targets are added post-deploy via boto3 create_gateway_target API
 * (CloudFormation GatewayTarget schema does not support Lambda targets).
 */
export class AnomalyAgentGatewayStack extends Construct {
  public readonly gateway: McpGateway;

  constructor(scope: Construct, id: string, props: AnomalyAgentGatewayStackProps) {
    super(scope, id);

    const cfg = CONFIG.anomalyAgent;

    this.gateway = new McpGateway(this, 'Gateway', {
      gatewayName: cfg.gateway.name,
      description: cfg.gateway.description,
      executionRoleArn: props.executionRoleArn,
      allowedClientId: props.auth.machineClient.userPoolClientId,
      discoveryUrl: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${props.auth.userPool.userPoolId}/.well-known/openid-configuration`,
      ssmPrefix: cfg.ssmPrefix,
    });
  }
}
