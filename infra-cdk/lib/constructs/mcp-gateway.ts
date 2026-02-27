import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Tool schema for Lambda gateway targets.
 */
export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerTargetConfig {
  name: string;
  description: string;
  /** The Runtime endpoint URL (constructed from ARN) */
  endpointUrl: string;
  /** OAuth2 credential provider ARN for auth */
  oauthProviderArn: string;
  /** OAuth scopes */
  scopes: string[];
}

export interface LambdaTargetConfig {
  name: string;
  description: string;
  lambdaArn: string;
  toolSchemas: ToolSchema[];
}

export interface McpGatewayProps {
  gatewayName: string;
  description: string;
  /** IAM execution role ARN */
  executionRoleArn: string;
  /** Cognito machine client ID for JWT auth */
  allowedClientId: string;
  /** Cognito OIDC discovery URL */
  discoveryUrl: string;
  /** mcpServer targets (Module 5 style) */
  mcpServerTargets?: McpServerTargetConfig[];
  /** Lambda targets (Module 6 style) */
  lambdaTargets?: LambdaTargetConfig[];
  /** SSM prefix for storing gateway params */
  ssmPrefix: string;
}

export class McpGateway extends Construct {
  public readonly gatewayId: string;
  public readonly gatewayArn: string;
  public readonly gatewayUrl: string;

  constructor(scope: Construct, id: string, props: McpGatewayProps) {
    super(scope, id);

    // Create Gateway via L1 construct
    const gateway = new cdk.CfnResource(this, 'Gateway', {
      type: 'AWS::BedrockAgentCore::Gateway',
      properties: {
        Name: props.gatewayName,
        RoleArn: props.executionRoleArn,
        ProtocolType: 'MCP',
        AuthorizerType: 'CUSTOM_JWT',
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            AllowedClients: [props.allowedClientId],
            DiscoveryUrl: props.discoveryUrl,
          },
        },
        Description: props.description,
      },
    });

    this.gatewayId = gateway.getAtt('GatewayId').toString();
    this.gatewayArn = gateway.getAtt('GatewayArn').toString();
    this.gatewayUrl = gateway.getAtt('GatewayUrl').toString();

    // Add mcpServer targets
    if (props.mcpServerTargets) {
      for (const target of props.mcpServerTargets) {
        const targetResource = new cdk.CfnResource(this, `Target-${target.name}`, {
          type: 'AWS::BedrockAgentCore::GatewayTarget',
          properties: {
            GatewayIdentifier: this.gatewayId,
            Name: target.name,
            Description: target.description,
            TargetConfiguration: {
              Mcp: {
                McpServer: {
                  Endpoint: target.endpointUrl,
                },
              },
            },
            CredentialProviderConfigurations: [
              {
                CredentialProviderType: 'OAUTH',
                CredentialProvider: {
                  OauthCredentialProvider: {
                    ProviderArn: target.oauthProviderArn,
                    Scopes: target.scopes,
                  },
                },
              },
            ],
          },
        });
        targetResource.addDependency(gateway);
      }
    }

    // Add Lambda targets
    if (props.lambdaTargets) {
      for (const target of props.lambdaTargets) {
        const targetResource = new cdk.CfnResource(this, `Target-${target.name}`, {
          type: 'AWS::BedrockAgentCore::GatewayTarget',
          properties: {
            GatewayIdentifier: this.gatewayId,
            Name: target.name,
            Description: target.description,
            TargetConfiguration: {
              Mcp: {
                Lambda: {
                  LambdaArn: target.lambdaArn,
                  ToolSchema: {
                    InlinePayload: target.toolSchemas,
                  },
                },
              },
            },
            CredentialProviderConfigurations: [
              { CredentialProviderType: 'GATEWAY_IAM_ROLE' },
            ],
          },
        });
        targetResource.addDependency(gateway);
      }
    }

    // SSM Parameters for gateway
    new ssm.StringParameter(this, 'GatewayIdParam', {
      parameterName: `${props.ssmPrefix}/gateway_id`,
      stringValue: this.gatewayId,
    });

    new ssm.StringParameter(this, 'GatewayNameParam', {
      parameterName: `${props.ssmPrefix}/gateway_name`,
      stringValue: props.gatewayName,
    });

    new ssm.StringParameter(this, 'GatewayArnParam', {
      parameterName: `${props.ssmPrefix}/gateway_arn`,
      stringValue: this.gatewayArn,
    });

    new ssm.StringParameter(this, 'GatewayUrlParam', {
      parameterName: `${props.ssmPrefix}/gateway_url`,
      stringValue: this.gatewayUrl,
    });
  }
}

/**
 * Creates an OAuth2 credential provider for Gateway→Runtime auth.
 */
export class OAuth2CredentialProvider extends Construct {
  public readonly providerArn: string;

  constructor(scope: Construct, id: string, props: {
    providerName: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
  }) {
    super(scope, id);

    const provider = new cdk.CfnResource(this, 'Provider', {
      type: 'AWS::BedrockAgentCore::OAuth2CredentialProvider',
      properties: {
        Name: props.providerName,
        CredentialProviderVendor: 'CustomOAuth',
        Oauth2ProviderConfigInput: {
          CustomOAuthProviderConfig: {
            TokenUrl: props.tokenUrl,
            ClientId: props.clientId,
            ClientSecret: props.clientSecret,
          },
        },
      },
    });

    this.providerArn = provider.getAtt('CredentialProviderArn').toString();
  }
}
