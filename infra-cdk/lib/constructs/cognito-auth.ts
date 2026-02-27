import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface CognitoAuthProps {
  /** User pool name */
  poolName: string;
  /** Cognito domain prefix (e.g. 'k8sagent') - account ID will be appended */
  domainPrefix: string;
  /** Resource server identifier */
  resourceServerIdentifier: string;
  /** OAuth2 scopes on the resource server */
  scopes: { name: string; description: string }[];
  /** Machine (M2M) client name */
  machineClientName: string;
  /** Web client name (optional - only for user-facing pools) */
  webClientName?: string;
  /** Web client callback URL */
  webCallbackUrl?: string;
  /** Additional OAuth scopes for the web client beyond the resource server scopes */
  webClientOAuthScopes?: cognito.OAuthScope[];
  /** SSM parameter prefix (e.g. '/a2a/app/k8s/agentcore') */
  ssmPrefix: string;
  /** SSM parameter key prefix for disambiguation (e.g. '' or 'eks_mcp_') */
  ssmKeyPrefix?: string;
}

export class CognitoAuth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly resourceServer: cognito.UserPoolResourceServer;
  public readonly machineClient: cognito.UserPoolClient;
  public readonly webClient?: cognito.UserPoolClient;
  public readonly domain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: CognitoAuthProps) {
    super(scope, id);

    const keyPrefix = props.ssmKeyPrefix ?? '';

    // User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: props.poolName,
      mfa: cognito.Mfa.OFF,
      signInCaseSensitive: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Groups
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      precedence: 1,
    });

    new cognito.CfnUserPoolGroup(this, 'UserGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'user',
      precedence: 2,
    });

    // Resource Server with OAuth2 scopes
    const oauthScopes = props.scopes.map(
      (s) => new cognito.ResourceServerScope({ scopeName: s.name, scopeDescription: s.description })
    );

    this.resourceServer = this.userPool.addResourceServer('ResourceServer', {
      identifier: props.resourceServerIdentifier,
      userPoolResourceServerName: props.resourceServerIdentifier,
      scopes: oauthScopes,
    });

    const resourceServerScopes = oauthScopes.map((s) =>
      cognito.OAuthScope.resourceServer(this.resourceServer, s)
    );

    // Machine Client (client_credentials M2M)
    this.machineClient = this.userPool.addClient('MachineClient', {
      userPoolClientName: props.machineClientName,
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: resourceServerScopes,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(1),
    });

    // Web Client (optional, for PKCE flow)
    if (props.webClientName) {
      const webScopes = [
        cognito.OAuthScope.OPENID,
        cognito.OAuthScope.EMAIL,
        cognito.OAuthScope.PROFILE,
        ...resourceServerScopes,
        ...(props.webClientOAuthScopes ?? []),
      ];

      this.webClient = this.userPool.addClient('WebClient', {
        userPoolClientName: props.webClientName,
        generateSecret: false,
        oAuth: {
          flows: { authorizationCodeGrant: true },
          scopes: webScopes,
          callbackUrls: [props.webCallbackUrl ?? 'http://localhost:8501/', 'https://example.com/auth/callback'],
          logoutUrls: [props.webCallbackUrl ?? 'http://localhost:8501/'],
        },
        accessTokenValidity: cdk.Duration.minutes(60),
        idTokenValidity: cdk.Duration.minutes(60),
        refreshTokenValidity: cdk.Duration.days(30),
      });
    }

    // Domain
    this.domain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: `${props.domainPrefix}-${cdk.Aws.ACCOUNT_ID}`,
      },
    });

    // SSM Parameters
    const domainBase = `https://${props.domainPrefix}-${cdk.Aws.ACCOUNT_ID}.auth.${cdk.Aws.REGION}.amazoncognito.com`;
    const discoveryUrl = `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${this.userPool.userPoolId}/.well-known/openid-configuration`;

    // Build the full scope string for the resource server
    const scopeString = props.scopes
      .map((s) => `${props.resourceServerIdentifier}/${s.name}`)
      .join(' ');

    const ssmParams: Record<string, string> = {
      [`${keyPrefix}userpool_id`]: this.userPool.userPoolId,
      [`${keyPrefix}machine_client_id`]: this.machineClient.userPoolClientId,
      [`${keyPrefix}cognito_discovery_url`]: discoveryUrl,
      [`${keyPrefix}cognito_token_url`]: `${domainBase}/oauth2/token`,
      [`${keyPrefix}cognito_auth_url`]: `${domainBase}/oauth2/authorize`,
      [`${keyPrefix}cognito_domain`]: domainBase,
      [`${keyPrefix}cognito_auth_scope`]: scopeString,
    };

    if (props.webClientName && this.webClient) {
      ssmParams[`${keyPrefix}web_client_id`] = this.webClient.userPoolClientId;
    }

    // The cognito_provider name matches the domain prefix pattern
    ssmParams[`${keyPrefix}cognito_provider`] = `${props.domainPrefix}-${cdk.Aws.ACCOUNT_ID}`;

    for (const [key, value] of Object.entries(ssmParams)) {
      new ssm.StringParameter(this, `Param-${key}`, {
        parameterName: `${props.ssmPrefix}/${key}`,
        stringValue: value,
      });
    }

    // Machine client secret needs special handling - use CfnOutput + SSM
    // The client secret is only available via CloudFormation GetAtt on the L1 construct
    const cfnMachineClient = this.machineClient.node.defaultChild as cognito.CfnUserPoolClient;
    new ssm.CfnParameter(this, `Param-${keyPrefix}machine_client_secret`, {
      name: `${props.ssmPrefix}/${keyPrefix}machine_client_secret`,
      type: 'String',
      value: cfnMachineClient.ref, // placeholder, overridden below
    }).addOverride('Properties.Value', { 'Fn::GetAtt': [cfnMachineClient.logicalId, 'ClientSecret'] });
  }
}
