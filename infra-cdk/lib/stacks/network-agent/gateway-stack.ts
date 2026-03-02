import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { McpGateway, OAuth2CredentialProvider, LambdaTargetConfig } from '../../constructs/mcp-gateway';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export interface NetworkAgentGatewayStackProps {
  agentAuth: CognitoAuth;
  runtimeAuth: CognitoAuth;
  executionRoleArn: string;
  dnsLambdaArn: string;
  networkMetricsLambdaArn: string;
}

/**
 * Network Agent Gateway - Hybrid gateway with three target types:
 *  - Target 1: NetworkMcpServer (mcpServer type) — AWS Network MCP Server
 *  - Target 2: DnsTools (Lambda type) — Route 53 DNS tools
 *  - Target 3: NetworkMetricsTools (Lambda type) — CloudWatch network metrics
 */
export class NetworkAgentGatewayStack extends Construct {
  public readonly gateway: McpGateway;

  constructor(scope: Construct, id: string, props: NetworkAgentGatewayStackProps) {
    super(scope, id);

    const cfg = CONFIG.networkAgent;
    const schemas = CONFIG.toolSchemas;

    // ========== Target 1: Network MCP Server (mcpServer type, OAuth2) ==========

    // Create OAuth2 credential provider for Gateway→Runtime auth
    const cfnRuntimeMachineClient = props.runtimeAuth.machineClient.node.defaultChild as cdk.CfnResource;

    const oauthProvider = new OAuth2CredentialProvider(this, 'OAuth2Provider', {
      providerName: cfg.gateway.oauthProviderName,
      tokenUrl: `https://${cfg.runtimePool.domainPrefix}-${cdk.Aws.ACCOUNT_ID}.auth.${cdk.Aws.REGION}.amazoncognito.com/oauth2/token`,
      clientId: props.runtimeAuth.machineClient.userPoolClientId,
      clientSecret: (cfnRuntimeMachineClient as any).getAtt('ClientSecret').toString(),
    });

    // Network MCP Server ARN is a manual prerequisite - read from SSM at deploy time
    const networkMcpServerArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${cfg.ssmPrefix}/network_mcp_server_arn`
    );

    // Construct the runtime endpoint URL from the ARN
    const encodedArn = cdk.Fn.join('', [
      'https://bedrock-agentcore.',
      cdk.Aws.REGION,
      '.amazonaws.com/runtimes/',
      networkMcpServerArn,
      '/invocations?qualifier=DEFAULT',
    ]);

    // Runtime auth scope
    const runtimeScope = `${cfg.runtimePool.resourceServerIdentifier}/invoke`;

    // ========== Target 2 & 3: Lambda targets ==========
    const lambdaTargets: LambdaTargetConfig[] = [
      {
        name: 'DnsTools',
        description: 'Route 53 DNS tools - hosted zones, records, health checks, resolution',
        lambdaArn: props.dnsLambdaArn,
        toolSchemas: schemas.dns as any,
      },
      {
        name: 'NetworkMetricsTools',
        description: 'CloudWatch network metrics - EC2, gateway, ELB, flow logs',
        lambdaArn: props.networkMetricsLambdaArn,
        toolSchemas: schemas.networkMetrics as any,
      },
    ];

    // ========== Create Gateway with all target types ==========
    this.gateway = new McpGateway(this, 'Gateway', {
      gatewayName: cfg.gateway.name,
      description: cfg.gateway.description,
      executionRoleArn: props.executionRoleArn,
      allowedClientId: props.agentAuth.machineClient.userPoolClientId,
      discoveryUrl: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${props.agentAuth.userPool.userPoolId}/.well-known/openid-configuration`,
      mcpServerTargets: [
        {
          name: 'NetworkMcpServer',
          description: 'AWS Labs Network MCP Server - VPC, TGW, Cloud WAN, Firewall, VPN, Flow Logs',
          endpointUrl: encodedArn,
          oauthProviderArn: oauthProvider.providerArn,
          scopes: [runtimeScope],
        },
      ],
      lambdaTargets,
      ssmPrefix: cfg.ssmPrefix,
    });
  }
}
