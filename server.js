const express = require('express');
const resultsRouter = require('./routes/results');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/get-results', resultsRouter);

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
