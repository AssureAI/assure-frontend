// netlify/functions/analyze.js
// Secure proxy from Netlify -> Render backend

const RENDER_URL = 'https://assure-backend.onrender.com/analyze';

// Use the existing Vite-style env var that you said is already set in Netlify
// Make sure VITE_API_KEY is configured in your Netlify site's environment variables.
const API_KEY = process.env.VITE_API_KEY;

/**
 * Netlify serverless function
 * Browser -> /.netlify/functions/analyze -> Render backend (/analyze)
 */
exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }

  if (!API_KEY) {
    console.error('VITE_API_KEY is not set in Netlify environment variables');
    return {
      statusCode: 500,
      body: 'Server misconfiguration: API key missing',
    };
  }

  try {
    // Forward original request body on to your Render backend
    const response = await fetch(RENDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Secret stays on the server – browser never sees this header
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: event.body,
    });

    const text = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
      body: text,
    };
  } catch (err) {
    console.error('Error calling Render backend:', err);
    return {
      statusCode: 502,
      body: 'Error contacting analysis backend',
    };
  }
};
