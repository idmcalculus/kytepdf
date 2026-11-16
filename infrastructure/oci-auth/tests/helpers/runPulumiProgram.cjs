// Run the Pulumi program (index.ts) the way `pulumi up` loads it, with mocked
// resources instead of a Pulumi engine and OCI credentials.
//
// The ts-node setup copies the CommonJS branch of
// node_modules/@pulumi/pulumi/cmd/run/run.js and uses Pulumi's own tsutils, so
// it picks the same ts-node (the vendored 7.0.1 unless the project installs one)
// and the same compiler options. Vitest cannot catch loader problems itself
// because Vite maps "./x.js" imports to "./x.ts"; CommonJS does not.
//
// Run with cwd set to infrastructure/oci-auth and stack config in PULUMI_CONFIG.
// Prints one JSON line: { ok: true, resources } or { ok: false, error }.

const path = require("node:path");

const projectDir = process.cwd();
const fromProject = (id) => require.resolve(id, { paths: [projectDir] });

let finished = false;
function finish(result) {
  if (finished) return;
  finished = true;
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}
function fail(err) {
  finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

// ── ts-node registration, as in run.js (non-ESM branch) ──────────────────────
const pulumiDir = path.dirname(fromProject("@pulumi/pulumi/package.json"));
const fromPulumi = (id) => (path.isAbsolute(id) ? id : require.resolve(id, { paths: [pulumiDir] }));
const tsutils = require(path.join(pulumiDir, "tsutils"));
const semver = require(fromPulumi("semver"));
const tsConfigPath = "tsconfig.json";
const compilerOptions = tsutils.loadTypeScriptCompilerOptions(tsConfigPath);
const { tsnodeRequire, typescriptRequire } = tsutils.typeScriptRequireStrings();
const ts = require(fromPulumi(typescriptRequire));
const tsVersion = semver.parse(ts.version);
const useNodeNext = tsVersion && tsVersion.compare(new semver.SemVer("4.7.0")) >= 0;
require(fromPulumi(tsnodeRequire)).register({
  compiler: typescriptRequire,
  transpileOnly: compilerOptions.noCheck,
  project: tsConfigPath,
  skipProject: false,
  compilerOptions: {
    target: "ES2020",
    module: useNodeNext ? "nodenext" : "commonjs",
    moduleResolution: useNodeNext ? "nodenext" : "node",
    sourceMap: "true",
    ...compilerOptions,
  },
});

// ── Mocked engine ────────────────────────────────────────────────────────────
const pulumi = require(fromProject("@pulumi/pulumi"));
const resources = [];

// Mocks receive secret inputs wrapped as { [sig]: secretSig, value }. Unwrap
// them so the test can read user_data.
const { specialSigKey, specialSecretSig } = pulumi.runtime;
function unwrapSecrets(value) {
  if (Array.isArray(value)) return value.map(unwrapSecrets);
  if (value && typeof value === "object") {
    if (value[specialSigKey] === specialSecretSig) return unwrapSecrets(value.value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrapSecrets(v)]));
  }
  return value;
}

pulumi.runtime.setMocks(
  {
    newResource: (args) => {
      resources.push({ type: args.type, name: args.name, inputs: unwrapSecrets(args.inputs) });
      const state = { ...args.inputs, ipAddress: "192.0.2.10" };
      if (args.type === "random:index/randomPassword:RandomPassword") {
        state.result = "x".repeat(args.inputs.length ?? 32);
      }
      return { id: `${args.name}-id`, state };
    },
    call: (args) => {
      if (args.token.includes("getAvailabilityDomains")) {
        return { availabilityDomains: [{ name: "AD-1" }] };
      }
      if (args.token.includes("getImages")) return { images: [{ id: "ocid1.image.test" }] };
      if (args.token.includes("getVnicAttachments")) {
        return { vnicAttachments: [{ vnicId: "ocid1.vnic.test" }] };
      }
      if (args.token.includes("getPrivateIps"))
        return { privateIps: [{ id: "ocid1.privateip.test" }] };
      return {};
    },
  },
  "oci-auth-hosting",
  "loader-test",
  false,
);

// run.js requires the program directory; Node then finds index.ts through
// the ".ts" extension ts-node registered.
let program;
try {
  program = require(`${projectDir}${path.sep}`);
} catch (err) {
  fail(err);
}

if (program) {
  pulumi.all([program.instanceId, program.reservedIp]).apply(() => {
    // Let resources registered in the same turn reach the mock.
    setImmediate(() => finish({ ok: true, resources }));
  });
}
