// netlify/functions/analyze.js

const ANALYZER_URL = 'https://assure-backend-2.onrender.com/analyze';

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  // Parse incoming JSON from the browser
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  const { text, filters } = body;

  if (!text || typeof text !== 'string') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing or invalid `text` field' })
    };
  }

  // Map front-end filters into advice_context for the backend
  const adviceContext = {
    advice_type: filters?.advice_type || 'standard',
    channel: filters?.channel || 'advised',
    age_band: filters?.age_band || '55_70',
    vulnerable: !!filters?.vulnerable
  };

  const payload = {
    report_text: text,
    advice_context: adviceContext,
    options: {
      include_explanations: true,
      include_fix_suggestions: true
    }
  };

  try {
    const resp = await fetch(ANALYZER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Pass through backend status + body
    const respText = await resp.text();

    return {
      statusCode: resp.status,
      headers: {
        'Content-Type':
          resp.headers.get('content-type') || 'application/json'
      },
      body: respText
    };
  } catch (err) {
    // If Render is down or network error
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: 'Failed to reach analyzer backend',
        detail: err.message || String(err)
      })
    };
  }
};
