const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const prompts = require('./prompts.json');
const jobHistory = [];
const outputsDir = path.join(__dirname, 'outputs');
const workspaceRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(workspaceRoot, 'skills', 'nano-banana-pro', 'scripts', 'generate_image.py');
const secretFilePath = path.join(process.env.HOME || '', '.openclaw', 'api.txt');
const automationPrefix = `cd ${workspaceRoot} && mcporter call chrome-devtools.`;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(outputsDir));

fs.mkdir(outputsDir, { recursive: true }).catch(() => {});

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

function updateJob(id, updates) {
  const idx = jobHistory.findIndex((job) => job.id === id);
  if (idx === -1) return;
  jobHistory[idx] = { ...jobHistory[idx], ...updates };
}

async function loadSecrets() {
  const secrets = {};
  try {
    const raw = await fs.readFile(secretFilePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const label = lines[i].trim();
      if (!label) continue;
      const value = lines[i + 1];
      if (!value) continue;
      secrets[label] = value.trim();
      i += 1;
    }
  } catch (error) {
    console.warn('Secret file not found or unreadable:', error.message);
  }
  return secrets;
}

async function resolveSecret(name, envVar) {
  if (process.env[envVar]) return process.env[envVar].trim();
  const secrets = await loadSecrets();
  return secrets[name] || null;
}

async function resolveGeminiKey() {
  return resolveSecret('Gemini', 'GEMINI_API_KEY');
}

async function resolveReplicateToken() {
  return resolveSecret('Replicate', 'REPLICATE_API_TOKEN');
}

function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: workspaceRoot, timeout: 90000 }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stdout, stderr });
      }
      return resolve({ stdout, stderr });
    });
  });
}

function buildTitle(job) {
  const base = (job.prompts?.[0] || 'Nano Banana artwork').trim();
  return base.slice(0, 190);
}

function buildKeywords(job) {
  const prompt = job.prompts?.[0] || 'Nano Banana';
  const parts = prompt
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\\s+/)
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  return unique.slice(0, 10).join(', ');
}

async function runContributorUpload(job) {
  const absoluteFilePath = path.join(__dirname, job.output || job.filename || '');
  if (!absoluteFilePath) {
    throw new Error('Missing output path for upload');
  }
  const commands = [];
  commands.push(`${automationPrefix}navigate_page url=https://contributor.stock.adobe.com/en/uploads`);
  commands.push(`${automationPrefix}click uid=2_16`);
  commands.push(`${automationPrefix}click uid=3_4`);
  commands.push(`${automationPrefix}upload_file uid=5_0 filePath=\"${absoluteFilePath}\"`);
  commands.push(`${automationPrefix}click uid=2_44`);
  const metadataScript = `(() => { const titleText = ${JSON.stringify(buildTitle(job))}; const keywordsText = ${JSON.stringify(buildKeywords(job))}; const titleField = document.querySelector('textarea[name="title"]'); if (titleField) { titleField.value = titleText; titleField.dispatchEvent(new Event('input', { bubbles: true })); } const keywordsField = document.querySelector('textarea[name="keywordsUITextArea"]'); if (keywordsField) { keywordsField.value = keywordsText; keywordsField.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`;
  commands.push(`${automationPrefix}evaluate_script function="${metadataScript.replace(/\\n/g, ' ')}"`);
  commands.push(`${automationPrefix}click uid=7_6`);
  commands.push(`${automationPrefix}click uid=2_112`);
  for (const cmd of commands) {
    await execCommand(cmd);
  }
}

function findJob(id) {
  return jobHistory.find((job) => job.id === id);
}

app.get('/api/prompts', (req, res) => {
  res.json({ prompts: samplePrompts() });
});

app.get('/api/jobs', (req, res) => {
  res.json({ jobs: jobHistory });
});

app.post('/api/generate', async (req, res) => {
  const { prompts: selected } = req.body;
  if (!Array.isArray(selected) || selected.length === 0) {
    return res.status(400).json({ error: 'Select at least one prompt before generation.' });
  }
  const key = await resolveGeminiKey();
  if (!key) {
    return res.status(500).json({ error: 'Gemini API key is missing. Set GEMINI_API_KEY or update .openclaw/api.txt with the Gemini entry.' });
  }
  await fs.mkdir(outputsDir, { recursive: true });
  const requested = selected.slice(0, 4);
  const queuedJobs = [];

  requested.forEach((prompt) => {
    const jobId = crypto.randomBytes(4).toString('hex');
    const slug = prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'nano';
    const filename = `${jobId}-${slug}.png`;
    const outputFile = path.join(outputsDir, filename);
    const job = {
      id: jobId,
      type: 'generation',
      prompts: [prompt],
      timestamp: new Date().toISOString(),
      status: 'scheduled',
      detail: 'Queued for Nano Banana generation',
      filename,
      downloaded: false,
      deleted: false,
      downloadUrl: null,
    };
    pushJob(job);
    queuedJobs.push(job);

    console.log(`Launching Nano Banana job ${jobId} -> ${scriptPath} (prompt: ${prompt.substring(0, 80)})`);
    const child = spawn('python3', [
      scriptPath,
      '--prompt',
      prompt,
      '--filename',
      outputFile,
      '--resolution',
      '2K',
    ], {
      env: { ...process.env, GEMINI_API_KEY: key },
    });

    let stdoutLog = '';
    let stderrLog = '';

    child.stdout.on('data', (chunk) => {
      stdoutLog += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderrLog += chunk.toString();
    });

    child.on('spawn', () => updateJob(jobId, { status: 'running', detail: 'Generating image…' }));
    child.on('error', (error) => {
      console.error('Nano Banana spawn error', jobId, error);
      updateJob(jobId, {
        status: 'failed',
        detail: `Spawn failed: ${error.message}`,
        log: stderrLog || error.message,
        timestamp: new Date().toISOString(),
      });
    });
    child.on('close', (code) => {
      (async () => {
        console.log(`Nano Banana job ${jobId} exited ${code}. stdout:
${stdoutLog}
stderr:
${stderrLog}`);
        let success = code === 0;
        if (success) {
          try {
            await fs.access(outputFile);
          } catch (error) {
            console.warn('Expected output file missing', error.message);
            success = false;
          }
        }
        const relative = success ? path.relative(__dirname, outputFile) : undefined;
        const downloadUrl = success ? `/outputs/${path.basename(relative)}` : null;
        updateJob(jobId, {
          status: success ? 'completed' : 'failed',
          detail: success ? `Saved ${filename}` : `Error (exit ${code})`,
          log: stdoutLog || stderrLog,
          output: relative,
          downloadUrl,
          timestamp: new Date().toISOString(),
        });
      })();
    });
  });

  return res.json({ message: 'Generation jobs submitted.', jobs: queuedJobs.map((job) => job.id) });
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

function openUploadBrowser(job, label, res) {
  const target = 'https://stock.adobe.com/contributor';
  exec(
    `cd /home/strid3r/.openclaw/workspace && mcporter call chrome-devtools.navigate_page url=${target}`,
    { timeout: 20000 },
    (error, stdout, stderr) => {
      if (error) {
        console.error('Upload automation failed:', job.id, error, stderr);
        updateJob(job.id, {
          status: 'upload-failed',
          detail: stderr || error.message,
        });
        return res.status(500).json({ error: 'Headed browser upload failed.', detail: stderr || error.message });
      }
      updateJob(job.id, {
        status: 'upload-triggered',
        detail: `Headed browser opened for ${label}`,
      });
      return res.json({ message: 'Headed browser launched to Adobe Stock Contributor.', stdout });
    },
  );
}

app.post('/api/upload', (req, res) => {
  const placeholderJob = {
    id: crypto.randomBytes(4).toString('hex'),
    type: 'upload',
    prompts: ['Adobe Stock contributor'],
    timestamp: new Date().toISOString(),
    status: 'pending',
    detail: 'General upload trigger',
  };
  pushJob(placeholderJob);
  openUploadBrowser(placeholderJob, 'general upload', res);
});

app.post('/api/job/:id/upload', async (req, res) => {
  const job = findJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  if (!job.output || job.deleted) {
    return res.status(400).json({ error: 'Job has no available asset to upload.' });
  }
  updateJob(job.id, { status: 'uploading', detail: 'Automating Adobe Stock upload' });
  try {
    await runContributorUpload(job);
    updateJob(job.id, { status: 'uploaded', detail: 'Upload completed on Adobe Stock', uploadedAt: new Date().toISOString() });
    return res.json({ message: 'Upload automation completed.' });
  } catch (error) {
    console.error('Upload automation failed', error);
    updateJob(job.id, { status: 'upload-failed', detail: error.error?.message || error.message });
    return res.status(500).json({ error: 'Upload automation failed.', detail: error.stderr || error.error?.message || error.message });
  }
});

app.post('/api/job/:id/download', (req, res) => {
  const job = findJob(req.params.id);
  if (!job || !job.output) {
    return res.status(404).json({ error: 'Job not found or has no output.' });
  }
  if (job.deleted) {
    return res.status(400).json({ error: 'Asset already deleted.' });
  }
  updateJob(job.id, {
    downloaded: true,
    detail: 'Downloaded by user',
    downloadedAt: new Date().toISOString(),
  });
  return res.json({ url: job.downloadUrl });
});

app.delete('/api/job/:id', async (req, res) => {
  const job = findJob(req.params.id);
  if (!job || !job.output) {
    return res.status(404).json({ error: 'Job not found or has no output.' });
  }
  if (job.deleted) {
    return res.status(400).json({ error: 'Asset already deleted.' });
  }
  const absolutePath = path.join(__dirname, job.output);
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    console.warn('Failed to delete asset', absolutePath, error.message);
  }
  updateJob(job.id, {
    deleted: true,
    detail: 'Deleted by user',
    deletedAt: new Date().toISOString(),
  });
  return res.json({ message: 'Asset deleted.', id: job.id });
});

app.listen(PORT, () => {
  console.log(`Nano Banana dashboard listening on http://localhost:${PORT}`);
});
