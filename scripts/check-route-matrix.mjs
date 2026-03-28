#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MATRIX = 'specs/route-matrix.json';
const REQUIRED_ROUTE_IDS = [
  'go-rewrite',
  'rust-rewrite',
  'hybrid-native-cli-node-core',
];
const REQUIRED_DAEMON_OPTION_IDS = ['keep', 'fold', 'replace'];
const VALID_DAEMON_CHOICES = new Set(REQUIRED_DAEMON_OPTION_IDS);
const DISPLAY_DECIMALS = 2;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    matrix: DEFAULT_MATRIX,
    requireRouteIds: new Set(),
    requireDaemonDecision: false,
    requireFinalDaemonChoice: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--matrix') {
      args.matrix = argv[++index] ?? fail('missing value for --matrix');
      continue;
    }
    if (token === '--require-go') {
      args.requireRouteIds.add('go-rewrite');
      continue;
    }
    if (token === '--require-rust') {
      args.requireRouteIds.add('rust-rewrite');
      continue;
    }
    if (token === '--require-hybrid') {
      args.requireRouteIds.add('hybrid-native-cli-node-core');
      continue;
    }
    if (token === '--require-daemon-decision') {
      args.requireDaemonDecision = true;
      args.requireFinalDaemonChoice = true;
      continue;
    }
    if (token === '--require-final-daemon-choice') {
      args.requireFinalDaemonChoice = true;
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  return args;
}

function resolveFromRoot(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

function loadJson(filePath) {
  const absolutePath = resolveFromRoot(filePath);
  let text;
  try {
    text = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    fail(`unable to read ${absolutePath}: ${error.message}`);
  }

  try {
    return {
      filePath: absolutePath,
      data: JSON.parse(text),
    };
  } catch (error) {
    fail(`invalid JSON in ${absolutePath}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function ensureNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function roundScore(value) {
  return Number(value.toFixed(DISPLAY_DECIMALS));
}

function compareNumbers(a, b) {
  if (a === b) {
    return 0;
  }
  return a > b ? 1 : -1;
}

function validateWeights(scoring, errors) {
  if (!isPlainObject(scoring)) {
    errors.push('scoring must be an object');
    return { scaleMin: null, scaleMax: null, weightsById: new Map() };
  }

  const scale = scoring.scale;
  if (!isPlainObject(scale)) {
    errors.push('scoring.scale must be an object');
  }

  const scaleMin = scale?.min;
  const scaleMax = scale?.max;
  if (!Number.isInteger(scaleMin)) {
    errors.push('scoring.scale.min must be an integer');
  }
  if (!Number.isInteger(scaleMax)) {
    errors.push('scoring.scale.max must be an integer');
  }
  if (Number.isInteger(scaleMin) && Number.isInteger(scaleMax) && scaleMax <= scaleMin) {
    errors.push('scoring.scale.max must be greater than scoring.scale.min');
  }

  if (!Array.isArray(scoring.weights) || scoring.weights.length === 0) {
    errors.push('scoring.weights must be a non-empty array');
    return { scaleMin, scaleMax, weightsById: new Map() };
  }

  const weightsById = new Map();
  let totalWeight = 0;
  scoring.weights.forEach((entry, index) => {
    const label = `scoring.weights[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (!ensureNonEmptyString(entry.id)) {
      errors.push(`${label}.id must be a non-empty string`);
      return;
    }
    if (!ensureNonEmptyString(entry.name)) {
      errors.push(`${label}.name must be a non-empty string`);
    }
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      errors.push(`${label}.weight must be a positive number`);
    } else {
      totalWeight += entry.weight;
    }
    if (!ensureNonEmptyString(entry.reason)) {
      errors.push(`${label}.reason must be a non-empty string`);
    }
    if (weightsById.has(entry.id)) {
      errors.push(`duplicate scoring criterion id: ${entry.id}`);
      return;
    }
    weightsById.set(entry.id, entry);
  });

  if (Math.abs(totalWeight - 100) > 0.000001) {
    errors.push(`scoring.weights must sum to 100, got ${totalWeight}`);
  }

  return { scaleMin, scaleMax, weightsById };
}

function validateDaemonStrategyOptions(options, errors) {
  if (!Array.isArray(options)) {
    errors.push('daemonStrategyOptions must be an array');
    return;
  }

  const seenIds = new Set();
  options.forEach((entry, index) => {
    const label = `daemonStrategyOptions[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (!ensureNonEmptyString(entry.id)) {
      errors.push(`${label}.id must be a non-empty string`);
      return;
    }
    if (!ensureNonEmptyString(entry.summary)) {
      errors.push(`${label}.summary must be a non-empty string`);
    }
    if (!ensureNonEmptyString(entry.repoFit)) {
      errors.push(`${label}.repoFit must be a non-empty string`);
    }
    if (seenIds.has(entry.id)) {
      errors.push(`duplicate daemon strategy option id: ${entry.id}`);
      return;
    }
    seenIds.add(entry.id);
  });

  const actualIds = [...seenIds].sort();
  const expectedIds = [...REQUIRED_DAEMON_OPTION_IDS].sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    errors.push(`daemonStrategyOptions must contain exactly: ${REQUIRED_DAEMON_OPTION_IDS.join(', ')}`);
  }
}

function calculateWeightedTotal(route, weightsById, scaleMax) {
  let total = 0;
  for (const [criterionId, criterion] of weightsById.entries()) {
    total += (criterion.weight * route.scores[criterionId]) / scaleMax;
  }
  return total;
}

function validateRoute(route, index, context, errors) {
  const { scaleMin, scaleMax, weightsById } = context;
  const label = `routes[${index}]`;

  if (!isPlainObject(route)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!ensureNonEmptyString(route.id)) {
    errors.push(`${label}.id must be a non-empty string`);
    return;
  }
  if (!ensureNonEmptyString(route.label)) {
    errors.push(`${label}.label must be a non-empty string`);
  }
  if (!ensureNonEmptyString(route.summary)) {
    errors.push(`${label}.summary must be a non-empty string`);
  }
  if (!ensureNonEmptyArray(route.repoFacts)) {
    errors.push(`${label}.repoFacts must be a non-empty array`);
  }

  if (!isPlainObject(route.daemonStrategy)) {
    errors.push(`${label}.daemonStrategy must be an object`);
  } else {
    if (!VALID_DAEMON_CHOICES.has(route.daemonStrategy.choice)) {
      errors.push(`${label}.daemonStrategy.choice must be one of ${REQUIRED_DAEMON_OPTION_IDS.join(', ')}`);
    }
    if (!ensureNonEmptyString(route.daemonStrategy.summary)) {
      errors.push(`${label}.daemonStrategy.summary must be a non-empty string`);
    }
    if (!ensureNonEmptyArray(route.daemonStrategy.reasons)) {
      errors.push(`${label}.daemonStrategy.reasons must be a non-empty array`);
    }
  }

  if (!isPlainObject(route.analysis)) {
    errors.push(`${label}.analysis must be an object`);
  } else {
    if (!ensureNonEmptyArray(route.analysis.strengths)) {
      errors.push(`${label}.analysis.strengths must be a non-empty array`);
    }
    if (!ensureNonEmptyArray(route.analysis.risks)) {
      errors.push(`${label}.analysis.risks must be a non-empty array`);
    }
  }

  if (!isPlainObject(route.scores)) {
    errors.push(`${label}.scores must be an object`);
    return;
  }

  const scoreKeys = Object.keys(route.scores).sort();
  const criterionIds = [...weightsById.keys()].sort();
  if (scoreKeys.length !== criterionIds.length || scoreKeys.some((key, keyIndex) => key !== criterionIds[keyIndex])) {
    errors.push(`${label}.scores must contain exactly the same criteria as scoring.weights`);
  }

  for (const criterionId of weightsById.keys()) {
    const score = route.scores[criterionId];
    if (!Number.isInteger(score) || score < scaleMin || score > scaleMax) {
      errors.push(`${label}.scores.${criterionId} must be an integer between ${scaleMin} and ${scaleMax}`);
    }
  }

  if (!Number.isFinite(route.weightedTotal)) {
    errors.push(`${label}.weightedTotal must be a number`);
    return;
  }

  const calculated = calculateWeightedTotal(route, weightsById, scaleMax);
  if (Math.abs(route.weightedTotal - calculated) > 0.000001) {
    errors.push(`${label}.weightedTotal mismatch: expected ${roundScore(calculated)}, got ${route.weightedTotal}`);
  }
}

function meetsMinimumScores(route, minimumScores) {
  const entries = Object.entries(minimumScores || {});
  return entries.every(([criterionId, minimum]) => route.scores[criterionId] >= minimum);
}

function compareCriterion(a, b, criterionId) {
  return compareNumbers(a.route.scores[criterionId], b.route.scores[criterionId]);
}

function breakTie(a, b, tieBreakRule) {
  const preferredComparison = compareCriterion(a, b, tieBreakRule.preferHigherCriterion);
  const aMeetsMinimums = meetsMinimumScores(a.route, tieBreakRule.minimumScores);
  const bMeetsMinimums = meetsMinimumScores(b.route, tieBreakRule.minimumScores);

  if (preferredComparison !== 0) {
    const preferred = preferredComparison > 0 ? a : b;
    const other = preferred === a ? b : a;
    const preferredMeetsMinimums = preferred === a ? aMeetsMinimums : bMeetsMinimums;
    const otherMeetsMinimums = other === a ? aMeetsMinimums : bMeetsMinimums;
    if (!preferredMeetsMinimums && otherMeetsMinimums) {
      return other;
    }
    return preferred;
  }

  if (aMeetsMinimums !== bMeetsMinimums) {
    return aMeetsMinimums ? a : b;
  }

  for (const criterionId of tieBreakRule.secondaryCriteria || []) {
    const comparison = compareCriterion(a, b, criterionId);
    if (comparison !== 0) {
      return comparison > 0 ? a : b;
    }
  }

  return [a, b].sort((left, right) => left.route.id.localeCompare(right.route.id))[0];
}

function determineOutcome(routes, tieBreakRule) {
  const ordered = [...routes].sort((left, right) => {
    const totalDifference = right.weightedTotal - left.weightedTotal;
    if (Math.abs(totalDifference) > 0.000001) {
      return totalDifference;
    }
    return left.route.id.localeCompare(right.route.id);
  });

  const winnerByTotal = ordered[0];
  const runnerUpByTotal = ordered[1] ?? null;
  if (!runnerUpByTotal) {
    return {
      winner: winnerByTotal,
      runnerUp: null,
      tieBreakApplied: false,
    };
  }

  const difference = Math.abs(winnerByTotal.weightedTotal - runnerUpByTotal.weightedTotal);
  if (difference > tieBreakRule.thresholdPoints) {
    return {
      winner: winnerByTotal,
      runnerUp: runnerUpByTotal,
      tieBreakApplied: false,
    };
  }

  const winner = breakTie(winnerByTotal, runnerUpByTotal, tieBreakRule);
  const runnerUp = winner.route.id === winnerByTotal.route.id ? runnerUpByTotal : winnerByTotal;
  return {
    winner,
    runnerUp,
    tieBreakApplied: true,
  };
}

function validateTieBreakRule(tieBreakRule, weightsById, scaleMin, scaleMax, errors) {
  if (!isPlainObject(tieBreakRule)) {
    errors.push('tieBreakRule must be an object');
    return;
  }

  if (!Number.isFinite(tieBreakRule.thresholdPoints) || tieBreakRule.thresholdPoints < 0) {
    errors.push('tieBreakRule.thresholdPoints must be a non-negative number');
  }
  if (!ensureNonEmptyString(tieBreakRule.preferHigherCriterion)) {
    errors.push('tieBreakRule.preferHigherCriterion must be a non-empty string');
  } else if (!weightsById.has(tieBreakRule.preferHigherCriterion)) {
    errors.push(`tieBreakRule.preferHigherCriterion must reference a scoring criterion: ${tieBreakRule.preferHigherCriterion}`);
  }
  if (!isPlainObject(tieBreakRule.minimumScores)) {
    errors.push('tieBreakRule.minimumScores must be an object');
  } else {
    for (const [criterionId, minimum] of Object.entries(tieBreakRule.minimumScores)) {
      if (!weightsById.has(criterionId)) {
        errors.push(`tieBreakRule.minimumScores contains unknown criterion: ${criterionId}`);
      }
      if (!Number.isInteger(minimum) || minimum < scaleMin || minimum > scaleMax) {
        errors.push(`tieBreakRule.minimumScores.${criterionId} must be an integer between ${scaleMin} and ${scaleMax}`);
      }
    }
  }
  if (!Array.isArray(tieBreakRule.secondaryCriteria) || tieBreakRule.secondaryCriteria.length === 0) {
    errors.push('tieBreakRule.secondaryCriteria must be a non-empty array');
  } else {
    tieBreakRule.secondaryCriteria.forEach((criterionId, index) => {
      if (!ensureNonEmptyString(criterionId) || !weightsById.has(criterionId)) {
        errors.push(`tieBreakRule.secondaryCriteria[${index}] must reference a scoring criterion`);
      }
    });
  }
  if (tieBreakRule.finalFallback !== 'route-id-lexicographic-ascending') {
    errors.push('tieBreakRule.finalFallback must be route-id-lexicographic-ascending');
  }
}

function validateFinalDecision(matrix, scoredRoutes, args, errors) {
  const routeIds = new Set(scoredRoutes.map((entry) => entry.route.id));

  if (!isPlainObject(matrix.finalDecision)) {
    errors.push('finalDecision must be an object');
    return;
  }
  if (!ensureNonEmptyString(matrix.finalDecision.selectedRoute)) {
    errors.push('finalDecision.selectedRoute must be a non-empty string');
    return;
  }
  if (!routeIds.has(matrix.finalDecision.selectedRoute)) {
    errors.push(`finalDecision.selectedRoute must match a route id: ${matrix.finalDecision.selectedRoute}`);
  }
  if (!ensureNonEmptyString(matrix.finalDecision.runnerUp)) {
    errors.push('finalDecision.runnerUp must be a non-empty string');
  } else if (!routeIds.has(matrix.finalDecision.runnerUp)) {
    errors.push(`finalDecision.runnerUp must match a route id: ${matrix.finalDecision.runnerUp}`);
  }
  if (!ensureNonEmptyString(matrix.finalDecision.selectionSummary)) {
    errors.push('finalDecision.selectionSummary must be a non-empty string');
  }
  if (!ensureNonEmptyArray(matrix.finalDecision.reasons)) {
    errors.push('finalDecision.reasons must be a non-empty array');
  }
  if (typeof matrix.finalDecision.tieBreakApplied !== 'boolean') {
    errors.push('finalDecision.tieBreakApplied must be a boolean');
  }

  const computed = determineOutcome(scoredRoutes, matrix.tieBreakRule);
  if (matrix.finalDecision.selectedRoute !== computed.winner.route.id) {
    errors.push(`finalDecision.selectedRoute must equal computed winner ${computed.winner.route.id}`);
  }
  if (ensureNonEmptyString(matrix.finalDecision.runnerUp) && matrix.finalDecision.runnerUp !== computed.runnerUp?.route.id) {
    errors.push(`finalDecision.runnerUp must equal computed runner-up ${computed.runnerUp?.route.id}`);
  }
  if (typeof matrix.finalDecision.tieBreakApplied === 'boolean' && matrix.finalDecision.tieBreakApplied !== computed.tieBreakApplied) {
    errors.push(`finalDecision.tieBreakApplied must equal computed value ${computed.tieBreakApplied}`);
  }

  if (args.requireFinalDaemonChoice) {
    if (!isPlainObject(matrix.finalDaemonChoice)) {
      errors.push('finalDaemonChoice must be an object when daemon decision is required');
      return;
    }
    if (!ensureNonEmptyString(matrix.finalDaemonChoice.routeId)) {
      errors.push('finalDaemonChoice.routeId must be a non-empty string');
    } else if (matrix.finalDaemonChoice.routeId !== matrix.finalDecision.selectedRoute) {
      errors.push(`finalDaemonChoice.routeId must equal finalDecision.selectedRoute (${matrix.finalDecision.selectedRoute})`);
    }
    if (!VALID_DAEMON_CHOICES.has(matrix.finalDaemonChoice.choice)) {
      errors.push(`finalDaemonChoice.choice must be one of ${REQUIRED_DAEMON_OPTION_IDS.join(', ')}`);
    }
    if (!ensureNonEmptyString(matrix.finalDaemonChoice.summary)) {
      errors.push('finalDaemonChoice.summary must be a non-empty string');
    }
    if (!ensureNonEmptyArray(matrix.finalDaemonChoice.reasons)) {
      errors.push('finalDaemonChoice.reasons must be a non-empty array');
    }

    const selectedRoute = scoredRoutes.find((entry) => entry.route.id === matrix.finalDecision.selectedRoute)?.route;
    if (selectedRoute && matrix.finalDaemonChoice.choice !== selectedRoute.daemonStrategy.choice) {
      errors.push(`finalDaemonChoice.choice must match ${selectedRoute.id}.daemonStrategy.choice (${selectedRoute.daemonStrategy.choice})`);
    }
  }
}

function validateMatrix(matrix, args) {
  const errors = [];
  if (!isPlainObject(matrix)) {
    return { errors, scoredRoutes: [] };
  }

  if (matrix.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }
  if (!ensureNonEmptyString(matrix.decisionId)) {
    errors.push('decisionId must be a non-empty string');
  }
  if (!ensureNonEmptyString(matrix.capabilityBaseline)) {
    errors.push('capabilityBaseline must be a non-empty string');
  }
  if (!ensureNonEmptyString(matrix.machineContractBaseline)) {
    errors.push('machineContractBaseline must be a non-empty string');
  }
  if (!ensureNonEmptyArray(matrix.repoFacts)) {
    errors.push('repoFacts must be a non-empty array');
  }

  const weightValidation = validateWeights(matrix.scoring, errors);
  validateDaemonStrategyOptions(matrix.daemonStrategyOptions, errors);
  validateTieBreakRule(matrix.tieBreakRule, weightValidation.weightsById, weightValidation.scaleMin, weightValidation.scaleMax, errors);

  if (!Array.isArray(matrix.routes)) {
    errors.push('routes must be an array');
    return { errors, scoredRoutes: [] };
  }

  if (matrix.routes.length !== REQUIRED_ROUTE_IDS.length) {
    errors.push(`routes must contain exactly ${REQUIRED_ROUTE_IDS.length} entries`);
  }

  const seenRouteIds = new Set();
  matrix.routes.forEach((route, index) => {
    validateRoute(route, index, weightValidation, errors);
    if (route?.id) {
      if (seenRouteIds.has(route.id)) {
        errors.push(`duplicate route id: ${route.id}`);
      }
      seenRouteIds.add(route.id);
    }
  });

  const actualRouteIds = [...seenRouteIds].sort();
  const expectedRouteIds = [...REQUIRED_ROUTE_IDS].sort();
  if (actualRouteIds.length !== expectedRouteIds.length || actualRouteIds.some((id, index) => id !== expectedRouteIds[index])) {
    errors.push(`routes must contain exactly: ${REQUIRED_ROUTE_IDS.join(', ')}`);
  }

  for (const routeId of args.requireRouteIds) {
    if (!seenRouteIds.has(routeId)) {
      errors.push(`required route is missing: ${routeId}`);
    }
  }

  const scoredRoutes = matrix.routes
    .filter((route) => isPlainObject(route) && ensureNonEmptyString(route.id) && isPlainObject(route.scores))
    .map((route) => ({
      route,
      weightedTotal: calculateWeightedTotal(route, weightValidation.weightsById, weightValidation.scaleMax),
    }));

  validateFinalDecision(matrix, scoredRoutes, args, errors);

  return { errors, scoredRoutes };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { filePath, data } = loadJson(args.matrix);
  const validation = validateMatrix(data, args);
  if (validation.errors.length > 0) {
    fail(validation.errors.join('; '));
  }

  const selectedRoute = data.finalDecision.selectedRoute;
  const selectedDaemon = data.finalDaemonChoice?.choice ?? 'not-required';
  console.log(
    `OK matrix=${path.relative(process.cwd(), filePath)} routes=${data.routes.length} selected=${selectedRoute} daemon=${selectedDaemon}`
  );
}

main();
