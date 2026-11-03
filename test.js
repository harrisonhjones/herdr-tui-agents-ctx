// Run with: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { tierOf, reportArgs } = require('./agents-ctx.js');

test('tierOf rounds down and picks the threshold token', () => {
  assert.deepEqual(tierOf(34.4), { name: 'ctx_lo', value: '34%' });
  assert.deepEqual(tierOf(49.9), { name: 'ctx_lo', value: '49%' });
  assert.deepEqual(tierOf(50), { name: 'ctx_mid', value: '50%' });
  assert.deepEqual(tierOf(79.9), { name: 'ctx_mid', value: '79%' });
  assert.deepEqual(tierOf(80), { name: 'ctx_hi', value: '80%' });
  assert.deepEqual(tierOf('96.2'), { name: 'ctx_hi', value: '96%' });
});

test('reportArgs sets one token and clears the other two', () => {
  assert.deepEqual(reportArgs('w0:p7', 55.2, 123), [
    'pane', 'report-metadata', 'w0:p7', '--source', 'agents-ctx', '--seq', '123',
    '--token', 'ctx_mid=55%', '--ttl-ms', '600000', '--clear-token', 'ctx_lo', '--clear-token', 'ctx_hi',
  ]);
});

// End to end with a fake original command and no herdr pane.
test('claude-statusline passes the original output and exit status through', () => {
  const env = { ...process.env };
  delete env.HERDR_PANE_ID;
  const input = JSON.stringify({ session_id: 's1', context_window: { used_percentage: 12.5 } });
  const run = (...cmd) => spawnSync(process.execPath, [path.join(__dirname, 'agents-ctx.js'), 'claude-statusline', ...cmd],
    { input, env, encoding: 'utf8' });
  const echo = run(process.execPath, '-e', 'process.stdin.pipe(process.stdout)');
  assert.equal(echo.stdout, input);
  assert.equal(echo.status, 0);
  const failed = run(process.execPath, '-e', 'process.stdout.write("partial"); process.exit(3)');
  assert.equal(failed.stdout, 'partial');
  assert.equal(failed.status, 3);
  assert.equal(run('/nonexistent-command').status, 1);
});
