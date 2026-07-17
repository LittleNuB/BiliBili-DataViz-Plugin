import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('partial empty Dynamic Bill columns use a compact class and weighted desktop layout', async () => {
  const [source, styles, mock] = await Promise.all([
    readFile(new URL('../dashboard/modules/dynamic-bill/DynamicBillPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/styles/dashboard.css', import.meta.url), 'utf8'),
    readFile(new URL('./dynamic-bill-partial-empty.mock.html', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /dynamic-bill-column[^`]*is-empty/);
  assert.match(source, /className="dynamic-bill-column-empty"/);
  assert.match(styles, /\.dynamic-bill-board\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /\.dynamic-bill-column\.is-empty\s*\{[^}]*flex:/s);

  const compactBlock = styles.match(/\.dynamic-bill-column-empty\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.ok(compactBlock);
  assert.doesNotMatch(compactBlock, /min-height:\s*268px/);
  assert.match(styles, /\.dynamic-bill-empty\s*\{[^}]*min-height:\s*268px/s);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.dynamic-bill-board[^}]*grid-template-columns:\s*1fr/s);
  assert.match(mock, /scenario === "two-empty"/);
  assert.match(mock, /: "one-empty"/);
  assert.match(mock, /compactHeight < 120/);
  assert.match(mock, /hasHorizontalOverflow/);
});
