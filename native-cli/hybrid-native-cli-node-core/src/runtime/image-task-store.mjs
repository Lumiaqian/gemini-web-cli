import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const STORE_VERSION = 1;
const TASK_PROTOCOL_VERSION = 1;
const DEFAULT_ROOT = path.join(homedir(), '.gemini-web-cli');
const DEFAULT_STORE_FILE = path.join(DEFAULT_ROOT, 'image-tasks.json');
const ACTIVE_STATES = new Set(['queued', 'generating', 'image_visible', 'collecting']);
const REUSABLE_STATES = new Set(['queued', 'generating', 'image_visible', 'collecting', 'completed']);
const REUSE_WINDOW_MS = 15 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function defaultStoreShape() {
  return {
    schemaVersion: STORE_VERSION,
    tasks: {},
  };
}

function safeParseStore(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.tasks !== 'object') {
      return defaultStoreShape();
    }
    return {
      schemaVersion: STORE_VERSION,
      tasks: parsed.tasks,
    };
  } catch {
    return defaultStoreShape();
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildHistoryEntry(state, note = null) {
  return {
    state,
    at: nowIso(),
    note,
  };
}

function generateTaskId() {
  return `imgtask_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortObject(value[key]);
      return acc;
    }, {});
  }
  return value;
}

export function buildImageTaskKey(input) {
  const canonical = JSON.stringify(sortObject(input));
  return createHash('sha256').update(canonical).digest('hex');
}

export function createImageTaskStore({ storeFile = DEFAULT_STORE_FILE } = {}) {
  function ensureStoreDir() {
    mkdirSync(path.dirname(storeFile), { recursive: true });
  }

  function readStore() {
    ensureStoreDir();
    if (!existsSync(storeFile)) {
      return defaultStoreShape();
    }
    return safeParseStore(readFileSync(storeFile, 'utf8'));
  }

  function writeStore(store) {
    ensureStoreDir();
    writeFileSync(storeFile, JSON.stringify(store, null, 2));
  }

  function listTasks() {
    return Object.values(readStore().tasks)
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      .map(clone);
  }

  function getTask(taskId) {
    const task = readStore().tasks[taskId];
    return task ? clone(task) : null;
  }

  function createTask(payload) {
    const store = readStore();
    const createdAt = nowIso();
    const taskId = generateTaskId();
    const task = {
      taskId,
      protocolVersion: TASK_PROTOCOL_VERSION,
      kind: 'image-generation',
      state: 'queued',
      createdAt,
      updatedAt: createdAt,
      idempotencyKey: payload.idempotencyKey,
      prompt: payload.prompt,
      fullSize: Boolean(payload.fullSize),
      newSession: Boolean(payload.newSession),
      timeoutMs: payload.timeoutMs ?? null,
      referenceImages: Array.isArray(payload.referenceImages) ? [...payload.referenceImages] : [],
      session: payload.session ?? null,
      image: null,
      output: null,
      error: null,
      history: [buildHistoryEntry('queued', 'task-created')],
    };
    store.tasks[taskId] = task;
    writeStore(store);
    return clone(task);
  }

  function updateTask(taskId, updater) {
    const store = readStore();
    const existing = store.tasks[taskId];
    if (!existing) {
      return null;
    }

    const draft = clone(existing);
    const next = updater(draft) ?? draft;
    next.taskId = existing.taskId;
    next.protocolVersion = existing.protocolVersion;
    next.kind = existing.kind;
    next.createdAt = existing.createdAt;
    next.updatedAt = nowIso();
    next.history = Array.isArray(next.history) ? next.history : [];

    if (next.state !== existing.state) {
      next.history.push(buildHistoryEntry(next.state));
    }

    store.tasks[taskId] = next;
    writeStore(store);
    return clone(next);
  }

  function findReusableTaskByKey(idempotencyKey, { nowMs = Date.now() } = {}) {
    if (!idempotencyKey) return null;

    const tasks = Object.values(readStore().tasks)
      .filter((task) => task.idempotencyKey === idempotencyKey)
      .filter((task) => REUSABLE_STATES.has(task.state))
      .filter((task) => {
        const updatedAtMs = Date.parse(task.updatedAt ?? task.createdAt ?? 0);
        return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= REUSE_WINDOW_MS;
      })
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));

    return tasks.length > 0 ? clone(tasks[0]) : null;
  }

  function markFailed(taskId, error) {
    return updateTask(taskId, (task) => ({
      ...task,
      state: 'failed',
      error: error ? clone(error) : { message: 'unknown-error' },
    }));
  }

  function toPublicTask(task) {
    if (!task) return null;
    return {
      taskId: task.taskId,
      protocolVersion: task.protocolVersion,
      kind: task.kind,
      state: task.state,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      prompt: task.prompt,
      fullSize: task.fullSize,
      newSession: task.newSession,
      timeoutMs: task.timeoutMs,
      referenceImages: Array.isArray(task.referenceImages) ? [...task.referenceImages] : [],
      session: task.session ? clone(task.session) : null,
      image: task.image ? clone(task.image) : null,
      output: task.output ? clone(task.output) : null,
      error: task.error ? clone(task.error) : null,
      active: ACTIVE_STATES.has(task.state),
    };
  }

  return Object.freeze({
    storeFile,
    listTasks,
    getTask,
    createTask,
    updateTask,
    findReusableTaskByKey,
    markFailed,
    toPublicTask,
  });
}
