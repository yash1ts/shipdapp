/**
 * Generates an Akash SDL (Stack Definition Language) YAML file
 * for deploying a Docker container to Akash Sandbox-2 by default (hackathon); see sdk/src/constants.ts.
 */
export function generateSDL(
  dockerImage: string,
  appName: string,
  port: number = 3000,
  cpu: number = 0.5,
  memory: string = "512Mi",
  storage: string = "1Gi"
): string {
  const sanitizedName = appName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 40);

  return `---
version: "2.0"

services:
  ${sanitizedName}:
    image: ${dockerImage}
    expose:
      - port: ${port}
        as: 80
        to:
          - global: true

profiles:
  compute:
    ${sanitizedName}:
      resources:
        cpu:
          units: ${cpu}
        memory:
          size: ${memory}
        storage:
          size: ${storage}
  placement:
    dcloud:
      pricing:
        ${sanitizedName}:
          denom: uact
          amount: 1000

deployment:
  ${sanitizedName}:
    dcloud:
      profile: ${sanitizedName}
      count: 1
`;
}

/**
 * Generates a more resource-heavy SDL for apps that need it.
 */
export function generateSDLPro(
  dockerImage: string,
  appName: string,
  opts: {
    port?: number;
    cpu?: number;
    memory?: string;
    storage?: string;
    envVars?: Record<string, string>;
  } = {}
): string {
  const {
    port = 3000,
    cpu = 1,
    memory = "1Gi",
    storage = "5Gi",
    envVars = {},
  } = opts;

  const sanitizedName = appName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 40);

  const envBlock =
    Object.keys(envVars).length > 0
      ? `    env:\n${Object.entries(envVars)
          .map(([k, v]) => `      - ${k}=${v}`)
          .join("\n")}`
      : "";

  return `---
version: "2.0"

services:
  ${sanitizedName}:
    image: ${dockerImage}
${envBlock}
    expose:
      - port: ${port}
        as: 80
        to:
          - global: true

profiles:
  compute:
    ${sanitizedName}:
      resources:
        cpu:
          units: ${cpu}
        memory:
          size: ${memory}
        storage:
          size: ${storage}
  placement:
    dcloud:
      pricing:
        ${sanitizedName}:
          denom: uact
          amount: 5000

deployment:
  ${sanitizedName}:
    dcloud:
      profile: ${sanitizedName}
      count: 1
`;
}
