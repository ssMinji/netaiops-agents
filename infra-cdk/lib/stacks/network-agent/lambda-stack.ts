import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DockerLambda } from '../../constructs/docker-lambda';
import { CONFIG } from '../../config';
import * as path from 'path';

export interface NetworkAgentLambdaStackProps {
  lambdaRole: iam.IRole;
}

export class NetworkAgentLambdaStack extends Construct {
  public readonly dnsLambda: DockerLambda;
  public readonly networkMetricsLambda: DockerLambda;

  constructor(scope: Construct, id: string, props: NetworkAgentLambdaStackProps) {
    super(scope, id);

    const cfg = CONFIG.networkAgent;
    const lambdaSrcBase = path.join(__dirname, '..', '..', '..', 'lambda-src', 'network-agent');

    // 1. DNS Lambda — Route 53 DNS tools
    this.dnsLambda = new DockerLambda(this, 'Dns', {
      functionName: cfg.lambdas.dns.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.dns.dir),
      role: props.lambdaRole,
      description: 'Network Agent - DNS tools (hosted zones, records, health checks, resolution)',
      environment: {
        AWS_REGION_NAME: CONFIG.primaryRegion,
      },
    });

    // 2. Network Metrics Lambda — CloudWatch network metrics
    this.networkMetricsLambda = new DockerLambda(this, 'NetworkMetrics', {
      functionName: cfg.lambdas.networkMetrics.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.networkMetrics.dir),
      role: props.lambdaRole,
      description: 'Network Agent - Network metrics (EC2, gateway, ELB, flow logs)',
      environment: {
        AWS_REGION_NAME: CONFIG.primaryRegion,
      },
    });

    // Store Lambda ARNs in SSM
    new ssm.StringParameter(this, 'Param-dns_lambda_arn', {
      parameterName: `${cfg.ssmPrefix}/dns_lambda_arn`,
      stringValue: this.dnsLambda.fn.functionArn,
    });

    new ssm.StringParameter(this, 'Param-network_metrics_lambda_arn', {
      parameterName: `${cfg.ssmPrefix}/network_metrics_lambda_arn`,
      stringValue: this.networkMetricsLambda.fn.functionArn,
    });
  }
}
