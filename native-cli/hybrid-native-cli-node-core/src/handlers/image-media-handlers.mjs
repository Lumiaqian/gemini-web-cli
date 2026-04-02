import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import legacyConfig from '../../../../src/config.js';
import { ROUTE_ID, SCAFFOLD_VERSION } from '../route-metadata.mjs';
import { toPublicRuntimeSnapshot } from '../runtime/load-cli-config.mjs';
import { CliRuntimeFailure } from '../runtime/stdio-runtime.mjs';
import { buildImageTaskKey } from '../runtime/image-task-store.mjs';

const HANDLED_COMMAND_IDS = new Set([
  'start-image-task',
  'get-image-task',
  'collect-image-task',
  'generate-image',
  'upload-images',
  'get-images',
  'extract-image',
  'download-full-size-image',
]);

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

function buildImageTaskResult(commandId, task, payload = {}) {
  return buildBaseResult(commandId, {
    task,
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

function parseIntegerFlag(flagName, rawValue, { allowZero = true } = {}) {
  const parsed = Number.parseInt(rawValue, 10);
  const valid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    throw new Error(`invalid value for ${flagName}: ${rawValue}`);
  }
  return parsed;
}

function parseBooleanToken(flagName, rawValue) {
  if (rawValue === undefined) {
    return true;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  throw new Error(`invalid boolean value for ${flagName}: ${rawValue}`);
}

function parseCsvList(rawValue) {
  return String(rawValue)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function collectCommandArgs(tokens, { valueFlags = new Set(), booleanFlags = new Set(), multiValueFlags = new Set() } = {}) {
  const values = new Map();
  const multiValues = new Map();
  const booleans = new Map();
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--') {
      positionals.push(...tokens.slice(index + 1));
      break;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf('=');
    const flagName = eqIndex === -1 ? token : token.slice(0, eqIndex);
    const inlineValue = eqIndex === -1 ? undefined : token.slice(eqIndex + 1);

    if (booleanFlags.has(flagName)) {
      if (eqIndex === -1) {
        const next = tokens[index + 1];
        if (hasText(next) && !next.startsWith('--')) {
          booleans.set(flagName, parseBooleanToken(flagName, next));
          index += 1;
        } else {
          booleans.set(flagName, true);
        }
      } else {
        booleans.set(flagName, parseBooleanToken(flagName, inlineValue));
      }
      continue;
    }

    if (!valueFlags.has(flagName) && !multiValueFlags.has(flagName)) {
      throw new Error(`unknown argument: ${token}`);
    }

    const rawValue = eqIndex === -1 ? tokens[++index] : inlineValue;
    if (!hasText(rawValue)) {
      throw new Error(`missing value for ${flagName}`);
    }

    if (multiValueFlags.has(flagName)) {
      const existing = multiValues.get(flagName) ?? [];
      existing.push(...parseCsvList(rawValue));
      multiValues.set(flagName, existing);
      continue;
    }

    values.set(flagName, rawValue);
  }

  return { values, multiValues, booleans, positionals };
}

function parseNoArgCommand(tokens) {
  if (tokens.length > 0) {
    throw new Error(`unexpected arguments: ${tokens.join(' ')}`);
  }
  return Object.freeze({});
}

function parseGenerateImageArgs(tokens) {
  const { values, multiValues, booleans, positionals } = collectCommandArgs(tokens, {
    valueFlags: new Set(['--prompt', '--timeout', '--idempotency-key']),
    booleanFlags: new Set(['--new-session', '--full-size']),
    multiValueFlags: new Set(['--reference-images']),
  });

  if (values.has('--prompt') && positionals.length > 0) {
    throw new Error('prompt must be provided either as --prompt <text> or as positional text');
  }

  const prompt = values.get('--prompt') ?? (positionals.length > 0 ? positionals.join(' ') : null);
  if (!hasText(prompt)) {
    throw new Error('missing required argument: --prompt <text>');
  }

  return Object.freeze({
    prompt,
    newSession: booleans.get('--new-session') ?? false,
    fullSize: booleans.get('--full-size') ?? false,
    timeoutMs: values.has('--timeout') ? parseIntegerFlag('--timeout', values.get('--timeout'), { allowZero: false }) : null,
    referenceImages: multiValues.get('--reference-images') ?? [],
    idempotencyKey: values.get('--idempotency-key') ?? null,
  });
}

function parseTaskIdArgs(tokens) {
  const { values, positionals } = collectCommandArgs(tokens, {
    valueFlags: new Set(['--task-id']),
  });

  if (values.has('--task-id') && positionals.length > 0) {
    throw new Error('task id must be provided either as --task-id <value> or as one positional argument');
  }

  const taskId = values.get('--task-id') ?? (positionals.length === 1 ? positionals[0] : null);
  if (!hasText(taskId)) {
    throw new Error('missing required argument: --task-id <value>');
  }
  if (positionals.length > 1) {
    throw new Error(`unexpected arguments: ${positionals.slice(1).join(' ')}`);
  }

  return Object.freeze({ taskId });
}

function parseUploadImagesArgs(tokens) {
  const { multiValues, positionals } = collectCommandArgs(tokens, {
    multiValueFlags: new Set(['--images']),
  });

  const images = multiValues.has('--images') ? multiValues.get('--images') : positionals;
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('missing required argument: --images <path[,path...]>');
  }

  return Object.freeze({ images: [...images] });
}

function parseExtractImageArgs(tokens) {
  const { values, positionals } = collectCommandArgs(tokens, {
    valueFlags: new Set(['--image-url']),
  });

  if (values.has('--image-url') && positionals.length > 0) {
    throw new Error('image URL must be provided either as --image-url <value> or as one positional argument');
  }

  const imageUrl = values.get('--image-url') ?? (positionals.length === 1 ? positionals[0] : null);
  if (!hasText(imageUrl)) {
    throw new Error('missing required argument: --image-url <url>');
  }
  if (positionals.length > 1) {
    throw new Error(`unexpected arguments: ${positionals.slice(1).join(' ')}`);
  }

  return Object.freeze({ imageUrl });
}

function parseDownloadImageArgs(tokens) {
  const { values, positionals } = collectCommandArgs(tokens, {
    valueFlags: new Set(['--index']),
  });

  if (values.has('--index') && positionals.length > 0) {
    throw new Error('index must be provided either as --index <number> or as one positional argument');
  }

  const rawIndex = values.get('--index') ?? (positionals.length === 1 ? positionals[0] : null);
  if (positionals.length > 1) {
    throw new Error(`unexpected arguments: ${positionals.slice(1).join(' ')}`);
  }

  return Object.freeze({
    index: rawIndex === null ? null : parseIntegerFlag('--index', rawIndex),
  });
}

function parseCommandArgs(commandId, passthroughArgs) {
  switch (commandId) {
    case 'start-image-task':
    case 'generate-image':
      return parseGenerateImageArgs(passthroughArgs);
    case 'get-image-task':
    case 'collect-image-task':
      return parseTaskIdArgs(passthroughArgs);
    case 'upload-images':
      return parseUploadImagesArgs(passthroughArgs);
    case 'get-images':
      return parseNoArgCommand(passthroughArgs);
    case 'extract-image':
      return parseExtractImageArgs(passthroughArgs);
    case 'download-full-size-image':
      return parseDownloadImageArgs(passthroughArgs);
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

function normalizeLocalImagePath(inputPath) {
  return path.resolve(path.normalize(inputPath));
}

function validateLocalImagePaths(runtime, commandId, inputPaths, details = {}) {
  return inputPaths.map((inputPath) => {
    if (!hasText(inputPath)) {
      throwCommandFailure({
        runtime,
        commandId,
        category: 'invalid-args',
        message: 'Image path cannot be empty.',
        reason: 'empty-image-path',
        details,
      });
    }

    const normalizedPath = normalizeLocalImagePath(inputPath);
    if (!existsSync(normalizedPath)) {
      throwCommandFailure({
        runtime,
        commandId,
        category: 'invalid-args',
        message: `Image file does not exist: ${normalizedPath}`,
        reason: 'file-not-found',
        details: {
          inputPath,
          normalizedPath,
          ...details,
        },
      });
    }

    return {
      inputPath,
      normalizedPath,
    };
  });
}

function buildOutputArtifact(runtime, filePath, payload = {}) {
  const resolvedOutputDir = runtime.config.outputDirResolved ?? runtime.config.outputDir;

  return {
    kind: 'local-file',
    wroteFile: true,
    filePath,
    outputDir: resolvedOutputDir,
    ...payload,
  };
}

function writeDataUrlArtifact(runtime, dataUrl, { prefix, semantics, sourceUrl = null, method = null } = {}) {
  const match = String(dataUrl).match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) {
    throw new CliRuntimeFailure({
      category: 'internal-error',
      message: 'Image extraction did not return a valid data URL.',
      details: {
        reason: 'invalid-data-url',
        runtime: toRuntimeSnapshot(runtime),
        sourceUrl,
        method,
      },
    });
  }

  const mimeType = match[1];
  const base64Payload = match[2];
  const extension = mimeType.split('/')[1] || 'png';
  const outputDir = runtime.config.outputDirResolved ?? runtime.config.outputDir;
  mkdirSync(outputDir, { recursive: true });

  const fileName = `${prefix}_${Date.now()}.${extension}`;
  const filePath = path.join(outputDir, fileName);
  const buffer = Buffer.from(base64Payload, 'base64');
  writeFileSync(filePath, buffer);

  return buildOutputArtifact(runtime, filePath, {
    semantics,
    fileName,
    mimeType,
    byteLength: buffer.byteLength,
    sourceUrl,
    method,
  });
}

async function withLegacyOutputDir(runtime, action) {
  const previousOutputDir = legacyConfig.outputDir;
  legacyConfig.outputDir = runtime.config.outputDirResolved ?? runtime.config.outputDir;
  try {
    return await action();
  } finally {
    legacyConfig.outputDir = previousOutputDir;
  }
}

async function withGeminiSession(runtime, browserLifecycle, action) {
  const session = await browserLifecycle.acquireSession(runtime);
  try {
    return await action(session);
  } finally {
    await browserLifecycle.disconnectSession(runtime);
  }
}

function throwTaskNotFound(runtime, commandId, taskId) {
  throwCommandFailure({
    runtime,
    commandId,
    category: 'invalid-args',
    message: `Unknown image task id: ${taskId}`,
    reason: 'image-task-not-found',
    details: { taskId },
  });
}

function toTaskSessionContext(session) {
  return {
    pageUrl: typeof session?.page?.url === 'function' ? session.page.url() : null,
    daemonStrategy: session?.daemonStrategy ?? 'keep',
  };
}

function buildTaskIdempotencyKey(parsedArgs) {
  return parsedArgs.idempotencyKey ?? buildImageTaskKey({
    prompt: parsedArgs.prompt,
    fullSize: Boolean(parsedArgs.fullSize),
    newSession: Boolean(parsedArgs.newSession),
    referenceImages: Array.isArray(parsedArgs.referenceImages) ? [...parsedArgs.referenceImages].map((v) => path.resolve(path.normalize(v))).sort() : [],
  });
}

async function ensureImageTaskPrerequisites(runtime, commandId, session, parsedArgs, referenceImages) {
  const loginCheck = await session.ops.checkLogin();
  if (!loginCheck?.ok) {
    throwSelectorFailure(runtime, commandId, 'Unable to determine Gemini login state before image generation.', 'check-login-failed', {
      legacyResult: loginCheck,
    });
  }
  if (!loginCheck.loggedIn) {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'auth-failure',
      message: 'Gemini is not logged in. Complete Google sign-in before generating images.',
      reason: 'not-logged-in',
      details: { loginCheck },
    });
  }

  if (parsedArgs.newSession) {
    const newChatResult = await session.ops.click('newChatBtn');
    if (!newChatResult?.ok) {
      throwSelectorFailure(runtime, commandId, 'Unable to start a new Gemini chat before image generation.', 'new-chat-click-failed', {
        legacyResult: newChatResult,
      });
    }
  }

  const ensureModelResult = await session.ops.ensureModelPro();
  if (!ensureModelResult?.ok) {
    throwSelectorFailure(runtime, commandId, 'Unable to switch Gemini to the Pro model required for image generation.', ensureModelResult.error ?? 'ensure-model-pro-failed', {
      legacyResult: ensureModelResult,
    });
  }

  const uploadedReferenceImages = [];
  for (const referenceImage of referenceImages) {
    const uploadResult = await session.ops.uploadImage(referenceImage.normalizedPath);
    if (!uploadResult?.ok) {
      mapUploadFailure(runtime, commandId, uploadResult, {
        stage: 'reference-image-upload',
        inputPath: referenceImage.inputPath,
        normalizedPath: referenceImage.normalizedPath,
        uploadedCount: uploadedReferenceImages.length,
        requestedCount: referenceImages.length,
      });
    }

    uploadedReferenceImages.push({
      inputPath: referenceImage.inputPath,
      normalizedPath: referenceImage.normalizedPath,
      elapsedMs: uploadResult.elapsed ?? null,
      warning: uploadResult.warning ?? null,
    });
  }

  return uploadedReferenceImages;
}

async function runImageTaskStart(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs) {
  const timeoutMs = resolveCommandTimeout(runtime, parsedArgs.timeoutMs, 180_000);
  const referenceImages = validateLocalImagePaths(runtime, commandId, parsedArgs.referenceImages, {
    argument: 'referenceImages',
  });
  const idempotencyKey = buildTaskIdempotencyKey(parsedArgs);
  const existingTask = imageTaskStore.findReusableTaskByKey(idempotencyKey);
  if (existingTask) {
    return buildImageTaskResult(commandId, imageTaskStore.toPublicTask(existingTask), {
      reused: true,
      message: `Reused existing image task ${existingTask.taskId} in state ${existingTask.state}.`,
    });
  }

  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const task = imageTaskStore.createTask({
      idempotencyKey,
      prompt: parsedArgs.prompt,
      fullSize: parsedArgs.fullSize,
      newSession: parsedArgs.newSession,
      timeoutMs,
      referenceImages: referenceImages.map((item) => item.normalizedPath),
      session: toTaskSessionContext(session),
    });

    imageTaskStore.updateTask(task.taskId, (draft) => ({
      ...draft,
      state: 'generating',
      session: toTaskSessionContext(session),
    }));

    try {
      const uploadedReferenceImages = await ensureImageTaskPrerequisites(runtime, commandId, session, parsedArgs, referenceImages);
      imageTaskStore.updateTask(task.taskId, (draft) => ({
        ...draft,
        referenceImages: uploadedReferenceImages,
        session: toTaskSessionContext(session),
      }));

      const sendResult = await session.ops.sendAndWait(parsedArgs.prompt, { timeout: timeoutMs });
      if (!sendResult?.ok) {
        mapGenerateFailure(runtime, commandId, sendResult);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      let imgInfo = await session.ops.getLatestImage();
      if (!imgInfo?.ok) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        imgInfo = await session.ops.getLatestImage();
      }
      if (!imgInfo?.ok) {
        throwSelectorFailure(runtime, commandId, 'Gemini did not render an image to persist for this task.', 'no-image-found', {
          legacyResult: imgInfo,
        });
      }

      const updatedTask = imageTaskStore.updateTask(task.taskId, (draft) => ({
        ...draft,
        state: 'image_visible',
        session: toTaskSessionContext(session),
        image: {
          src: imgInfo.src ?? null,
          alt: imgInfo.alt ?? null,
          width: imgInfo.width ?? null,
          height: imgInfo.height ?? null,
          isNew: imgInfo.isNew ?? null,
          methodHint: parsedArgs.fullSize ? 'fullSize' : 'preview',
        },
        error: null,
      }));

      return buildImageTaskResult(commandId, imageTaskStore.toPublicTask(updatedTask), {
        reused: false,
        message: `Started image task ${task.taskId}; Gemini image is now visible and ready for collection.`,
      });
    } catch (error) {
      const failure = error instanceof CliRuntimeFailure
        ? {
            category: error.category,
            message: error.message,
            details: error.details ?? null,
          }
        : {
            category: 'internal-error',
            message: error instanceof Error ? error.message : String(error),
            details: null,
          };

      imageTaskStore.markFailed(task.taskId, failure);
      throw error;
    }
  });
}

async function executeStartImageTask(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs) {
  return runImageTaskStart(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs);
}

async function executeGetImageTask(runtime, imageTaskStore, commandId, parsedArgs) {
  const task = imageTaskStore.getTask(parsedArgs.taskId);
  if (!task) {
    throwTaskNotFound(runtime, commandId, parsedArgs.taskId);
  }
  return buildImageTaskResult(commandId, imageTaskStore.toPublicTask(task), {
    message: `Loaded image task ${task.taskId} in state ${task.state}.`,
  });
}

async function executeCollectImageTask(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs) {
  const task = imageTaskStore.getTask(parsedArgs.taskId);
  if (!task) {
    throwTaskNotFound(runtime, commandId, parsedArgs.taskId);
  }
  if (task.state === 'completed') {
    return buildImageTaskResult(commandId, imageTaskStore.toPublicTask(task), {
      message: `Image task ${task.taskId} is already completed.`,
    });
  }
  if (task.state !== 'image_visible' && task.state !== 'collecting') {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: `Image task ${task.taskId} is not ready for collection (state=${task.state}).`,
      reason: 'image-task-not-collectable',
      details: { taskId: task.taskId, state: task.state },
    });
  }

  imageTaskStore.updateTask(task.taskId, (draft) => ({
    ...draft,
    state: 'collecting',
  }));

  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    try {
      let result;
      if (task.fullSize) {
        result = await withLegacyOutputDir(runtime, () => session.ops.downloadFullSizeImage());
        if (!result?.ok) {
          mapDownloadFailure(runtime, commandId, result, { operation: 'collect-image-task' });
        }

        const updatedTask = imageTaskStore.updateTask(task.taskId, (draft) => ({
          ...draft,
          state: 'completed',
          session: toTaskSessionContext(session),
          output: buildOutputArtifact(runtime, result.filePath, {
            semantics: 'generated-full-size-image',
            suggestedFilename: result.suggestedFilename ?? null,
            sourceUrl: result.src ?? null,
          }),
          error: null,
        }));

        return buildImageTaskResult(commandId, imageTaskStore.toPublicTask(updatedTask), {
          message: `Collected full-size artifact for image task ${task.taskId}.`,
        });
      }

      result = await session.ops.extractImageBase64(task.image?.src ?? '');
      if (!result?.ok) {
        mapExtractionFailure(runtime, commandId, result, { operation: 'collect-image-task', imageUrl: task.image?.src ?? null });
      }

      const output = writeDataUrlArtifact(runtime, result.dataUrl, {
        prefix: 'gemini',
        semantics: 'generated-preview-image',
        sourceUrl: task.image?.src ?? null,
        method: result.method ?? null,
      });

      const updatedTask = imageTaskStore.updateTask(task.taskId, (draft) => ({
        ...draft,
        state: 'completed',
        session: toTaskSessionContext(session),
        output,
        error: null,
      }));

      return buildImageTaskResult(commandId, imageTaskStore.toPublicTask(updatedTask), {
        message: `Collected preview artifact for image task ${task.taskId}.`,
      });
    } catch (error) {
      const failure = error instanceof CliRuntimeFailure
        ? {
            category: error.category,
            message: error.message,
            details: error.details ?? null,
          }
        : {
            category: 'internal-error',
            message: error instanceof Error ? error.message : String(error),
            details: null,
          };
      imageTaskStore.markFailed(task.taskId, failure);
      throw error;
    }
  });
}

function mapUploadFailure(runtime, commandId, result, context = {}) {
  if (result?.error === 'file_not_found') {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: `Image file does not exist: ${context.normalizedPath ?? context.inputPath ?? 'unknown'}`,
      reason: 'file-not-found',
      details: {
        legacyResult: result,
        ...context,
      },
    });
  }

  if (String(result?.detail ?? '').toLowerCase().includes('timeout')) {
    throwTimeoutFailure(runtime, commandId, 'Image upload exceeded its timeout budget.', 'upload-timeout', {
      legacyResult: result,
      ...context,
    });
  }

  if (result?.error === 'upload_panel_click_failed' || result?.error === 'upload_image_failed') {
    throwSelectorFailure(runtime, commandId, `Unable to upload image ${context.inputPath ?? ''}.`.trim(), result.error, {
      legacyResult: result,
      ...context,
    });
  }

  throwCommandFailure({
    runtime,
    commandId,
    category: 'internal-error',
    message: `Image upload failed: ${result?.error ?? 'unknown-error'}`,
    reason: 'upload-images-failed',
    details: {
      legacyResult: result,
      ...context,
    },
  });
}

function mapExtractionFailure(runtime, commandId, result, context = {}) {
  if (result?.error === 'missing_url') {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: 'Image URL is required for extraction.',
      reason: 'missing-image-url',
      details: {
        legacyResult: result,
        ...context,
      },
    });
  }

  if (result?.error === 'no_loaded_images') {
    throwSelectorFailure(runtime, commandId, 'No loaded Gemini image was available for extraction.', 'no-loaded-images', {
      legacyResult: result,
      ...context,
    });
  }

  if (String(result?.detail ?? '').toLowerCase().includes('timeout')) {
    throwTimeoutFailure(runtime, commandId, 'Image extraction exceeded its timeout budget.', 'extract-image-timeout', {
      legacyResult: result,
      ...context,
    });
  }

  throwCommandFailure({
    runtime,
    commandId,
    category: 'internal-error',
    message: `Image extraction failed: ${result?.error ?? 'unknown-error'}`,
    reason: 'extract-image-failed',
    details: {
      legacyResult: result,
      ...context,
    },
  });
}

function mapDownloadFailure(runtime, commandId, result, context = {}) {
  if (result?.error === 'index_out_of_range') {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'invalid-args',
      message: `Requested image index ${result.requestedIndex} is out of range for ${result.total ?? 0} available images.`,
      reason: 'index-out-of-range',
      details: {
        legacyResult: result,
        requestedIndex: result.requestedIndex ?? null,
        total: result.total ?? null,
        ...context,
      },
    });
  }

  if (result?.error === 'download_timeout') {
    throwTimeoutFailure(runtime, commandId, 'Full-size image download exceeded its timeout budget.', 'download-full-size-timeout', {
      legacyResult: result,
      ...context,
    });
  }

  if (result?.error === 'no_loaded_images') {
    throwSelectorFailure(runtime, commandId, 'Unable to locate a downloadable Gemini image on the current page.', result.error, {
      legacyResult: result,
      ...context,
    });
  }

  if (result?.error === 'empty_image_src' || result?.error === 'cdp_request_failed' || result?.error === 'cdp_no_stream') {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'internal-error',
      message: `CDP image fetch failed: ${result?.detail ?? result?.error}`,
      reason: result.error,
      details: {
        legacyResult: result,
        ...context,
      },
    });
  }

  throwCommandFailure({
    runtime,
    commandId,
    category: 'internal-error',
    message: `Full-size image download failed: ${result?.error ?? 'unknown-error'}`,
    reason: 'download-full-size-image-failed',
    details: {
      legacyResult: result,
      ...context,
    },
  });
}

function mapGenerateFailure(runtime, commandId, result) {
  if (result?.error === 'timeout') {
    throwTimeoutFailure(runtime, commandId, 'Gemini image generation exceeded its timeout budget.', 'generate-image-timeout', {
      legacyResult: result,
      elapsedMs: result.elapsed ?? null,
      finalStatus: result.finalStatus ?? null,
    });
  }

  if (result?.error === 'fill_failed' || result?.error === 'send_click_failed') {
    throwSelectorFailure(runtime, commandId, 'Unable to send the Gemini image prompt.', result.error, {
      legacyResult: result,
    });
  }

  if (result?.error === 'no_image_found') {
    throwSelectorFailure(runtime, commandId, 'Gemini did not render an image to extract or download.', 'no-image-found', {
      legacyResult: result,
    });
  }

  if (
    result?.method === 'fullSize'
    || result?.error === 'index_out_of_range'
    || result?.error === 'empty_image_src'
    || result?.error === 'cdp_request_failed'
    || result?.error === 'cdp_no_stream'
  ) {
    mapDownloadFailure(runtime, commandId, result, {
      operation: 'generate-image',
    });
  }

  mapExtractionFailure(runtime, commandId, result, {
    operation: 'generate-image',
  });
}

async function executeGenerateImage(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs) {
  const startResult = await executeStartImageTask(runtime, browserLifecycle, imageTaskStore, 'start-image-task', parsedArgs);
  const taskId = startResult.task?.taskId;
  if (!hasText(taskId)) {
    throwCommandFailure({
      runtime,
      commandId,
      category: 'internal-error',
      message: 'Image task start did not return a task id.',
      reason: 'image-task-missing-id',
      details: { startResult },
    });
  }

  const collectResult = await executeCollectImageTask(runtime, browserLifecycle, imageTaskStore, 'collect-image-task', { taskId });
  const task = collectResult.task;

  return buildBaseResult(commandId, {
    task,
    mode: task?.fullSize ? 'full-size-download' : 'preview-extraction',
    output: task?.output ?? null,
    referenceImages: Array.isArray(task?.referenceImages) ? task.referenceImages : [],
    message: task?.output?.filePath
      ? `Generated a Gemini image and wrote the artifact to ${task.output.filePath}.`
      : `Generated a Gemini image via task ${taskId}.`,
  });
}

async function executeUploadImages(runtime, browserLifecycle, commandId, parsedArgs) {
  const images = validateLocalImagePaths(runtime, commandId, parsedArgs.images);

  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const uploads = [];
    for (const image of images) {
      const uploadResult = await session.ops.uploadImage(image.normalizedPath);
      if (!uploadResult?.ok) {
        mapUploadFailure(runtime, commandId, uploadResult, {
          inputPath: image.inputPath,
          normalizedPath: image.normalizedPath,
          uploadedCount: uploads.length,
          requestedCount: images.length,
        });
      }

      uploads.push({
        inputPath: image.inputPath,
        normalizedPath: image.normalizedPath,
        elapsedMs: uploadResult.elapsed ?? null,
        warning: uploadResult.warning ?? null,
      });
    }

    return buildSessionResult(commandId, session, {
      uploadedCount: uploads.length,
      requestedCount: images.length,
      uploads,
      message: `Uploaded ${uploads.length} image${uploads.length === 1 ? '' : 's'} to the current Gemini prompt.`,
    });
  });
}

async function executeGetImages(runtime, browserLifecycle, commandId) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.getAllImages();
    if (!result?.ok) {
      throwSelectorFailure(runtime, commandId, 'No Gemini images were available on the current page.', 'no-loaded-images', {
        legacyResult: result,
      });
    }

    return buildSessionResult(commandId, session, {
      total: result.total ?? 0,
      newCount: result.newCount ?? 0,
      images: Array.isArray(result.images) ? result.images : [],
    });
  });
}

async function executeExtractImage(runtime, browserLifecycle, commandId, parsedArgs) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await session.ops.extractImageBase64(parsedArgs.imageUrl);
    if (!result?.ok) {
      mapExtractionFailure(runtime, commandId, result, {
        imageUrl: parsedArgs.imageUrl,
      });
    }

    const output = writeDataUrlArtifact(runtime, result.dataUrl, {
      prefix: 'gemini',
      semantics: 'extracted-preview-image',
      sourceUrl: parsedArgs.imageUrl,
      method: result.method ?? null,
    });

    return buildSessionResult(commandId, session, {
      extractionMethod: result.method ?? null,
      imageUrl: parsedArgs.imageUrl,
      output,
      message: `Extracted the Gemini image preview and wrote it to ${output.filePath}.`,
    });
  });
}

async function executeDownloadFullSizeImage(runtime, browserLifecycle, commandId, parsedArgs) {
  return withGeminiSession(runtime, browserLifecycle, async (session) => {
    const result = await withLegacyOutputDir(runtime, () => session.ops.downloadFullSizeImage({
      index: parsedArgs.index ?? undefined,
    }));

    if (!result?.ok) {
      mapDownloadFailure(runtime, commandId, result);
    }

    return buildSessionResult(commandId, session, {
      output: buildOutputArtifact(runtime, result.filePath, {
        semantics: 'downloaded-full-size-image',
        suggestedFilename: result.suggestedFilename ?? null,
        sourceUrl: result.src ?? null,
      }),
      download: {
        index: result.index ?? null,
        total: result.total ?? null,
        requestedIndex: parsedArgs.index,
        suggestedFilename: result.suggestedFilename ?? null,
        sourceUrl: result.src ?? null,
      },
      message: `Downloaded the full-size Gemini image to ${result.filePath}.`,
    });
  });
}

export function isImageMediaCommand(commandId) {
  return HANDLED_COMMAND_IDS.has(commandId);
}

export async function executeImageMediaCommand({
  command,
  passthroughArgs,
  runtime,
  browserLifecycle,
  imageTaskStore,
}) {
  const commandId = command.id;
  if (!isImageMediaCommand(commandId)) {
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
    case 'start-image-task':
      return executeStartImageTask(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs);
    case 'get-image-task':
      return executeGetImageTask(runtime, imageTaskStore, commandId, parsedArgs);
    case 'collect-image-task':
      return executeCollectImageTask(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs);
    case 'generate-image':
      return executeGenerateImage(runtime, browserLifecycle, imageTaskStore, commandId, parsedArgs);
    case 'upload-images':
      return executeUploadImages(runtime, browserLifecycle, commandId, parsedArgs);
    case 'get-images':
      return executeGetImages(runtime, browserLifecycle, commandId);
    case 'extract-image':
      return executeExtractImage(runtime, browserLifecycle, commandId, parsedArgs);
    case 'download-full-size-image':
      return executeDownloadFullSizeImage(runtime, browserLifecycle, commandId, parsedArgs);
    default:
      return null;
  }
}
