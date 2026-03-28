import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(RUNTIME_DIR, '../../../../');

const ENV_FILE_DEVELOPMENT = path.join(PROJECT_ROOT, '.env.development');
const ENV_FILE_BASE = path.join(PROJECT_ROOT, '.env');

const DEFAULTS = Object.freeze({
  browserPath: null,
  browserDebugPort: 40821,
  browserUserDataDir: null,
  browserHeadless: false,
  browserProtocolTimeout: 60_000,
  outputDir: path.join(PROJECT_ROOT, 'gemini-image'),
  daemonPort: 40225,
  daemonTTL: 30 * 60 * 1000,
  timeoutMs: null,
  nonInteractive: false,
});

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

const fileEnvDevelopment = Object.freeze(parseEnvFile(ENV_FILE_DEVELOPMENT));
const fileEnvBase = Object.freeze(parseEnvFile(ENV_FILE_BASE));

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (!hasText(value)) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return null;
}

function normalizeOptionalString(value) {
  return hasText(value) ? value : null;
}

function generateRequestId(startedAt, pid) {
  const compact = startedAt.toISOString().replace(/[-:.TZ]/g, '');
  return `req_${compact}_${pid}`;
}

function resolveConfigTierValue(envKey, parser, fallbackValue) {
  const devValue = parser(fileEnvDevelopment[envKey]);
  if (devValue !== null) {
    return {
      value: devValue,
      source: `.env.development:${envKey}`,
    };
  }

  const baseValue = parser(fileEnvBase[envKey]);
  if (baseValue !== null) {
    return {
      value: baseValue,
      source: `.env:${envKey}`,
    };
  }

  return {
    value: fallbackValue,
    source: 'default',
  };
}

function resolveRuntimeValue({ flagEnabled, flagValue, flagSource, env, envKeys, parser, configValue, configSource, fallbackValue, fallbackSource }) {
  if (flagEnabled) {
    return {
      value: flagValue,
      source: flagSource,
    };
  }

  for (const envKey of envKeys) {
    const envValue = parser(env[envKey]);
    if (envValue !== null) {
      return {
        value: envValue,
        source: `env:${envKey}`,
      };
    }
  }

  if (configSource !== null) {
    return {
      value: configValue,
      source: configSource,
    };
  }

  return {
    value: fallbackValue,
    source: fallbackSource,
  };
}

function buildConfigDefaults() {
  const browserPath = resolveConfigTierValue('BROWSER_PATH', normalizeOptionalString, DEFAULTS.browserPath);
  const browserDebugPort = resolveConfigTierValue('BROWSER_DEBUG_PORT', parseInteger, DEFAULTS.browserDebugPort);
  const browserUserDataDir = resolveConfigTierValue('BROWSER_USER_DATA_DIR', normalizeOptionalString, DEFAULTS.browserUserDataDir);
  const browserHeadless = resolveConfigTierValue('BROWSER_HEADLESS', parseBoolean, DEFAULTS.browserHeadless);
  const browserProtocolTimeout = resolveConfigTierValue('BROWSER_PROTOCOL_TIMEOUT', parseInteger, DEFAULTS.browserProtocolTimeout);
  const outputDir = resolveConfigTierValue('OUTPUT_DIR', normalizeOptionalString, DEFAULTS.outputDir);
  const daemonPort = resolveConfigTierValue('DAEMON_PORT', parseInteger, DEFAULTS.daemonPort);
  const daemonTTL = resolveConfigTierValue('DAEMON_TTL_MS', parseInteger, DEFAULTS.daemonTTL);

  return Object.freeze({
    browserPath,
    browserDebugPort,
    browserUserDataDir,
    browserHeadless,
    browserProtocolTimeout,
    outputDir,
    daemonPort,
    daemonTTL,
  });
}

const CONFIG_DEFAULTS = buildConfigDefaults();

export class CliRuntimeConfigError extends Error {
  constructor({ category, message, details }) {
    super(message);
    this.name = 'CliRuntimeConfigError';
    this.category = category;
    this.details = details;
  }
}

export function toPublicRuntimeSnapshot(runtime) {
  return {
    requestId: runtime.requestId,
    commandId: runtime.commandId,
    jsonMode: runtime.jsonMode,
    nonInteractive: runtime.nonInteractive,
    config: {
      browserPath: runtime.config.browserPath,
      browserPathResolved: runtime.config.browserPathResolved,
      browserDebugPort: runtime.config.browserDebugPort,
      browserHeadless: runtime.config.browserHeadless,
      browserProtocolTimeout: runtime.config.browserProtocolTimeout,
      browserUserDataDir: runtime.config.browserUserDataDir,
      outputDir: runtime.config.outputDir,
      outputDirResolved: runtime.config.outputDirResolved,
      daemonPort: runtime.config.daemonPort,
      daemonTTL: runtime.config.daemonTTL,
      daemonBaseUrl: runtime.config.daemonBaseUrl,
      timeoutMs: runtime.config.timeoutMs,
    },
    precedence: { ...runtime.precedence },
    configBaseline: {
      rule: 'flag > env > .env.development > .env > default',
      routeConfig: 'hybrid-native-cli-node-core mirrors src/config.js semantics locally so runtime precedence stays deterministic.',
    },
  };
}

function validateRuntimeConfig(runtime) {
  const runtimeSnapshot = toPublicRuntimeSnapshot(runtime);

  if (runtime.config.browserPath !== null) {
    if (!existsSync(runtime.config.browserPathResolved)) {
      throw new CliRuntimeConfigError({
        category: 'browser-startup-failure',
        message: `Configured browser path does not exist: ${runtime.config.browserPath}`,
        details: {
          reason: 'browser-path-missing',
          browserPath: runtime.config.browserPath,
          runtime: runtimeSnapshot,
        },
      });
    }

    if (!statSync(runtime.config.browserPathResolved).isFile()) {
      throw new CliRuntimeConfigError({
        category: 'browser-startup-failure',
        message: `Configured browser path is not a file: ${runtime.config.browserPath}`,
        details: {
          reason: 'browser-path-not-file',
          browserPath: runtime.config.browserPath,
          runtime: runtimeSnapshot,
        },
      });
    }
  }

  if (existsSync(runtime.config.outputDir) && !statSync(runtime.config.outputDir).isDirectory()) {
    throw new CliRuntimeConfigError({
      category: 'invalid-args',
      message: `Configured output directory is not a directory: ${runtime.config.outputDir}`,
      details: {
        reason: 'output-dir-not-directory',
        outputDir: runtime.config.outputDir,
        runtime: runtimeSnapshot,
      },
    });
  }
}

export function loadCliRuntimeConfig({ commandId, parsedArgs, startedAt, env = process.env, pid = process.pid, cwd = process.cwd() }) {
  const browserPath = resolveRuntimeValue({
    flagEnabled: false,
    flagValue: null,
    flagSource: null,
    env,
    envKeys: ['BROWSER_PATH'],
    parser: normalizeOptionalString,
    configValue: CONFIG_DEFAULTS.browserPath.value,
    configSource: CONFIG_DEFAULTS.browserPath.source,
    fallbackValue: null,
    fallbackSource: 'default',
  });
  const outputDir = resolveRuntimeValue({
    flagEnabled: parsedArgs.flagPresence.outputDir,
    flagValue: parsedArgs.outputDir,
    flagSource: 'flag:--output-dir',
    env,
    envKeys: ['OUTPUT_DIR'],
    parser: normalizeOptionalString,
    configValue: CONFIG_DEFAULTS.outputDir.value,
    configSource: CONFIG_DEFAULTS.outputDir.source,
    fallbackValue: DEFAULTS.outputDir,
    fallbackSource: 'default',
  });
  const timeoutMs = resolveRuntimeValue({
    flagEnabled: parsedArgs.flagPresence.timeoutMs,
    flagValue: parsedArgs.timeoutMs,
    flagSource: 'flag:--timeout-ms',
    env,
    envKeys: ['CLI_TIMEOUT_MS'],
    parser: parseInteger,
    configValue: null,
    configSource: null,
    fallbackValue: DEFAULTS.timeoutMs,
    fallbackSource: 'default',
  });
  const requestId = resolveRuntimeValue({
    flagEnabled: parsedArgs.flagPresence.requestId,
    flagValue: parsedArgs.requestId,
    flagSource: 'flag:--request-id',
    env,
    envKeys: ['CLI_REQUEST_ID'],
    parser: normalizeOptionalString,
    configValue: null,
    configSource: null,
    fallbackValue: generateRequestId(startedAt, pid),
    fallbackSource: 'generated',
  });
  const nonInteractive = resolveRuntimeValue({
    flagEnabled: parsedArgs.flagPresence.nonInteractive,
    flagValue: parsedArgs.nonInteractive,
    flagSource: 'flag:--non-interactive',
    env,
    envKeys: ['CLI_NON_INTERACTIVE', 'CI'],
    parser: parseBoolean,
    configValue: DEFAULTS.nonInteractive,
    configSource: 'default',
    fallbackValue: DEFAULTS.nonInteractive,
    fallbackSource: 'default',
  });
  const browserDebugPort = resolveRuntimeValue({
    flagEnabled: false,
    flagValue: null,
    flagSource: null,
    env,
    envKeys: ['BROWSER_DEBUG_PORT'],
    parser: parseInteger,
    configValue: CONFIG_DEFAULTS.browserDebugPort.value,
    configSource: CONFIG_DEFAULTS.browserDebugPort.source,
    fallbackValue: DEFAULTS.browserDebugPort,
    fallbackSource: 'default',
  });
  const browserUserDataDir = resolveRuntimeValue({
    flagEnabled: false,
    flagValue: null,
    flagSource: null,
    env,
    envKeys: ['BROWSER_USER_DATA_DIR'],
    parser: normalizeOptionalString,
    configValue: CONFIG_DEFAULTS.browserUserDataDir.value,
    configSource: CONFIG_DEFAULTS.browserUserDataDir.source,
    fallbackValue: DEFAULTS.browserUserDataDir,
    fallbackSource: 'default',
  });
  const browserHeadless = resolveRuntimeValue({
    flagEnabled: false,
    flagValue: null,
    flagSource: null,
    env,
    envKeys: ['BROWSER_HEADLESS'],
    parser: parseBoolean,
    configValue: CONFIG_DEFAULTS.browserHeadless.value,
    configSource: CONFIG_DEFAULTS.browserHeadless.source,
    fallbackValue: DEFAULTS.browserHeadless,
    fallbackSource: 'default',
  });
  const browserProtocolTimeout = resolveRuntimeValue({
    flagEnabled: false,
    flagValue: null,
    flagSource: null,
    env,
    envKeys: ['BROWSER_PROTOCOL_TIMEOUT'],
    parser: parseInteger,
    configValue: CONFIG_DEFAULTS.browserProtocolTimeout.value,
    configSource: CONFIG_DEFAULTS.browserProtocolTimeout.source,
    fallbackValue: DEFAULTS.browserProtocolTimeout,
    fallbackSource: 'default',
  });
  const daemonPort = resolveRuntimeValue({
    flagEnabled: false,
    flagValue: null,
    flagSource: null,
    env,
    envKeys: ['DAEMON_PORT'],
    parser: parseInteger,
    configValue: CONFIG_DEFAULTS.daemonPort.value,
    configSource: CONFIG_DEFAULTS.daemonPort.source,
    fallbackValue: DEFAULTS.daemonPort,
    fallbackSource: 'default',
  });
  const daemonTTL = resolveRuntimeValue({
    flagEnabled: false,
    flagValue: null,
    flagSource: null,
    env,
    envKeys: ['DAEMON_TTL_MS'],
    parser: parseInteger,
    configValue: CONFIG_DEFAULTS.daemonTTL.value,
    configSource: CONFIG_DEFAULTS.daemonTTL.source,
    fallbackValue: DEFAULTS.daemonTTL,
    fallbackSource: 'default',
  });

  const runtime = {
    commandId,
    jsonMode: parsedArgs.json,
    requestId: requestId.value,
    nonInteractive: nonInteractive.value,
    precedence: Object.freeze({
      browserPath: browserPath.source,
      outputDir: outputDir.source,
      timeoutMs: timeoutMs.source,
      requestId: requestId.source,
      nonInteractive: nonInteractive.source,
    }),
    config: Object.freeze({
      browserPath: browserPath.value,
      browserPathResolved: browserPath.value === null ? null : path.resolve(cwd, browserPath.value),
      browserDebugPort: browserDebugPort.value,
      browserUserDataDir: browserUserDataDir.value,
      browserHeadless: browserHeadless.value,
      browserProtocolTimeout: browserProtocolTimeout.value,
      outputDir: outputDir.value,
      outputDirResolved: path.resolve(cwd, outputDir.value),
      daemonPort: daemonPort.value,
      daemonTTL: daemonTTL.value,
      daemonBaseUrl: `http://127.0.0.1:${daemonPort.value}`,
      timeoutMs: timeoutMs.value,
    }),
  };

  validateRuntimeConfig(runtime);

  return runtime;
}
