const express = require('express');
const { spawn } = require('child_process');
const app = express();

app.use(express.json());

let mcpProcess;

// Start the MCP server as a child process
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
      console.log(`MCP stderr: ${data}`);
    });

    // Give it time to start
    setTimeout(() => resolve(), 1000);
  });
}

// POST endpoint to send requests to MCP server
app.post('/mcp', (req, res) => {
  const { method, params } = req.body;

  if (!mcpProcess) {
    return res.status(500).json({ error: 'MCP server not running' });
  }

  // Send JSON-RPC request to MCP server
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: params || {}
  });

  mcpProcess.stdin.write(request + '\n');

  // Listen for response
  const responseHandler = (data) => {
    try {
      const response = JSON.parse(data.toString());
      mcpProcess.stdout.removeListener('data', responseHandler);
      res.json(response);
    } catch (err) {
      console.error('Parse error:', err);
    }
  };

  mcpProcess.stdout.once('data', responseHandler);

  // Timeout after 30 seconds
  setTimeout(() => {
    mcpProcess.stdout.removeListener('data', responseHandler);
    res.status(504).json({ error: 'Request timeout' });
  }, 30000);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mcp: mcpProcess ? 'running' : 'stopped' });
});

// Start server
const PORT = process.env.PORT || 3000;

startMcpServer()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`HTTP server running on port ${PORT}`);
      console.log(`MCP server subprocess started`);
    });
  })
  .catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (mcpProcess) {
    mcpProcess.kill();
  }
  process.exit(0);
});
