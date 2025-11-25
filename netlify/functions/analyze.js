// netlify/functions/analyze.js
// TEMP: prove Netlify function works independently of Render

exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      message: 'Netlify function reached successfully.',
      received: event.body ? JSON.parse(event.body) : null
    })
  };
};
