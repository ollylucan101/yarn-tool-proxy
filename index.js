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

app.post('/scrape', async (req, res) => {
  try {
    const { url, shop_url, brand } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    // Fetch the page
    const pageResp = await axios.get(url, {
      headers: { 'User-Agent': 'YarnTool/1.0 (yarn substitute finder; hello@yarnfood.com)' },
      timeout: 10000
    });
    const html = pageResp.data;

    // Strip HTML tags to get plain text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 8000);

    // Ask Claude to extract yarn data
    const prompt = `You are extracting yarn product data from a retailer's website page. 

Here is the page text:
${text}

Extract all yarn products mentioned. For each yarn return structured data.
If gauge is not listed, infer it from weight category and yardage.
If needle size is not listed, infer from weight category.

Return ONLY a valid JSON array, no markdown:
[{
  "name": "yarn name",
  "brand": "${brand || 'unknown'}",
  "weight": "Lace|Fingering|Sport|DK|Worsted|Aran|Bulky|Super Bulky",
  "needle_size": "e.g. 3.5mm or range like 3-3.5mm",
  "gauge": "e.g. 28 sts per 10cm",
  "fibre": "e.g. 100% Wensleydale Wool",
  "texture": "e.g. plied, singles, woollen spun",
  "care": "e.g. handwash only",
  "yardage": "e.g. 350m per 100g",
  "shop_url": "${shop_url || url}",
  "source": "indie"
}]

Only include actual yarn products, not kits, advent boxes, pattern books, or accessories.`;

    const claudeResp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    const responseText = claudeResp.data.content?.map(b => b.text || '').join('') || '[]';
    const yarns = JSON.parse(responseText.replace(/```json|```/g, '').trim());
    res.json({ yarns, count: yarns.length });

  } catch (e) {
    console.error('Scrape error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
