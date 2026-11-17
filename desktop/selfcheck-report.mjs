/**
 * One authority for "did the off-screen self-check actually pass?".
 *
 * A green process exit code is not evidence on its own: the run must also have written a report
 * that parses and says passed=true with every check ok. build.mjs uses this, and desktop/test.mjs
 * exercises it against fabricated reports so a weakened gate goes red.
 */
import { existsSync, readFileSync } from 'node:fs';

export class SelfCheckError extends Error {}

export function readSelfCheckReport({ path, exitCode }) {
  if (!existsSync(path)) {
    throw new SelfCheckError(
      `self-check produced no report (exit ${exitCode}); report expected at ${path}`,
    );
  }

  let result;
  try {
    result = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SelfCheckError(`self-check report is not valid JSON: ${path} (${error.message})`);
  }

  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new SelfCheckError(`self-check report is empty: ${path}`);
  }
  if (!Object.hasOwn(result, 'passed')) {
    throw new SelfCheckError(`self-check report has no 'passed' field: ${path}`);
  }
  if (result.passed !== true) {
    throw new SelfCheckError(`self-check report does not say passed=true: ${path}`);
  }
  if (!Object.hasOwn(result, 'checks') || !Array.isArray(result.checks)) {
    throw new SelfCheckError(`self-check report has no 'checks' list: ${path}`);
  }
  if (result.checks.length === 0) {
    throw new SelfCheckError(`self-check report contains no checks: ${path}`);
  }

  const failed = result.checks.filter((check) => !check || check.ok !== true);
  if (failed.length > 0) {
    const names = failed.map((check) => check?.name ?? '(unnamed)').join('; ');
    throw new SelfCheckError(
      `self-check has ${failed.length} failing check(s): ${names}; report: ${path}`,
    );
  }

  if (exitCode !== 0) {
    throw new SelfCheckError(
      `self-check exited ${exitCode} while its report passed; refusing to trust either. report: ${path}`,
    );
  }

  return result;
}
