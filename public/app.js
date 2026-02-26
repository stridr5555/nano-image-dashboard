const promptGrid = document.getElementById('promptGrid');
const refreshButton = document.getElementById('refreshPrompts');
const generateButton = document.getElementById('generatePrompts');
const upscaleButton = document.getElementById('upscaleBtn');
const uploadButton = document.getElementById('uploadBtn');
const statusLine = document.getElementById('statusLine');
const jobLog = document.getElementById('jobLog');
const galleryGrid = document.getElementById('galleryGrid');
const refreshGalleryButton = document.getElementById('refreshGallery');
const batchUpscaleBtn = document.getElementById('batchUpscale');
const batchUploadBtn = document.getElementById('batchUpload');
const batchDeleteBtn = document.getElementById('batchDelete');
const galleryCache = new Map();
const selectedGallery = new Set();

function setStatus(text) {
  statusLine.textContent = text;
}

function renderPrompts(prompts) {
  promptGrid.innerHTML = '';
  prompts.forEach((prompt) => {
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

async function refreshOutputs() {
  if (!galleryGrid) return;
  try {
    const response = await fetch('/api/outputs?ts=' + Date.now());
    const payload = await response.json();
    renderGallery(payload.outputs || []);
  } catch (error) {
    console.error('Failed to refresh outputs', error);
  }
}

function renderGallery(items) {
  if (!galleryGrid) return;
  galleryCache.clear();
  const existingIds = new Set();
  if (!items.length) {
    galleryGrid.innerHTML = '<p class="helper">No finished images yet.</p>';
    selectedGallery.clear();
    updateBatchButtons();
    return;
  }
  galleryGrid.innerHTML = items
    .map(
      (item) => {
        const imageUrl = item.downloadUrl || item.url;
        const label = item.prompt || item.prompts?.[0] || 'Generated image';
        const detail = item.detail || item.status || 'Generated';
        const resolutionText = item.width && item.height ? `${item.width}×${item.height}` : 'Resolution unknown';
        const identifier = item.jobId ? `job-${item.jobId}` : `file-${item.file || item.id}`;
        const deleteType = item.jobId ? 'job' : 'file';
        galleryCache.set(identifier, { ...item, id: identifier, deleteType, isUpscaled: item.isUpscaled });
        existingIds.add(identifier);
        const isSelected = selectedGallery.has(identifier);
        const showUpload = item.isUpscaled && !item.deleted && (item.jobId || item.file);
        const showUpscale = !item.isUpscaled && !item.meetsAdobeMin && (item.jobId || item.file) && !item.deleted;
        return `
      <article class="gallery-card${isSelected ? ' selected' : ''}" data-item-id="${identifier}" data-job-id="${item.jobId || ''}" data-file-name="${item.file || ''}">
        <img src="${imageUrl}" alt="${label}" loading="lazy">
        <div class="gallery-meta">
          <div class="job-badges">
            ${item.downloaded ? '<span class="tag downloaded">Downloaded</span>' : ''}
            ${item.deleted ? '<span class="tag deleted">Deleted</span>' : ''}
            ${item.meetsAdobeMin ? '<span class="tag downloaded">Adobe-ready</span>' : '<span class="tag deleted">Needs upscale</span>'}
          </div>
          <strong>${label}</strong>
          <small>${detail} • ${resolutionText}</small>
          <div class="gallery-actions">
            ${showUpscale ? `<button class="btn ghost upscale-btn" data-action="upscale" data-id="${item.jobId || item.file}">Upscale</button>` : ''}
            ${showUpload ? `<button class="btn upload-btn" data-action="upload" data-type="${item.jobId ? 'job' : 'file'}" data-id="${item.jobId || item.file}">Upload</button>` : ''}
            ${item.jobId || item.file ? `<button class="btn ghost delete-btn" data-action="delete" data-type="${deleteType}" data-id="${item.jobId || item.file}">Delete</button>` : ''}
          </div>
        </div>
      </article>
    `;
      },
    )
    .join('');
  updateBatchButtons();
}
function clearSelection() {
  selectedGallery.clear();
  galleryGrid.querySelectorAll('.gallery-card.selected').forEach((card) => card.classList.remove('selected'));
  updateBatchButtons();
}

function updateBatchButtons() {
  if (!batchUploadBtn || !batchDeleteBtn || !batchUpscaleBtn) return;
  const selectedItems = Array.from(selectedGallery).map((id) => galleryCache.get(id)).filter(Boolean);
  const canUpload = selectedItems.some((item) => item?.isUpscaled && !item.deleted && (item.jobId || item.file));
  const canUpscale = selectedItems.some((item) => item && !item.isUpscaled && !item.meetsAdobeMin && !item.deleted && (item.jobId || item.file));
  batchUploadBtn.disabled = !canUpload;
  batchUpscaleBtn.disabled = !canUpscale;
  batchDeleteBtn.disabled = selectedItems.length === 0;
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

async function deleteOutput(fileName) {
  if (!fileName) return;
  setStatus('Deleting output…');
  const response = await fetch(`/api/output/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Delete failed');
  }
  setStatus('Output deleted.');
  refreshJobLog();
}

async function refreshJobLog() {
  try {
    const response = await fetch('/api/jobs?ts=' + Date.now());
    const { jobs } = await response.json();
    jobLog.innerHTML = jobs
      .map(
        (job) => `
        <article class="job-card ${job.deleted ? 'job-deleted' : ''}">
          <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
            <strong>${job.type} • ${job.id}</strong>
            <small>${new Date(job.timestamp).toLocaleTimeString()}</small>
          </div>
          <div>${job.prompts?.length ? job.prompts.join(', ') : '—'}</div>
          <div class="job-badges">
            ${job.downloaded ? '<span class="tag downloaded">Downloaded</span>' : ''}
            ${job.deleted ? '<span class="tag deleted">Deleted</span>' : ''}
          </div>
          <small>${job.detail || '—'}</small>
          ${job.output ? `<small>${job.deleted ? 'Asset removed' : `Saved file: ${job.output}`}</small>` : ''}
          <div class="job-actions">
            ${job.output && !job.deleted ? `<button class="btn upload-btn" data-action="upload" data-id="${job.id}">Upload</button>` : ''}
            ${job.output && !job.deleted ? `<button class="btn ghost delete-btn" data-action="delete" data-type="job" data-id="${job.id}">Delete</button>` : ''}
          </div>
          <small>Status: ${job.status}${job.predictionUrl ? ` • <a href="${job.predictionUrl}" target="_blank" rel="noreferrer">view</a>` : ''}</small>
        </article>
      `,
      )
      .join('');
    refreshOutputs();
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

async function deleteOutput(fileName) {
  if (!fileName) return;
  setStatus('Deleting output...');
  try {
    const response = await fetch(`/api/output/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Delete failed');
    }
    setStatus('Output deleted.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Delete failed. Check console.');
  }
}

async function deleteJobAsset(jobId) {
  setStatus('Deleting asset…');
  try {
    const response = await fetch(`/api/job/${jobId}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Deletion failed');
    setStatus('Asset deleted.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Deletion failed. Check console.');
  }
}

function toggleCardSelection(id, card) {
  if (!id) return;
  const selected = selectedGallery.has(id);
  if (selected) {
    selectedGallery.delete(id);
  } else {
    selectedGallery.add(id);
  }
  if (card) {
    card.classList.toggle('selected', !selected);
  }
  updateBatchButtons();
}

async function batchUpscaleSelection() {
  if (!batchUpscaleBtn) return;
  const selectedItems = Array.from(selectedGallery)
    .map((id) => galleryCache.get(id))
    .filter((item) => item && !item.isUpscaled && !item.deleted && (item.jobId || item.file));
  for (const item of selectedItems) {
    await triggerUpscale(item.jobId || item.file);
  }
  clearSelection();
}

async function batchUploadSelection() {
  if (!batchUploadBtn) return;
  const selectedItems = Array.from(selectedGallery)
    .map((id) => galleryCache.get(id))
    .filter((item) => item && item.isUpscaled && !item.deleted && (item.jobId || item.file));
  for (const item of selectedItems) {
    await triggerUpload(item.jobId || item.file, item.jobId ? 'job' : 'file');
  }
  clearSelection();
}

async function batchDeleteSelection() {
  const selectedItems = Array.from(selectedGallery)
    .map((id) => galleryCache.get(id))
    .filter(Boolean);
  for (const item of selectedItems) {
    if (item.jobId) {
      await deleteJobAsset(item.jobId);
    } else if (item.file) {
      try {
        await deleteOutput(item.file);
      } catch {
        // ignore
      }
    }
  }
  clearSelection();
}

async function triggerUpscale(targetId) {
  if (!targetId) return;
  const raw = String(targetId);
  const payload = raw.startsWith('job-')
    ? { jobId: raw.replace(/^job-/, '') }
    : (/^[a-f0-9]{8}$/i.test(raw) ? { jobId: raw } : { fileName: raw });
  setStatus('Upscaling...');
  try {
    const response = await fetch('/api/upscale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const payloadJson = await response.json();
    if (!response.ok) throw new Error(payloadJson.error || 'Upscale failed');
    setStatus('Upscale complete.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Upscale failed. Check console.');
  }
}

async function triggerUpload(targetId, type = 'job') {
  setStatus('Triggering upload flow…');
  try {
    const url = type === 'file'
      ? `/api/output/${encodeURIComponent(targetId)}/upload`
      : `/api/job/${targetId}/upload`;
    const response = await fetch(url, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Upload failed');
    setStatus('Upload flow triggered.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Upload automation failed. Check console.');
  }
}

galleryGrid.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (button) {
    const action = button.dataset.action;
    if (action === 'upload') {
      await triggerUpload(button.dataset.id, button.dataset.type || 'job');
    } else if (action === 'upscale') {
      await triggerUpscale(button.dataset.id);
    } else if (action === 'delete') {
      const type = button.dataset.type;
      const target = button.dataset.id;
      if (type === 'job') {
        await deleteJobAsset(target);
      } else {
        await deleteOutput(target);
      }
    }
    return;
  }
  const card = event.target.closest('.gallery-card');
  if (!card) return;
  toggleCardSelection(card.dataset.itemId, card);
});

batchUploadBtn?.addEventListener('click', async () => {
  if (batchUploadBtn.disabled) return;
  await batchUploadSelection();
});

batchUpscaleBtn?.addEventListener('click', async () => {
  if (batchUpscaleBtn.disabled) return;
  await batchUpscaleSelection();
});

batchDeleteBtn?.addEventListener('click', async () => {
  if (batchDeleteBtn.disabled) return;
  await batchDeleteSelection();
});

jobLog.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const jobId = button.dataset.id;
  if (button.classList.contains('delete-btn')) {
    const type = button.dataset.type;
    if (type === 'job') {
      await deleteJobAsset(jobId);
    } else {
      await deleteOutput(button.dataset.id);
    }
    return;
  }
  if (button.classList.contains('upload-btn')) {
    await triggerUpload(jobId);
    return;
  }
});

refreshGalleryButton.addEventListener('click', () => {
  refreshJobLog();
});

window.addEventListener('load', () => {
  loadPrompts();
  refreshJobLog();
  setInterval(refreshJobLog, 3000);
});
