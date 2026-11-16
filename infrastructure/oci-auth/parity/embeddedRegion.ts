/**
 * Embedded_Deployable_Unit region extractor and stripper.
 *
 * The OCI_Deployment rendered cloud-init contains two `write_files` blocks that
 * carry the verbatim contents of `auth-server/package.json` and
 * `auth-server/package-lock.json`. Those two blocks are
 * **Auth_Server's own content carried opaquely** — they are NOT authored by the
 * OCI_Deployment — so they must be excluded before any Direct_Reference scan.
 *
 * `stripEmbeddedDeployableUnit` removes exactly those two blocks and replaces
 * each with a neutral placeholder, leaving every other block intact so that
 * references placed outside the exact embedded paths are still caught.
 *
 * Requirements: 2.1, 3.1, 3.7
 */

/**
 * The exact two `write_files` paths that constitute the Embedded_Deployable_Unit.
 * Only blocks whose `path:` value is an exact member of this set are stripped.
 */
export const EMBEDDED_UNIT_PATHS = [
  "/opt/auth/app/package.json",
  "/opt/auth/app/package-lock.json",
] as const;

/**
 * The neutral placeholder substituted for each stripped block.
 * It preserves a single YAML list entry so surrounding structure and
 * approximate line accounting are maintained.
 */
const PLACEHOLDER_SUFFIX = "- path: [EMBEDDED_DEPLOYABLE_UNIT_EXCLUDED]";

/**
 * Remove exactly the two Embedded_Deployable_Unit `write_files` blocks
 * (matched by their exact `path:` value) from rendered cloud-init, replacing
 * each with a neutral placeholder so the surrounding YAML structure and line
 * accounting are preserved. Everything else — including any other `write_files`
 * block — is left intact and will still be scanned.
 *
 * Returns the OCI_Deployment_Authored_Content view of the render. Only blocks
 * whose path is an exact member of `EMBEDDED_UNIT_PATHS` are stripped; a block
 * with any other path (even a look-alike) is NOT stripped, so a reference
 * cannot be smuggled by mislabelling a block (R3.7 anti-abuse).
 *
 * Algorithm:
 *   1. Split the content into lines.
 *   2. Walk the lines looking for YAML list entries of the form
 *      `<indent>- path: <value>` (arbitrary leading whitespace).
 *   3. When the path value is an exact member of EMBEDDED_UNIT_PATHS, record
 *      the start of that block.
 *   4. The block spans from its opening `- path:` line through to (but not
 *      including) the next `- path:` line at the same or lesser indentation,
 *      or the end of the string — whichever comes first.
 *   5. Replace the entire block with a single placeholder line that preserves
 *      the original list-entry indentation.
 */
export function stripEmbeddedDeployableUnit(renderedCloudInit: string): string {
  const lines = renderedCloudInit.split("\n");
  const result: string[] = [];

  // Regex matching a YAML list entry that opens a write_files block.
  // Captures: (1) leading whitespace/indent, (2) the path value.
  const pathLineRe = /^(\s*)- path:\s*(.+?)\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = pathLineRe.exec(line);

    if (m !== null) {
      const indent = m[1];
      const pathValue = m[2];

      // Check whether this is one of the two exact embedded-unit paths.
      const isEmbedded = (EMBEDDED_UNIT_PATHS as readonly string[]).includes(pathValue);

      if (isEmbedded) {
        // Determine the indentation depth of this block opener so we know
        // when the next sibling list entry starts.
        const blockIndentLen = indent.length;

        // Emit the placeholder instead of the real block opener.
        result.push(`${indent}${PLACEHOLDER_SUFFIX}`);

        // Skip all lines that belong to this block (i.e. until we hit the
        // next `- path:` entry at an indentation level <= the block opener,
        // or reach the end of the lines).
        i += 1;
        while (i < lines.length) {
          const inner = lines[i];
          const innerMatch = pathLineRe.exec(inner);
          if (innerMatch !== null) {
            // Another list entry. Check its indentation to decide if it is a
            // sibling (same or shallower indent) that terminates the current
            // block, or a deeper nested entry that still belongs to this block.
            const innerIndentLen = innerMatch[1].length;
            if (innerIndentLen <= blockIndentLen) {
              // Sibling or parent — stop consuming the block; the outer loop
              // will process this line on the next iteration.
              break;
            }
          }
          // This line still belongs to the stripped block — skip it.
          i += 1;
        }
        // Do NOT increment i here; the outer while will re-examine lines[i].
        continue;
      }
    }

    // Not an embedded block opener — emit the line verbatim.
    result.push(line);
    i += 1;
  }

  return result.join("\n");
}
