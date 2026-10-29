import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allTools, callTool } from './tools.js';
import { toZodShape } from './schema.js';

// Servidor MCP "stateless": um servidor por requisição, ideal para Render e para conectar no Claude.
export function buildMcpServer() {
  const server = new McpServer({ name: 'traffic-agent', version: '0.1.0' });
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
