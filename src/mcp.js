import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allTools, callTool } from './tools.js';
import { toZodShape } from './schema.js';
import { promptOf } from './team.js';

// Servidor MCP "stateless": um servidor por requisição, ideal para Render e para conectar no Claude.
export function buildMcpServer() {
  // O prompt mestre viaja como "instruções" do servidor, para o Claude agir como gestora de tráfego.
  let instructions = '';
  try { instructions = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'master.md'), 'utf8'); } catch {}
  instructions += `\n\n---\n${promptOf('time')}`;
  const server = new McpServer({ name: 'traffic-agent', version: '0.2.0' }, { instructions });
  for (const t of allTools) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: toZodShape(t.params || {}) },
      async (args) => {
        const out = await callTool(t.name, args, 'mcp');
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      }
    );
  }
  return server;
}
