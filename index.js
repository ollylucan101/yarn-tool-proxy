const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const RAVELRY_USER = process.env.RAVELRY_USER;
const RAVELRY_PASS = process.env.RAVELRY_PASS;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

app.get('/test', (req, res) => {
  res.json({ 
    status: 'ok',
    has_ravelry_user: !!RAVELRY_USER,
    has_ravelry_pass: !!RAVELRY_PASS,
    has_anthropic_key: !!ANTHROPIC_KEY,
    anthropic_key_prefix: ANTHROPIC_KEY ? ANTHROPIC_KEY.substring(0, 10) : 'missing'
  });
});

app.get('/yarns/search', async (req, res) => {
  try {
    const response = await axios.get('https://api.ravelry.com/yarns/search.json', {
      params: req.query,
      auth: { username: RAVELRY_USER, password: RAVELRY_PASS }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/yarns/:id', async (req, res) => {
  try {
    const response = await axios.get(`https://api.ravelry.com/yarns/${req.params.id}.json`, {
      auth: { username: RAVELRY_USER, password: RAVELRY_PASS }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/patterns/search', async (req, res) => {
  try {
    const response = await axios.get('https://api.ravelry.com/patterns/search.json', {
      params: req.query,
      auth: { username: RAVELRY_USER, password: RAVELRY_PASS }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/claude', async (req, res) => {
  try {
    console.log('Claude request received, key prefix:', ANTHROPIC_KEY ? ANTHROPIC_KEY.substring(0, 10) : 'missing');
    const response = await axios.post('https://api.anthropic.com/v1/messages', req.body, {
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (e) {
    console.error('Claude error status:', e.response?.status);
    console.error('Claude error data:', JSON.stringify(e.response?.data));
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
