const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function substituteEnv(value: string): string {
  return value.replace(ENV_PATTERN, (_match, name) => {
    const envValue = process.env[name];
    if (envValue === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return envValue;
  });
}

export function substituteEnvInYaml(content: string): string {
  return substituteEnv(content);
}
