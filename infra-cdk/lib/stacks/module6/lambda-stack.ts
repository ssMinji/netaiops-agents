import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DockerLambda } from '../../constructs/docker-lambda';
import { CONFIG } from '../../config';
import * as path from 'path';

export interface Module6LambdaStackProps {
  lambdaRole: iam.IRole;
}

export class Module6LambdaStack extends Construct {
  public readonly datadogLambda: DockerLambda;
  public readonly opensearchLambda: DockerLambda;
  public readonly containerInsightLambda: DockerLambda;
  public readonly chaosLambda: DockerLambda;
  public readonly alarmTriggerLambda: DockerLambda;
  public readonly githubLambda: DockerLambda;

  constructor(scope: Construct, id: string, props: Module6LambdaStackProps) {
    super(scope, id);

    const cfg = CONFIG.module6;
    const lambdaSrcBase = path.join(__dirname, '..', '..', '..', 'lambda-src', 'module6');

    // 1. Datadog Lambda
    this.datadogLambda = new DockerLambda(this, 'Datadog', {
      functionName: cfg.lambdas.datadog.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.datadog.dir),
      role: props.lambdaRole,
      description: 'Incident Analysis - Datadog metrics, events, traces, monitors',
      environment: {
        DATADOG_SITE: 'us5.datadoghq.com',
        // DATADOG_API_KEY and DATADOG_APP_KEY set via SSM/env post-deploy
      },
    });

    // 2. OpenSearch Lambda
    this.opensearchLambda = new DockerLambda(this, 'OpenSearch', {
      functionName: cfg.lambdas.opensearch.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.opensearch.dir),
      role: props.lambdaRole,
      description: 'Incident Analysis - OpenSearch log search, anomaly detection',
      environment: {
        AWS_REGION_NAME: CONFIG.primaryRegion,
      },
    });

    // 3. Container Insight Lambda
    this.containerInsightLambda = new DockerLambda(this, 'ContainerInsight', {
      functionName: cfg.lambdas.containerInsight.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.containerInsight.dir),
      role: props.lambdaRole,
      description: 'Incident Analysis - EKS Container Insights pod/node/cluster metrics',
    });

    // 4. Chaos Lambda
    this.chaosLambda = new DockerLambda(this, 'Chaos', {
      functionName: cfg.lambdas.chaos.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.chaos.dir),
      role: props.lambdaRole,
      description: 'Incident Analysis - Chaos engineering for EKS incident injection',
      environment: {
        EKS_CLUSTER_NAME: CONFIG.eksClusterName,
        EKS_CLUSTER_REGION: CONFIG.alarmRegion,
      },
    });

    // 5. Alarm Trigger Lambda (SNS → Agent invocation)
    this.alarmTriggerLambda = new DockerLambda(this, 'AlarmTrigger', {
      functionName: cfg.lambdas.alarmTrigger.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.alarmTrigger.dir),
      role: props.lambdaRole,
      description: 'Incident Analysis - SNS alarm handler that triggers agent runtime',
      environment: {
        AGENT_REGION: CONFIG.primaryRegion,
      },
    });

    // 6. GitHub Lambda
    this.githubLambda = new DockerLambda(this, 'GitHub', {
      functionName: cfg.lambdas.github.name,
      dockerDir: path.join(lambdaSrcBase, cfg.lambdas.github.dir),
      role: props.lambdaRole,
      description: 'Incident Analysis - GitHub issue creation and management',
      environment: {
        AGENT_REGION: CONFIG.primaryRegion,
      },
    });

    // Store Lambda ARNs in SSM
    const lambdaArnParams: Record<string, string> = {
      datadog_lambda_arn: this.datadogLambda.fn.functionArn,
      opensearch_lambda_arn: this.opensearchLambda.fn.functionArn,
      container_insight_lambda_arn: this.containerInsightLambda.fn.functionArn,
      chaos_lambda_arn: this.chaosLambda.fn.functionArn,
      alarm_trigger_lambda_arn: this.alarmTriggerLambda.fn.functionArn,
      github_lambda_arn: this.githubLambda.fn.functionArn,
    };

    for (const [key, value] of Object.entries(lambdaArnParams)) {
      new ssm.StringParameter(this, `Param-${key}`, {
        parameterName: `${cfg.ssmPrefix}/${key}`,
        stringValue: value,
      });
    }
  }
}
