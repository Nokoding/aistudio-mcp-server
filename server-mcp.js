#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';

const server = new Server({
  name: 'aistudio-mcp-server',
  version: '0.4.0',
}, {
  capabilities: {
    tools: {}
  }
});

let mcpProcess;

function startMcpServer() {
  return new Promise((resolve, reject) => {
    mcpProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    mcpProcess.on('error', (err) => {
      console.error('MCP process error:', err);
      reject(err);
    });

    mcpProcess.stderr.on('data', (data) => {
      process.stderr.write(`[MCP subprocess] ${data}`);
    });

    setTimeout(() => resolve(), 1000);
  });
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'generate_image',
        description: 'Generate an image using Gemini 3.1 Flash Image (Nano Banana 2)',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed description of the image to generate'
            },
            width: {
              type: 'number',
              description: 'Width of the image (default: 1024)'
            },
            height: {
              type: 'number',
              description: 'Height of the image (default: 1024)'
            }
          },
          required: ['prompt']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'generate_image') {
    const { prompt, width = 1024, height = 1024 } = request.params.arguments;

    if (!mcpProcess) {
      throw new Error('MCP subprocess not running');
    }

    const mcpRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random(),
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: { prompt, width, height }
      }
    });

    return new Promise((resolve, reject) => {
      const responseHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          mcpProcess.stdout.removeListener('data', responseHandler);
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response.result)
                }
              ]
            });
          }
        } catch (err) {
          console.error('Parse error:', err);
        }
      };

      mcpProcess.stdout.once('data', responseHandler);
      mcpProcess.stdin.write(mcpRequest + '\n');

      setTimeout(() => {
        mcpProcess.stdout.removeListener('data', responseHandler);
        reject(new Error('Request timeout'));
      }, 60000);
    });
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function main() {
  try {
    await startMcpServer();
    console.error('MCP subprocess started');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP stdio server connected');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();

process.on('SIGTERM', () => {
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});
