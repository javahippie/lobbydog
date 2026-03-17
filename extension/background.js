/**
 * LobbyDog Background Service Worker
 * Manages the lobby register name index and caches entity detail requests.
 */

const INDEX_STORAGE_KEY = 'lobbydog_index';
const INDEX_VERSION_KEY = 'lobbydog_index_version';
const INDEX_TIMESTAMP_KEY = 'lobbydog_index_timestamp';
const DETAIL_CACHE_KEY = 'lobbydog_detail_cache';
const INDEX_URL = 'https://javahippie.net/assets/lobbydog-index.json';
const API_BASE = 'https://www.lobbyregister.bundestag.de';
const INDEX_CHECK_INTERVAL_MINUTES = 360; // 6 hours
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Message handling ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_INDEX') {
    getIndex().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_ENTITY') {
    getEntityDetails(msg.entityId, msg.registerNumber).then(sendResponse);
    return true;
  }

  if (msg.type === 'REFRESH_INDEX') {
    refreshIndex().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    getStatus().then(sendResponse);
    return true;
  }
});

// ── Index management ──────────────────────────────────────────

async function getIndex() {
  const stored = await chrome.storage.local.get([INDEX_STORAGE_KEY, INDEX_TIMESTAMP_KEY]);
  const index = stored[INDEX_STORAGE_KEY];

  if (index && Object.keys(index).length > 0) {
    return index;
  }

  // No index yet – build it
  return await refreshIndex();
}

async function refreshIndex() {
  console.log('[LobbyDog] Downloading lobby register index...');

  try {
    const response = await fetch(INDEX_URL);

    if (!response.ok) {
      throw new Error(`Index download failed: ${response.status}`);
    }

    const index = await response.json();
    const nameCount = Object.keys(index).length;
    console.log(`[LobbyDog] Index loaded: ${nameCount} names`);

    await chrome.storage.local.set({
      [INDEX_STORAGE_KEY]: index,
      [INDEX_TIMESTAMP_KEY]: Date.now()
    });

    return index;
  } catch (e) {
    console.error('[LobbyDog] Failed to download index:', e);
    // Return existing index if available
    const stored = await chrome.storage.local.get(INDEX_STORAGE_KEY);
    return stored[INDEX_STORAGE_KEY] || {};
  }
}

// ── Entity detail fetching with cache ─────────────────────────

async function getEntityDetails(entityId, registerNumber) {
  // Check in-memory / storage cache
  const stored = await chrome.storage.local.get(DETAIL_CACHE_KEY);
  const cache = stored[DETAIL_CACHE_KEY] || {};

  const cacheKey = `${registerNumber}_${entityId}`;
  const cached = cache[cacheKey];

  if (cached && Date.now() - cached.timestamp < DETAIL_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `${API_BASE}/sucheJson/${encodeURIComponent(registerNumber)}/${encodeURIComponent(entityId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Detail API returned ${response.status}`);
    }

    const raw = await response.json();
    const identity = raw.lobbyistIdentity || {};
    const activity = raw.activitiesAndInterests || {};
    const expenses = raw.financialExpenses || {};
    const employees = raw.employeesInvolvedInLobbying || {};

    // Normalize the response into a clean structure
    const data = {
      name: identity.name?.trim() || '',
      registerNumber: raw.registerNumber || registerNumber,
      legalForm: identity.legalForm?.de || '',
      type: activity.activity?.de || '',
      fieldsOfInterest: (activity.fieldsOfInterest || []).map(f => f.de || f.en || ''),
      employeeCount: employees.employeeFTE != null ? `${employees.employeeFTE} VZÄ` : '',
      financialExpenditure: formatExpenses(expenses),
      address: identity.address ? [identity.address.city, identity.address.country?.de || ''].filter(Boolean).join(', ') : '',
      website: identity.website || ''
    };

    // Update cache
    cache[cacheKey] = { data, timestamp: Date.now() };

    // Prune old cache entries (keep max 500)
    const keys = Object.keys(cache);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
      for (let i = 0; i < keys.length - 500; i++) {
        delete cache[sorted[i]];
      }
    }

    await chrome.storage.local.set({ [DETAIL_CACHE_KEY]: cache });

    return data;
  } catch (e) {
    console.error('[LobbyDog] Failed to fetch entity details:', e);
    return null;
  }
}

function formatExpenses(expenses) {
  const euro = expenses.financialExpensesEuro;
  if (!euro) return '';
  const fmt = (val) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(val);
  if (euro.from != null && euro.to != null) {
    if (euro.from === euro.to) return fmt(euro.from);
    return `${fmt(euro.from)} – ${fmt(euro.to)}`;
  }
  return '';
}

// ── Status ────────────────────────────────────────────────────

async function getStatus() {
  const stored = await chrome.storage.local.get([INDEX_STORAGE_KEY, INDEX_TIMESTAMP_KEY]);
  const index = stored[INDEX_STORAGE_KEY] || {};
  return {
    nameCount: Object.keys(index).length,
    lastUpdated: stored[INDEX_TIMESTAMP_KEY] || null
  };
}

// ── Periodic index update check ───────────────────────────────

chrome.alarms.create('checkIndex', { periodInMinutes: INDEX_CHECK_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkIndex') {
    const stored = await chrome.storage.local.get(INDEX_TIMESTAMP_KEY);
    const lastUpdate = stored[INDEX_TIMESTAMP_KEY] || 0;
    const age = Date.now() - lastUpdate;

    // Refresh if older than 24 hours
    if (age > 24 * 60 * 60 * 1000) {
      await refreshIndex();
    }
  }
});

// ── First install ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[LobbyDog] Extension installed, building initial index...');
  refreshIndex();
});
