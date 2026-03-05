import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface VpcConstructProps {
  availabilityZones: string[];
}

export class VpcConstruct extends Construct {
  public readonly prodVpc: ec2.Vpc;
  public readonly stagingVpc: ec2.Vpc;
  public readonly sharedVpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);

    const azs = props.availabilityZones;

    // Production VPC: 10.1.0.0/16, 1 NAT GW, public + private subnets
    this.prodVpc = new ec2.Vpc(this, 'ProdVpc', {
      vpcName: 'netaiops-prod-vpc',
      ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),

      availabilityZones: azs,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'netaiops-prod-public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'netaiops-prod-private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Staging VPC: 10.2.0.0/16, NO NAT/IGW (egress via TGW → Prod NAT)
    this.stagingVpc = new ec2.Vpc(this, 'StagingVpc', {
      vpcName: 'netaiops-staging-vpc',
      ipAddresses: ec2.IpAddresses.cidr('10.2.0.0/16'),
      availabilityZones: azs,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'netaiops-staging-private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Shared Services VPC: 10.0.0.0/16, 1 NAT GW
    this.sharedVpc = new ec2.Vpc(this, 'SharedVpc', {
      vpcName: 'netaiops-shared-vpc',
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),

      availabilityZones: azs,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'netaiops-shared-public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'netaiops-shared-private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Tag all subnets
    this.tagSubnets(this.prodVpc, 'prod');
    this.tagSubnets(this.stagingVpc, 'staging');
    this.tagSubnets(this.sharedVpc, 'shared');
  }

  private tagSubnets(vpc: ec2.Vpc, env: string) {
    vpc.publicSubnets.forEach((subnet, i) => {
      const az = i === 0 ? 'a' : 'b';
      cdk.Tags.of(subnet).add('Name', `netaiops-${env}-public-${az}`);
    });
    vpc.privateSubnets.forEach((subnet, i) => {
      const az = i === 0 ? 'a' : 'b';
      cdk.Tags.of(subnet).add('Name', `netaiops-${env}-private-${az}`);
    });
    vpc.isolatedSubnets.forEach((subnet, i) => {
      const az = i === 0 ? 'a' : 'b';
      cdk.Tags.of(subnet).add('Name', `netaiops-${env}-private-${az}`);
    });
  }
}
