#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const steps = [
  ['node', ['bin/session-skill.js', 'convert', 'fixtures/sample-session.json', '--out', './skills/add-retry-to-fetch']],
  ['node', ['scripts/print-demo.js']],
];
for (const [cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
