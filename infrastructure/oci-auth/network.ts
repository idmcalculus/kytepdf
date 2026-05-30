// network.ts

import * as oci from "@pulumi/oci";
import * as pulumi from "@pulumi/pulumi";

export interface NetworkArgs {
  compartmentId: pulumi.Input<string>;
  adminCidrs: string[]; // e.g. ["203.0.113.0/24"]
}

/**
 * Represents a single ingress security rule (plain data, no Pulumi Outputs).
 * Used by buildIngressRules() so the rule-generation logic can be unit-tested
 * without instantiating Pulumi resources.
 */
export interface IngressRule {
  protocol: string;
  source: string;
  tcpOptions?: {
    min: number;
    max: number;
  };
  icmpOptions?: {
    type: number;
    code: number;
  };
}

/**
 * Pure function: builds the full list of ingress security rules for the
 * NetworkComponent Security List given a set of admin CIDRs.
 *
 * Rules:
 *  - TCP 443 from 0.0.0.0/0 (HTTPS)
 *  - TCP 80 from 0.0.0.0/0 (HTTP / ACME HTTP-01)
 *  - TCP 22 from each adminCidr (SSH — one rule per CIDR)
 *  - ICMP type 3 code 4 from 10.0.0.0/16 (path MTU discovery)
 *  - TCP 5432 is intentionally ABSENT (Postgres must never be publicly reachable)
 *
 * Extracted from the constructor so it can be property-tested independently.
 */
export function buildIngressRules(adminCidrs: string[]): IngressRule[] {
  return [
    // HTTPS from anywhere
    {
      protocol: "6",
      source: "0.0.0.0/0",
      tcpOptions: {
        min: 443,
        max: 443,
      },
    },
    // HTTP from anywhere (for ACME HTTP-01 challenge and redirect)
    {
      protocol: "6",
      source: "0.0.0.0/0",
      tcpOptions: {
        min: 80,
        max: 80,
      },
    },
    // SSH from admin CIDRs only
    ...adminCidrs.map((cidr) => ({
      protocol: "6",
      source: cidr,
      tcpOptions: {
        min: 22,
        max: 22,
      },
    })),
    // ICMP type 3 (destination unreachable) from VCN
    {
      protocol: "1",
      source: "10.0.0.0/16",
      icmpOptions: {
        type: 3,
        code: 4,
      },
    },
  ];
}

export class NetworkComponent extends pulumi.ComponentResource {
  public readonly vcnId: pulumi.Output<string>;
  public readonly subnetId: pulumi.Output<string>;

  constructor(name: string, args: NetworkArgs, opts?: pulumi.ComponentResourceOptions) {
    super("kytepdf:oci:NetworkComponent", name, {}, opts);
    const defaultOpts = {
      parent: this,
    };

    // VCN
    const vcn = new oci.core.Vcn(
      `${name}-vcn`,
      {
        compartmentId: args.compartmentId,
        cidrBlock: "10.0.0.0/16",
        displayName: `${name}-vcn`,
        dnsLabel: "authvcn",
      },
      defaultOpts,
    );

    // Internet Gateway
    const igw = new oci.core.InternetGateway(
      `${name}-igw`,
      {
        compartmentId: args.compartmentId,
        vcnId: vcn.id,
        enabled: true,
        displayName: `${name}-igw`,
      },
      defaultOpts,
    );

    // Route Table: default route via IGW
    const routeTable = new oci.core.RouteTable(
      `${name}-rt`,
      {
        compartmentId: args.compartmentId,
        vcnId: vcn.id,
        displayName: `${name}-rt`,
        routeRules: [
          {
            networkEntityId: igw.id,
            destination: "0.0.0.0/0",
            destinationType: "CIDR_BLOCK",
          },
        ],
      },
      defaultOpts,
    );

    // Security List — uses buildIngressRules() to keep rule logic testable
    const securityList = new oci.core.SecurityList(
      `${name}-sl`,
      {
        compartmentId: args.compartmentId,
        vcnId: vcn.id,
        displayName: `${name}-sl`,
        ingressSecurityRules: buildIngressRules(args.adminCidrs),
        egressSecurityRules: [
          // Allow all outbound (OCI blocks port 25 at network level regardless)
          {
            protocol: "all",
            destination: "0.0.0.0/0",
          },
        ],
      },
      defaultOpts,
    );

    // Public Subnet
    const subnet = new oci.core.Subnet(
      `${name}-subnet`,
      {
        compartmentId: args.compartmentId,
        vcnId: vcn.id,
        cidrBlock: "10.0.1.0/24",
        displayName: `${name}-subnet`,
        dnsLabel: "authsubnet",
        routeTableId: routeTable.id,
        securityListIds: [securityList.id],
        prohibitPublicIpOnVnic: false,
      },
      defaultOpts,
    );

    this.vcnId = vcn.id;
    this.subnetId = subnet.id;
    this.registerOutputs({
      vcnId: this.vcnId,
      subnetId: this.subnetId,
    });
  }
}
