#!/usr/bin/env node
'use strict';

const path = require('path');
const { convertSession } = require('../src/convert');

function printHelp() {
  console.log(`session-skill — convert an agent session into an installable Agent Skill

Usage:
  session-skill convert <session.json> --out <dir> [--name <name>]
  session-skill --help

Options:
  --out <dir>   Output skill directory (SKILL.md + references/ + INSTALL.md)
  --name <n>    Override skill name (default: from session title or out folder)
  --help        Show this help

Example:
  session-skill convert fixtures/sample-session.json --out ./skills/add-retry-to-fetch
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { cmd: 'help' };
  }
  const cmd = args[0];
  if (cmd !== 'convert') {
    return { cmd: 'error', message: `Unknown command: ${cmd}` };
  }
  const rest = args.slice(1);
  let input = null;
  let out = null;
  let name = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--out') {
      out = rest[++i];
    } else if (a === '--name') {
      name = rest[++i];
    } else if (!a.startsWith('-') && !input) {
      input = a;
    } else {
      return { cmd: 'error', message: `Unexpected argument: ${a}` };
    }
  }
  if (!input) return { cmd: 'error', message: 'Missing <session.json>' };
  if (!out) return { cmd: 'error', message: 'Missing --out <dir>' };
  return { cmd: 'convert', input, out, name };
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.cmd === 'help') {
    printHelp();
    process.exit(0);
  }
  if (opts.cmd === 'error') {
    console.error(`Error: ${opts.message}\n`);
    printHelp();
    process.exit(1);
  }

  try {
    const result = convertSession({
      inputPath: path.resolve(opts.input),
      outDir: path.resolve(opts.out),
      nameOverride: opts.name || null,
    });
    console.log('Converted session → Agent Skill');
    console.log(`  skill:      ${result.skillName}`);
    console.log(`  SKILL.md:   ${result.skillMdPath}`);
    console.log(`  references: ${result.referencesDir}`);
    console.log(`  files:      ${result.written.join(', ')}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
