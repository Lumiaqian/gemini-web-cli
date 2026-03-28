import {
  COMMAND_TREE,
  findCommandByTokens,
  getCommandTreeSnapshot,
  listCommandDefinitions,
} from '../command-tree.mjs';
import { ROUTE_ID, SCAFFOLD_VERSION } from '../route-metadata.mjs';
import { buildExitCodeError, getExitCodeEntry } from '../runtime/exit-codes.mjs';
import { CliRuntimeConfigError, loadCliRuntimeConfig, toPublicRuntimeSnapshot } from '../runtime/load-cli-config.mjs';
import { CliRuntimeFailure, createStdioRuntime } from '../runtime/stdio-runtime.mjs';
import { createBrowserLifecycleAdapter } from '../lifecycle/browser-lifecycle.mjs';
import { executeSessionTextDiagnosticCommand } from '../handlers/session-text-diagnostic-handlers.mjs';
import { executeImageMediaCommand } from '../handlers/image-media-handlers.mjs';
import { describeScaffold as describeLegacyScaffold } from './run-scaffold-command.mjs';

const IO_DEFAULTS = Object.freeze({
  stdout: process.stdout,
  stderr: process.stderr,
});

const DEFAULT_DEPENDENCIES = Object.freeze({
  browserLifecycle: createBrowserLifecycleAdapter(),
});

function generateRequestId(startedAt) {
  const compact = startedAt.toISOString().replace(/[-:.TZ]/g, '');
  return `req_${compact}_${process.pid}`;
}

function ensureNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toCommandField(tokens) {
  const cleaned = tokens
    .filter((token) => typeof token === 'string' && token.trim().length > 0)
    .map((token) => token.trim())
    .join('-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return cleaned || 'root';
}

function parseIntegerFlag(name, rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`invalid value for ${name}: ${rawValue}`);
  }
  return parsed;
}

function parseGlobalArgs(argv) {
  const options = {
    json: false,
    help: false,
    version: false,
    timeoutMs: null,
    requestId: null,
    outputDir: null,
    nonInteractive: false,
    positionals: [],
    flagPresence: {
      timeoutMs: false,
      requestId: false,
      outputDir: false,
      nonInteractive: false,
    },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--version') {
      options.version = true;
      continue;
    }
    if (token === '--non-interactive') {
      options.nonInteractive = true;
       options.flagPresence.nonInteractive = true;
      continue;
    }
    if (token === '--describe-scaffold') {
      options.positionals.push('describe-scaffold');
      continue;
    }
    if (token === '--timeout-ms') {
      const value = argv[++index];
      if (!ensureNonEmptyString(value)) {
        throw new Error('missing value for --timeout-ms');
      }
      options.timeoutMs = parseIntegerFlag('--timeout-ms', value);
      options.flagPresence.timeoutMs = true;
      continue;
    }
    if (token === '--request-id') {
      const value = argv[++index];
      if (!ensureNonEmptyString(value)) {
        throw new Error('missing value for --request-id');
      }
      options.requestId = value;
      options.flagPresence.requestId = true;
      continue;
    }
    if (token === '--output-dir') {
      const value = argv[++index];
      if (!ensureNonEmptyString(value)) {
        throw new Error('missing value for --output-dir');
      }
      options.outputDir = value;
      options.flagPresence.outputDir = true;
      continue;
    }

    options.positionals.push(token);
  }

  return options;
}

function finalizeTiming(startedAt) {
  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

function buildEnvelope({
  startedAt,
  command,
  requestId,
  exitCategory,
  timeoutMs,
  terminalState,
  cancelledBySignal,
  result,
  error,
}) {
  const exitMetadata = getExitCodeEntry(exitCategory);

  return {
    schemaVersion: 1,
    mode: 'json',
    command,
    requestId,
    ok: exitMetadata.exitCode === 0,
    exitCode: exitMetadata.exitCode,
    timing: finalizeTiming(startedAt),
    execution: {
      timeoutMs,
      terminalState,
      cancelledBySignal,
    },
    result,
    error,
  };
}

function emitJsonStaticSuccess(stdioRuntime, startedAt, runtimeLike, commandId, result) {
  const envelope = buildEnvelope({
    startedAt,
    command: commandId,
    requestId: runtimeLike.requestId ?? generateRequestId(startedAt),
    exitCategory: 'success',
    timeoutMs: runtimeLike.timeoutMs ?? null,
    terminalState: 'succeeded',
    cancelledBySignal: null,
    result,
    error: null,
  });

  stdioRuntime.emitJson(envelope);
  return envelope.exitCode;
}

function emitJsonSuccess(stdioRuntime, startedAt, runtime, commandId, result) {
  const envelope = buildEnvelope({
    startedAt,
    command: commandId,
    requestId: runtime.requestId,
    exitCategory: 'success',
    timeoutMs: runtime.config.timeoutMs,
    terminalState: 'succeeded',
    cancelledBySignal: null,
    result,
    error: null,
  });

  stdioRuntime.emitJson(envelope);
  return envelope.exitCode;
}

function emitJsonFailure(stdioRuntime, startedAt, runtimeLike, commandId, category, message, details, terminalState = 'failed', cancelledBySignal = null) {
  const envelope = buildEnvelope({
    startedAt,
    command: commandId,
    requestId: runtimeLike.requestId ?? generateRequestId(startedAt),
    exitCategory: category,
    timeoutMs: runtimeLike.timeoutMs ?? null,
    terminalState,
    cancelledBySignal,
    result: null,
    error: buildExitCodeError(category, message, details),
  });

  stdioRuntime.emitJson(envelope);
  return envelope.exitCode;
}

function detectCliName() {
  const binPath = process.argv[1];
  if (!binPath) return 'gemini-web-cli';
  const base = binPath.split('/').pop();
  if (base === 'run-cli.mjs' || base === 'run-cli') return 'node scripts/run-cli.mjs';
  return base;
}

function buildRootHelpLines() {
  const cliName = detectCliName();
  const lines = [
    `Usage: ${cliName} <group> <command> [command args] [global flags]`,
    `       ${cliName} <command-id> [command args] [global flags]`,
    `       ${cliName} describe-scaffold [--json]`,
    '',
    `Route: ${COMMAND_TREE.routeId} (daemon strategy: ${COMMAND_TREE.daemonStrategy})`,
    '',
    'Global flags:',
  ];

  for (const flag of COMMAND_TREE.globalFlags) {
    lines.push(`  ${flag.name}${flag.type === 'boolean' ? '' : ` <${flag.type}>`}  ${flag.description}`);
  }

  lines.push('', 'Commands:');

  for (const group of getCommandTreeSnapshot().groups) {
    lines.push(`  ${group.id} - ${group.title}`);
    for (const command of group.commands) {
      const aliasText = command.aliases.length > 0 ? ` (alias: ${command.aliases.join(', ')})` : '';
      const legacyText = command.legacyTool ? ` [legacy: ${command.legacyTool}]` : '';
      lines.push(`    ${command.path.join(' ')}${aliasText}${legacyText}`);
    }
  }

  lines.push('', 'Compatibility alias:', '  --describe-scaffold  Behaves like the describe-scaffold command.');

  return lines;
}

function buildCommandHelpLines(command) {
  const lines = [
    `Command: ${command.path.join(' ')}`,
    `Canonical id: ${command.id}`,
    `Implementation: ${command.implementation}`,
    `Description: ${command.description}`,
  ];

  if (command.legacyTool) {
    lines.push(`Original tool: ${command.legacyTool}`);
    lines.push(`Capability group: ${command.capabilityGroup}`);
  }

  if (command.legacyParameters.length > 0) {
    lines.push(`Legacy parameter names: ${command.legacyParameters.join(', ')}`);
  }

  return lines;
}

function buildDescribeScaffoldRuntimeResult(runtime) {
  return {
    ...describeLegacyScaffold(),
    commandTree: getCommandTreeSnapshot(),
    runtime: toPublicRuntimeSnapshot(runtime),
    scope: 'Task 7 runtime layer is active. Gemini business handlers remain scaffold placeholders until later migration tasks.',
  };
}

function buildRootHelpResult(parsed) {
  return {
    routeId: ROUTE_ID,
    scaffoldVersion: SCAFFOLD_VERSION,
    daemonStrategy: COMMAND_TREE.daemonStrategy,
    commandTree: getCommandTreeSnapshot(),
    helpLines: buildRootHelpLines(),
    executionDefaults: {
      jsonModeRequested: parsed.json,
      timeoutMs: parsed.timeoutMs,
      requestId: parsed.requestId,
      outputDir: parsed.outputDir,
      nonInteractive: parsed.nonInteractive,
    },
  };
}

function buildVersionResult() {
  return {
    routeId: ROUTE_ID,
    scaffoldVersion: SCAFFOLD_VERSION,
    daemonStrategy: COMMAND_TREE.daemonStrategy,
    versionLine: buildVersionLine(),
  };
}

function buildScaffoldPlaceholderResult(command, passthroughArgs, runtime) {
  return {
    routeId: ROUTE_ID,
    scaffoldVersion: SCAFFOLD_VERSION,
    commandId: command.id,
    commandPath: [...command.path],
    matchedBy: command.path.length === 1 ? 'path' : 'path-or-alias',
    implementation: command.implementation,
    legacyTool: command.legacyTool,
    capabilityGroup: command.capabilityGroup,
    mustHaveV1: command.mustHaveV1,
    legacyParameters: [...command.legacyParameters],
    passthroughArgs,
    runtime: toPublicRuntimeSnapshot(runtime),
    status: 'dispatch-only',
    message: 'The command tree and dispatch layer are wired, but the real Gemini handler has not been migrated yet.',
  };
}

function summarizeHumanResult(command, result) {
  switch (command.id) {
    case 'new-chat':
    case 'temp-chat':
    case 'switch-model':
    case 'send-message':
    case 'get-latest-text-response':
    case 'check-login':
    case 'reload-page':
    case 'navigate-to':
    case 'generate-image':
    case 'extract-image':
    case 'download-full-size-image':
      return result.message ?? 'ok';
    case 'upload-images':
      return `uploaded=${result.uploadedCount ?? 0}`;
    case 'get-images':
      return `images=${result.total ?? 0}`;
    case 'get-all-text-responses':
      return `responses=${result.total ?? 0}`;
    case 'probe':
      return `status=${result.pageStatus?.status ?? 'unknown'} model=${result.currentModel ?? 'unknown'}`;
    case 'browser-info':
      return `daemon=${result.daemon?.status ?? 'unknown'} ws=${result.browser?.wsEndpoint ?? 'unavailable'}`;
    default:
      return result.status ?? 'ok';
  }
}

function emitHumanHelp(stdioRuntime, lines) {
  for (const line of lines) {
    stdioRuntime.writeStdout(line);
  }
  return getExitCodeEntry('success').exitCode;
}

function emitHumanSuccess(stdioRuntime, command, result) {
  if (command.id === 'describe-scaffold') {
    stdioRuntime.writeStdout(`route=${result.routeId}`);
    stdioRuntime.writeStdout(`daemon_strategy=${result.daemonStrategy}`);
    stdioRuntime.writeStdout(`mapped_commands=${result.commandTree.parityCommandCount}`);
    stdioRuntime.writeStdout(`command_groups=${result.commandTree.groups.length}`);
    stdioRuntime.writeStdout('status=dispatch-ready');
    return getExitCodeEntry('success').exitCode;
  }

  stdioRuntime.writeStdout(`command=${command.id}`);
  stdioRuntime.writeStdout(`legacy_tool=${command.legacyTool}`);
  stdioRuntime.writeStdout(summarizeHumanResult(command, result));
  return getExitCodeEntry('success').exitCode;
}

function buildVersionLine() {
  return `${ROUTE_ID} scaffold-v${SCAFFOLD_VERSION}`;
}

function normalizeRuntimeFailure(error, runtime) {
  if (error instanceof CliRuntimeConfigError) {
    return {
      category: error.category,
      message: error.message,
      details: error.details,
      terminalState: 'failed',
      cancelledBySignal: null,
    };
  }

  if (error instanceof CliRuntimeFailure) {
    return {
      category: error.category,
      message: error.message,
      details: error.details,
      terminalState: error.terminalState,
      cancelledBySignal: error.cancelledBySignal,
    };
  }

  return {
    category: 'internal-error',
    message: error instanceof Error ? error.message : 'Unknown internal error',
    details: {
      runtime: runtime ? toPublicRuntimeSnapshot(runtime) : null,
    },
    terminalState: 'failed',
    cancelledBySignal: null,
  };
}

async function executeCommand(command, passthroughArgs, runtime, stdioRuntime, dependencies) {
  if (command.id === 'describe-scaffold') {
    return buildDescribeScaffoldRuntimeResult(runtime);
  }

  const migratedResult = await executeSessionTextDiagnosticCommand({
    command,
    passthroughArgs,
    runtime,
    stdioRuntime,
    browserLifecycle: dependencies.browserLifecycle,
  });
  if (migratedResult !== null) {
    return migratedResult;
  }

  const imageMediaResult = await executeImageMediaCommand({
    command,
    passthroughArgs,
    runtime,
    browserLifecycle: dependencies.browserLifecycle,
  });
  if (imageMediaResult !== null) {
    return imageMediaResult;
  }

  return buildScaffoldPlaceholderResult(command, passthroughArgs, runtime);
}

export async function dispatchHybridNativeCliCommand(argv, io = IO_DEFAULTS) {
  const startedAt = new Date();
  const stdioRuntime = createStdioRuntime({
    stdout: io.stdout,
    stderr: io.stderr,
    jsonMode: argv.includes('--json'),
  });
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...(io.dependencies ?? {}),
  };

  let parsed;
  try {
    parsed = parseGlobalArgs(argv);
  } catch (error) {
    const commandId = toCommandField(argv);
    if (argv.includes('--json')) {
      return emitJsonFailure(stdioRuntime, startedAt, { requestId: null, timeoutMs: null }, commandId, 'invalid-args', error.message, {
        argv,
      });
    }
    stdioRuntime.writeStderr(`ERROR: ${error.message}`);
    return getExitCodeEntry('invalid-args').exitCode;
  }

  const runtimeForVersion = parsed.flagPresence.requestId
    ? { requestId: parsed.requestId, timeoutMs: parsed.timeoutMs }
    : { requestId: generateRequestId(startedAt), timeoutMs: parsed.timeoutMs };

  if (parsed.version && parsed.positionals.length === 0 && !parsed.help) {
    if (parsed.json) {
      return emitJsonStaticSuccess(stdioRuntime, startedAt, runtimeForVersion, 'root', buildVersionResult());
    }
    stdioRuntime.writeStdout(buildVersionLine());
    return getExitCodeEntry('success').exitCode;
  }

  if (parsed.positionals.length === 0) {
    if (parsed.json) {
      return emitJsonStaticSuccess(stdioRuntime, startedAt, runtimeForVersion, 'root', buildRootHelpResult(parsed));
    }
    return emitHumanHelp(stdioRuntime, buildRootHelpLines());
  }

  const resolution = findCommandByTokens(parsed.positionals);

  if (!resolution) {
    const attemptedTokens = [...parsed.positionals];
    const attemptedCommand = toCommandField(attemptedTokens);
    const details = {
      attemptedTokens,
      availableCommands: listCommandDefinitions().filter((command) => command.mustHaveV1).length,
      routeId: COMMAND_TREE.routeId,
    };

    if (parsed.json) {
      return emitJsonFailure(
        stdioRuntime,
        startedAt,
        runtimeForVersion,
        attemptedCommand,
        'invalid-args',
        `Unknown command: ${attemptedTokens.join(' ')}`,
        details,
      );
    }

    stdioRuntime.writeStderr(`ERROR: Unknown command: ${attemptedTokens.join(' ')}`);
    return getExitCodeEntry('invalid-args').exitCode;
  }

  const { command, consumedTokens } = resolution;
  const passthroughArgs = parsed.positionals.slice(consumedTokens);

  if (parsed.help) {
    return emitHumanHelp(stdioRuntime, buildCommandHelpLines(command));
  }

  let runtime;
  try {
    runtime = loadCliRuntimeConfig({
      commandId: command.id,
      parsedArgs: parsed,
      startedAt,
    });
  } catch (error) {
    const failure = normalizeRuntimeFailure(error, null);
    if (parsed.json) {
      if (failure.details?.runtime?.config?.browserPath) {
        stdioRuntime.writeStderr(`[runtime] ${failure.message}`);
      }
      return emitJsonFailure(
        stdioRuntime,
        startedAt,
        {
          requestId: failure.details?.runtime?.requestId ?? runtimeForVersion.requestId,
          timeoutMs: failure.details?.runtime?.config?.timeoutMs ?? runtimeForVersion.timeoutMs,
        },
        command.id,
        failure.category,
        failure.message,
        failure.details,
        failure.terminalState,
        failure.cancelledBySignal,
      );
    }

    stdioRuntime.writeStderr(`ERROR: ${failure.message}`);
    return getExitCodeEntry(failure.category).exitCode;
  }

  let result;
  try {
    result = await stdioRuntime.runCommand(
      () => executeCommand(command, passthroughArgs, runtime, stdioRuntime, dependencies),
      { timeoutMs: runtime.config.timeoutMs }
    );
  } catch (error) {
    const failure = normalizeRuntimeFailure(error, runtime);
    if (parsed.json) {
      return emitJsonFailure(
        stdioRuntime,
        startedAt,
        { requestId: runtime.requestId, timeoutMs: runtime.config.timeoutMs },
        command.id,
        failure.category,
        failure.message,
        failure.details,
        failure.terminalState,
        failure.cancelledBySignal,
      );
    }

    stdioRuntime.writeStderr(`ERROR: ${failure.message}`);
    return getExitCodeEntry(failure.category).exitCode;
  }

  if (parsed.json) {
    return emitJsonSuccess(stdioRuntime, startedAt, runtime, command.id, result);
  }

  return emitHumanSuccess(stdioRuntime, command, result);
}
