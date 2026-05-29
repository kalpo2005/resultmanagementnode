const express = require("express");
const cors = require("cors");
const resultsRouter = require("./routes/results");
const hallticketRouter = require("./routes/halltickets");
const seatNumbersRouter = require("./routes/seatNumbers");

const app = express();
const PORT = 3000;

/* ✅ CORS middleware BEFORE routes */
app.use(cors({
    origin: "*",                 // allow all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

/* Body parsers */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/* Routes */
app.use("/get-results", resultsRouter);
app.use("/generate-halltickets", hallticketRouter);
app.use("/seat-numbers", seatNumbersRouter);

/* Health check */
app.get("/", (req, res) => {
    res.json({ status: true, message: "Server running 🚀" });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
