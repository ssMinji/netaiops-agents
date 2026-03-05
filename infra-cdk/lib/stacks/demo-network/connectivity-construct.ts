import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface ConnectivityConstructProps {
  prodVpc: ec2.Vpc;
  stagingVpc: ec2.Vpc;
  sharedVpc: ec2.Vpc;
}

export class ConnectivityConstruct extends Construct {
  public readonly transitGateway: ec2.CfnTransitGateway;

  constructor(scope: Construct, id: string, props: ConnectivityConstructProps) {
    super(scope, id);

    const { prodVpc, stagingVpc, sharedVpc } = props;

    // Transit Gateway
    this.transitGateway = new ec2.CfnTransitGateway(this, 'TransitGateway', {
      description: 'NetAIOps Transit Gateway',
      amazonSideAsn: 64512,
      dnsSupport: 'enable',
      vpnEcmpSupport: 'enable',
      defaultRouteTableAssociation: 'enable',
      defaultRouteTablePropagation: 'enable',
      tags: [{ key: 'Name', value: 'netaiops-tgw' }],
    });

    // TGW Attachments (private subnets)
    const prodAttachment = new ec2.CfnTransitGatewayAttachment(this, 'ProdAttachment', {
      transitGatewayId: this.transitGateway.ref,
      vpcId: prodVpc.vpcId,
      subnetIds: prodVpc.privateSubnets.map(s => s.subnetId),
      tags: [{ key: 'Name', value: 'netaiops-tgw-prod-attach' }],
    });

    const stagingAttachment = new ec2.CfnTransitGatewayAttachment(this, 'StagingAttachment', {
      transitGatewayId: this.transitGateway.ref,
      vpcId: stagingVpc.vpcId,
      subnetIds: stagingVpc.isolatedSubnets.map(s => s.subnetId),
      tags: [{ key: 'Name', value: 'netaiops-tgw-staging-attach' }],
    });

    const sharedAttachment = new ec2.CfnTransitGatewayAttachment(this, 'SharedAttachment', {
      transitGatewayId: this.transitGateway.ref,
      vpcId: sharedVpc.vpcId,
      subnetIds: sharedVpc.privateSubnets.map(s => s.subnetId),
      tags: [{ key: 'Name', value: 'netaiops-tgw-shared-attach' }],
    });

    // VPC Peering: Prod ↔ Shared (dual connectivity path)
    const peering = new ec2.CfnVPCPeeringConnection(this, 'ProdSharedPeering', {
      vpcId: prodVpc.vpcId,
      peerVpcId: sharedVpc.vpcId,
      tags: [{ key: 'Name', value: 'netaiops-prod-shared-peering' }],
    });

    // --- Route Table Updates ---

    // Staging private → 0.0.0.0/0 via TGW (shared egress through Prod NAT)
    stagingVpc.isolatedSubnets.forEach((subnet, i) => {
      new ec2.CfnRoute(this, `StagingDefaultViaTgw${i}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        transitGatewayId: this.transitGateway.ref,
      }).addDependency(stagingAttachment);
    });

    // Staging private → 10.1.0.0/16 (Prod) via TGW
    stagingVpc.isolatedSubnets.forEach((subnet, i) => {
      new ec2.CfnRoute(this, `StagingToProdViaTgw${i}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.1.0.0/16',
        transitGatewayId: this.transitGateway.ref,
      }).addDependency(stagingAttachment);
    });

    // Staging private → 10.0.0.0/16 (Shared) via TGW
    stagingVpc.isolatedSubnets.forEach((subnet, i) => {
      new ec2.CfnRoute(this, `StagingToSharedViaTgw${i}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.0.0.0/16',
        transitGatewayId: this.transitGateway.ref,
      }).addDependency(stagingAttachment);
    });

    // Prod private → 10.2.0.0/16 (Staging) via TGW
    prodVpc.privateSubnets.forEach((subnet, i) => {
      new ec2.CfnRoute(this, `ProdToStagingViaTgw${i}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.2.0.0/16',
        transitGatewayId: this.transitGateway.ref,
      }).addDependency(prodAttachment);
    });

    // Prod private → 10.0.0.0/16 (Shared) via VPC Peering
    prodVpc.privateSubnets.forEach((subnet, i) => {
      new ec2.CfnRoute(this, `ProdToSharedViaPeering${i}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.0.0.0/16',
        vpcPeeringConnectionId: peering.ref,
      });
    });

    // Shared private → 10.2.0.0/16 (Staging) via TGW
    sharedVpc.privateSubnets.forEach((subnet, i) => {
      new ec2.CfnRoute(this, `SharedToStagingViaTgw${i}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.2.0.0/16',
        transitGatewayId: this.transitGateway.ref,
      }).addDependency(sharedAttachment);
    });

    // Shared private → 10.1.0.0/16 (Prod) via VPC Peering
    sharedVpc.privateSubnets.forEach((subnet, i) => {
      new ec2.CfnRoute(this, `SharedToProdViaPeering${i}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.1.0.0/16',
        vpcPeeringConnectionId: peering.ref,
      });
    });
  }
}
