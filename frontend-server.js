const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3451;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`前端服务器运行在 http://localhost:${PORT}`);
});
