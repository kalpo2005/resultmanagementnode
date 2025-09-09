const express = require('express');
const path = require('path');

// Import routes
const resultsRouter = require('./routes/results');

const app = express();
const PORT = 3000;

// ✅ Middleware with increased JSON & URL-encoded body size limit
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/get-results', resultsRouter);

// Health check (optional)
app.get('/', (req, res) => {
    res.json({ status: true, message: 'Server is running 🚀' });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
