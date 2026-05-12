#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';

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
