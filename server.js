async function buildUpscaledPath(relativePath) {
  const parsed = path.parse(relativePath);
  const base = parsed.name.includes('upscaled') ? parsed.name : `${parsed.name}-upscaled`;
  let candidate = `${base}${parsed.ext}`;
  let counter = 1;
  while (true) {
    const candidatePath = path.join(outputsDir, candidate);
    try {
      await fs.access(candidatePath);
      candidate = `${base}-${counter}${parsed.ext}`;
      counter += 1;
      continue;
    } catch (error) {
      return candidatePath;
    }
  }
}

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

const ADOBE_MIN_PIXELS = 4_000_000;

async function getImageDimensions(filePath) {
  const fd = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(64);
    await fd.read(header, 0, 64, 0);

    // PNG
    if (header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      return { width, height };
    }

    // JPEG
    if (header[0] === 0xff && header[1] === 0xd8) {
      const full = await fs.readFile(filePath);
      let offset = 2;
      while (offset < full.length) {
        if (full[offset] !== 0xff) { offset += 1; continue; }
        const marker = full[offset + 1];
        const blockLen = full.readUInt16BE(offset + 2);
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          const height = full.readUInt16BE(offset + 5);
          const width = full.readUInt16BE(offset + 7);
          return { width, height };
        }
        offset += 2 + blockLen;
      }
    }

    return { width: null, height: null };
  } finally {
    await fd.close();
  }
}

function adobeReadiness(width, height) {
  if (!width || !height) return { pixels: null, meetsAdobeMin: false };
  const pixels = width * height;
  return { pixels, meetsAdobeMin: pixels >= ADOBE_MIN_PIXELS };
}

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

  const getUid = (snapshot, labelRegex) => {
    const lines = snapshot.split('\n');
    for (const line of lines) {
      const uidMatch = line.match(/uid=([\w_]+)/);
      if (!uidMatch) continue;
      if (labelRegex.test(line)) return uidMatch[1];
    }
    return null;
  };

  await execCommand(`${automationPrefix}navigate_page url=https://contributor.stock.adobe.com/en/uploads`);

  let snap = await execCommand(`${automationPrefix}take_snapshot`);
  let browseUid = getUid(snap.stdout, /button "Browse"/);

  if (!browseUid) {
    const uploadUid = getUid(snap.stdout, /button "Upload"/);
    if (!uploadUid) throw new Error('Upload button not found on contributor page.');
    await execCommand(`${automationPrefix}click uid=${uploadUid}`);
    snap = await execCommand(`${automationPrefix}take_snapshot`);
    browseUid = getUid(snap.stdout, /button "Browse"/);
  }

  if (!browseUid) throw new Error('Browse button not found after opening upload dialog.');

  await execCommand(`${automationPrefix}upload_file uid=${browseUid} filePath="${absoluteFilePath}"`);

  await execCommand(`${automationPrefix}take_snapshot`);
  const metadataScript = `() => { const titleText = ${JSON.stringify(buildTitle(job))}; const keywordsText = ${JSON.stringify(buildKeywords(job))}; const titleField = document.querySelector('textarea[name=\"title\"]') || document.querySelector('textarea[aria-label=\"Content title\"]'); if (titleField) { titleField.value = titleText; titleField.dispatchEvent(new Event('input', { bubbles: true })); } const keywordsField = document.querySelector('textarea[name=\"keywordsUITextArea\"]') || document.querySelector('textarea[aria-label=\"Paste Keywords...\"]'); if (keywordsField) { keywordsField.value = keywordsText; keywordsField.dispatchEvent(new Event('input', { bubbles: true })); } return {title: Boolean(titleField), keywords: Boolean(keywordsField)}; }`;
  const escapedMetadata = metadataScript.replace(/\n/g, ' ').replace(/"/g, '\\"');
  await execCommand(`${automationPrefix}evaluate_script function="${escapedMetadata}"`);

  const postMetaSnap = await execCommand(`${automationPrefix}take_snapshot`);
  const noUid = getUid(postMetaSnap.stdout, /button "No"/);
  const saveUid = getUid(postMetaSnap.stdout, /button "Save work"/);

  if (noUid) {
    await execCommand(`${automationPrefix}click uid=${noUid}`);
  }
  if (!saveUid) throw new Error('Save work button not found after metadata fill.');

  await execCommand(`${automationPrefix}click uid=${saveUid}`);
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
  const { jobId, fileName } = req.body;
  const safeFileName = fileName ? path.basename(fileName) : null;
  let job = jobId ? findJob(jobId) : null;

  if (!job && safeFileName) {
    job = jobHistory.find((entry) => entry.output?.endsWith(`/${safeFileName}`));
  }

  let relativeOutput = job?.output || (safeFileName ? path.join('outputs', safeFileName) : null);
  if (!relativeOutput) {
    return res.status(404).json({ error: 'Job/file not found or missing output.' });
  }

  const source = path.join(__dirname, relativeOutput);
  try {
    await fs.access(source);
  } catch (error) {
    return res.status(404).json({ error: 'Source asset missing.' });
  }

  try {
    const destPath = await buildUpscaledPath(relativeOutput);
    await fs.copyFile(source, destPath);
    const relative = path.relative(__dirname, destPath);

    if (job) {
      job.output = relative;
      job.downloadUrl = `/outputs/${path.basename(relative)}`;
      job.status = 'upscaled';
      job.detail = 'Upscaled asset locally';
      job.updatedAt = new Date().toISOString();
    }

    return res.json({
      message: 'Upscale completed locally.',
      outputUrl: `/outputs/${path.basename(relative)}`,
      file: path.basename(relative),
      job: job || null,
    });
  } catch (error) {
    console.error('Upscale copy failed', error);
    return res.status(500).json({ error: 'Unable to create upscaled file.', detail: error.message });
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

app.post('/api/output/:file/upload', async (req, res) => {
  const safeName = path.basename(req.params.file || '');
  if (!safeName) {
    return res.status(400).json({ error: 'File is required.' });
  }
  const relative = path.join('outputs', safeName);
  const absolute = path.join(__dirname, relative);
  try {
    await fs.access(absolute);
  } catch (error) {
    return res.status(404).json({ error: 'Output file not found.' });
  }

  const pseudoJob = {
    id: `file-${safeName}`,
    output: relative,
    filename: safeName,
    prompts: [safeName.replace(/[-_]+/g, ' ')],
    status: 'uploading',
  };

  try {
    await runContributorUpload(pseudoJob);
    return res.json({ message: 'Upload automation completed for output file.' });
  } catch (error) {
    console.error('Output upload automation failed', error);
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

app.get('/api/outputs', async (req, res) => {
  try {
    const files = await fs.readdir(outputsDir);
    const imageFiles = files.filter((file) => file.match(/\.(png|jpg|jpeg|webp)$/i));
    const entries = [];

    for (const file of imageFiles) {
      const job = jobHistory.find((jobEntry) => jobEntry.output?.endsWith(`/${file}`));
      const absolute = path.join(outputsDir, file);
      const dims = await getImageDimensions(absolute);
      const readiness = adobeReadiness(dims.width, dims.height);
      entries.push({
        id: job?.id ?? file,
        prompt: job?.prompts?.[0] || file,
        detail: job?.detail || 'Generated',
        status: job?.status || 'generated',
        url: `/outputs/${file}`,
        file,
        jobId: job?.id || null,
        deleted: job?.deleted || false,
        downloaded: job?.downloaded || false,
        isUpscaled: file.toLowerCase().includes('upscaled'),
        width: dims.width,
        height: dims.height,
        pixels: readiness.pixels,
        meetsAdobeMin: readiness.meetsAdobeMin,
        adobeMinPixels: ADOBE_MIN_PIXELS,
      });
    }

    return res.json({ outputs: entries });
  } catch (error) {
    console.error('Unable to list outputs', error);
    return res.status(500).json({ error: 'Unable to list outputs.', detail: error.message });
  }
});

app.delete('/api/output/:file', async (req, res) => {
  const file = req.params.file;
  if (!file) {
    return res.status(400).json({ error: 'File name is required.' });
  }
  const safeName = path.basename(file);
  const absolutePath = path.join(outputsDir, safeName);
  try {
    await fs.access(absolutePath);
  } catch (error) {
    return res.status(404).json({ error: 'File not found.' });
  }
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    console.error('Failed to delete output', error);
    return res.status(500).json({ error: 'Unable to remove file.' });
  }
  const job = jobHistory.find((entry) => entry.output?.endsWith(`/${safeName}`));
  if (job) {
    job.deleted = true;
    job.detail = 'Deleted via gallery';
  }
  return res.json({ message: 'Output deleted', file: safeName });
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