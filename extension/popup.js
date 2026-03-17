document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const nameCountEl = document.getElementById('nameCount');
  const lastUpdatedEl = document.getElementById('lastUpdated');
  const refreshBtn = document.getElementById('refreshBtn');

  function setStatus(cssClass, text) {
    statusEl.textContent = '';
    const dot = document.createElement('span');
    dot.className = `status-dot ${cssClass}`;
    statusEl.appendChild(dot);
    statusEl.appendChild(document.createTextNode(text));
  }

  async function updateUI() {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });

      if (status.nameCount > 0) {
        const ageMs = Date.now() - (status.lastUpdated || 0);
        const isStale = ageMs > 48 * 60 * 60 * 1000;

        setStatus(isStale ? 'stale' : 'active', isStale ? 'Veraltet' : 'Aktiv');
        nameCountEl.textContent = new Intl.NumberFormat('de-DE').format(status.nameCount);

        if (status.lastUpdated) {
          lastUpdatedEl.textContent = new Date(status.lastUpdated).toLocaleString('de-DE');
        }
      } else {
        setStatus('empty', 'Kein Index');
        nameCountEl.textContent = '0';
        lastUpdatedEl.textContent = '-';
      }
    } catch (e) {
      setStatus('empty', 'Fehler');
    }
  }

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Aktualisiere...';

    try {
      await chrome.runtime.sendMessage({ type: 'REFRESH_INDEX' });
      await updateUI();
      refreshBtn.textContent = 'Fertig!';
      setTimeout(() => {
        refreshBtn.textContent = 'Index aktualisieren';
        refreshBtn.disabled = false;
      }, 2000);
    } catch (e) {
      refreshBtn.textContent = 'Fehler - Erneut versuchen';
      refreshBtn.disabled = false;
    }
  });

  await updateUI();
});
