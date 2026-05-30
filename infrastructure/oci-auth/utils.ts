// utils.ts
import * as oci from "@pulumi/oci";
import type * as pulumi from "@pulumi/pulumi";

/**
 * Look up the latest Ubuntu 24.04 (Noble Numbat) ARM64 image for VM.Standard.A1.Flex.
 * Returns the image OCID as an Output<string>.
 *
 * Queries OCI images for "Canonical Ubuntu" 24.04 compatible with VM.Standard.A1.Flex,
 * sorted by TIMECREATED DESC, and returns the first result's OCID.
 *
 * @throws Error if no compatible image is found in the compartment/region.
 */
export function lookupUbuntu2404Arm64(compartmentId: string): pulumi.Output<string> {
  const images = oci.core.getImagesOutput({
    compartmentId,
    operatingSystem: "Canonical Ubuntu",
    operatingSystemVersion: "24.04",
    shape: "VM.Standard.A1.Flex",
    sortBy: "TIMECREATED",
    sortOrder: "DESC",
  });

  return images.images.apply((imgs) => {
    if (imgs.length === 0) {
      throw new Error(
        "No Ubuntu 24.04 ARM64 image found for VM.Standard.A1.Flex in this compartment/region. " +
          "Set 'imageOcid' in Pulumi config to override.",
      );
    }
    return imgs[0].id;
  });
}
