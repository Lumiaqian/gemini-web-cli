#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { dispatchHybridNativeCliCommand } from '../src/shell/dispatch-command.mjs';
import { getExitCodeForCategory } from '../src/runtime/exit-codes.mjs';

const ONE_BY_ONE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0i8AAAAASUVORK5CYII=';
const ONE_BY_ONE_PNG_DATA_URL = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;

function createBufferStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });

  return {
    stream,
    read() {
      return text;
    },
  };
}

async function runJsonCommand(argv, dependencies) {
  const stdout = createBufferStream();
  const stderr = createBufferStream();
  const exitCode = await dispatchHybridNativeCliCommand(argv, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    dependencies,
  });

  return {
    exitCode,
    stdout: stdout.read(),
    stderr: stderr.read(),
    envelope: JSON.parse(stdout.read()),
  };
}

function createTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTempPng(directory, name) {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));
  return filePath;
}

function createHappyPathDependencies(tempDir) {
  const calls = [];
  const downloadPath = writeTempPng(tempDir, 'full-size-download.png');

  const ops = {
    async checkLogin() {
      calls.push('check-login');
      return { ok: true, loggedIn: true, barText: 'Profile Menu' };
    },
    async click(key) {
      calls.push(`click:${key}`);
      return { ok: true };
    },
    async ensureModelPro() {
      calls.push('ensure-model-pro');
      return { ok: true, switched: false };
    },
    async uploadImage(filePath) {
      calls.push(`upload:${path.basename(filePath)}`);
      return { ok: true, elapsed: 25 };
    },
    async generateImage(prompt, { fullSize, timeout }) {
      calls.push(`generate:${prompt}:${fullSize}:${timeout}`);
      if (fullSize) {
        return {
          ok: true,
          method: 'fullSize',
          elapsed: 222,
          filePath: downloadPath,
          suggestedFilename: path.basename(downloadPath),
          src: 'https://example.test/full-size.png',
          index: 1,
          total: 2,
        };
      }

      return {
        ok: true,
        method: 'canvas',
        elapsed: 111,
        dataUrl: ONE_BY_ONE_PNG_DATA_URL,
      };
    },
    async getAllImages() {
      calls.push('get-all-images');
      return {
        ok: true,
        total: 2,
        newCount: 1,
        images: [
          { src: 'blob:first', alt: 'first', width: 512, height: 512, isNew: false, index: 0 },
          { src: 'blob:second', alt: 'second', width: 1024, height: 1024, isNew: true, index: 1 },
        ],
      };
    },
    async extractImageBase64(imageUrl) {
      calls.push(`extract:${imageUrl}`);
      return {
        ok: true,
        method: 'cdp',
        dataUrl: ONE_BY_ONE_PNG_DATA_URL,
      };
    },
    async downloadFullSizeImage({ index } = {}) {
      calls.push(`download:${index ?? 'latest'}`);
      return {
        ok: true,
        filePath: downloadPath,
        suggestedFilename: path.basename(downloadPath),
        src: 'https://example.test/full-size-direct.png',
        index: index ?? 1,
        total: 2,
      };
    },
  };

  const browserLifecycle = {
    async acquireSession(runtime) {
      calls.push(`acquire:${runtime.commandId}`);
      return {
        ops,
        reused: false,
        staleSessionReplaced: false,
        daemonStrategy: 'keep',
      };
    },
    async disconnectSession(runtime) {
      calls.push(`disconnect:${runtime.commandId}`);
      return {
        disconnected: true,
        browserPreserved: true,
        daemonStrategy: 'keep',
      };
    },
  };

  return { dependencies: { browserLifecycle }, calls, downloadPath };
}

function createFailureDependencies(mode) {
  const calls = [];

  const ops = {
    async checkLogin() {
      calls.push('check-login');
      return { ok: true, loggedIn: true };
    },
    async ensureModelPro() {
      calls.push('ensure-model-pro');
      return { ok: true, switched: false };
    },
    async uploadImage(filePath) {
      calls.push(`upload:${path.basename(filePath)}`);
      if (mode === 'upload-failure') {
        return { ok: false, error: 'upload_image_failed', detail: 'chooser blocked' };
      }
      return { ok: true, elapsed: 12 };
    },
    async extractImageBase64(imageUrl) {
      calls.push(`extract:${imageUrl}`);
      if (mode === 'extract-failure') {
        return { ok: false, error: 'cdp_error', detail: 'socket closed' };
      }
      return { ok: true, dataUrl: ONE_BY_ONE_PNG_DATA_URL, method: 'cdp' };
    },
    async downloadFullSizeImage({ index } = {}) {
      calls.push(`download:${index ?? 'latest'}`);
      if (mode === 'index-out-of-range') {
        return { ok: false, error: 'index_out_of_range', requestedIndex: index, total: 2 };
      }
      if (mode === 'download-missing') {
        return { ok: false, error: 'downloaded_file_not_found', filePath: '/tmp/missing-full-size.png', index: index ?? 0, total: 2 };
      }
      return { ok: true, filePath: '/tmp/unused.png', index: index ?? 0, total: 1 };
    },
    async generateImage(prompt, { fullSize, timeout }) {
      calls.push(`generate:${prompt}:${fullSize}:${timeout}`);
      if (mode === 'generate-timeout') {
        return {
          ok: false,
          error: 'timeout',
          elapsed: timeout,
          finalStatus: { status: 'stop', btnClass: 'stop' },
        };
      }

      return {
        ok: true,
        method: fullSize ? 'fullSize' : 'canvas',
        elapsed: 12,
        dataUrl: ONE_BY_ONE_PNG_DATA_URL,
        filePath: '/tmp/unused.png',
      };
    },
  };

  const browserLifecycle = {
    async acquireSession(runtime) {
      calls.push(`acquire:${runtime.commandId}`);
      return {
        ops,
        reused: false,
        staleSessionReplaced: false,
        daemonStrategy: 'keep',
      };
    },
    async disconnectSession(runtime) {
      calls.push(`disconnect:${runtime.commandId}`);
    },
  };

  return { dependencies: { browserLifecycle }, calls };
}

async function verifyHappyPathCoverage() {
  const tempDir = createTempDir('image-media-happy-');
  try {
    const referenceOne = writeTempPng(tempDir, 'reference-one.png');
    const referenceTwo = writeTempPng(tempDir, 'reference-two.png');
    const uploadOne = writeTempPng(tempDir, 'upload-one.png');
    const uploadTwo = writeTempPng(tempDir, 'upload-two.png');
    const { dependencies, calls, downloadPath } = createHappyPathDependencies(tempDir);

    const upload = await runJsonCommand([
      'upload-images',
      '--json',
      '--output-dir', tempDir,
      '--images', `${uploadOne},${uploadTwo}`,
    ], dependencies);
    assert.equal(upload.exitCode, 0);
    assert.equal(upload.envelope.result.uploadedCount, 2);
    assert.equal(upload.envelope.result.requestedCount, 2);

    const getImages = await runJsonCommand(['get-images', '--json', '--output-dir', tempDir], dependencies);
    assert.equal(getImages.exitCode, 0);
    assert.equal(getImages.envelope.result.total, 2);
    assert.equal(getImages.envelope.result.newCount, 1);

    const extract = await runJsonCommand([
      'extract-image',
      '--json',
      '--output-dir', tempDir,
      '--image-url', 'blob:second',
    ], dependencies);
    assert.equal(extract.exitCode, 0);
    assert.equal(extract.envelope.result.output.semantics, 'extracted-preview-image');
    assert.equal(extract.envelope.result.output.wroteFile, true);
    assert.ok(existsSync(extract.envelope.result.output.filePath));

    const generatePreview = await runJsonCommand([
      'generate-image',
      '--json',
      '--output-dir', tempDir,
      '--prompt', 'A bright sunrise over mountains',
      '--reference-images', referenceOne,
      '--reference-images', referenceTwo,
      '--timeout', '190000',
    ], dependencies);
    assert.equal(generatePreview.exitCode, 0);
    assert.equal(generatePreview.envelope.result.mode, 'preview-extraction');
    assert.equal(generatePreview.envelope.result.output.semantics, 'generated-preview-image');
    assert.ok(existsSync(generatePreview.envelope.result.output.filePath));
    assert.equal(generatePreview.envelope.result.referenceImages.length, 2);

    const generateFullSize = await runJsonCommand([
      'generate-image',
      '--json',
      '--output-dir', tempDir,
      '--prompt', 'A cinematic storm cloud',
      '--full-size',
    ], dependencies);
    assert.equal(generateFullSize.exitCode, 0);
    assert.equal(generateFullSize.envelope.result.mode, 'full-size-download');
    assert.equal(generateFullSize.envelope.result.output.semantics, 'generated-full-size-image');
    assert.equal(generateFullSize.envelope.result.output.filePath, downloadPath);

    const download = await runJsonCommand([
      'download-full-size-image',
      '--json',
      '--output-dir', tempDir,
      '--index', '1',
    ], dependencies);
    assert.equal(download.exitCode, 0);
    assert.equal(download.envelope.result.output.semantics, 'downloaded-full-size-image');
    assert.equal(download.envelope.result.download.index, 1);
    assert.equal(download.envelope.result.output.filePath, downloadPath);

    assert.match(calls.join('\n'), /upload:upload-one\.png/);
    assert.match(calls.join('\n'), /upload:reference-one\.png/);
    assert.match(calls.join('\n'), /generate:A bright sunrise over mountains:false:190000/);
    assert.match(calls.join('\n'), /generate:A cinematic storm cloud:true:/);
    assert.match(calls.join('\n'), /download:1/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function verifyMissingFileFailure() {
  const result = await runJsonCommand([
    'upload-images',
    '--json',
    '--images', '/definitely/missing/image.png',
  ], {
    browserLifecycle: {
      async acquireSession() {
        throw new Error('acquireSession should not run for missing file validation');
      },
      async disconnectSession() {
        throw new Error('disconnectSession should not run for missing file validation');
      },
    },
  });

  assert.equal(result.exitCode, getExitCodeForCategory('invalid-args'));
  assert.equal(result.envelope.error.category, 'invalid-args');
  assert.equal(result.envelope.error.details.reason, 'file-not-found');
}

async function verifyUploadFailureCoverage() {
  const tempDir = createTempDir('image-media-upload-fail-');
  try {
    const imagePath = writeTempPng(tempDir, 'broken-upload.png');
    const { dependencies, calls } = createFailureDependencies('upload-failure');
    const result = await runJsonCommand([
      'upload-images',
      '--json',
      '--output-dir', tempDir,
      '--images', imagePath,
    ], dependencies);

    assert.equal(result.exitCode, getExitCodeForCategory('selector-failure'));
    assert.equal(result.envelope.error.category, 'selector-failure');
    assert.equal(result.envelope.error.details.reason, 'upload_image_failed');
    assert.deepEqual(calls, ['acquire:upload-images', 'upload:broken-upload.png', 'disconnect:upload-images']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function verifyIndexOutOfRangeCoverage() {
  const { dependencies, calls } = createFailureDependencies('index-out-of-range');
  const result = await runJsonCommand([
    'download-full-size-image',
    '--json',
    '--index', '9',
  ], dependencies);

  assert.equal(result.exitCode, getExitCodeForCategory('invalid-args'));
  assert.equal(result.envelope.error.category, 'invalid-args');
  assert.equal(result.envelope.error.details.reason, 'index-out-of-range');
  assert.equal(result.envelope.error.details.requestedIndex, 9);
  assert.deepEqual(calls, ['acquire:download-full-size-image', 'download:9', 'disconnect:download-full-size-image']);
}

async function verifyExtractionFailureCoverage() {
  const tempDir = createTempDir('image-media-extract-fail-');
  try {
    const { dependencies, calls } = createFailureDependencies('extract-failure');
    const result = await runJsonCommand([
      'extract-image',
      '--json',
      '--output-dir', tempDir,
      '--image-url', 'blob:broken',
    ], dependencies);

    assert.equal(result.exitCode, getExitCodeForCategory('internal-error'));
    assert.equal(result.envelope.error.category, 'internal-error');
    assert.equal(result.envelope.error.details.reason, 'extract-image-failed');
    assert.deepEqual(calls, ['acquire:extract-image', 'extract:blob:broken', 'disconnect:extract-image']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function verifyGenerateTimeoutCoverage() {
  const { dependencies, calls } = createFailureDependencies('generate-timeout');
  const result = await runJsonCommand([
    'generate-image',
    '--json',
    '--prompt', 'timeout-case',
    '--timeout', '9000',
  ], dependencies);

  assert.equal(result.exitCode, getExitCodeForCategory('timeout'));
  assert.equal(result.envelope.error.category, 'timeout');
  assert.equal(result.envelope.error.details.reason, 'generate-image-timeout');
  assert.equal(result.envelope.error.details.elapsedMs, 9000);
  assert.deepEqual(calls, [
    'acquire:generate-image',
    'check-login',
    'ensure-model-pro',
    'generate:timeout-case:false:9000',
    'disconnect:generate-image',
  ]);
}

async function verifyDownloadFailureCoverage() {
  const { dependencies, calls } = createFailureDependencies('download-missing');
  const result = await runJsonCommand([
    'download-full-size-image',
    '--json',
    '--index', '0',
  ], dependencies);

  assert.equal(result.exitCode, getExitCodeForCategory('internal-error'));
  assert.equal(result.envelope.error.category, 'internal-error');
  assert.equal(result.envelope.error.details.reason, 'download-full-size-image-failed');
  assert.deepEqual(calls, ['acquire:download-full-size-image', 'download:0', 'disconnect:download-full-size-image']);
}

async function main() {
  await verifyHappyPathCoverage();
  await verifyMissingFileFailure();
  await verifyUploadFailureCoverage();
  await verifyIndexOutOfRangeCoverage();
  await verifyExtractionFailureCoverage();
  await verifyGenerateTimeoutCoverage();
  await verifyDownloadFailureCoverage();
  process.stdout.write('OK image-media-test-entry\n');
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});
