# Compatibility Impact Record

Use this record for one legacy MCP capability and one native CLI command at a time.

## Identity

- Legacy MCP tool:
- Native CLI command:
- Capability group:
- Current parity classification:
- Impact level (`compatible`, `minor`, `breaking`, `deferred`):

## Inputs

- Current inputs and defaults:
- Native inputs and defaults:
- Input changes that callers must notice:

## Outputs

- Current observable success payload:
- Native CLI `result` payload:
- Current observable failure payload:
- Native CLI `error` payload:
- Output changes that affect scripts or CI:

## Runtime Behavior

- Shared runtime dependencies to preserve:
- Side effects to preserve:
- Timeout behavior:
- Cancellation behavior:
- Local file writes or browser-state mutations:

## Machine Contract

- Stdout contract confirmation:
- Stderr contract confirmation:
- Exit codes exercised by this command:
- Long-running notes:

## Compatibility Assessment

- Input changes:
- Output changes:
- Behavior changes:
- Migration notes for downstream callers:

## Evidence

- Source references:
- Fixture or validator references:
- Verification command output references:

## Risks And Follow-ups

- Risks or tensions that remain after this assessment:
- Follow-up tasks required before release:
