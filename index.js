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
  res.json({ status: 'ok', has_ravelry_user: !!RAVELRY_USER, has_ravelry_pass: !!RAVELRY_PASS, has_anthropic_key: !!ANTHROPIC_KEY, anthropic_key_prefix: ANTHROPIC_KEY ? ANTHROPIC_KEY.substring(0, 10) : 'missing' });
});
app.get('/yarns/search', async (req, res) => {
  try {
    const response = await axios.get('https://api.ravelry.com/yarns/search.json', { params: req.query, auth: { username: RAVELRY_USER, password: RAVELRY_PASS } });
    res.json(response.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/yarns/:id', async (req, res) => {
  try {
    const response = await axios.get(`https://api.ravelry.com/yarns/${req.params.id}.json`, { auth: { username: RAVELRY_USER, password: RAVELRY_PASS } });
    res.json(response.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/patterns/search', async (req, res) => {
  try {
    const response = await axios.get('https://api.ravelry.com/patterns/search.json', { params: req.query, auth: { username: RAVELRY_USER, password: RAVELRY_PASS } });
    res.json(response.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/claude', async (req, res) => {
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', req.body, { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
    res.json(response.data);
  } catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});
function extractText(html) {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/[^\x20-\x7E\n]/g, '').trim();
}
function extractProductLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const patterns = [/href="([^"]*product-page[^"]*)"/gi, /href="([^"]*\/products\/[^"#?]*)"/gi];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const url = new URL(match[1], base.origin);
        if (url.hostname === base.hostname) links.add(url.href);
      } catch(e) {}
    }
  }
  return [...links].slice(0, 20);
}
function inferWeight(text) {
  const t = text.toLowerCase();
  if (t.includes('lace')) return 'Lace';
  if (t.includes('fingering') || t.includes('4ply') || t.includes('sock')) return 'Fingering';
  if (t.includes('sport') || t.includes('5ply')) return 'Sport';
  if (t.includes('worsted') || t.includes('10ply')) return 'Worsted';
  if (t.includes('aran')) return 'Aran';
  if (t.includes('super bulky') || t.includes('super chunky')) return 'Super Bulky';
  if (t.includes('bulky') || t.includes('chunky')) return 'Bulky';
  return 'DK';
}
function inferNeedle(weight) {
  const map = { 'Lace': '1.5-2.5mm', 'Fingering': '2.5-3.25mm', 'Sport': '3.5-4mm', 'DK': '4mm', 'Worsted': '4.5-5mm', 'Aran': '5mm', 'Bulky': '6-8mm', 'Super Bulky': '9-12mm' };
  return map[weight] || '4mm';
}
function inferGauge(weight) {
  const map = { 'Lace': '32-40 sts per 10cm', 'Fingering': '28-32 sts per 10cm', 'Sport': '24-26 sts per 10cm', 'DK': '22 sts per 10cm', 'Worsted': '18-20 sts per 10cm', 'Aran': '16-18 sts per 10cm', 'Bulky': '12-14 sts per 10cm', 'Super Bulky': '6-11 sts per 10cm' };
  return map[weight] || '22 sts per 10cm';
}
async function scrapeShopifyCollection(url, brand) {
  const base = new URL(url);
  const jsonUrl = base.origin + base.pathname.replace(/\/$/, '') + '/products.json?limit=250';
  const resp = await axios.get(jsonUrl, { headers: { 'User-Agent': 'YarnTool/1.0 (hello@yarnfood.com)' }, timeout: 15000 });
  const products = resp.data.products || [];
  return products.map(p => {
    const desc = (p.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '').trim();
    const allText = (p.tags?.join(' ') || '') + ' ' + desc + ' ' + p.title;
    const weight = inferWeight(allText);
    const fibreMatch = desc.match(/(\d+%\s*[A-Za-z ]+)/g);
    const fibre = fibreMatch ? fibreMatch.slice(0, 3).join(', ') : '';
    const yardageMatch = desc.match(/(\d+)\s*m(?:etres?|eters?)?\s*(?:\/|per)\s*\d+g/i) || desc.match(/(\d+)\s*yards?\s*(?:\/|per)\s*\d+g/i);
    return {
      name: p.title,
      brand: brand || p.vendor || 'unknown',
      weight,
      needle_size: inferNeedle(weight),
      gauge: inferGauge(weight),
      fibre,
      texture: p.tags?.find(t => ['plied','singles','cord','spun','twisted'].some(k => t.toLowerCase().includes(k))) || '',
      care: desc.match(/hand\s?wash|machine\s?wash|dry\s?clean/i)?.[0] || '',
      yardage: yardageMatch ? yardageMatch[0] : '',
      shop_url: `${base.origin}/products/${p.handle}`,
      source: 'indie'
    };
  }).filter(y => y.name);
}
async function scrapeYarnsFromPage(url, brand) {
  const pageResp = await axios.get(url, { headers: { 'User-Agent': 'YarnTool/1.0 (hello@yarnfood.com)' }, timeout: 10000 });
  const text = extractText(pageResp.data).substring(0, 6000);
  const prompt = `Extract yarn product data from this page. Return ONLY a valid JSON array, no markdown. If not a yarn product page return [].
Page: ${text}
Format: [{"name":"yarn name","brand":"${brand || 'unknown'}","weight":"Lace|Fingering|Sport|DK|Worsted|Aran|Bulky|Super Bulky","needle_size":"e.g. 3.5mm","gauge":"e.g. 28 sts per 10cm","fibre":"e.g. 100% Wool","texture":"e.g. plied","care":"e.g. handwash","yardage":"e.g. 350m per 100g","shop_url":"${url}","source":"indie"}]
Exclude kits, advent boxes, patterns, accessories.`;
  const claudeResp = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }, { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
  const responseText = claudeResp.data.content?.map(b => b.text || '').join('') || '[]';
  const jsonMatch = responseText.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
}
app.post('/scrape', async (req, res) => {
  try {
    const { url, brand } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    console.log('Scraping:', url);
    let allYarns = [];
    let method = 'unknown';
    let productPageCount = 0;
    if (url.includes('/collections/')) {
      method = 'shopify';
      allYarns = await scrapeShopifyCollection(url, brand);
    } else {
      const pageResp = await axios.get(url, { headers: { 'User-Agent': 'YarnTool/1.0 (hello@yarnfood.com)' }, timeout: 10000 });
      const html = pageResp.data;
      const productLinks = extractProductLinks(html, url);
      console.log('Product links found:', productLinks.length);
      if (productLinks.length > 0) {
        method = 'product-pages';
        productPageCount = productLinks.length;
        const results = await Promise.allSettled(productLinks.map(link => scrapeYarnsFromPage(link, brand)));
        for (const r of results) { if (r.status === 'fulfilled') allYarns = allYarns.concat(r.value); }
      } else {
        method = 'single-page';
        allYarns = await scrapeYarnsFromPage(url, brand);
      }
    }
    const seen = new Set();
    const unique = allYarns.filter(y => { if (!y.name || seen.has(y.name.toLowerCase())) return false; seen.add(y.name.toLowerCase()); return true; });
    console.log('Yarns extracted:', unique.length, 'method:', method);
    res.json({ yarns: unique, count: unique.length, method, product_pages_scraped: productPageCount });
  } catch (e) {
    console.error('Scrape error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
