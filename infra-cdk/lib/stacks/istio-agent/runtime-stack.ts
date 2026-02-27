import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CONFIG } from '../../config';

export interface IstioAgentRuntimeStackProps {
  executionRoleArn: string;
}

/**
 * Istio Agent Runtime - AgentCore Runtime for the Istio Mesh Diagnostics Agent.
 */
export class IstioAgentRuntimeStack extends Construct {
  public readonly runtimeArn: string;

  constructor(scope: Construct, id: string, props: IstioAgentRuntimeStackProps) {
    super(scope, id);

    const cfg = CONFIG.istioAgent;

    const runtime = new cdk.CfnResource(this, 'Runtime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        RuntimeName: cfg.runtime.name,
        RoleArn: props.executionRoleArn,
        Description: 'Istio Mesh Diagnostics Agent Runtime',
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC',
        },
      },
    });

    this.runtimeArn = runtime.getAtt('RuntimeArn').toString();

    new ssm.StringParameter(this, 'RuntimeArnParam', {
      parameterName: `${cfg.ssmPrefix}/runtime_arn`,
      stringValue: this.runtimeArn,
    });

    new ssm.StringParameter(this, 'RuntimeNameParam', {
      parameterName: `${cfg.ssmPrefix}/runtime_name`,
      stringValue: cfg.runtime.name,
    });
  }
}
