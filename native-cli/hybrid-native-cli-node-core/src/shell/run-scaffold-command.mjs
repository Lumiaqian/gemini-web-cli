import { CLI_ENTRYPOINT, TEST_ENTRYPOINT, getRouteScaffoldMetadata } from '../route-metadata.mjs';
import { describeSessionBridge } from '../node-core/session-bridge.mjs';
import { describeDaemonBridge } from '../node-core/daemon-bridge.mjs';

function fail(message) {
  throw new Error(message);
}

function write(stream, text) {
  stream.write(`${text}\n`);
}

function printJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {
    describeScaffold: false,
    json: false,
    help: false,
  };

  for (const token of argv) {
    if (token === '--describe-scaffold') {
      args.describeScaffold = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  if (!args.describeScaffold && !args.help) {
    args.describeScaffold = true;
  }

  return args;
}

export function describeScaffold() {
  const metadata = getRouteScaffoldMetadata();

  return {
    routeId: metadata.routeId,
    daemonStrategy: metadata.daemonStrategy,
    scaffoldVersion: metadata.scaffoldVersion,
    buildEntrypoint: metadata.buildEntrypoint,
    cliEntrypoint: CLI_ENTRYPOINT,
    testEntrypoint: TEST_ENTRYPOINT,
    nodeCoreBoundaries: [describeSessionBridge(), describeDaemonBridge()],
    scope: 'Scaffold only. Command tree and capability handlers are implemented in dispatch-command.mjs.',
  };
}

function usageLines() {
  return [
    'Usage: node native-cli/hybrid-native-cli-node-core/src/cli-dev-entry.mjs [--describe-scaffold] [--json]',
    '',
    'Flags:',
    '  --describe-scaffold  Print the selected-route scaffold metadata.',
    '  --json               Emit one JSON document to stdout.',
    '  --help, -h           Show this help.',
  ];
}

export async function runHybridNativeCliShell(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const args = parseArgs(argv);

    if (args.help) {
      for (const line of usageLines()) {
        write(io.stdout, line);
      }
      return 0;
    }

    const payload = describeScaffold();

    if (args.json) {
      printJson(io.stdout, payload);
      return 0;
    }

    write(io.stdout, `route=${payload.routeId}`);
    write(io.stdout, `daemon_strategy=${payload.daemonStrategy}`);
    write(io.stdout, `build=${payload.buildEntrypoint}`);
    write(io.stdout, `test=${payload.testEntrypoint}`);
    write(io.stdout, 'status=scaffold-ready');
    return 0;
  } catch (error) {
    write(io.stderr, `ERROR: ${error.message}`);
    return 64;
  }
}
