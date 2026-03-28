import { format } from 'node:util';

export class CliRuntimeFailure extends Error {
  constructor({ category, message, details = null, terminalState = 'failed', cancelledBySignal = null }) {
    super(message);
    this.name = 'CliRuntimeFailure';
    this.category = category;
    this.details = details;
    this.terminalState = terminalState;
    this.cancelledBySignal = cancelledBySignal;
  }
}

function writeLine(stream, text) {
  stream.write(`${text}\n`);
}

export function createStdioRuntime({ stdout = process.stdout, stderr = process.stderr, jsonMode = false }) {
  function writeStdout(text) {
    writeLine(stdout, text);
  }

  function writeStderr(text) {
    writeLine(stderr, text);
  }

  function emitJson(value) {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  async function withMachineOutputGuard(action) {
    if (!jsonMode) {
      return action();
    }

    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    process.stdout.write = function guardedStdoutWrite(chunk, encoding, callback) {
      return stderr.write(chunk, encoding, callback);
    };

    const redirect = (...args) => writeStderr(format(...args));
    console.log = redirect;
    console.info = redirect;
    console.warn = redirect;
    console.error = redirect;
    console.debug = redirect;

    try {
      return await action();
    } finally {
      process.stdout.write = originalStdoutWrite;
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
    }
  }

  async function runCommand(action, { timeoutMs }) {
    return withMachineOutputGuard(async () => {
      const cleanups = [];
      const raced = [Promise.resolve().then(action)];

      if (Number.isInteger(timeoutMs)) {
        let timer = null;
        raced.push(new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new CliRuntimeFailure({
              category: 'timeout',
              message: `Command exceeded timeout budget of ${timeoutMs}ms.`,
              details: { elapsedMs: timeoutMs, timeoutMs },
              terminalState: 'timed_out',
            }));
          }, timeoutMs);
        }));
        cleanups.push(() => clearTimeout(timer));
      }

      for (const signalName of ['SIGINT', 'SIGTERM']) {
        const onSignal = () => {
          throwSignal(signalName);
        };
        process.once(signalName, onSignal);
        cleanups.push(() => process.removeListener(signalName, onSignal));
      }

      let signalReject = null;
      function throwSignal(signalName) {
        if (signalReject) {
          signalReject(new CliRuntimeFailure({
            category: 'interrupted',
            message: `Command interrupted by ${signalName}.`,
            details: { signal: signalName },
            terminalState: 'interrupted',
            cancelledBySignal: signalName,
          }));
        }
      }

      raced.push(new Promise((_, reject) => {
        signalReject = reject;
      }));

      try {
        return await Promise.race(raced);
      } finally {
        for (const cleanup of cleanups) {
          cleanup();
        }
      }
    });
  }

  return Object.freeze({
    jsonMode,
    writeStdout,
    writeStderr,
    emitJson,
    runCommand,
  });
}
