const express = require('express');
const path = require('path');

// Import routes
const resultsRouter = require('./routes/results');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Routes
app.use('/get-results', resultsRouter);

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
