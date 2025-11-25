// internal/app.js
// Front-end controller for Assure.ai internal demo

// -----------------------------
// DOM ELEMENTS
// -----------------------------

const srTextEl = document.getElementById('srText');
const loadGoodBtn = document.getElementById('loadGood');
const loadBadBtn = document.getElementById('loadBad');
const fileInputEl = document.getElementById('fileInput');
const adviceTypeEl = document.getElementById('adviceType');
const channelEl = document.getElementById('channel');
const ageBandEl = document.getElementById('ageBand');
const vulnerableEl = document.getElementById('vulnerable');
const runBtn = document.getElementById('runBtn');
const exportBtn = document.getElementById('exportBtn');

const progressEl = document.getElementById('progress');
const barEl = document.getElementById('bar');
const barLabelEl = document.getElementById('barLabel');

const overallEl = document.getElementById('overall');
const contextNoteEl = document.getElementById('contextNote');
const accordionEl = document.getElementById('accordion');

// Last backend response (for export)
let lastBackendResult = null;

// -----------------------------
// SAMPLE TEXTS
// -----------------------------

const GOOD_SAMPLE = `Client: Mr & Mrs Example
Age: 61 and 59
Objective: Tax-efficient growth and income using ISA and GIA.

Recommendation:
- Invest £150,000 into a diversified multi-asset portfolio aligned to a balanced risk profile.
- Use ISA allowance first, with remaining funds held in a GIA.
- Ongoing review service provided annually.

Suitability:
- Capacity for loss and attitude to risk assessed and documented.
- Alternative options (e.g. deposit accounts, leaving funds within existing investments) considered and discounted with clear rationale.
- Costs and charges disclosed in percentage and monetary terms.
- Risks explained, including that the value of investments can go down as well as up and that capital is not guaranteed.

This recommendation is considered suitable given your objectives, risk profile and capacity for loss.`;

const BAD_SAMPLE = `This investment is guaranteed and has no risk at all.
You will definitely get better returns than your pension and you cannot lose money.

We have not considered any alternative products or explained any charges in detail.
There is no discussion of risk, tax, or what happens if markets fall.

This transfer away from a defined benefit pension is obviously better because it offers more flexibility, so we recommend you transfer the full amount now.`;

// -----------------------------
// UTILITIES: PROGRESS UI
// -----------------------------

function showProgress(label = 'Analysing…') {
  if (!progressEl || !barEl || !barLabelEl) return;
  progressEl.hidden = false;
  barEl.style.width = '10%';
  barLabelEl.textContent = label;
}

function updateProgress(pct, label) {
  if (!progressEl || !barEl || !barLabelEl) return;
  barEl.style.width = `${pct}%`;
  if (label) barLabelEl.textContent = label;
}

function hideProgress() {
  if (!progressEl || !barEl || !barLabelEl) return;
  barEl.style.width = '0%';
  barLabelEl.textContent = '';
  progressEl.hidden = true;
}

// -----------------------------
// FILE IMPORT HANDLING
// Uses: mammoth (DOCX) and pdfjsLib (PDF)
// -----------------------------

async function handleFileImport(file) {
  if (!file) return;
  console.log('[Import] Selected file:', file.name, file.type);

  const name = file.name.toLowerCase();
  const ext = name.split('.').pop();

  try {
    if (ext === 'docx') {
      const arrayBuffer = await file.arrayBuffer();
      if (typeof mammoth === 'undefined') {
        console.warn('[Import] mammoth not available; fallback to raw text');
        const textFallback = await file.text();
        srTextEl.value = textFallback;
        return;
      }
      const result = await mammoth.extractRawText({ arrayBuffer });
      srTextEl.value = result.value || '';
      console.log('[Import] DOCX text length:', srTextEl.value.length);
    } else if (ext === 'pdf') {
      const arrayBuffer = await file.arrayBuffer();
      if (typeof pdfjsLib === 'undefined') {
        console.warn('[Import] pdfjsLib not available; fallback to raw text');
        const textFallback = await file.text();
        srTextEl.value = textFallback;
        return;
      }

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const strings = content.items.map((item) => item.str);
        fullText += strings.join(' ') + '\n\n';
      }

      srTextEl.value = fullText.trim();
      console.log('[Import] PDF text length:', srTextEl.value.length);
    } else {
      // Plain text or anything else we just read as text
      const text = await file.text();
      srTextEl.value = text;
      console.log('[Import] Text file length:', text.length);
    }
  } catch (err) {
    console.error('[Import] Failed to read file', err);
    alert('Could not read that file. Please check the console for details.');
  }
}

// -----------------------------
// BACKEND CALL VIA NETLIFY FUNCTION
// -----------------------------

// Call Netlify function → Render backend and return parsed JSON
async function getBackendOutcomes(text, filters) {
  try {
    const response = await fetch('/.netlify/functions/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        filters
      })
    });

    if (!response.ok) {
      console.error('Backend HTTP error', response.status);
      const respText = await response.text().catch(() => '');
      console.error('Backend error body:', respText);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Backend call failed', err);
    return null;
  }
}

// -----------------------------
// RENDERING RESULTS
// -----------------------------

function statusClass(status) {
  if (!status) return '';
  const s = String(status).toLowerCase();
  if (s === 'pass') return 'pass';
  if (s === 'flag' || s === 'warning') return 'flag';
  if (s === 'fail' || s === 'error') return 'fail';
  return '';
}

function statusLabel(status) {
  if (!status) return '—';
  const s = String(status).toLowerCase();
  if (s === 'pass') return 'PASS';
  if (s === 'flag' || s === 'warning') return 'FLAG';
  if (s === 'fail' || s === 'error') return 'FAIL';
  return s.toUpperCase();
}

function renderScore(data, filters) {
  if (!overallEl || !contextNoteEl) return;

  let score = null;

  if (typeof data?.overall_score === 'number') {
    // Could be 0–1 or 0–100; normalise
    score = data.overall_score <= 1 ? Math.round(data.overall_score * 100) : Math.round(data.overall_score);
  }

  if (score === null && data?.outcomes && typeof data.outcomes === 'object') {
    // Fallback: compute from rule statuses
    const vals = [];
    const outcomes = data.outcomes;
    Object.values(outcomes).forEach((ruleOrSection) => {
      if (Array.isArray(ruleOrSection.rules)) {
        ruleOrSection.rules.forEach((r) => {
          const st = String(r.status || '').toLowerCase();
          if (st === 'pass') vals.push(1);
          else if (st === 'flag') vals.push(0.5);
          else if (st === 'fail') vals.push(0);
        });
      } else if (ruleOrSection && typeof ruleOrSection === 'object') {
        const st = String(ruleOrSection.status || '').toLowerCase();
        if (st === 'pass') vals.push(1);
        else if (st === 'flag') vals.push(0.5);
        else if (st === 'fail') vals.push(0);
      }
    });
    if (vals.length > 0) {
      score = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100);
    }
  }

  if (score === null) {
    overallEl.textContent = '—';
  } else {
    overallEl.textContent = `${score}%`;
  }

  // Context note from filters
  const bits = [];
  if (filters?.advice_type) bits.push(`Advice type: ${filters.advice_type}`);
  if (filters?.channel) bits.push(`Channel: ${filters.channel}`);
  if (filters?.age_band) bits.push(`Age band: ${filters.age_band}`);
  if (filters?.vulnerable) bits.push('Vulnerability flagged');

  contextNoteEl.textContent = bits.length
    ? `Context used for this run — ${bits.join(' • ')}`
    : '';
}

function renderAccordion(data) {
  if (!accordionEl) return;
  accordionEl.innerHTML = '';

  if (!data) {
    accordionEl.innerHTML = '<div class="card">No results to display.</div>';
    return;
  }

  const outcomes = data.outcomes || data.sections || data.rules;
  if (!outcomes) {
    accordionEl.innerHTML = '<div class="card">No structured rule outcomes returned from backend.</div>';
    return;
  }

  // Normalise into an array of "sections"
  const sections = [];

  if (Array.isArray(outcomes)) {
    // e.g. [{id, title, rules: [...]}, ...]
    outcomes.forEach((sec, idx) => {
      sections.push({
        id: sec.id || `section-${idx}`,
        title: sec.title || sec.name || `Section ${idx + 1}`,
        description: sec.description || '',
        rules: sec.rules || []
      });
    });
  } else if (typeof outcomes === 'object') {
    // Object map of sections or rules
    Object.entries(outcomes).forEach(([key, val], idx) => {
      if (Array.isArray(val?.rules)) {
        sections.push({
          id: key,
          title: val.title || key,
          description: val.description || '',
          rules: val.rules
        });
      } else if (val && typeof val === 'object') {
        // Treat as a "flat" rule under a generic section
        sections.push({
          id: `section-${idx}`,
          title: val.section || 'Rule outcomes',
          description: '',
          rules: [val]
        });
      }
    });
  }

  if (!sections.length) {
    accordionEl.innerHTML = '<div class="card">No rule-level details available.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  sections.forEach((section) => {
    const card = document.createElement('div');
    card.className = 'card';

    const details = document.createElement('details');
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'summary';
    summary.innerHTML = `
      <span>${section.title || 'Section'}</span>
      ${section.description ? `<span class="refs">${section.description}</span>` : ''}
    `;

    const inner = document.createElement('div');
    inner.className = 'inner';

    if (Array.isArray(section.rules) && section.rules.length > 0) {
      section.rules.forEach((rule) => {
        const ruleDiv = document.createElement('div');
        ruleDiv.className = 'rule';

        const pillCls = statusClass(rule.status);
        const pillLbl = statusLabel(rule.status);

        const ruleHead = document.createElement('div');
        ruleHead.className = 'rule-head';
        ruleHead.innerHTML = `
          <span class="pill ${pillCls}">${pillLbl}</span>
          <strong>${rule.title || rule.name || rule.id || 'Rule'}</strong>
          ${
            rule.ref
              ? `<span class="refs">${rule.ref}</span>`
              : rule.regulation
              ? `<span class="refs">${rule.regulation}</span>`
              : ''
          }
        `;

    const body = document.createElement('div');
const bits = [];

// Requirement / obligation
const requirementText =
  rule.requirement ||
  rule.requirements ||
  rule.obligation ||
  rule.rule_text;

if (requirementText) {
  bits.push(
    `<div><strong>Requirement:</strong> ${requirementText}</div>`
  );
}

// Why / rationale / explanation
const whyText =
  rule.why ||
  rule.reason ||
  rule.explanation ||
  rule.explanations ||
  rule.context;

if (whyText) {
  bits.push(
    `<div><strong>Why it matters / Explanation:</strong> ${whyText}</div>`
  );
}

// Fix / remediation suggestion
const fixText =
  rule.fix ||
  rule.fix_suggestion ||
  rule.remediation ||
  rule.suggestion;

if (fixText) {
  bits.push(
    `<div><strong>Suggested fix:</strong> ${fixText}</div>`
  );
}

// Evidence / snippet from the report
const evidenceText = rule.snippet || rule.evidence || rule.text_match;

if (evidenceText) {
  bits.push(
    `<div><strong>Evidence:</strong> <span class="refs">${evidenceText}</span></div>`
  );
}

// Fallback if nothing else was populated
if (!bits.length && rule.detail) {
  bits.push(`<div>${rule.detail}</div>`);
}
if (!bits.length && rule.description) {
  bits.push(`<div>${rule.description}</div>`);
}

body.innerHTML =
  bits.join('') || '<div class="refs">No additional detail provided.</div>';
        ruleDiv.appendChild(ruleHead);
        ruleDiv.appendChild(body);
        inner.appendChild(ruleDiv);
      });
    } else {
      inner.innerHTML = '<div class="refs">No rules returned for this section.</div>';
    }

    details.appendChild(summary);
    details.appendChild(inner);
    card.appendChild(details);
    fragment.appendChild(card);
  });

  accordionEl.appendChild(fragment);
}

// -----------------------------
// MAIN RUN HANDLER
// -----------------------------

async function runCheck() {
  const text = (srTextEl?.value || '').trim();
  if (!text) {
    alert('Paste or import some Suitability Report text first.');
    return;
  }

  const filters = {
    advice_type: adviceTypeEl?.value || 'standard',
    channel: channelEl?.value || 'advised',
    age_band: ageBandEl?.value || '55plus',
    vulnerable: !!(vulnerableEl && vulnerableEl.checked)
  };

  showProgress('Analysing…');

  const data = await getBackendOutcomes(text, filters);

  if (!data) {
    hideProgress();
    alert('The backend could not analyse this report. Check the console for details.');
    return;
  }

  lastBackendResult = data;

  // Update score + context
  renderScore(data, filters);
  // Update accordion / rules
  renderAccordion(data);

  hideProgress();
}

// -----------------------------
// EXPORT RESULTS
// -----------------------------

function exportResults() {
  if (!lastBackendResult) {
    alert('Run a check first before exporting.');
    return;
  }

  const blob = new Blob([JSON.stringify(lastBackendResult, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'assure_results.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------
// WIRE UP EVENTS
// -----------------------------

if (loadGoodBtn) {
  loadGoodBtn.addEventListener('click', () => {
    srTextEl.value = GOOD_SAMPLE;
  });
}

if (loadBadBtn) {
  loadBadBtn.addEventListener('click', () => {
    srTextEl.value = BAD_SAMPLE;
  });
}

if (fileInputEl) {
  fileInputEl.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    await handleFileImport(file);
  });
}

if (runBtn) {
  runBtn.addEventListener('click', () => {
    runCheck();
  });
}

if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    exportResults();
  });
}

// Optional: keyboard shortcut (Ctrl+Enter) to run check
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    runCheck();
  }
});
