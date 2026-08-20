/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for lark-cli.
 *
 * Runs as a standalone stdio process spawned by the MCP client. Each tool spawns the
 * lark-cli binary once and returns its JSON output, so the full breadth of the official
 * CLI (docs, sheets, base, calendar, mail, tasks, im, approval, and more) is exposed
 * without reimplementing any of it — and the CLI keeps its own version and update cycle.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_LARK_CLI_MCP_NAME } from '@/common/config/constants';
import { buildLarkCliInvocation, execLarkCli, type ExecLarkCliResult } from './larkCliCommand';

function textResult(result: ExecLarkCliResult) {
  return {
    content: [{ type: 'text' as const, text: result.text }],
    isError: !result.ok,
  };
}

async function main() {
  const server = new McpServer({
    name: BUILTIN_LARK_CLI_MCP_NAME,
    version: '1.0.0',
  });

  server.tool(
    'lark_cli_run',
    'Run any lark-cli command. lark-cli is the official Lark/Feishu CLI for messaging, docs, drive, sheets, base, calendar, mail, tasks, approval, attendance, wiki, slides, and more. JSON is the default output format. Prefer a +prefixed shortcut when one matches the task. Browse a domain with lark_cli_help and inspect a method with lark_cli_schema before calling it. Write operations require user confirmation; the --yes gate in lark-cli itself stays authoritative, so never add --yes unless the user explicitly approved. Use dry_run to preview without executing.',
    {
      argv: z
        .array(z.string())
        .min(1)
        .describe('Command tokens to run, e.g. docs +fetch --doc <doc-url> --detail simple.'),
      dry_run: z.boolean().optional().describe('Append --dry-run: print the request without executing it.'),
      jq: z.string().optional().describe('Append --jq <expr> to filter the JSON output.'),
    },
    async ({ argv, dry_run, jq }) => {
      const args = buildLarkCliInvocation({ argv, dryRun: dry_run, jq });
      return textResult(await execLarkCli(args));
    }
  );

  server.tool(
    'lark_cli_help',
    'Browse lark-cli commands. Run with no args for the overview, or pass a domain path (e.g. docs) to list that domain commands and flags. Prefer this over guessing a command.',
    {
      argv: z.array(z.string()).optional().describe('Optional domain path, e.g. docs.'),
    },
    async ({ argv }) => {
      const tokens = argv && argv.length > 0 ? [...argv, '--help'] : [];
      return textResult(await execLarkCli(tokens));
    }
  );

  server.tool(
    'lark_cli_schema',
    'Inspect a Lark API method parameters, types, and scopes before calling it. Equivalent to lark-cli schema <service.resource.method>.',
    {
      path: z.string().min(1).describe('Service resource method, e.g. mail.user_mailbox.messages.list.'),
    },
    async ({ path }) => {
      return textResult(await execLarkCli(['schema', path]));
    }
  );

  server.tool(
    'lark_cli_skills',
    'Read lark-cli embedded agent guidance (SKILL.md and references), kept in sync with the CLI version. Use this to get domain-specific usage rules before a complex operation.',
    {
      action: z.enum(['list', 'read']).describe('List skills, or read one skill.'),
      path: z
        .string()
        .optional()
        .describe('Skill path to read, e.g. lark-doc or lark-doc/references/lark-doc-fetch.md.'),
    },
    async ({ action, path }) => {
      const tokens = ['skills', action];
      if (path) tokens.push(path);
      return textResult(await execLarkCli(tokens));
    }
  );

  server.tool(
    'lark_cli_auth_status',
    'Check the current lark-cli auth status (identity, profile, token). Equivalent to lark-cli auth status --json.',
    {
      verify: z.boolean().optional().describe('Also verify the token against the server (requires network).'),
    },
    async ({ verify }) => {
      const tokens = ['auth', 'status', '--json'];
      if (verify) tokens.push('--verify');
      return textResult(await execLarkCli(tokens));
    }
  );

  server.tool(
    'lark_cli_auth_login',
    'Log in to lark-cli via the official Device Flow. Two phases: 1) initiate with no_wait=true to get the verification URL and device code, show them to the user, and end the turn; 2) after the user confirms, call again with device_code to complete. Never run the blocking login from an agent tool.',
    {
      no_wait: z
        .boolean()
        .optional()
        .describe('Initiate device authorization and return immediately (verification URL and device code).'),
      device_code: z
        .string()
        .optional()
        .describe('Complete a previously initiated login by polling with this device code.'),
      domain: z.array(z.string()).optional().describe('Domains to request scopes for, e.g. calendar or task.'),
      recommend: z.boolean().optional().describe('Request only recommended (auto-approve) scopes.'),
    },
    async ({ no_wait, device_code, domain, recommend }) => {
      const tokens = ['auth', 'login'];
      if (no_wait) tokens.push('--no-wait', '--json');
      if (device_code) tokens.push('--device-code', device_code);
      if (domain && domain.length > 0) tokens.push('--domain', domain.join(','));
      if (recommend) tokens.push('--recommend');
      return textResult(await execLarkCli(tokens, { timeoutMs: 300_000 }));
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[LarkCliMCP] Fatal error:', error);
  process.exit(1);
});
