import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(
  new URL('../src/content/player-monitor/assistant-status.ts', import.meta.url),
  'utf8',
);

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const nextFunction = source.indexOf('\nfunction ', start + 1);
  assert.notEqual(nextFunction, -1, `${name} must be followed by another function`);
  return source.slice(start, nextFunction);
}

test('primary text selection invalidates in-page summary render token during active requests', () => {
  const body = functionBody('invalidatePrimaryTextDependentAssistantState');
  const incrementIndex = body.indexOf('assistantState.summaryRequestId += 1;');
  const activeRequestBranchIndex = body.indexOf('if (!assistantState.summaryActiveRequest)');
  assert.ok(incrementIndex >= 0, 'summaryRequestId must be incremented on primary text invalidation');
  assert.ok(
    activeRequestBranchIndex >= 0 && incrementIndex < activeRequestBranchIndex,
    'summaryRequestId increment must not be skipped while a summary request is active',
  );
});

test('summary generation finally restores when operation token is stale', () => {
  const body = functionBody('generateCurrentVideoSummaryHighlightsFromPage');
  assert.match(
    body,
    /const operationStale = assistantState\.summaryRequestId !== operationId\s+\|\|\s+assistantState\.contextKey !== contextKey;/,
  );
  assert.match(body, /if \(operationStale\) {\s+void restoreCurrentVideoSummaryHighlightsFromPage\(\);/);
});
