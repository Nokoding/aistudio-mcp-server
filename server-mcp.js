#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import http from 'http';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';

const server = new Server({
  name: 'aistudio-mcp-server',
  version: '0.4.0',
}, {
  capabilities: { tools: {} }
});

let mcpProcess;

function startMcpServer() {
  return new Promise((resolve, reject) => {
    mcpProcess = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    mcpProcess.on('error', (err) => { console.error('MCP process error:', err); reject(err); });
    mcpProcess.stderr.on('data', (data) => { process.stderr.write(`[MCP subprocess] ${data}`); });
    setTimeout(() => resolve(), 1000);
  });
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
      name: 'generate_image',
      description: 'Generate an image using Gemini 3.1 Flash Image',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the image to generate' },
          width: { type: 'number', description: 'Width of the image (default: 1024)' },
          height: { type: 'number', description: 'Height of the image (default: 1024)' }
        },
        required: ['prompt']
      }
    }]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'generate_image') {
    const { prompt, width = 1024, height = 1024 } = request.params.arguments;
    if (!mcpProcess) throw new Error('MCP subprocess not running');

    const mcpRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random(),
      method: 'tools/call',
      params: { name: 'generate_image', arguments: { prompt, width, height } }
    });

    return new Promise((resolve, reject) => {
      const responseHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          mcpProcess.stdout.removeListener('data', responseHandler);
          if (response.error) reject(new Error(response.error.message));
          else resolve({ content: [{ type: 'text', text: JSON.stringify(response.result) }] });
        } catch (err) { console.error('Parse error:', err); }
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

async function generateImage(prompt, aspect) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  
  // FIX: Use application/json as responseMimeType, not image/jpeg
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        responseMimeType: 'application/json'
      }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `API error ${res.status}`);

  // Extract the base64 image data from Gemini response
  const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imgPart) throw new Error('No image returned from Gemini');

  return {
    mimeType: imgPart.inlineData.mimeType,
    data: imgPart.inlineData.data
  };
}

const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', model: GEMINI_MODEL }));
    return;
  }

  if (req.url === '/generate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { prompt, aspect } = JSON.parse(body);
        if (!prompt) throw new Error('prompt is required');
        if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set on server');

        const imgData = await generateImage(prompt, aspect);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, image: imgData.data, mimeType: imgData.mimeType }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');

}).listen(PORT, () => {
  console.error(`Server running on port ${PORT}`);
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
  if (mcpProcess) mcpProcess.kill();
  process.exit(0);
});
