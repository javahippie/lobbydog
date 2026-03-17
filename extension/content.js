/**
 * LobbyDog Content Script
 * Scans visible text on news pages, matches against the lobby register index,
 * highlights matches, and shows tooltips on hover.
 */
(() => {
  'use strict';

  // Avoid running in iframes or if already initialized
  if (window.__lobbydogInitialized) return;
  window.__lobbydogInitialized = true;

  let automaton = null;
  let nameIndex = {}; // name → { entityId, registerNumber }
  let matchCount = 0;
  let tooltip = null;
  let badge = null;
  let hideTimeout = null;
  const scannedNodes = new WeakSet();
  const highlightedNames = new Set(); // only highlight first occurrence per name

  // ── Initialization ──────────────────────────────────────────────

  async function init() {
    const index = await loadIndex();
    if (!index || Object.keys(index).length === 0) return;

    nameIndex = index;
    automaton = new AhoCorasick();
    for (const name of Object.keys(index)) {
      automaton.addPattern(name);
    }
    automaton.build();

    // Set icon URL as CSS variable so ::after pseudo-element can use it
    const iconUrl = chrome.runtime.getURL('icons/lobbydog.svg');
    document.documentElement.style.setProperty('--lobbydog-icon', `url("${iconUrl}")`);

    createTooltip();
    observeVisibleElements();
    observeDOMChanges();
  }

  async function loadIndex() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_INDEX' });
      return response || {};
    } catch (e) {
      console.warn('[LobbyDog] Failed to load index:', e);
      return {};
    }
  }

  // ── DOM Scanning ────────────────────────────────────────────────

  /** Only scan content-relevant elements */
  const CONTENT_SELECTORS = 'article, main, [role="main"], .article-body, .story-body, .entry-content, .post-content, .content, p, h1, h2, h3, h4';

  /** Elements to skip */
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'SVG']);

  function observeVisibleElements() {
    const observer = new IntersectionObserver((entries) => {
      const toScan = [];
      for (const entry of entries) {
        if (entry.isIntersecting) {
          toScan.push(entry.target);
          observer.unobserve(entry.target);
        }
      }
      if (toScan.length > 0) {
        scheduleScan(toScan);
      }
    }, { rootMargin: '200px' });

    document.querySelectorAll(CONTENT_SELECTORS).forEach(el => {
      observer.observe(el);
    });
  }

  /** Watch for dynamically added content (infinite scroll, SPAs) */
  function observeDOMChanges() {
    const mutationObserver = new MutationObserver((mutations) => {
      const newElements = [];
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && !SKIP_TAGS.has(node.tagName)) {
            const contentEls = node.matches?.(CONTENT_SELECTORS)
              ? [node]
              : Array.from(node.querySelectorAll?.(CONTENT_SELECTORS) || []);
            newElements.push(...contentEls);
          }
        }
      }
      if (newElements.length > 0) {
        scheduleScan(newElements);
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /** Batch scanning using requestIdleCallback */
  function scheduleScan(elements) {
    const textNodes = [];
    for (const el of elements) {
      collectTextNodes(el, textNodes);
    }

    let index = 0;
    const BATCH_SIZE = 30;

    function processBatch(deadline) {
      while (index < textNodes.length && deadline.timeRemaining() > 2) {
        const end = Math.min(index + BATCH_SIZE, textNodes.length);
        for (let i = index; i < end; i++) {
          scanTextNode(textNodes[i]);
        }
        index = end;
      }
      if (index < textNodes.length) {
        requestIdleCallback(processBatch);
      } else {
        updateBadge();
      }
    }

    if ('requestIdleCallback' in window) {
      requestIdleCallback(processBatch);
    } else {
      // Fallback for older browsers
      setTimeout(() => {
        for (const node of textNodes) {
          scanTextNode(node);
        }
        updateBadge();
      }, 0);
    }
  }

  function collectTextNodes(root, result) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (scannedNodes.has(node)) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest('.lobbydog-highlight')) return NodeFilter.FILTER_REJECT;
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      result.push(walker.currentNode);
    }
  }

  function scanTextNode(textNode) {
    if (scannedNodes.has(textNode)) return;
    scannedNodes.add(textNode);

    const text = textNode.textContent;
    if (!text || text.length < 3) return;

    const matches = automaton.search(text);
    if (matches.length === 0) return;

    // Deduplicate overlapping matches: keep the longest at each position
    const deduped = deduplicateMatches(matches);

    // Process matches in reverse order to preserve offsets
    const parent = textNode.parentNode;
    if (!parent) return;

    // Sort descending by start position
    deduped.sort((a, b) => b.start - a.start);

    let currentNode = textNode;
    for (const match of deduped) {
      const { name, start, end } = match;

      // Validate: match should be a word boundary (not inside another word)
      if (start > 0 && isWordChar(text[start - 1])) continue;
      if (end < text.length && isWordChar(text[end])) continue;

      const info = nameIndex[name];
      if (!info) continue;

      // Only highlight first occurrence of each name
      if (highlightedNames.has(name)) continue;
      highlightedNames.add(name);

      // Split the text node and wrap the match
      const afterText = currentNode.splitText(end);
      const matchNode = currentNode.splitText(start);

      const highlight = document.createElement('mark');
      highlight.className = 'lobbydog-highlight';
      highlight.dataset.entityId = info.entityId;
      highlight.dataset.registerNumber = info.registerNumber;
      highlight.dataset.name = name;
      if (info.p) highlight.dataset.person = '1';
      highlight.textContent = matchNode.textContent;

      parent.replaceChild(highlight, matchNode);
      matchCount++;

      // Continue with the remaining pre-match text
      currentNode = currentNode; // the first part before `start`
    }
  }

  function isWordChar(ch) {
    return /\w/.test(ch);
  }

  function deduplicateMatches(matches) {
    if (matches.length <= 1) return matches;

    // Group by overlapping ranges, prefer longer matches
    matches.sort((a, b) => a.start - b.start || b.name.length - a.name.length);

    const result = [matches[0]];
    for (let i = 1; i < matches.length; i++) {
      const prev = result[result.length - 1];
      if (matches[i].start >= prev.end) {
        result.push(matches[i]);
      } else if (matches[i].name.length > prev.name.length) {
        result[result.length - 1] = matches[i];
      }
    }
    return result;
  }

  // ── Tooltip ─────────────────────────────────────────────────────

  let activeHighlight = null;

  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'lobbydog-tooltip';
    setTooltipContent(el('div', 'lobbydog-tooltip-loading', 'Lade...'));
    document.body.appendChild(tooltip);

    // Use mouseover/mouseout (they bubble, unlike mouseenter/mouseleave)
    // plus capture phase to beat other handlers
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);

    // Keep tooltip open when mouse is over it
    tooltip.addEventListener('mouseover', () => {
      clearTimeout(hideTimeout);
    });
    tooltip.addEventListener('mouseout', () => {
      hideTimeout = setTimeout(hideTooltip, 300);
    });
  }

  function onMouseOver(e) {
    const highlight = e.target.closest?.('.lobbydog-highlight');
    if (!highlight || highlight === activeHighlight) return;

    clearTimeout(hideTimeout);
    activeHighlight = highlight;

    const entityId = highlight.dataset.entityId;
    const registerNumber = highlight.dataset.registerNumber;
    const name = highlight.dataset.name;
    const isPerson = highlight.dataset.person === '1';

    showTooltipLoading(highlight);
    fetchEntityDetails(entityId, registerNumber, name, isPerson);
  }

  function onMouseOut(e) {
    const highlight = e.target.closest?.('.lobbydog-highlight');
    if (!highlight) return;

    // Check if we moved to the tooltip or another part of the same highlight
    const related = e.relatedTarget;
    if (related && (tooltip.contains(related) || highlight.contains(related))) return;

    hideTimeout = setTimeout(hideTooltip, 300);
  }

  function hideTooltip() {
    tooltip.classList.remove('lobbydog-visible');
    activeHighlight = null;
  }

  function showTooltipLoading(anchor) {
    setTooltipContent(el('div', 'lobbydog-tooltip-loading', 'Lade Informationen...'));
    positionTooltip(anchor);
    tooltip.classList.add('lobbydog-visible');
  }

  function positionTooltip(anchor) {
    const rect = anchor.getBoundingClientRect();
    const tooltipWidth = 400;
    const tooltipHeight = tooltip.offsetHeight || 200;

    let top = rect.bottom + 8;
    let left = rect.left;

    // Ensure tooltip stays within viewport
    if (left + tooltipWidth > window.innerWidth - 16) {
      left = window.innerWidth - tooltipWidth - 16;
    }
    if (left < 16) left = 16;

    if (top + tooltipHeight > window.innerHeight - 16) {
      top = rect.top - tooltipHeight - 8;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  async function fetchEntityDetails(entityId, registerNumber, name, isPerson) {
    try {
      const data = await chrome.runtime.sendMessage({
        type: 'GET_ENTITY',
        entityId,
        registerNumber
      });

      if (!data) {
        setTooltipContent(
          el('div', 'lobbydog-tooltip-header', [
            el('div', 'lobbydog-tooltip-name', name),
            el('div', 'lobbydog-tooltip-type', 'Im Lobbyregister eingetragen')
          ]),
          el('div', 'lobbydog-tooltip-error', 'Details konnten nicht geladen werden.')
        );
        return;
      }

      renderTooltip(data, name, isPerson);
    } catch (e) {
      setTooltipContent(el('div', 'lobbydog-tooltip-error', `Fehler beim Laden: ${e.message}`));
    }
  }

  function renderTooltip(data, fallbackName, isPerson) {
    const name = data.name || fallbackName;
    const type = data.legalForm || data.type || '';
    const fields = data.fieldsOfInterest || [];
    const employees = data.employeeCount || '';
    const expenditure = data.financialExpenditure || '';
    const registerNumber = data.registerNumber || '';

    const rows = [];
    if (type) rows.push(tooltipRow('Rechtsform', type));
    if (fields.length > 0) {
      const fieldsText = fields.slice(0, 5).join(', ') + (fields.length > 5 ? ` (+${fields.length - 5})` : '');
      rows.push(tooltipRow('Interessenbereiche', fieldsText));
    }
    if (employees) rows.push(tooltipRow('Interessenvertreter', employees));
    if (expenditure) rows.push(tooltipRow('Finanzaufwand', expenditure));
    if (data.address) rows.push(tooltipRow('Sitz', data.address));

    const header = el('div', 'lobbydog-tooltip-header', [
      el('div', 'lobbydog-tooltip-name', name),
      el('div', 'lobbydog-tooltip-type', `Lobbyregister ${registerNumber ? '#' + registerNumber : ''}`)
    ]);

    const body = el('div', 'lobbydog-tooltip-body',
      rows.length > 0 ? rows : [el('div', 'lobbydog-tooltip-row', 'Keine weiteren Details verf\u00FCgbar.')]
    );

    const link = document.createElement('a');
    link.className = 'lobbydog-tooltip-link';
    link.href = `https://www.lobbyregister.bundestag.de/suche/${registerNumber}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Im Lobbyregister ansehen \u2192';
    const footer = el('div', 'lobbydog-tooltip-footer', [link]);

    const parts = [header];
    if (isPerson) {
      parts.push(el('div', 'lobbydog-tooltip-warning',
        'Hinweis: Namensgleichheit ist m\u00F6glich. Dieser Treffer basiert auf dem Namen einer Person im Lobbyregister. Es k\u00F6nnte sich um eine andere Person gleichen Namens handeln.'));
    }
    parts.push(body, footer);

    setTooltipContent(...parts);
  }

  function tooltipRow(label, value) {
    return el('div', 'lobbydog-tooltip-row', [
      el('span', 'lobbydog-tooltip-label', label),
      el('span', 'lobbydog-tooltip-value', value)
    ]);
  }

  // ── Badge ───────────────────────────────────────────────────────

  let currentHighlightIndex = -1;

  function getAllHighlights() {
    return Array.from(document.querySelectorAll('.lobbydog-highlight'));
  }

  function scrollToHighlight(index) {
    const highlights = getAllHighlights();
    if (highlights.length === 0) return;

    currentHighlightIndex = ((index % highlights.length) + highlights.length) % highlights.length;
    highlights[currentHighlightIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Brief flash to indicate current
    const el = highlights[currentHighlightIndex];
    el.style.outline = '2px solid #f59e0b';
    setTimeout(() => { el.style.outline = ''; }, 1000);

    updateBadgeCounter();
  }

  function updateBadgeCounter() {
    const total = getAllHighlights().length;
    if (!badge || total === 0) return;
    const counter = badge.querySelector('.lobbydog-badge-counter');
    if (counter) {
      counter.textContent = `${currentHighlightIndex + 1}/${total}`;
    }
  }

  function updateBadge() {
    if (matchCount === 0) return;

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'lobbydog-badge';

      const prev = el('span', 'lobbydog-badge-prev', '\u25B2');
      const icon = document.createElement('img');
      icon.className = 'lobbydog-badge-icon';
      icon.src = chrome.runtime.getURL('icons/lobbydog.svg');
      icon.alt = '';
      const counter = el('span', 'lobbydog-badge-counter');
      const next = el('span', 'lobbydog-badge-next', '\u25BC');
      badge.append(prev, icon, counter, next);

      prev.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollToHighlight(currentHighlightIndex - 1);
      });
      next.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollToHighlight(currentHighlightIndex + 1);
      });
      document.body.appendChild(badge);
    }

    const total = getAllHighlights().length;
    const counter = badge.querySelector('.lobbydog-badge-counter');
    counter.textContent = currentHighlightIndex >= 0
      ? `${currentHighlightIndex + 1}/${total}`
      : `${total} erkannt`;
  }

  // ── Utils ───────────────────────────────────────────────────────

  /** Create a DOM element: el('div', 'className', 'text or [children]') */
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof content === 'string') {
      node.textContent = content;
    } else if (Array.isArray(content)) {
      for (const child of content) node.appendChild(child);
    }
    return node;
  }

  /** Replace tooltip contents safely (no innerHTML) */
  function setTooltipContent(...children) {
    tooltip.textContent = '';
    for (const child of children) tooltip.appendChild(child);
  }

  // ── Start ───────────────────────────────────────────────────────
  init();
})();
