// vm.ts
// AuthVmComponent: provisions the OCI ARM64 VM, reserved public IP,
// block volume, and cloud-init bootstrap for the KytePDF auth stack.
//
// NOTE: AuthVmArgs is defined in cloudinit.ts to avoid circular dependencies.
// This file imports it from there.

import * as oci from "@pulumi/oci";
import * as pulumi from "@pulumi/pulumi";
import type { AuthVmArgs } from "./cloudinit";
import { buildCloudInit } from "./cloudinit";

export class AuthVmComponent extends pulumi.ComponentResource {
  public readonly reservedIp: pulumi.Output<string>;
  public readonly instanceId: pulumi.Output<string>;

  constructor(name: string, args: AuthVmArgs, opts?: pulumi.ComponentResourceOptions) {
    super("kytepdf:oci:AuthVmComponent", name, {}, opts);
    const defaultOpts = {
      parent: this,
    };

    // ── Availability Domain selection ──────────────────────────────────────
    // Look up all ADs for the compartment, then select by index with fallback
    // to index 0 if the specified index exceeds the available count.
    const availabilityDomains = oci.identity.getAvailabilityDomainsOutput({
      compartmentId: args.compartmentId,
    });
    const selectedAd = availabilityDomains.availabilityDomains.apply(
      (ads) => ads[args.availabilityDomainIndex]?.name ?? ads[0].name,
    );

    // ── Reserved public IPv4 placeholder ──────────────────────────────────
    // A single RESERVED PublicIp is created and immediately bound to the
    // instance's primary VNIC private IP once the instance is up.
    // (No separate "unassigned" resource — that would waste quota.)

    // ── Cloud-init user-data ───────────────────────────────────────────────
    // buildCloudInit resolves all secret Outputs via pulumi.all() and renders
    // the full cloud-init YAML. We base64-encode it for the instance metadata.
    const userData = buildCloudInit(args);

    // ── A1.Flex instance ───────────────────────────────────────────────────
    // assignPublicIp: false — we assign the reserved IP separately below.
    // Boot volume is set to exactly 50 GB (Requirement 2.3).
    const instance = new oci.core.Instance(
      `${name}-instance`,
      {
        compartmentId: args.compartmentId,
        availabilityDomain: selectedAd,
        shape: "VM.Standard.A1.Flex",
        shapeConfig: {
          ocpus: args.ocpu,
          memoryInGbs: args.memoryGb,
        },
        sourceDetails: {
          sourceType: "image",
          sourceId: args.imageOcid,
          bootVolumeSizeInGbs: "50",
        },
        createVnicDetails: {
          subnetId: args.subnetId,
          assignPublicIp: "false", // reserved IP is assigned separately
          displayName: `${name}-vnic`,
        },
        metadata: {
          ssh_authorized_keys: args.sshPublicKey,
          user_data: userData.apply((ud) => Buffer.from(ud).toString("base64")),
        },
        displayName: `${name}-instance`,
      },
      defaultOpts,
    );

    // ── Assign reserved IP to the instance's primary VNIC private IP ───────
    // Step 1: Retrieve the VNIC attachment for the instance.
    const vnicAttachments = oci.core.getVnicAttachmentsOutput({
      compartmentId: args.compartmentId,
      instanceId: instance.id,
    });
    const primaryVnicId = vnicAttachments.vnicAttachments.apply(
      (attachments) => attachments[0].vnicId,
    );

    // Step 2: Get the primary private IP of the VNIC.
    const privateIps = oci.core.getPrivateIpsOutput({
      vnicId: primaryVnicId,
    });
    const primaryPrivateIpId = privateIps.privateIps.apply((ips) => ips[0].id);

    // Step 3: Create the RESERVED PublicIp bound to the private IP.
    // retainOnDelete: if the IP resource is replaced during `pulumi up`, the old
    // OCI resource is retained (unassigned) rather than deleted, so the IP address
    // persists and can be re-bound on the next update. This prevents DNS downtime.
    const assignedIp = new oci.core.PublicIp(
      `${name}-ip-assigned`,
      {
        compartmentId: args.compartmentId,
        lifetime: "RESERVED",
        displayName: `${name}-reserved-ip`,
        privateIpId: primaryPrivateIpId,
      },
      {
        parent: this,
        dependsOn: [instance],
        retainOnDelete: true,
      },
    );

    // ── Optional block volume for Postgres data ────────────────────────────
    // Only created when enableBlockVolume is true (Requirement 2.4, 2.5).
    // Attached with paravirtualized type and in-transit encryption enabled.
    if (args.enableBlockVolume) {
      const blockVolume = new oci.core.Volume(
        `${name}-data-vol`,
        {
          compartmentId: args.compartmentId,
          availabilityDomain: selectedAd,
          displayName: `${name}-data-vol`,
          sizeInGbs: String(args.blockVolumeSizeGb),
        },
        defaultOpts,
      );

      new oci.core.VolumeAttachment(
        `${name}-vol-attach`,
        {
          attachmentType: "paravirtualized",
          instanceId: instance.id,
          volumeId: blockVolume.id,
          displayName: `${name}-vol-attach`,
          isPvEncryptionInTransitEnabled: true,
        },
        {
          parent: this,
          dependsOn: [instance, blockVolume],
        },
      );
    }

    // ── Outputs ────────────────────────────────────────────────────────────
    this.reservedIp = assignedIp.ipAddress;
    this.instanceId = instance.id;
    this.registerOutputs({
      reservedIp: this.reservedIp,
      instanceId: this.instanceId,
    });
  }
}
