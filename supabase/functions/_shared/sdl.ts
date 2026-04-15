/**
 * Standard web-app SDL for hackathon demos (Akash SDL v2, Sandbox-2 / `generateManifest` "sandbox").
 * Placement pricing uses **uact** (compute escrow on the playground), aligned with `akashDepositUact`.
 *
 * Placement deliberately has **no** `signedBy` or `attributes` filters so any provider that bids
 * can win; narrow the winner with `createDeploymentAndLease` env (e.g. `AKASH_EXCLUDE_PROVIDERS`).
 */
export function buildStandardWebAppSdl(
  dockerImage: string,
  opts: { serviceName?: string; internalPort?: number } = {}
): string {
  const service = (opts.serviceName ?? "web")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 40);
  const port = opts.internalPort ?? 80;

  return `---
version: "2.0"

services:
  ${service}:
    image: ${dockerImage}
    expose:
      - port: ${port}
        as: 80
        to:
          - global: true

profiles:
  compute:
    ${service}:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 512Mi
        storage:
          size: 512Mi
  placement:
    dcloud:
      pricing:
        ${service}:
          denom: uact
          amount: 1000

deployment:
  ${service}:
    dcloud:
      profile: ${service}
      count: 1
`;
}
