import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { McpGateway, OAuth2CredentialProvider } from '../../constructs/mcp-gateway';
import { CognitoAuth } from '../../constructs/cognito-auth';
import { CONFIG } from '../../config';

export interface K8sAgentGatewayStackProps {
  agentAuth: CognitoAuth;
  runtimeAuth: CognitoAuth;
  executionRoleArn: string;
}

/**
 * K8s Agent Gateway - mcpServer target pointing to EKS MCP Server Runtime.
 *
 * The Gateway authenticates to the EKS MCP Server Runtime using OAuth2 credentials
 * from the Runtime User Pool. The EKS MCP Server ARN must be pre-set in SSM
 * as a prerequisite (it's deployed via CLI, not CDK).
 */
export class K8sAgentGatewayStack extends Construct {
  public readonly gateway: McpGateway;

  constructor(scope: Construct, id: string, props: K8sAgentGatewayStackProps) {
    super(scope, id);

    const cfg = CONFIG.k8sAgent;

    // Create OAuth2 credential provider for Gateway→Runtime auth
    // Uses the Runtime User Pool machine client credentials
    const cfnRuntimeMachineClient = props.runtimeAuth.machineClient.node.defaultChild as cdk.CfnResource;

    const oauthProvider = new OAuth2CredentialProvider(this, 'OAuth2Provider', {
      providerName: cfg.gateway.oauthProviderName,
      tokenUrl: `https://${cfg.runtimePool.domainPrefix}-${cdk.Aws.ACCOUNT_ID}.auth.${cdk.Aws.REGION}.amazoncognito.com/oauth2/token`,
      clientId: props.runtimeAuth.machineClient.userPoolClientId,
      // Client secret retrieved via CloudFormation GetAtt
      clientSecret: (cfnRuntimeMachineClient as any).getAtt('ClientSecret').toString(),
    });

    // EKS MCP Server ARN is a manual prerequisite - read from SSM at deploy time
    // Users must deploy the EKS MCP Server via CLI first and store its ARN in SSM
    const eksMcpServerArn = ssm.StringParameter.valueForStringParameter(
      this,
      `${cfg.ssmPrefix}/eks_mcp_server_arn`
    );

    // Construct the runtime endpoint URL from the ARN
    const encodedArn = cdk.Fn.join('', [
      'https://bedrock-agentcore.',
      cdk.Aws.REGION,
      '.amazonaws.com/runtimes/',
      eksMcpServerArn, // Note: URL encoding handled by the service
      '/invocations?qualifier=DEFAULT',
    ]);

    // Runtime auth scope
    const runtimeScope = `${cfg.runtimePool.resourceServerIdentifier}/invoke`;

    this.gateway = new McpGateway(this, 'Gateway', {
      gatewayName: cfg.gateway.name,
      description: cfg.gateway.description,
      executionRoleArn: props.executionRoleArn,
      allowedClientId: props.agentAuth.machineClient.userPoolClientId,
      discoveryUrl: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${props.agentAuth.userPool.userPoolId}/.well-known/openid-configuration`,
      mcpServerTargets: [
        {
          name: cfg.gateway.targetName,
          description: cfg.gateway.targetDescription,
          endpointUrl: encodedArn,
          oauthProviderArn: oauthProvider.providerArn,
          scopes: [runtimeScope],
        },
      ],
      ssmPrefix: cfg.ssmPrefix,
    });
  }
}
