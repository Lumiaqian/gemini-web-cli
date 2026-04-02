import {
  CLI_ENTRYPOINT,
  DAEMON_STRATEGY,
  ROUTE_ID,
  TEST_ENTRYPOINT,
  getRouteScaffoldMetadata,
} from './route-metadata.mjs';

export const GLOBAL_FLAGS = Object.freeze([
  Object.freeze({
    name: '--json',
    type: 'boolean',
    stable: true,
    description: 'Emit one machine-readable JSON envelope to stdout.',
  }),
  Object.freeze({
    name: '--timeout-ms',
    type: 'integer',
    stable: true,
    description: 'Override the effective timeout budget in milliseconds.',
  }),
  Object.freeze({
    name: '--request-id',
    type: 'string',
    stable: true,
    description: 'Echo a caller-supplied opaque request identifier in machine mode.',
  }),
  Object.freeze({
    name: '--output-dir',
    type: 'string',
    stable: false,
    description: 'Route-local output directory override placeholder for later handler migration.',
  }),
  Object.freeze({
    name: '--non-interactive',
    type: 'boolean',
    stable: false,
    description: 'Force CI-safe execution without prompts or interactive fallbacks.',
  }),
  Object.freeze({
    name: '--help',
    type: 'boolean',
    stable: true,
    description: 'Print human-readable help.',
  }),
  Object.freeze({
    name: '--version',
    type: 'boolean',
    stable: true,
    description: 'Print the current route-local CLI scaffold version.',
  }),
]);

const COMMAND_GROUPS = Object.freeze([
  Object.freeze({
    id: 'scaffold',
    title: 'Scaffold Introspection',
    description: 'Route-local introspection commands kept for scaffold verification and deterministic developer entrypoints.',
    commands: Object.freeze([
      Object.freeze({
        id: 'describe-scaffold',
        path: Object.freeze(['describe-scaffold']),
        aliases: Object.freeze([]),
        legacyTool: null,
        capabilityGroup: 'route-scaffold',
        mustHaveV1: false,
        implementation: 'introspection',
        description: 'Describe the selected route scaffold, private Node-core boundaries, and command tree mapping.',
        legacyParameters: Object.freeze([]),
      }),
    ]),
  }),
  Object.freeze({
    id: 'session',
    title: 'Session Management',
    description: 'Commands that create, switch, or restore Gemini chat context.',
    commands: Object.freeze([
      Object.freeze({
        id: 'new-chat',
        path: Object.freeze(['session', 'new-chat']),
        aliases: Object.freeze(['new-chat']),
        legacyTool: 'gemini_new_chat',
        capabilityGroup: 'session-management',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Create a fresh Gemini chat.',
        legacyParameters: Object.freeze([]),
      }),
      Object.freeze({
        id: 'temp-chat',
        path: Object.freeze(['session', 'temp-chat']),
        aliases: Object.freeze(['temp-chat']),
        legacyTool: 'gemini_temp_chat',
        capabilityGroup: 'session-management',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Enter temporary chat mode.',
        legacyParameters: Object.freeze([]),
      }),
      Object.freeze({
        id: 'navigate-to',
        path: Object.freeze(['session', 'navigate-to']),
        aliases: Object.freeze(['navigate-to', 'navigate']),
        legacyTool: 'gemini_navigate_to',
        capabilityGroup: 'session-management',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Navigate the active Gemini tab to a specific Gemini URL.',
        legacyParameters: Object.freeze(['url', 'timeout']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'model',
    title: 'Model',
    description: 'Commands that switch Gemini model state without leaving the current chat.',
    commands: Object.freeze([
      Object.freeze({
        id: 'switch-model',
        path: Object.freeze(['model', 'switch-model']),
        aliases: Object.freeze(['switch-model']),
        legacyTool: 'gemini_switch_model',
        capabilityGroup: 'model-and-conversation',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Switch to a target Gemini model.',
        legacyParameters: Object.freeze(['model']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'conversation',
    title: 'Conversation',
    description: 'Commands that send prompts or otherwise mutate the current conversation.',
    commands: Object.freeze([
      Object.freeze({
        id: 'send-message',
        path: Object.freeze(['conversation', 'send-message']),
        aliases: Object.freeze(['send-message']),
        legacyTool: 'gemini_send_message',
        capabilityGroup: 'model-and-conversation',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Send a text prompt and wait for Gemini to respond.',
        legacyParameters: Object.freeze(['message', 'timeout']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'image',
    title: 'Image Operations',
    description: 'Commands that generate, upload, inspect, extract, or download Gemini images.',
    commands: Object.freeze([
      Object.freeze({
        id: 'start-image-task',
        path: Object.freeze(['image', 'start-image-task']),
        aliases: Object.freeze(['start-image-task']),
        legacyTool: null,
        capabilityGroup: 'core-image-generation',
        mustHaveV1: false,
        implementation: 'native-handler',
        description: 'Start an image-generation task and persist task state until the Gemini image becomes visible.',
        legacyParameters: Object.freeze(['prompt', 'newSession', 'referenceImages', 'fullSize', 'timeout', 'idempotencyKey']),
      }),
      Object.freeze({
        id: 'get-image-task',
        path: Object.freeze(['image', 'get-image-task']),
        aliases: Object.freeze(['get-image-task']),
        legacyTool: null,
        capabilityGroup: 'core-image-generation',
        mustHaveV1: false,
        implementation: 'native-handler',
        description: 'Read persisted state for an image-generation task.',
        legacyParameters: Object.freeze(['taskId']),
      }),
      Object.freeze({
        id: 'collect-image-task',
        path: Object.freeze(['image', 'collect-image-task']),
        aliases: Object.freeze(['collect-image-task']),
        legacyTool: null,
        capabilityGroup: 'core-image-generation',
        mustHaveV1: false,
        implementation: 'native-handler',
        description: 'Collect the generated image artifact for a persisted image-generation task.',
        legacyParameters: Object.freeze(['taskId']),
      }),
      Object.freeze({
        id: 'generate-image',
        path: Object.freeze(['image', 'generate-image']),
        aliases: Object.freeze(['generate-image']),
        legacyTool: 'gemini_generate_image',
        capabilityGroup: 'core-image-generation',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Run the full Gemini image-generation flow.',
        legacyParameters: Object.freeze(['prompt', 'newSession', 'referenceImages', 'fullSize', 'timeout']),
      }),
      Object.freeze({
        id: 'upload-images',
        path: Object.freeze(['image', 'upload-images']),
        aliases: Object.freeze(['upload-images']),
        legacyTool: 'gemini_upload_images',
        capabilityGroup: 'image-operations',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Upload one or more local images into the current Gemini prompt.',
        legacyParameters: Object.freeze(['images']),
      }),
      Object.freeze({
        id: 'get-images',
        path: Object.freeze(['image', 'get-images']),
        aliases: Object.freeze(['get-images']),
        legacyTool: 'gemini_get_images',
        capabilityGroup: 'image-operations',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'List image metadata from the current Gemini conversation.',
        legacyParameters: Object.freeze([]),
      }),
      Object.freeze({
        id: 'extract-image',
        path: Object.freeze(['image', 'extract-image']),
        aliases: Object.freeze(['extract-image']),
        legacyTool: 'gemini_extract_image',
        capabilityGroup: 'image-operations',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Extract a selected Gemini image and write a local file.',
        legacyParameters: Object.freeze(['imageUrl']),
      }),
      Object.freeze({
        id: 'download-full-size-image',
        path: Object.freeze(['image', 'download-full-size-image']),
        aliases: Object.freeze(['download-full-size-image']),
        legacyTool: 'gemini_download_full_size_image',
        capabilityGroup: 'image-operations',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Download the original full-size Gemini image asset.',
        legacyParameters: Object.freeze(['index']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'text',
    title: 'Text Responses',
    description: 'Read back one or many Gemini text responses from the active page.',
    commands: Object.freeze([
      Object.freeze({
        id: 'get-all-text-responses',
        path: Object.freeze(['text', 'get-all-text-responses']),
        aliases: Object.freeze(['get-all-text-responses']),
        legacyTool: 'gemini_get_all_text_responses',
        capabilityGroup: 'text-response',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Return all text responses currently visible in the active Gemini conversation.',
        legacyParameters: Object.freeze([]),
      }),
      Object.freeze({
        id: 'get-latest-text-response',
        path: Object.freeze(['text', 'get-latest-text-response']),
        aliases: Object.freeze(['get-latest-text-response']),
        legacyTool: 'gemini_get_latest_text_response',
        capabilityGroup: 'text-response',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Return only the latest Gemini text response.',
        legacyParameters: Object.freeze([]),
      }),
    ]),
  }),
  Object.freeze({
    id: 'diagnostic',
    title: 'Diagnostics And Management',
    description: 'Inspect login, page, daemon, and browser state without leaving the selected route shell.',
    commands: Object.freeze([
      Object.freeze({
        id: 'check-login',
        path: Object.freeze(['diagnostic', 'check-login']),
        aliases: Object.freeze(['check-login']),
        legacyTool: 'gemini_check_login',
        capabilityGroup: 'diagnostics-and-management',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Check whether Gemini is currently logged in.',
        legacyParameters: Object.freeze([]),
      }),
      Object.freeze({
        id: 'probe',
        path: Object.freeze(['diagnostic', 'probe']),
        aliases: Object.freeze(['probe']),
        legacyTool: 'gemini_probe',
        capabilityGroup: 'diagnostics-and-management',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Inspect Gemini page selectors and current readiness state.',
        legacyParameters: Object.freeze([]),
      }),
      Object.freeze({
        id: 'reload-page',
        path: Object.freeze(['diagnostic', 'reload-page']),
        aliases: Object.freeze(['reload-page']),
        legacyTool: 'gemini_reload_page',
        capabilityGroup: 'diagnostics-and-management',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Reload the current Gemini page.',
        legacyParameters: Object.freeze(['timeout']),
      }),
      Object.freeze({
        id: 'browser-info',
        path: Object.freeze(['diagnostic', 'browser-info']),
        aliases: Object.freeze(['browser-info']),
        legacyTool: 'gemini_browser_info',
        capabilityGroup: 'diagnostics-and-management',
        mustHaveV1: true,
        implementation: 'native-handler',
        description: 'Report daemon and browser connection information.',
        legacyParameters: Object.freeze([]),
      }),
    ]),
  }),
]);

const FLAT_COMMANDS = Object.freeze(COMMAND_GROUPS.flatMap((group) => group.commands));
const MAX_COMMAND_PATH_SEGMENTS = Math.max(...FLAT_COMMANDS.map((command) => command.path.length));

const PATH_INDEX = new Map();
const ALIAS_INDEX = new Map();

for (const command of FLAT_COMMANDS) {
  PATH_INDEX.set(command.path.join(' '), command);
  for (const alias of command.aliases) {
    ALIAS_INDEX.set(alias, command);
  }
}

function cloneCommand(command) {
  return {
    ...command,
    path: [...command.path],
    aliases: [...command.aliases],
    legacyParameters: [...command.legacyParameters],
  };
}

export function listCommandDefinitions() {
  return FLAT_COMMANDS.map((command) => cloneCommand(command));
}

export function listParityMappedLegacyTools() {
  return FLAT_COMMANDS.filter((command) => command.legacyTool).map((command) => command.legacyTool);
}

export function findCommandByTokens(tokens) {
  const normalized = tokens.filter((token) => typeof token === 'string' && token.length > 0);

  for (let length = Math.min(MAX_COMMAND_PATH_SEGMENTS, normalized.length); length > 0; length -= 1) {
    const byPath = PATH_INDEX.get(normalized.slice(0, length).join(' '));
    if (byPath) {
      return {
        command: cloneCommand(byPath),
        consumedTokens: length,
        matchedBy: 'path',
      };
    }
  }

  const byAlias = ALIAS_INDEX.get(normalized[0]);
  if (byAlias) {
    return {
      command: cloneCommand(byAlias),
      consumedTokens: 1,
      matchedBy: 'alias',
    };
  }

  return null;
}

export function getCommandTreeSnapshot() {
  const metadata = getRouteScaffoldMetadata();

  return {
    routeId: metadata.routeId,
    daemonStrategy: metadata.daemonStrategy,
    scaffoldVersion: metadata.scaffoldVersion,
    cliEntrypoint: CLI_ENTRYPOINT,
    testEntrypoint: TEST_ENTRYPOINT,
    globalFlags: GLOBAL_FLAGS.map((flag) => ({ ...flag })),
    commandCount: FLAT_COMMANDS.length,
    parityCommandCount: listParityMappedLegacyTools().length,
    groups: COMMAND_GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      commands: group.commands.map((command) => cloneCommand(command)),
    })),
  };
}

export const COMMAND_TREE = Object.freeze({
  routeId: ROUTE_ID,
  daemonStrategy: DAEMON_STRATEGY,
  globalFlags: GLOBAL_FLAGS,
  groups: COMMAND_GROUPS,
});
