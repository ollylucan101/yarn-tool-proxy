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

function extractText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim();
}

function extractProductLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const patterns = [
    /href="([^"]*product-page[^"]*)"/gi,
    /href="([^"]*\/products\/[^"]*)"/gi,
    /href="([^"]*\/shop\/[^"]*yarn[^"]*)"/gi,
    /href="([^"]*\/collections\/[^"]*\/products\/[^"]*)"/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const url = new URL(match[1], base.origin);
        if (url.hostname === base.hostname) links.add(url.href);
      } catch(e) {}
    }
  }
  return [...links].slice(0, 15);
}

async function scrapeYarnsFromPage(url, brand, anthropicKey) {
  const pageResp = await axios.get(url, {
    headers: { 'User-Agent': 'YarnTool/1.0 (yarn substitute finder; hello@yarnfood.com)' },
    timeout: 10000
  });
  const text = extractText(pageResp.data).substring(0, 6000);

  const prompt = `Extract yarn product data from this retailer page.

Page text:
${text}

Return ONLY a valid JSON array. If this is not a yarn product page, return [].
Infer gauge and needle size from weight/yardage if not stated.

[{
  "name": "yarn name",
  "brand": "${brand || 'unknown'}",
  "weight": "Lace|Fingering|Sport|DK|Worsted|Aran|Bulky|Super Bulky",
  "needle_size": "e.g. 3.5mm",
  "gauge": "e.g. 28 sts per 10cm",
  "fibre": "e.g. 100% Wensleydale Wool",
  "texture": "e.g. plied, woollen spun",
  "care": "e.g. handwash only",
  "yardage": "e.g. 350m per 100g",
  "shop_url": "${url}",
  "source": "indie"
}]

Exclude kits, advent boxes, pattern books, accessories. Only real yarn products.`;

  const claudeResp = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  }, {
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }
  });

  const responseText = claudeResp.data.content?.map(b => b.text || '').join('') || '[]';
  const clean = responseText.replace(/```json|```/g, '').trim();
  const jsonMatch = clean.match(/\[[\s\S]*\]/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
}

app.post('/scrape', async (req, res) => {
  try {
    const { url, brand } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    console.log('Scraping:', url);

    // First fetch the submitted URL
    const pageResp = await axios.get(url, {
      headers: { 'User-Agent': 'YarnTool/1.0 (yarn substitute finder; hello@yarnfood.com)' },
      timeout: 10000
    });
    const html = pageResp.data;
    const text = extractText(html).substring(0, 6000);

    // Check if this looks like a product listing page
    const productLinks = extractProductLinks(html, url);
    console.log('Found product links:', productLinks.length);

    let allYarns = [];

    if (productLinks.length > 0) {
      // It's a shop listing — scrape each product page
      console.log('Auto-discovering product pages...');
      const results = await Promise.allSettled(
        productLinks.map(link => scrapeYarnsFromPage(link, brand, ANTHROPIC_KEY))
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allYarns = allYarns.concat(result.value);
        }
      }
    } else {
      // It's a single product page — scrape directly
      allYarns = await scrapeYarnsFromPage(url, brand, ANTHROPIC_KEY);
    }

    // Deduplicate by name
    const seen = new Set();
    const unique = allYarns.filter(y => {
      if (!y.name || seen.has(y.name.toLowerCase())) return false;
      seen.add(y.name.toLowerCase());
      return true;
    });

    console.log('Total yarns extracted:', unique.length);
    res.json({ yarns: unique, count: unique.length, product_pages_scraped: productLinks.length });

  } catch (e) {
    console.error('Scrape error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
