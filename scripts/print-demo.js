#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '..', 'skills', 'add-retry-to-fetch');
const skillMd = path.join(outDir, 'SKILL.md');
const installMd = path.join(outDir, 'INSTALL.md');
const summary = path.join(outDir, 'references', 'session-summary.md');

console.log('');
console.log('Demo output paths:');
console.log('  ' + skillMd);
console.log('  ' + installMd);
console.log('  ' + summary);
console.log('');

if (!fs.existsSync(skillMd)) {
  console.error('SKILL.md missing — convert failed');
  process.exit(1);
}

const text = fs.readFileSync(skillMd, 'utf8');
const preview = text.split('\n').slice(0, 28).join('\n');
console.log('--- SKILL.md preview ---');
console.log(preview);
console.log('------------------------');
console.log('');
console.log('Install tips:');
console.log('  Cursor:      cp -R skills/add-retry-to-fetch .cursor/skills/add-retry-to-fetch');
console.log('  Claude Code: cp -R skills/add-retry-to-fetch ~/.claude/skills/add-retry-to-fetch');
