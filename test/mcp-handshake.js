/**
 * Boots the real MCP server as a subprocess over stdio and uses the SDK client
 * to perform the initialize handshake, then lists tools and prompts. Verifies
 * the server speaks MCP correctly without needing Glooko credentials (we only
 * list capabilities, we don't call the data tools).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/server.js'],
  env: { ...process.env, GLOOKO_EMAIL: 'noop@test', GLOOKO_PASSWORD: 'noop' },
});

const client = new Client({ name: 'selftest-client', version: '1.0.0' });

await client.connect(transport);

const tools = await client.listTools();
console.log('Tools registered:');
for (const t of tools.tools) console.log('  -', t.name, '::', t.title);

const prompts = await client.listPrompts();
console.log('Prompts registered:');
for (const p of prompts.prompts) console.log('  -', p.name, '::', p.title);

const expectedTools = [
  'get_diabetes_summary',
  'get_enriched_bolus_log',
  'get_hourly_trends',
  'get_settings_history',
  'get_trend',
  'get_chart_series',
  'get_basal_delivery',
  'get_device_events',
  'get_daily_insulin',
  'get_glucose',
  'get_meal_window_analysis',
];
const names = tools.tools.map((t) => t.name).sort();
const ok =
  expectedTools.every((n) => names.includes(n)) &&
  prompts.prompts.some((p) => p.name === 'clinical_auditor');

// Confirm a cap rejection comes back cleanly (no Glooko call needed: the cap
// check fires before any fetch).
const capTest = await client.callTool({
  name: 'get_glucose',
  arguments: {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-06-01T00:00:00.000Z',
  },
});
const capRejected =
  capTest.isError && /exceeds the .* limit/.test(capTest.content[0].text);
console.log('\nCap rejection works:', capRejected);
console.log('Cap message:', capTest.content[0].text.split('.')[0] + '.');

await client.close();
console.log('\nHandshake + capability listing:', ok ? 'PASS' : 'FAIL');
process.exit(ok && capRejected ? 0 : 1);
