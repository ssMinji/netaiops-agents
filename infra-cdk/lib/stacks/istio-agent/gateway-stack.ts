import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { McpGateway, OAuth2CredentialProvider, LambdaTargetConfig } from '../../constructs/mcp-gateway';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export interface IstioAgentGatewayStackProps {
  auth: CognitoAuth;
  executionRoleArn: string;
  prometheusLambdaArn: string;
}

/**
 * Istio Agent Gateway - Hybrid gateway with two target types:
 *  - Target 1: EksMcpServer (mcpServer type) — reuses K8s Agent's EKS MCP Server
 *  - Target 2: IstioPrometheusTools (Lambda type) — Istio Prometheus metrics
 *
 * Depends on K8s Agent stack being deployed first (reads SSM params for
 * EKS MCP Server ARN and Runtime Pool OAuth2 credentials).
 */
export class IstioAgentGatewayStack extends Construct {
  public readonly gateway: McpGateway;

  constructor(scope: Construct, id: string, props: IstioAgentGatewayStackProps) {
    super(scope, id);

    const cfg = CONFIG.istioAgent;
    const k8sSsmPrefix = cfg.gateway.k8sSsmPrefix;
    const schemas = CONFIG.toolSchemas;

    // ========== Target 1: EKS MCP Server (mcpServer type, OAuth2) ==========

    // Read K8s Agent's Runtime Pool OAuth2 credentials from SSM
    const eksMcpClientId = ssm.StringParameter.valueForStringParameter(
      this,
      `${k8sSsmPrefix}/eks_mcp_machine_client_id`
    );
    const eksMcpClientSecret = ssm.StringParameter.valueForStringParameter(
      this,
      `${k8sSsmPrefix}/eks_mcp_machine_client_secret`
    );
    const eksMcpTokenUrl = ssm.StringParameter.valueForStringParameter(
      this,
      `${k8sSsmPrefix}/eks_mcp_cognito_token_url`
    );
    const eksMcpScope = ssm.StringParameter.valueForStringParameter(
      this,
      `${k8sSsmPrefix}/eks_mcp_cognito_auth_scope`
    );

    // Create OAuth2 credential provider for Gateway→EKS MCP Server auth
    const oauthProvider = new OAuth2CredentialProvider(this, 'OAuth2Provider', {
      providerName: cfg.gateway.oauthProviderName,
      tokenUrl: eksMcpTokenUrl,
      clientId: eksMcpClientId,
      clientSecret: eksMcpClientSecret,
    });

    // EKS MCP Server ARN from K8s Agent SSM
    const eksMcpServerArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${k8sSsmPrefix}/eks_mcp_server_arn`
    );

    // Construct runtime endpoint URL from ARN
    const encodedArn = cdk.Fn.join('', [
      'https://bedrock-agentcore.',
      cdk.Aws.REGION,
      '.amazonaws.com/runtimes/',
      eksMcpServerArn,
      '/invocations?qualifier=DEFAULT',
    ]);

    // ========== Target 2: Prometheus Lambda ==========
    const lambdaTargets: LambdaTargetConfig[] = [
      {
        name: 'IstioPrometheusTools',
        description: 'Istio Prometheus metrics - RED, topology, TCP, control plane, proxy resources',
        lambdaArn: props.prometheusLambdaArn,
        toolSchemas: schemas.istioPrometheus as any,
      },
    ];

    // ========== Create Gateway with both target types ==========
    this.gateway = new McpGateway(this, 'Gateway', {
      gatewayName: cfg.gateway.name,
      description: cfg.gateway.description,
      executionRoleArn: props.executionRoleArn,
      allowedClientId: props.auth.machineClient.userPoolClientId,
      discoveryUrl: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${props.auth.userPool.userPoolId}/.well-known/openid-configuration`,
      mcpServerTargets: [
        {
          name: 'EksMcpServer',
          description: 'AWS Labs EKS MCP Server - K8s resources, Istio CRDs, pod logs, events',
          endpointUrl: encodedArn,
          oauthProviderArn: oauthProvider.providerArn,
          scopes: [eksMcpScope],
        },
      ],
      lambdaTargets,
      ssmPrefix: cfg.ssmPrefix,
    });
  }
}
