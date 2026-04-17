const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const RAVELRY_USER = process.env.RAVELRY_USER;
const RAVELRY_PASS = process.env.RAVELRY_PASS;

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
