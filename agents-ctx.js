#!/usr/bin/env node
// herdr-agents-ctx: shows each agent's context-window usage in herdr's Agents sidebar, by
// writing the percentage to the agent's pane as a metadata token. Each supported agent has an
// adapter that gets the percentage from that agent and passes it to report().
//
// Usage:
//   node agents-ctx.js claude-statusline <original status line command...>   (Claude Code statusLine.command)
//   node agents-ctx.js cursor-statusline <original status line command...>   (Cursor CLI statusLine.command)
//   node agents-ctx.js clear|doctor                                            (plugin actions)
'use strict';
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HERDR = process.env.HERDR_BIN_PATH || 'herdr';
const SOURCE = 'agents-ctx';
// Exactly one is set per pane, so the sidebar layout can give each threshold its own colour.
const TOKENS = ['ctx_lo', 'ctx_mid', 'ctx_hi'];
const MID = 50; // ctx_mid from this percentage
const HIGH = 80; // ctx_hi from this percentage
const TTL_MS = 600000; // the token disappears 10 minutes after the agent last reported
// Re-report an unchanged value after this long, so the TTL doesn't expire on an active agent.
const REREPORT_MS = 300000;

// Rounded down, so 85.9 shows as 85%, and 79.9 stays below the ctx_hi threshold.
function tierOf(pct) {
  const n = Math.floor(Number(pct));
  return { name: n >= HIGH ? 'ctx_hi' : n >= MID ? 'ctx_mid' : 'ctx_lo', value: `${n}%` };
}

// The millisecond clock is the sequence number, so a slower detached call can't
// overwrite a newer value, and `clear` always wins over earlier reports.
function reportArgs(pane, pct, seq) {
  const { name, value } = tierOf(pct);
  const args = ['pane', 'report-metadata', pane, '--source', SOURCE, '--seq', String(seq),
    '--token', `${name}=${value}`, '--ttl-ms', String(TTL_MS)];
  for (const t of TOKENS) if (t !== name) args.push('--clear-token', t);
  return args;
}

function detach(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

// Set the pane's context token. Adapters call this; the herdr call runs detached, so it
// doesn't hold up the agent.
function report(pane, pct) {
  if (!pane || pct == null) return;
  const { name, value } = tierOf(pct);
  const key = `${name}=${value}`;
  // Skip the herdr call when nothing changed and the last report is still fresh.
  const marker = path.join(os.tmpdir(), `herdr-agents-ctx-${pane.replace(/[^A-Za-z0-9_.-]/g, '_')}`);
  try {
    if (fs.readFileSync(marker, 'utf8') === key && Date.now() - fs.statSync(marker).mtimeMs < REREPORT_MS) return;
  } catch { /* first report for this pane */ }
  detach(HERDR, reportArgs(pane, pct, Date.now()));
  fs.writeFileSync(marker, key);
}

// Cursor CLI and Claude Code pass their status line command a JSON blob on stdin
// (StatusLinePayload) with context_window.used_percentage and related fields.
function contextPctFromPayload(data) {
  const cw = data && data.context_window;
  if (!cw) return null;
  const used = cw.used_percentage;
  if (used != null && used !== '' && !Number.isNaN(Number(used))) return Number(used);
  const size = Number(cw.context_window_size);
  if (!(size > 0)) return null;
  let tokens = cw.total_input_tokens;
  if (tokens == null && cw.current_usage && typeof cw.current_usage === 'object') {
    tokens = cw.current_usage.input_tokens ?? cw.current_usage.total_input_tokens;
  }
  if (tokens == null || Number.isNaN(Number(tokens))) return null;
  return (Number(tokens) / size) * 100;
}

// Status line adapter shared by Claude Code and Cursor CLI. Runs the original command with
// the same stdin, its output going straight to the agent, then reports the percentage. The
// agent waits for the original as it would without this wrapper; nothing is cached (README).
function statuslineAdapter(cmd) {
  const input = fs.readFileSync(0);
  let data = {};
  try { data = JSON.parse(input.toString('utf8')); } catch { /* not JSON: run the original only */ }
  if (cmd.length) {
    const r = spawnSync(cmd[0], cmd.slice(1), { input, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    process.exitCode = r.error ? 1 : (r.status ?? 1);
  }
  const pct = contextPctFromPayload(data);
  try { report(process.env.HERDR_PANE_ID, pct); } catch { /* never break the status line */ }
}

function claudeStatusline(cmd) {
  statuslineAdapter(cmd);
}

function cursorStatusline(cmd) {
  statuslineAdapter(cmd);
}

function herdr(args) {
  const r = spawnSync(HERDR, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`herdr ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout);
}

const ctxOf = (tokens) => TOKENS.find((t) => tokens && tokens[t] != null);

// Remove every token this plugin wrote. Each agent sets its token again on its next report
// once the value changes, or within REREPORT_MS.
function clear() {
  let n = 0;
  for (const p of herdr(['pane', 'list']).result.panes) {
    if (!ctxOf(p.tokens)) continue;
    herdr(['pane', 'report-metadata', p.pane_id, '--source', SOURCE, '--seq', String(Date.now()),
      ...TOKENS.flatMap((t) => ['--clear-token', t])]);
    n++;
  }
  console.log(`cleared context tokens on ${n} pane(s)`);
}

// Print each agent's context token, changing nothing.
function doctor() {
  const agents = herdr(['agent', 'list']).result.agents;
  for (const a of agents) {
    const t = ctxOf(a.tokens);
    const label = (a.tokens && a.tokens.tl) || a.name || '';
    console.log(`${a.pane_id.padEnd(8)} ${String(a.agent).padEnd(8)} ${(t ? `${t}=${a.tokens[t]}` : '-').padEnd(14)} ${label}`);
  }
  if (!agents.some((a) => ctxOf(a.tokens))) {
    console.log('No context tokens. See "Agents" in the README for how to connect each agent.');
  }
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'claude-statusline') return claudeStatusline(rest);
  if (mode === 'cursor-statusline') return cursorStatusline(rest);
  if (mode === 'clear') return clear();
  if (mode === 'doctor') return doctor();
  console.error('usage: node agents-ctx.js claude-statusline | cursor-statusline <command...> | clear | doctor');
  process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { tierOf, reportArgs, contextPctFromPayload };
