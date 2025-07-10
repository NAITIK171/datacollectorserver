require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 4000; // Use a different port than the predictor

// --- In-Memory Data Store ---
let gameDataStore = {
    history: [],
    lastChecked: null
};

// --- CORS Configuration ---
app.use(cors());

// --- API Key Middleware for securing your data endpoint ---
const requireApiKey = (req, res, next) => {
    const apiKey = req.get('X-API-Key');
    const serverApiKey = process.env.INTERNAL_API_KEY;

    if (!serverApiKey) {
        console.error("FATAL: INTERNAL_API_KEY is not set.");
        return res.status(500).json({ error: 'Server configuration error.' });
    }
    if (!apiKey || apiKey !== serverApiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

/**
 * Fetches the latest game data and appends it to our in-memory store.
 */
async function collectData() {
    console.log(`[${new Date().toISOString()}] Fetching latest game data...`);
    try {
        const response = await fetch(
            "https://api.fantasygamesapi.com/api/webapi/GetNoaverageEmerdList",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pageSize: 10,
                    pageNo: 1,
                    typeId: 1,
                    language: 0,
                    random: "4a0522c6ecd8410496260e686be2a57c",
                    signature: "334B5E70A0C9B8918B0B15E517E2069C",
                    timestamp: Math.floor(Date.now() / 1000),
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`API responded with status: ${response.status}`);
        }

        const apiData = await response.json();
        if (!apiData?.data?.list?.length) {
            console.log("API response did not contain a valid game list.");
            return;
        }

        const latestGameResult = apiData.data.list[0];

        if (gameDataStore.history.length === 0 || !gameDataStore.history.some(h => h.issueNumber === latestGameResult.issueNumber)) {
            console.log(`✨ New game result found for period ${latestGameResult.issueNumber}. Storing in memory...`);
            gameDataStore.history.unshift(latestGameResult);
            console.log(`✅ Successfully stored. Total records in memory: ${gameDataStore.history.length}`);
        } else {
            // console.log(`No new game data. Current latest is ${latestGameResult.issueNumber}.`);
        }
        gameDataStore.lastChecked = new Date().toISOString();

    } catch (error) {
        console.error('❌ Data collection cycle failed:', error.message);
    }
}

// --- API Endpoints ---
app.get('/data', requireApiKey, (req, res) => {
    res.json(gameDataStore);
});

app.get('/status', (req, res) => {
    res.json({
        status: "OK",
        lastChecked: gameDataStore.lastChecked,
        recordsInMemory: gameDataStore.history.length
    });
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`🚀 Data Collector Service running on http://localhost:${PORT}`);
    collectData(); // Run immediately on start
    setInterval(collectData, 20000); // Continue running every 20 seconds
});
