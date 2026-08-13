'use strict';

const fs = require('fs');
const path = require('path');

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'session-skill'
  );
}

function readSession(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Session file not found: ${inputPath}`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${inputPath}: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Session root must be an object');
  }
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  if (messages.length === 0) {
    throw new Error('Session must include a non-empty messages array');
  }
  return raw;
}

function extractGoal(session) {
  const firstUser = (session.messages || []).find(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim()
  );
  if (firstUser) {
    const line = firstUser.content.trim().split(/\n/)[0].trim();
    return line.slice(0, 200);
  }
  if (session.title && typeof session.title === 'string') return session.title.trim();
  if (session.goal && typeof session.goal === 'string') return session.goal.trim();
  return 'Reproduce a successful agent workflow from a recorded session';
}

function extractToolCalls(messages) {
  const calls = [];
  for (const m of messages) {
    if (m.role === 'tool' || m.type === 'tool_result') {
      calls.push({
        kind: 'result',
        name: m.name || m.tool || 'tool',
        content:
          typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content || '', null, 2),
      });
      continue;
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const fn = tc.function || tc;
        let args = fn.arguments || tc.arguments || {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch (_) {
            /* keep string */
          }
        }
        calls.push({
          kind: 'call',
          name: fn.name || tc.name || 'tool',
          args,
        });
      }
    }
    if (m.role === 'assistant' && m.tool) {
      calls.push({
        kind: 'call',
        name: m.tool,
        args: m.input || m.args || {},
      });
    }
  }
  return calls;
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function extractCommands(toolCalls) {
  const cmds = [];
  for (const tc of toolCalls) {
    if (tc.kind !== 'call') continue;
    const n = (tc.name || '').toLowerCase();
    const args = tc.args || {};
    if (
      n.includes('shell') ||
      n === 'bash' ||
      n === 'run_terminal_cmd' ||
      n === 'execute'
    ) {
      const cmd = args.command || args.cmd || args.script;
      if (cmd && typeof cmd === 'string') cmds.push(cmd.trim());
    }
  }
  return unique(cmds);
}

function extractFilesTouched(toolCalls) {
  const files = [];
  for (const tc of toolCalls) {
    if (tc.kind !== 'call') continue;
    const args = tc.args || {};
    const pathKeys = ['path', 'file_path', 'filePath', 'filename', 'target'];
    for (const k of pathKeys) {
      if (typeof args[k] === 'string' && args[k].trim()) files.push(args[k].trim());
    }
  }
  return unique(files);
}

function extractAssistantSteps(messages) {
  const steps = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const text = typeof m.content === 'string' ? m.content.trim() : '';
    if (!text) continue;
    const para = text.split(/\n\n+/)[0].replace(/\n/g, ' ').trim();
    if (para.length > 20) steps.push(para.slice(0, 280));
  }
  return steps.slice(0, 12);
}

function yamlEscape(s) {
  const t = String(s).replace(/\n/g, ' ').trim();
  if (/[:#{}\[\],&*?!<>%@`"']/.test(t) || t.includes(': ')) {
    return JSON.stringify(t);
  }
  return t;
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  return t.slice(0, max) + '\n…(truncated)';
}

function buildSkillMarkdown({ name, description, goal, steps, commands, files }) {
  const procedure = [];
  procedure.push('# ' + titleCase(name.replace(/-/g, ' ')));
  procedure.push('');
  procedure.push('## When to use');
  procedure.push('');
  procedure.push(`Use this skill when the user asks to: **${goal}**`);
  procedure.push('');
  procedure.push('## Procedure');
  procedure.push('');
  if (steps.length) {
    steps.forEach((s, i) => {
      procedure.push(`${i + 1}. ${s}`);
    });
  } else {
    procedure.push('1. Clarify the goal with the user.');
    procedure.push('2. Inspect relevant files.');
    procedure.push('3. Apply the minimal change that satisfies the goal.');
    procedure.push('4. Verify with a focused command or test.');
  }
  procedure.push('');
  if (commands.length) {
    procedure.push('## Commands observed');
    procedure.push('');
    for (const c of commands) {
      procedure.push('```bash');
      procedure.push(c);
      procedure.push('```');
      procedure.push('');
    }
  }
  if (files.length) {
    procedure.push('## Files involved');
    procedure.push('');
    for (const f of files) {
      procedure.push(`- \`${f}\``);
    }
    procedure.push('');
  }
  procedure.push('## References');
  procedure.push('');
  procedure.push('- See `references/session-summary.md` for the condensed source transcript.');
  procedure.push('- See `INSTALL.md` for Cursor and Claude Code install paths.');
  procedure.push('');
  procedure.push('## Notes');
  procedure.push('');
  procedure.push('- Distilled heuristically from a successful agent session (no LLM API).');
  procedure.push('- Adapt paths and commands to the target repository before running them.');
  procedure.push('');

  const fm = [
    '---',
    `name: ${name}`,
    `description: ${yamlEscape(description)}`,
    '---',
    '',
  ].join('\n');

  return fm + procedure.join('\n');
}

function buildSessionSummary(session, { goal, commands, files }) {
  const lines = [];
  lines.push('# Session summary');
  lines.push('');
  lines.push(`**Title:** ${session.title || '(none)'}`);
  lines.push(`**Goal:** ${goal}`);
  lines.push('');
  if (session.id) lines.push(`**Session id:** ${session.id}`);
  if (session.created_at || session.timestamp) {
    lines.push(`**Recorded:** ${session.created_at || session.timestamp}`);
  }
  lines.push('');
  lines.push('## Condensed transcript');
  lines.push('');

  for (const m of session.messages || []) {
    const role = m.role || m.type || 'message';
    if (role === 'tool' || m.type === 'tool_result') {
      const name = m.name || m.tool || 'tool';
      const body =
        typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content || '', null, 2);
      lines.push(`### tool:${name}`);
      lines.push('');
      lines.push('```');
      lines.push(truncate(body, 1200));
      lines.push('```');
      lines.push('');
      continue;
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      if (typeof m.content === 'string' && m.content.trim()) {
        lines.push('### assistant');
        lines.push('');
        lines.push(truncate(m.content.trim(), 1500));
        lines.push('');
      }
      lines.push('### assistant (tool calls)');
      lines.push('');
      for (const tc of m.tool_calls) {
        const fn = tc.function || tc;
        let args = fn.arguments || tc.arguments || {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch (_) {}
        }
        lines.push(`- **${fn.name || tc.name}**`);
        lines.push('');
        lines.push('```json');
        lines.push(truncate(JSON.stringify(args, null, 2), 800));
        lines.push('```');
        lines.push('');
      }
      continue;
    }
    const text = typeof m.content === 'string' ? m.content.trim() : '';
    if (text) {
      lines.push(`### ${role}`);
      lines.push('');
      lines.push(truncate(text, 1500));
      lines.push('');
    }
  }

  if (commands.length) {
    lines.push('## Shell / tool commands');
    lines.push('');
    for (const c of commands) lines.push(`- \`${c}\``);
    lines.push('');
  }
  if (files.length) {
    lines.push('## Files touched');
    lines.push('');
    for (const f of files) lines.push(`- \`${f}\``);
    lines.push('');
  }
  return lines.join('\n');
}

function buildInstallMd(name) {
  return [
    `# Install \`${name}\``,
    '',
    'Copy this skill folder into one of the paths below, then restart or reload the agent.',
    '',
    '## Cursor',
    '',
    '```',
    `.cursor/skills/${name}/`,
    '```',
    '',
    'Place the contents of this directory (including `SKILL.md` and `references/`) at:',
    '',
    `\`.cursor/skills/${name}/\``,
    '',
    '## Claude Code',
    '',
    '```',
    `~/.claude/skills/${name}/`,
    '```',
    '',
    'Place the contents of this directory at:',
    '',
    `\`~/.claude/skills/${name}/\``,
    '',
    '## Verify',
    '',
    '- Cursor: open Agent / Skills and confirm the skill name appears.',
    '- Claude Code: run `/skills` (or equivalent) and confirm the skill is listed.',
    '',
  ].join('\n');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function convertSession({ inputPath, outDir, nameOverride }) {
  const session = readSession(inputPath);
  const goal = extractGoal(session);
  const toolCalls = extractToolCalls(session.messages || []);
  const commands = extractCommands(toolCalls);
  const files = extractFilesTouched(toolCalls);
  const steps = extractAssistantSteps(session.messages || []);

  const baseName =
    nameOverride ||
    session.skill_name ||
    session.name ||
    session.title ||
    path.basename(outDir) ||
    slugify(goal);
  const name = slugify(baseName);

  const description =
    (session.description && String(session.description).trim()) ||
    `Distilled from a successful agent session: ${goal}. Use when repeating this workflow.`;

  const skillMd = buildSkillMarkdown({
    name,
    description,
    goal,
    steps,
    commands,
    files,
  });
  const summary = buildSessionSummary(session, { goal, commands, files });
  const installMd = buildInstallMd(name);

  ensureDir(outDir);
  const referencesDir = path.join(outDir, 'references');
  ensureDir(referencesDir);

  const skillMdPath = path.join(outDir, 'SKILL.md');
  const summaryPath = path.join(referencesDir, 'session-summary.md');
  const installPath = path.join(outDir, 'INSTALL.md');

  fs.writeFileSync(skillMdPath, skillMd, 'utf8');
  fs.writeFileSync(summaryPath, summary, 'utf8');
  fs.writeFileSync(installPath, installMd, 'utf8');

  return {
    skillName: name,
    skillMdPath,
    referencesDir,
    written: ['SKILL.md', 'INSTALL.md', 'references/session-summary.md'],
  };
}

module.exports = { convertSession, slugify, extractGoal };
