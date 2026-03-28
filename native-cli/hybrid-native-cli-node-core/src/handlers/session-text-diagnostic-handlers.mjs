import { ROUTE_ID, SCAFFOLD_VERSION } from '../route-metadata.mjs';
import { toPublicRuntimeSnapshot } from '../runtime/load-cli-config.mjs';
import { CliRuntimeFailure } from '../runtime/stdio-runtime.mjs';

const HANDLED_COMMAND_IDS = new Set([
  'new-chat',
  'temp-chat',
  'switch-model',
  'send-message',
  'get-all-text-responses',
  'get-latest-text-response',
  'check-login',
  'probe',
  'reload-page',
  'navigate-to',
  'browser-info',
]);

const MODEL_CHOICES = new Set(['pro', 'quick', 'think']);

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toRuntimeSnapshot(runtime) {
  return toPublicRuntimeSnapshot(runtime);
}

function buildBaseResult(commandId, payload = {}) {
  return {
    routeId: ROUTE_ID,
    scaffoldVersion: SCAFFOLD_VERSION,
    commandId,
    ...payload,
  };
}

function buildSessionMetadata(session) {
  return {
    reused: Boolean(session?.reused),
    staleSessionReplaced: Boolean(session?.staleSessionReplaced),
    daemonStrategy: session?.daemonStrategy ?? 'keep',
  };
}

function buildSessionResult(commandId, session, payload = {}) {
  return buildBaseResult(commandId, {
    session: buildSessionMetadata(session),
    ...payload,
  });
}

function throwCommandFailure({
  runtime,
  commandId,
  category,
  message,
  reason,
  phase = 'command-handler',
  cause = null,
  details = null,
  terminalState = 'failed',
}) {
  throw new CliRuntimeFailure({
    category,
    message,
    terminalState,
    details: {
      commandId,
      reason,
      phase,
      cause,
      runtime: toRuntimeSnapshot(runtime),
      ...(details ?? {}),
    },
  });
}

function parseIntegerFlag(flagName, rawValue, { allowZero = true } = {}) {
  const parsed = Number.parseInt(rawValue, 10);
  const valid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    throw new Error(`invalid value for ${flagName}: ${rawValue}`);
  }
  return parsed;
}

function collectCommandArgs(tokens, allowedFlags) {
  const values = new Map();
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--') {
      positionals.push(...tokens.slice(index + 1));
      break;
    }

    if (token.startsWith('--')) {
      const eqIndex = token.indexOf('=');
      const flagName = eqIndex === -1 ? token : token.slice(0, eqIndex);
      if (!allowedFlags.has(flagName)) {
        throw new Error(`unknown argument: ${token}`);
      }

      const rawValue = eqIndex === -1 ? tokens[++index] : token.slice(eqIndex + 1);
      if (!hasText(rawValue)) {
        throw new Error(`missing value for ${flagName}`);
      }
      values.set(flagName, rawValue);
      continue;
    }

    positionals.push(token);
  }

  return { values, positionals };
}

function parseNoArgCommand(tokens) {
  if (tokens.length > 0) {
    throw new Error(`unexpected arguments: ${tokens.join(' ')}`);
  }
  return Object.freeze({});
}

function parseSwitchModelArgs(tokens) {
  const { values, positionals } = collectCommandArgs(tokens, new Set(['--model']));
  if (values.has('--model') && positionals.length > 0) {
    throw new Error('model must be provided either as --model <value> or as one positional argument');
  }

  const model = values.get('--model') ?? (positionals.length === 1 ? positionals[0] : null);
  if (!hasText(model)) {
    throw new Error('missing required argument: --model <pro|quick|think>');
  }
  if (positionals.length > 1) {
    throw new Error(`unexpected arguments: ${positionals.slice(1).join(' ')}`);
  }

  return Object.freeze({ model: model.trim().toLowerCase() });
}

function parseSendMessageArgs(tokens) {
  const { values, positionals } = collectCommandArgs(tokens, new Set(['--message', '--timeout']));
  if (values.has('--message') && positionals.length > 0) {
    throw new Error('message must be provided either as --message <text> or as positional text');
  }

  const message = values.get('--message') ?? (positionals.length > 0 ? positionals.join(' ') : null);
  if (!hasText(message)) {
    throw new Error('missing required argument: --message <text>');
  }

  return Object.freeze({
    message,
    timeoutMs: values.has('--timeout') ? parseIntegerFlag('--timeout', values.get('--timeout')) : null,
  });
}

function parseTimeoutOnlyArgs(tokens) {
  const { values, positionals } = collectCommandArgs(tokens, new Set(['--timeout']));
  if (positionals.length > 0) {
    throw new Error(`unexpected arguments: ${positionals.join(' ')}`);
  }

  return Object.freeze({
    timeoutMs: values.has('--timeout') ? parseIntegerFlag('--timeout', values.get('--timeout')) : null,
  });
}

function parseNavigateArgs(tokens) {
  const { values, positionals } = collectCommandArgs(tokens, new Set(['--url', '--timeout']));
  if (values.has('--url') && positionals.length > 0) {
    throw new Error('url must be provided either as --url <value> or as one positional argument');
  }

  const url = values.get('--url') ?? (positionals.length === 1 ? positionals[0] : null);
  if (!hasText(url)) {
    throw new Error('missing required argument: --url <gemini-url>');
  }
  if (positionals.length > 1) {
    throw new Error(`unexpected arguments: ${positionals.slice(1).join(' ')}`);
  }

  return Object.freeze({
    url,
    timeoutMs: values.has('--timeout') ? parseIntegerFlag('--timeout', values.get('--timeout')) : null,
  });
}

function parseCommandArgs(commandId, passthroughArgs) {
  switch (commandId) {
    case 'new-chat':
    case 'temp-chat':
    case 'get-all-text-responses':
    case 'get-latest-text-response':
    case 'check-login':
    case 'probe':
    case 'browser-info':
      return parseNoArgCommand(passthroughArgs);
    case 'switch-model':
      return parseSwitchModelArgs(passthroughArgs);
    case 'send-message':
      return parseSendMessageArgs(passthroughArgs);
    case 'reload-page':
      return parseTimeoutOnlyArgs(passthroughArgs);
    case 'navigate-to':
      return parseNavigateArgs(passthroughArgs);
    default:
      return null;
  }
}

function resolveCommandTimeout(runtime, requestedTimeoutMs, fallbackTimeoutMs) {
  if (Number.isInteger(requestedTimeoutMs)) {
    return requestedTimeoutMs;
  }
  if (Number.isInteger(runtime?.config?.timeoutMs)) {
    return runtime.config.timeoutMs;
  }
  return fallbackTimeoutMs;
}

function isTimeoutLike(detail) {
  return typeof detail === 'string' && /timeout/i.test(detail);
}

function ensureAllowedGeminiUrl(url, runtime, commandId) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: `Invalid URL: ${url}`,
      reason: 'invalid-url',
      cause: error.message,
      details: { url },
    });
  }

  if (parsed.hostname !== 'gemini.google.com') {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: `Only gemini.google.com URLs are allowed, received: ${parsed.hostname}`,
      reason: 'invalid-domain',
      details: {
        url,
        hostname: parsed.hostname,
        allowedHostnames: ['gemini.google.com'],
      },
    });
  }

  return parsed;
}

function throwSelectorFailure(runtime, commandId, message, reason, details = null) {
  throwCommandFailure({
    runtime,
    commandId,
    category: 'selector-failure',
    message,
    reason,
    details,
  });
}

function throwTimeoutFailure(runtime, commandId, message, reason, details = null) {
  throwCommandFailure({
    runtime,
    commandId,
    category: 'timeout',
    message,
    reason,
    details,
    terminalState: 'timed_out',
  });
}

function mapSendMessageFailure(runtime, commandId, result) {
  if (result?.error === 'timeout') {
    throwTimeoutFailure(
      runtime,
      commandId,
      `Timed out waiting for Gemini to finish responding after ${result.elapsed ?? 0}ms.`,
      'wait-for-response-timeout',
      {
        elapsedMs: result.elapsed ?? null,
        finalStatus: result.finalStatus ?? null,
        legacyResult: result,
      },
    );
  }

  if (result?.error === 'fill_failed' || result?.error === 'send_click_failed') {
    throwSelectorFailure(
      runtime,
      commandId,
      `Unable to send a Gemini message: ${result.error}`,
      result.error,
      { legacyResult: result },
    );
  }

  throwCommandFailure({
    runtime,
    commandId,
    category: 'internal-error',
    message: `Gemini message send failed: ${result?.error ?? 'unknown-error'}`,
    reason: 'send-message-failed',
    details: { legacyResult: result },
  });
}

function mapNavigationLikeFailure(runtime, commandId, operation, result) {
  if (result?.error === 'invalid_domain') {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: result.detail ?? `Only gemini.google.com URLs are allowed for ${operation}.`,
      reason: 'invalid-domain',
      details: { legacyResult: result },
    });
  }

  if (isTimeoutLike(result?.detail) || result?.error === 'timeout') {
    throwTimeoutFailure(
      runtime,
      commandId,
      `${operation} exceeded its timeout budget.`,
      `${operation}-timeout`,
      { legacyResult: result },
    );
  }

  throwCommandFailure({
    runtime,
    commandId,
    category: 'internal-error',
    message: `${operation} failed: ${result?.error ?? 'unknown-error'}`,
    reason: `${operation}-failed`,
    details: { legacyResult: result },
  });
}

async function withGeminiSession(runtime, browserLifecycle, action) {
  const session = await browserLifecycle.acquireSession(runtime);
  try {
    return await action(session);
  } finally {
    await browserLifecycle.disconnectSession(runtime);
  }
}

async function executeNewChat(runtime, browserLifecycle, commandId) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.click('newChatBtn');
    if (!result?.ok) {
      throwSelectorFailure(runtime, commandId, 'Unable to create a new Gemini chat.', 'new-chat-click-failed', {
        legacyResult: result,
      });
    }

    return buildSessionResult(commandId, session, {
      action: 'new-chat',
      message: 'Created a new Gemini chat.',
    });
  });
}

async function executeTempChat(runtime, browserLifecycle, commandId) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const newChatResult = await session.ops.click('newChatBtn');
    if (!newChatResult?.ok) {
      throwSelectorFailure(
        runtime,
        commandId,
        'Unable to prepare a blank Gemini chat before entering temporary mode.',
        'temp-chat-new-chat-failed',
        { legacyResult: newChatResult },
      );
    }

    const result = await session.ops.clickTempChat();
    if (!result?.ok) {
      throwSelectorFailure(runtime, commandId, 'Unable to enter Gemini temporary chat mode.', 'temp-chat-click-failed', {
        legacyResult: result,
      });
    }

    return buildSessionResult(commandId, session, {
      action: 'temp-chat',
      message: 'Entered Gemini temporary chat mode.',
    });
  });
}

async function executeSwitchModel(runtime, browserLifecycle, commandId, parsedArgs) {
  if (!MODEL_CHOICES.has(parsedArgs.model)) {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: `Unsupported model: ${parsedArgs.model}`,
      reason: 'invalid-model',
      details: { model: parsedArgs.model, allowedModels: [...MODEL_CHOICES] },
    });
  }

  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.switchToModel(parsedArgs.model);
    if (!result?.ok) {
      const category = result?.error === 'unknown_model' ? 'invalid-args' : 'selector-failure';
      throwCommandFailure({
        runtime,
        commandId,
        category,
        message: `Unable to switch Gemini to model ${parsedArgs.model}.`,
        reason: result?.error ?? 'switch-model-failed',
        details: { model: parsedArgs.model, legacyResult: result },
      });
    }

    return buildSessionResult(commandId, session, {
      model: parsedArgs.model,
      previousModel: result.previousModel ?? null,
      message: `Switched Gemini model to ${parsedArgs.model}.`,
    });
  });
}

async function executeSendMessage(runtime, browserLifecycle, commandId, parsedArgs) {
  const timeoutMs = resolveCommandTimeout(runtime, parsedArgs.timeoutMs, 120_000);

  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.sendAndWait(parsedArgs.message, { timeout: timeoutMs });
    if (!result?.ok) {
      mapSendMessageFailure(runtime, commandId, result);
    }

    return buildSessionResult(commandId, session, {
      text: result.text ?? null,
      responseIndex: Number.isInteger(result.textIndex) ? result.textIndex : null,
      elapsedMs: result.elapsed ?? null,
      finalStatus: result.finalStatus ?? null,
      message: result.text ?? 'Gemini responded without extractable text.',
    });
  });
}

async function executeGetAllTextResponses(runtime, browserLifecycle, commandId) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.getAllTextResponses();
    if (!result?.ok) {
      throwSelectorFailure(runtime, commandId, 'No Gemini text responses were available on the current page.', 'no-text-responses', {
        legacyResult: result,
      });
    }

    return buildSessionResult(commandId, session, {
      total: result.total,
      responses: Array.isArray(result.responses) ? result.responses : [],
    });
  });
}

async function executeGetLatestTextResponse(runtime, browserLifecycle, commandId) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.getLatestTextResponse();
    if (!result?.ok) {
      throwSelectorFailure(runtime, commandId, 'No Gemini text responses were available on the current page.', 'no-text-responses', {
        legacyResult: result,
      });
    }

    return buildSessionResult(commandId, session, {
      text: result.text,
      responseIndex: Number.isInteger(result.index) ? result.index : null,
      message: result.text,
    });
  });
}

async function executeCheckLogin(runtime, browserLifecycle, commandId) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.checkLogin();
    if (!result?.ok) {
      throwSelectorFailure(runtime, commandId, 'Unable to determine Gemini login state.', 'check-login-failed', {
        legacyResult: result,
      });
    }

    return buildSessionResult(commandId, session, {
      loggedIn: result.loggedIn,
      barText: result.barText ?? null,
      message: result.loggedIn ? 'Gemini login is active.' : 'Gemini login is not active.',
    });
  });
}

async function executeProbe(runtime, browserLifecycle, commandId) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.probe();
    return buildSessionResult(commandId, session, {
      probe: result,
      currentModel: result.currentModel ?? null,
      pageStatus: result.status ?? null,
    });
  });
}

async function executeReloadPage(runtime, browserLifecycle, commandId, parsedArgs) {
  const timeoutMs = resolveCommandTimeout(runtime, parsedArgs.timeoutMs, 30_000);

  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.reloadPage({ timeout: timeoutMs });
    if (!result?.ok) {
      mapNavigationLikeFailure(runtime, commandId, 'reload-page', result);
    }

    return buildSessionResult(commandId, session, {
      elapsedMs: result.elapsed ?? null,
      message: `Reloaded the Gemini page in ${result.elapsed ?? 0}ms.`,
    });
  });
}

async function executeNavigateTo(runtime, browserLifecycle, commandId, parsedArgs) {
  ensureAllowedGeminiUrl(parsedArgs.url, runtime, commandId);
  const timeoutMs = resolveCommandTimeout(runtime, parsedArgs.timeoutMs, 30_000);

  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.navigateTo(parsedArgs.url, { timeout: timeoutMs });
    if (!result?.ok) {
      mapNavigationLikeFailure(runtime, commandId, 'navigate-to', result);
    }

    return buildSessionResult(commandId, session, {
      url: result.url,
      elapsedMs: result.elapsed ?? null,
      message: `Navigated to ${result.url}.`,
    });
  });
}

async function executeBrowserInfo(runtime, browserLifecycle, stdioRuntime) {
  return browserLifecycle.inspectBrowserInfo(runtime, stdioRuntime);
}

export function isSessionTextDiagnosticCommand(commandId) {
  return HANDLED_COMMAND_IDS.has(commandId);
}

export async function executeSessionTextDiagnosticCommand({
  command,
  passthroughArgs,
  runtime,
  stdioRuntime,
  browserLifecycle,
}) {
  const commandId = command.id;
  if (!isSessionTextDiagnosticCommand(commandId)) {
    return null;
  }

  let parsedArgs;
  try {
    parsedArgs = parseCommandArgs(commandId, passthroughArgs);
  } catch (error) {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: error.message,
      reason: 'command-argument-parse-failed',
      details: {
        argv: passthroughArgs,
      },
    });
  }

  switch (commandId) {
    case 'new-chat':
      return executeNewChat(runtime, browserLifecycle, commandId);
    case 'temp-chat':
      return executeTempChat(runtime, browserLifecycle, commandId);
    case 'switch-model':
      return executeSwitchModel(runtime, browserLifecycle, commandId, parsedArgs);
    case 'send-message':
      return executeSendMessage(runtime, browserLifecycle, commandId, parsedArgs);
    case 'get-all-text-responses':
      return executeGetAllTextResponses(runtime, browserLifecycle, commandId);
    case 'get-latest-text-response':
      return executeGetLatestTextResponse(runtime, browserLifecycle, commandId);
    case 'check-login':
      return executeCheckLogin(runtime, browserLifecycle, commandId);
    case 'probe':
      return executeProbe(runtime, browserLifecycle, commandId);
    case 'reload-page':
      return executeReloadPage(runtime, browserLifecycle, commandId, parsedArgs);
    case 'navigate-to':
      return executeNavigateTo(runtime, browserLifecycle, commandId, parsedArgs);
    case 'browser-info':
      return executeBrowserInfo(runtime, browserLifecycle, stdioRuntime);
    default:
      return null;
  }
}
