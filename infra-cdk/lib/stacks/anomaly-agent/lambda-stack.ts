import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DockerLambda } from '../../constructs/docker-lambda';
import { CONFIG } from '../../config';
import * as path from 'path';

export interface AnomalyAgentLambdaStackProps {
  lambdaRole: iam.IRole;
}

export class AnomalyAgentLambdaStack extends Construct {
  public readonly cloudwatchAnomalyLambda: DockerLambda;
  public readonly networkAnomalyLambda: DockerLambda;

  constructor(scope: Construct, id: string, props: AnomalyAgentLambdaStackProps) {
    super(scope, id);

    const cfg = CONFIG.anomalyAgent;
    const lambdaSrcBase = path.join(__dirname, '..', '..', '..', 'lambda-src', 'anomaly-agent');

    // 1. CloudWatch Anomaly Lambda (2 tools)
    this.cloudwatchAnomalyLambda = new DockerLambda(this, 'CloudwatchAnomaly', {
      functionName: cfg.lambdas.cloudwatchAnomaly.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.cloudwatchAnomaly.dir),
      role: props.lambdaRole,
      description: 'Anomaly Detection - CloudWatch ML anomaly detection band analysis and alarm status',
    });

    // 2. Network Anomaly Lambda (3 tools)
    this.networkAnomalyLambda = new DockerLambda(this, 'NetworkAnomaly', {
      functionName: cfg.lambdas.networkAnomaly.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.networkAnomaly.dir),
      role: props.lambdaRole,
      description: 'Anomaly Detection - VPC Flow Logs analysis, Inter-AZ traffic, ELB shift detection',
    });

    // Store Lambda ARNs in SSM
    const lambdaArnParams: Record<string, string> = {
      cloudwatch_anomaly_lambda_arn: this.cloudwatchAnomalyLambda.fn.functionArn,
      network_anomaly_lambda_arn: this.networkAnomalyLambda.fn.functionArn,
    };

    for (const [key, value] of Object.entries(lambdaArnParams)) {
      new ssm.StringParameter(this, `Param-${key}`, {
        parameterName: `${cfg.ssmPrefix}/${key}`,
        stringValue: value,
      });
    }
  }
}
