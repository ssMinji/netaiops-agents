import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DockerLambda } from '../../constructs/docker-lambda';
import { CONFIG } from '../../config';
import * as path from 'path';

export interface IstioAgentLambdaStackProps {
  lambdaRole: iam.IRole;
}

export class IstioAgentLambdaStack extends Construct {
  public readonly prometheusLambda: DockerLambda;
  public readonly faultLambda: DockerLambda;

  constructor(scope: Construct, id: string, props: IstioAgentLambdaStackProps) {
    super(scope, id);

    const cfg = CONFIG.istioAgent;
    const lambdaSrcBase = path.join(__dirname, '..', '..', '..', 'lambda-src', 'istio-agent');

    // 1. Prometheus Lambda — AMP metrics query
    this.prometheusLambda = new DockerLambda(this, 'Prometheus', {
      functionName: cfg.lambdas.prometheus.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.prometheus.dir),
      role: props.lambdaRole,
      description: 'Istio Mesh - Prometheus metrics (RED, topology, TCP, control plane, proxy)',
      environment: {
        AWS_REGION_NAME: CONFIG.primaryRegion,
      },
    });

    // 2. Fault Lambda — UI에서 직접 호출하는 용도 (MCP Gateway에 연결하지 않음)
    this.faultLambda = new DockerLambda(this, 'Fault', {
      functionName: cfg.lambdas.fault.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.fault.dir),
      role: props.lambdaRole,
      description: 'Istio Mesh - Fault injection (delay, abort, circuit breaker)',
      environment: {
        TARGET_REGION: CONFIG.primaryRegion,
        EKS_CLUSTER_NAME: CONFIG.eksClusterName,
      },
    });

    // Store Lambda ARNs in SSM
    new ssm.StringParameter(this, 'Param-prometheus_lambda_arn', {
      parameterName: `${cfg.ssmPrefix}/prometheus_lambda_arn`,
      stringValue: this.prometheusLambda.fn.functionArn,
    });

    new ssm.StringParameter(this, 'Param-fault_lambda_arn', {
      parameterName: `${cfg.ssmPrefix}/fault_lambda_arn`,
      stringValue: this.faultLambda.fn.functionArn,
    });
  }
}
