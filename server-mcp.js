#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/stdio');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types');
const { spawn } = require('child_process');

// Create MCP server
const server = new Server({
  name: 'aistudio-mcp-server',
  version: '0.4.0',
});

let mcpProcess;

// Start the underlying MCP server as subprocess
function startMcpServer() {
  return new Promise((resolve, reject) => {
    mcpProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    mcpProcess.on('error', (err) => {
      console.error('MCP process error:', err);
      reject(err);
    });

    // Log stderr
    mcpProcess.stderr.on('data', (data) => {
      process.stderr.write(`[MCP subprocess] ${data}`);
    });

    setTimeout(() => resolve(), 1000);
  });
}

// Tool definitions
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

// Tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'generate_image') {
    const { prompt, width = 1024, height = 1024 } = request.params.arguments;

    if (!mcpProcess) {
      throw new Error('MCP subprocess not running');
    }

    // Send request to subprocess MCP server
    const mcpRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random(),
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: {
          prompt,
          width,
          height
        }
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

      // Timeout
      setTimeout(() => {
        mcpProcess.stdout.removeListener('data', responseHandler);
        reject(new Error('Request timeout'));
      }, 60000);
    });
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Start everything
async function main() {
  try {
    // Start subprocess MCP server
    await startMcpServer();
    console.error('MCP subprocess started');

    // Start this MCP server on stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP stdio server connected');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();

// Graceful shutdown
process.on('SIGTERM', () => {
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});
