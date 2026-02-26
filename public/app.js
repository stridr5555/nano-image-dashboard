const promptGrid = document.getElementById('promptGrid');
const refreshButton = document.getElementById('refreshPrompts');
const generateButton = document.getElementById('generatePrompts');
const upscaleButton = document.getElementById('upscaleBtn');
const uploadButton = document.getElementById('uploadBtn');
const statusLine = document.getElementById('statusLine');
const jobLog = document.getElementById('jobLog');

function setStatus(text) {
  statusLine.textContent = text;
}

function renderPrompts(prompts) {
  promptGrid.innerHTML = '';
  prompts.forEach((prompt, index) => {
    const card = document.createElement('label');
    card.className = 'prompt-card';
    card.innerHTML = `
      <div class="prompt-source">${prompt.source}</div>
      <div class="prompt-description">${prompt.description}</div>
      <div class="tags">
        <span class="tag">${prompt.mood}</span>
      </div>
      <input type="checkbox" name="prompt" value="${prompt.description}" />
    `;
    promptGrid.appendChild(card);
  });
}

async function loadPrompts() {
  setStatus('Loading curated prompts…');
  try {
    const response = await fetch('/api/prompts');
    const payload = await response.json();
    renderPrompts(payload.prompts);
    setStatus('Ready for Nano Banana generation.');
  } catch (error) {
    console.error(error);
    setStatus('Unable to load prompts. Check the console.');
  }
}

async function refreshJobLog() {
  try {
    const response = await fetch('/api/jobs?ts=' + Date.now());
    const { jobs } = await response.json();
    jobLog.innerHTML = jobs
      .map(
        (job) => `
        <article class="job-card">
          <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
            <strong>${job.type} • ${job.id}</strong>
            <small>${new Date(job.timestamp).toLocaleTimeString()}</small>
          </div>
          <div>${job.prompts?.length ? job.prompts.join(', ') : '—'}</div>
          <small>${job.detail || '—'}</small>
          ${job.output ? `<div class="preview"><img src="${job.output}" alt="${job.prompts?.[0] ?? 'Nano Banana output'}" loading="lazy"></div>` : ''}
          ${job.output ? `<small>Saved file: ${job.output}</small>` : ''}
          <small>Status: ${job.status}${job.predictionUrl ? ` • <a href="${job.predictionUrl}" target="_blank" rel="noreferrer">view</a>` : ''}</small>
        </article>
      `,
      )
      .join('');
  } catch (error) {
    console.error('Failed to refresh jobs', error);
  }
}

function getSelectedPrompts() {
  return Array.from(document.querySelectorAll('input[name="prompt"]:checked')).map((input) => input.value);
}

generateButton.addEventListener('click', async () => {
  const selected = getSelectedPrompts();
  if (selected.length === 0) {
    setStatus('Select at least one prompt to generate.');
    return;
  }
  setStatus('Sending generation job to Nano Banana…');
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: selected }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unknown error');
    }
    setStatus(`Generation queued (${payload.job.id}).`);
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Generation request failed. Check console.');
  }
});

refreshButton.addEventListener('click', () => {
  loadPrompts();
});

upscaleButton.addEventListener('click', async () => {
  const imageUri = prompt('Paste the image URL you just generated (https://…):');
  if (!imageUri) return;
  setStatus('Requesting Replicate upscale…');
  try {
    const response = await fetch('/api/upscale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUri, scale: 4 }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Upscale failed');
    setStatus('Upscale kicked off — check job log for prediction ID.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Upscale request failed. Check console.');
  }
});

uploadButton.addEventListener('click', async () => {
  setStatus('Opening headed browser to Adobe Stock…');
  try {
    const response = await fetch('/api/upload', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Upload automation failed');
    setStatus('Upload workflow triggered. Browser should be on the contributor page.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Upload automation failed. Check console.');
  }
});

window.addEventListener('load', () => {
  loadPrompts();
  refreshJobLog();
  setInterval(refreshJobLog, 60000);
});
