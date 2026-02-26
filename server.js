const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const { exec } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const prompts = require('./prompts.json');
const jobHistory = [];

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function samplePrompts() {
  const copy = prompts.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, 4);
}

function pushJob(entry) {
  jobHistory.unshift(entry);
  if (jobHistory.length > 12) jobHistory.pop();
}

let replicateTokenCache = null;
async function resolveReplicateToken() {
  if (replicateTokenCache) return replicateTokenCache;
  if (process.env.REPLICATE_API_TOKEN) {
    replicateTokenCache = process.env.REPLICATE_API_TOKEN.trim();
    return replicateTokenCache;
  }
  const possiblePath = path.join(process.env.HOME || '', '.openclaw', 'api.txt');
  try {
    const raw = await fs.readFile(possiblePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() === 'Replicate' && lines[i + 1]) {
        replicateTokenCache = lines[i + 1].trim();
        return replicateTokenCache;
      }
    }
  } catch (error) {
    console.warn('Could not read replicate token file', error.message);
  }
  return null;
}

app.get('/api/prompts', (req, res) => {
  res.json({ prompts: samplePrompts() });
});

app.get('/api/jobs', (req, res) => {
  res.json({ jobs: jobHistory });
});

app.post('/api/generate', (req, res) => {
  const { prompts: selected } = req.body;
  if (!Array.isArray(selected) || selected.length === 0) {
    return res.status(400).json({ error: 'Select at least one prompt before generation.' });
  }
  const job = {
    id: crypto.randomBytes(4).toString('hex'),
    type: 'generation',
    prompts: selected,
    timestamp: new Date().toISOString(),
    status: 'queued',
  };
  pushJob(job);
  console.log('Queuing Nano Banana generation job with prompts:', selected);
  return res.json({ message: 'Image generation queued.', job });
});

app.post('/api/upscale', async (req, res) => {
  const { imageUri, scale = 4 } = req.body;
  if (!imageUri) {
    return res.status(400).json({ error: 'Please provide an image URI to upscale.' });
  }
  const token = await resolveReplicateToken();
  if (!token) {
    return res.status(500).json({ error: 'Replicate API key is missing. Set REPLICATE_API_TOKEN or ensure .openclaw/api.txt is available.' });
  }
  const payload = {
    version: 'b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8',
    input: {
      image: imageUri,
      scale,
      face_enhance: true,
    },
  };
  try {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Replicate rejected the request', data);
      return res.status(500).json({ error: 'Replicate refused the upscale job', detail: data });
    }
    const job = {
      id: data.id,
      type: 'upscale',
      prompts: [imageUri],
      timestamp: new Date().toISOString(),
      status: data.status,
      output: data.output,
      predictionUrl: data.urls?.get,
    };
    pushJob(job);
    return res.json({ message: 'Upscale job submitted.', prediction: data, job });
  } catch (error) {
    console.error('Upscale pipeline failed', error);
    return res.status(500).json({ error: 'Unable to reach Replicate.', detail: error.message });
  }
});

app.post('/api/upload', (req, res) => {
  const target = 'https://stock.adobe.com/contributor';
  exec(
    `cd /home/strid3r/.openclaw/workspace && mcporter call chrome-devtools.navigate_page url=${target}`,
    { timeout: 20000 },
    (error, stdout, stderr) => {
      if (error) {
        console.error('Upload automation failed:', error, stderr);
        const failureJob = {
          id: crypto.randomBytes(4).toString('hex'),
          type: 'upload',
          prompts: [target],
          timestamp: new Date().toISOString(),
          status: 'failed',
          detail: stderr || error.message,
        };
        pushJob(failureJob);
        return res.status(500).json({ error: 'Headed browser upload failed.', detail: stderr || error.message });
      }
      const successJob = {
        id: crypto.randomBytes(4).toString('hex'),
        type: 'upload',
        prompts: [target],
        timestamp: new Date().toISOString(),
        status: 'triggered',
      };
      pushJob(successJob);
      return res.json({ message: 'Headed browser launched to Adobe Stock Contributor.', stdout });
    },
  );
});

app.listen(PORT, () => {
  console.log(`Nano Banana dashboard listening on http://localhost:${PORT}`);
});
