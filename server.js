import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadEnvFile } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local development reads .env; Jenkins/Docker variables keep precedence.
try {
  loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const app = express();
const PORT = process.env.PORT || 3000;

// API health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toLocaleTimeString(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'production'
  });
});

// Keep the runtime display name available even before metadata is rendered.
app.get('/api/project', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ projectName: process.env.PROJECT_NAME?.trim() || null });
});

// Infrastructure API from infra_info.json
app.get(['/api/infra', '/infra_info.json'], (req, res) => {
  try {
    const infraPath = path.join(__dirname, 'infra_info.json');
    const data = JSON.parse(fs.readFileSync(infraPath, 'utf8'));
    // Publish only the display name, never the full runtime environment.
    const projectName = process.env.PROJECT_NAME?.trim() || data.projectName;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...data, projectName });
  } catch (err) {
    res.status(500).json({ error: 'Unable to read infra_info.json', details: err.message });
  }
});

// Middleware serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Main Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Node.js app listening on port ${PORT}: http://localhost:${PORT}`);
});

