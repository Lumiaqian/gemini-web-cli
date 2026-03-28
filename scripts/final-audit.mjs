#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SPEC_ROOT = 'specs';
const DEFAULT_PLAN = 'specs/test-harness.md';
const DEFAULT_ROUTE = 'hybrid-native-cli-node-core';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    modeIds: [],
    plan: DEFAULT_PLAN,
    fixture: null,
    requireAllDeliverables: false,
    failOnBlocker: false,
    requireEvidence: false,
    failOnScopeDrift: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--mode') {
      args.modeIds.push(argv[++index] ?? fail('missing value for --mode'));
      continue;
    }
    if (token === '--plan') {
      args.plan = argv[++index] ?? fail('missing value for --plan');
      continue;
    }
    if (token === '--fixture') {
      args.fixture = argv[++index] ?? fail('missing value for --fixture');
      continue;
    }
    if (token === '--require-all-deliverables') {
      args.requireAllDeliverables = true;
      continue;
    }
    if (token === '--fail-on-blocker') {
      args.failOnBlocker = true;
      continue;
    }
    if (token === '--require-evidence') {
      args.requireEvidence = true;
      continue;
    }
    if (token === '--fail-on-scope-drift') {
      args.failOnScopeDrift = true;
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  return args;
}

function loadText(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`unable to read ${filePath}: ${error.message}`);
  }
}

function loadFixture(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`unable to load fixture ${filePath}: ${error.message}`);
  }
}

function ensureFileExists(filePath, stepId) {
  if (!existsSync(filePath)) {
    fail(`${stepId} missing file: ${filePath}`);
  }
}

function ensureIncludes(filePath, includes, stepId) {
  const text = loadText(filePath);
  const missing = includes.filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    fail(`${stepId} missing required content in ${filePath}: ${missing.join(', ')}`);
  }
}

function ensureExcludes(filePath, excludes, stepId) {
  const text = loadText(filePath);
  const found = excludes.filter((needle) => text.includes(needle));
  if (found.length > 0) {
    fail(`${stepId} found forbidden content in ${filePath}: ${found.join(', ')}`);
  }
}

function formatCommand(step) {
  return ['node', step.script, ...step.args].join(' ');
}

function runCommand(step) {
  const result = spawnSync(process.execPath, [step.script, ...step.args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    fail(`unable to run ${step.id}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runFixtureGuard(modeId, args) {
  const fixture = loadFixture(args.fixture);
  if (!fixture) {
    return;
  }

  if (modeId === 'plan-compliance' && args.requireAllDeliverables) {
    const missing = Array.isArray(fixture.missingDeliverables) ? fixture.missingDeliverables : [];
    if (missing.length > 0) {
      fail(`plan-compliance fixture reports missing deliverables: ${missing.join(', ')}`);
    }
  }

  if (modeId === 'quality-review' && args.failOnBlocker) {
    const blockers = Array.isArray(fixture.blockers) ? fixture.blockers : [];
    if (blockers.length > 0) {
      fail(`quality-review fixture reports blocker defects: ${blockers.join(', ')}`);
    }
  }

  if (modeId === 'e2e-regression' && args.requireEvidence) {
    const missingEvidence = Array.isArray(fixture.missingEvidence) ? fixture.missingEvidence : [];
    if (missingEvidence.length > 0) {
      fail(`e2e-regression fixture reports missing evidence: ${missingEvidence.join(', ')}`);
    }
  }

  if (modeId === 'scope-fidelity' && args.failOnScopeDrift) {
    const scopeDrift = Array.isArray(fixture.scopeDrift) ? fixture.scopeDrift : [];
    if (scopeDrift.length > 0) {
      fail(`scope-fidelity fixture reports scope drift: ${scopeDrift.join(', ')}`);
    }
  }
}

function getModes(args) {
  return [
    {
      id: 'plan-compliance',
      description: 'Verify Task 4 harness deliverables, plan file presence, and smoke fixture documentation anchors.',
      steps: [
        {
          type: 'file-exists',
          id: 'required-harness-files',
          files: [
            args.plan,
            `${SPEC_ROOT}/test-harness.md`,
            `${SPEC_ROOT}/fixtures/smoke/README.md`,
            `${SPEC_ROOT}/fixtures/smoke/bad-smoke-interactive.json`,
            `${SPEC_ROOT}/fixtures/smoke/describe-scaffold-built-artifact.json`,
            'scripts/test-unit.mjs',
            'scripts/test-integration.mjs',
            'scripts/run-smoke.mjs',
            'scripts/final-audit.mjs',
            'scripts/ci-local.mjs',
            '.github/workflows/selected-route-ci.yml',
          ],
        },
        {
          type: 'content-includes',
          id: 'harness-doc-links',
          file: `${SPEC_ROOT}/test-harness.md`,
          includes: [
            'check-parity.mjs',
            'test-contract.mjs',
            'check-route-matrix.mjs',
            'fixtures/smoke',
            'plan-compliance',
            'quality-review',
            'e2e-regression',
            'scope-fidelity',
          ],
        },
        {
          type: 'content-includes',
          id: 'smoke-readme-policy',
          file: `${SPEC_ROOT}/fixtures/smoke/README.md`,
          includes: ['interactive', '--require-noninteractive', 'describe-scaffold-built-artifact.json'],
        },
        {
          type: 'content-includes',
          id: 'plan-final-wave-anchors',
          file: args.plan,
          includes: ['Final Verification Wave', 'scripts/final-audit.mjs', 'plan-compliance', 'scope-fidelity'],
        },
      ],
    },
    {
      id: 'quality-review',
      description: 'Run the route-neutral unit and integration harnesses.',
      steps: [
        {
          type: 'command',
          id: 'unit-harness',
          script: 'scripts/test-unit.mjs',
          args: [],
        },
        {
          type: 'command',
          id: 'integration-harness',
          script: 'scripts/test-integration.mjs',
          args: [],
        },
      ],
    },
    {
      id: 'e2e-regression',
      description: 'Run the selected-route local CI orchestration including built-artifact smoke and docs checks.',
      steps: [
        {
          type: 'command',
          id: 'local-ci',
          script: 'scripts/ci-local.mjs',
          args: ['--selected-route', DEFAULT_ROUTE],
        },
      ],
    },
    {
      id: 'scope-fidelity',
      description: 'Check frozen validators plus the CLI-first docs and repo automation surface.',
      steps: [
        {
          type: 'content-includes',
          id: 'plan-scope-anchors',
          file: 'README.md',
          includes: ['主入口: `node scripts/run-cli.mjs`', '## CLI 优先入口', '脚本和 CI 应该优先使用 `--json`'],
        },
        {
          type: 'command',
          id: 'parity-validator',
          script: 'scripts/check-parity.mjs',
          args: ['--source', 'cli', '--expected-count', '16', '--require-classification'],
        },
        {
          type: 'command',
          id: 'contract-validator',
          script: 'scripts/test-contract.mjs',
          args: ['--fixtures', 'contract'],
        },
        {
          type: 'command',
          id: 'route-matrix-validator',
          script: 'scripts/check-route-matrix.mjs',
          args: ['--require-go', '--require-rust', '--require-hybrid', '--require-daemon-decision'],
        },
        {
          type: 'command',
          id: 'docs-validator',
          script: 'scripts/check-docs.mjs',
          args: ['--require-cli-primary', '--require-compat-report', '--detect-stale-scripts', '--detect-missing-deps'],
        },
        {
          type: 'content-includes',
          id: 'readme-en-cli-primary',
          file: 'README.en.md',
          includes: ['CLI-first', 'node scripts/run-cli.mjs', '--json', 'primary entrypoint'],
        },
        {
          type: 'content-excludes',
          id: 'readme-en-no-mcp-primary',
          file: 'README.en.md',
          excludes: ['npm run demo'],
        },
        {
          type: 'content-includes',
          id: 'skill-cli-primary',
          file: 'SKILL.md',
          includes: ['首选 CLI', 'node scripts/run-cli.mjs', 'CLI-first', '次选仓库脚本'],
        },
        {
          type: 'content-excludes',
          id: 'skill-no-mcp-primary',
          file: 'SKILL.md',
          excludes: ['npm run demo'],
        },
        {
          type: 'file-exists',
          id: 'repo-workflow-present',
          files: ['.github/workflows/selected-route-ci.yml'],
        },
        {
          type: 'content-includes',
          id: 'repo-workflow-runs-local-ci',
          file: '.github/workflows/selected-route-ci.yml',
          includes: ['node scripts/ci-local.mjs --selected-route hybrid-native-cli-node-core'],
        },
      ],
    },
  ];
}

function selectModes(args) {
  const modes = getModes(args);
  if (args.modeIds.length === 0) {
    return modes;
  }

  return args.modeIds.map((modeId) => {
    const mode = modes.find((entry) => entry.id === modeId);
    if (!mode) {
      fail(`unknown mode: ${modeId}`);
    }
    return mode;
  });
}

function executeStep(step) {
  if (step.type === 'file-exists') {
    for (const file of step.files) {
      ensureFileExists(file, step.id);
    }
    return;
  }

  if (step.type === 'content-includes') {
    ensureIncludes(step.file, step.includes, step.id);
    return;
  }

  if (step.type === 'content-excludes') {
    ensureExcludes(step.file, step.excludes, step.id);
    return;
  }

  if (step.type === 'command') {
    runCommand(step);
    return;
  }

  fail(`unsupported step type: ${step.type}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = selectModes(args);

  if (args.dryRun) {
    console.log(`DRY RUN final-audit modes=${modes.length} plan=${args.plan} fixture=${args.fixture ?? 'none'}`);
    for (const mode of modes) {
      console.log(`mode=${mode.id} steps=${mode.steps.length} description="${mode.description}"`);
      for (const step of mode.steps) {
        if (step.type === 'command') {
          console.log(`step=${step.id} type=command command="${formatCommand(step)}"`);
          continue;
        }
        if (step.type === 'file-exists') {
          console.log(`step=${step.id} type=file-exists files=${step.files.join(',')}`);
          continue;
        }
        if (step.type === 'content-includes') {
          console.log(`step=${step.id} type=content-includes file=${step.file} includes=${step.includes.join(',')}`);
          continue;
        }
        if (step.type === 'content-excludes') {
          console.log(`step=${step.id} type=content-excludes file=${step.file} excludes=${step.excludes.join(',')}`);
        }
      }
    }
    return;
  }

  for (const mode of modes) {
    console.log(`RUN audit-mode=${mode.id}`);
    runFixtureGuard(mode.id, args);
    for (const step of mode.steps) {
      executeStep(step);
    }
  }

  console.log(`OK audit-modes=${modes.length}`);
}

main();
