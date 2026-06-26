const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, message: "Shopify connector is running." });
});

app.get('/', (req, res) => {
  res.send('Shopify Connector Home');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
