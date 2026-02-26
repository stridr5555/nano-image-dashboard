const promptGrid = document.getElementById('promptGrid');
const refreshButton = document.getElementById('refreshPrompts');
const generateButton = document.getElementById('generatePrompts');
const upscaleButton = document.getElementById('upscaleBtn');
const uploadButton = document.getElementById('uploadBtn');
const statusLine = document.getElementById('statusLine');
const jobLog = document.getElementById('jobLog');
const galleryGrid = document.getElementById('galleryGrid');
const refreshGalleryButton = document.getElementById('refreshGallery');
const downloadedList = document.getElementById('downloadedList');
const uploadSelectedBtn = document.getElementById('uploadSelected');
const deleteSelectedBtn = document.getElementById('deleteSelected');
const selectAllDownloadedBtn = document.getElementById('selectAllDownloaded');
let selectedDownloads = new Set();

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

function renderGallery(images) {
  if (!galleryGrid) return;
  if (!images.length) {
    galleryGrid.innerHTML = '<p class="helper">No finished images yet.</p>';
    return;
  }
  galleryGrid.innerHTML = images
    .map(
      (job) => `
      <article class="gallery-card">
        <img src="${job.downloadUrl}" alt="${job.prompts?.[0] ?? 'Nano Banana output'}" loading="lazy">
        <div class="gallery-meta">
          <div class="job-badges">
            ${job.downloaded ? '<span class="tag downloaded">Downloaded</span>' : ''}
            ${job.deleted ? '<span class="tag deleted">Deleted</span>' : ''}
          </div>
          <strong>${job.prompts?.[0] ?? 'Generated image'}</strong>
          <small>${job.detail || 'Ready to use'}</small>
          <div class="gallery-actions">
            ${job.deleted ? '' : `<button class="btn download-btn" data-id="${job.id}">Download</button><button class="btn upload-btn" data-id="${job.id}">Upload</button><button class="btn ghost delete-btn" data-id="${job.id}">Delete</button>`}
          </div>
        </div>
      </article>
    `,
    )
    .join('');
}

function renderDownloadedList(items) {
  if (!downloadedList) return;
  const availableIds = new Set(items.map((item) => item.id));
  selectedDownloads.forEach((id) => {
    if (!availableIds.has(id)) selectedDownloads.delete(id);
  });
  if (!items.length) {
    downloadedList.innerHTML = '<p class="helper">No downloaded images yet.</p>';
    selectedDownloads.clear();
    uploadSelectedBtn.disabled = true;
    deleteSelectedBtn.disabled = true;
    return;
  }
  downloadedList.innerHTML = items
    .map(
      (job) => `
      <article class="downloaded-card">
        <input type="checkbox" class="checkbox" data-id="${job.id}" ${selectedDownloads.has(job.id) ? 'checked' : ''} />
        <img src="${job.downloadUrl}" alt="${job.prompts?.[0] ?? 'Downloaded image'}">
        <div class="downloaded-info">
          <strong>${job.prompts?.[0] ?? 'Downloaded output'}</strong>
          <small class="downloaded-total">${job.detail || 'Downloaded'}</small>
        </div>
      </article>
    `,
    )
    .join('');
  uploadSelectedBtn.disabled = selectedDownloads.size === 0;
  deleteSelectedBtn.disabled = selectedDownloads.size === 0;
}

function renderGallery(images) {
  if (!galleryGrid) return;
  if (!images.length) {
    galleryGrid.innerHTML = '<p class="helper">No finished images yet.</p>';
    return;
  }
  galleryGrid.innerHTML = images
    .map(
      (job) => `
      <article class="gallery-card">
        <img src="${job.downloadUrl}" alt="${job.prompts?.[0] ?? 'Nano Banana output'}" loading="lazy">
        <div class="gallery-meta">
          <div class="job-badges">
            ${job.downloaded ? '<span class="tag downloaded">Downloaded</span>' : ''}
            ${job.deleted ? '<span class="tag deleted">Deleted</span>' : ''}
          </div>
          <strong>${job.prompts?.[0] ?? 'Generated image'}</strong>
          <small>${job.detail || 'Ready to use'}</small>
          <div class="gallery-actions">
            ${job.deleted ? '' : `<button class="btn download-btn" data-id="${job.id}">Download</button><button class="btn upload-btn" data-id="${job.id}">Upload</button><button class="btn ghost delete-btn" data-id="${job.id}">Delete</button>`}
          </div>
        </div>
      </article>
    `,
    )
    .join('');
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
            ${job.output && !job.deleted ? `<button class="btn download-btn" data-id="${job.id}">Download</button><button class="btn upload-btn" data-id="${job.id}">Upload</button>` : ''}
            ${job.output && !job.deleted ? `<button class="btn ghost delete-btn" data-id="${job.id}">Delete</button>` : ''}
          </div>
          <small>Status: ${job.status}${job.predictionUrl ? ` • <a href="${job.predictionUrl}" target="_blank" rel="noreferrer">view</a>` : ''}</small>
        </article>
      `,
      )
      .join('');
    const galleryItems = jobs.filter((job) => job.output && !job.deleted);
    renderGallery(galleryItems);
    const downloadedItems = jobs.filter((job) => job.downloaded && job.output && !job.deleted);
    renderDownloadedList(downloadedItems);
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

async function triggerDownload(jobId) {
  setStatus('Preparing download…');
  try {
    const response = await fetch(`/api/job/${jobId}/download`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Download failed');
    const anchor = document.createElement('a');
    anchor.href = payload.url;
    anchor.download = anchor.href.split('/').pop();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setStatus('Download started.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Download failed. Check console.');
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

async function triggerUpload(jobId) {
  setStatus('Triggering upload flow…');
  try {
    const response = await fetch(`/api/job/${jobId}/upload`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Upload failed');
    setStatus('Upload flow triggered.');
    refreshJobLog();
  } catch (error) {
    console.error(error);
    setStatus('Upload automation failed. Check console.');
  }
}

jobLog.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const jobId = button.dataset.id;
  if (button.classList.contains('download-btn')) {
    await triggerDownload(jobId);
    return;
  }
  if (button.classList.contains('delete-btn')) {
    await deleteJobAsset(jobId);
    return;
  }
  if (button.classList.contains('upload-btn')) {
    await triggerUpload(jobId);
    return;
  }
});

galleryGrid.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const jobId = button.dataset.id;
  if (button.classList.contains('download-btn')) {
    await triggerDownload(jobId);
    return;
  }
  if (button.classList.contains('delete-btn')) {
    await deleteJobAsset(jobId);
    return;
  }
  if (button.classList.contains('upload-btn')) {
    await triggerUpload(jobId);
    return;
  }
});

downloadedList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-id]');
  if (!checkbox) return;
  const id = checkbox.dataset.id;
  if (checkbox.checked) {
    selectedDownloads.add(id);
  } else {
    selectedDownloads.delete(id);
  }
  uploadSelectedBtn.disabled = selectedDownloads.size === 0;
  deleteSelectedBtn.disabled = selectedDownloads.size === 0;
});

selectAllDownloadedBtn.addEventListener('click', () => {
  const checkboxes = downloadedList.querySelectorAll('input[type="checkbox"][data-id]');
  const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every((cb) => cb.checked);
  checkboxes.forEach((cb) => {
    cb.checked = !allChecked;
    if (cb.checked) {
      selectedDownloads.add(cb.dataset.id);
    } else {
      selectedDownloads.delete(cb.dataset.id);
    }
  });
  uploadSelectedBtn.disabled = selectedDownloads.size === 0;
  deleteSelectedBtn.disabled = selectedDownloads.size === 0;
});

uploadSelectedBtn?.addEventListener('click', async () => {
  if (selectedDownloads.size === 0) return;
  setStatus('Uploading selected assets…');
  for (const jobId of Array.from(selectedDownloads)) {
    await triggerUpload(jobId);
  }
});

deleteSelectedBtn?.addEventListener('click', async () => {
  if (selectedDownloads.size === 0) return;
  setStatus('Deleting selected assets…');
  for (const jobId of Array.from(selectedDownloads)) {
    await deleteJobAsset(jobId);
  }
});

refreshGalleryButton.addEventListener('click', () => {
  refreshJobLog();
});

window.addEventListener('load', () => {
  loadPrompts();
  refreshJobLog();
  setInterval(refreshJobLog, 60000);
});
