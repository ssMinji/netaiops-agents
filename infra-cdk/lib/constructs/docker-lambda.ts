import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface DockerLambdaProps {
  functionName: string;
  /** Path to the directory containing the Dockerfile */
  dockerDir: string;
  /** Environment variables */
  environment?: Record<string, string>;
  /** IAM role to use (shared across lambdas) */
  role: iam.IRole;
  /** Timeout in seconds (default: 300) */
  timeout?: number;
  /** Memory in MB (default: 1024) */
  memorySize?: number;
  /** Description */
  description?: string;
}

export class DockerLambda extends Construct {
  public readonly fn: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: DockerLambdaProps) {
    super(scope, id);

    this.fn = new lambda.DockerImageFunction(this, 'Function', {
      functionName: props.functionName,
      code: lambda.DockerImageCode.fromImageAsset(props.dockerDir, {
        platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
      }),
      role: props.role,
      timeout: cdk.Duration.seconds(props.timeout ?? 300),
      memorySize: props.memorySize ?? 1024,
      environment: props.environment,
      description: props.description,
      architecture: lambda.Architecture.X86_64,
    });
  }
}
