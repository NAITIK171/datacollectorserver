// server.js for the Data Collector Service

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// This path MUST point to your persistent disk on Render
const DATA_DIR = process.env.RENDER_DISK_PATH || __dirname;
const GAME_DATA_PATH = path.join(DATA_DIR, 'gameData.json');

// Ensure the data directory exists on startup
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory at: ${DATA_DIR}`);
}

async function dataCollectionCycle() {
    console.log('Collector: Fetching latest game data...');
    try {
        const response = await fetch(
            "https://api.fantasygamesapi.com/api/webapi/GetNoaverageEmerdList",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageSize: 10, pageNo: 1, typeId: 1, language: 0, random: "4a0522c6ecd8410496260e686be2a57c", signature: "334B5E70A0C9B8918B0B15E517E2069C", timestamp: Math.floor(Date.now() / 1000) }),
            }
        );
        if (!response.ok) throw new Error(`API responded with status: ${response.status}`);
        
        const apiData = await response.json();
        if (!apiData?.data?.list?.length) return;

        const latestGameResult = apiData.data.list[0];
        const gameDataStore = fs.existsSync(GAME_DATA_PATH) ? JSON.parse(fs.readFileSync(GAME_DATA_PATH, 'utf8')) : { history: [] };

        if (!gameDataStore.history.some(h => h.issueNumber === latestGameResult.issueNumber)) {
            gameDataStore.history.unshift(latestGameResult);
            fs.writeFileSync(GAME_DATA_PATH, JSON.stringify(gameDataStore, null, 2));
            console.log(`Collector: Stored new result for period ${latestGameResult.issueNumber}. Total records: ${gameDataStore.history.length}`);
        }
    } catch (error) {
        console.error('Collector: Data collection cycle failed:', error);
    }
}

// Check for new data every 15 seconds
setInterval(dataCollectionCycle, 15000);

// Middleware to protect the data endpoint
const requireInternalApiKey = (req, res, next) => {
  const apiKey = req.get('x-api-key');
  const internalApiKey = process.env.INTERNAL_API_KEY; // Use the specific internal key
  if (!internalApiKey || apiKey !== internalApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// The ONLY endpoint for this server. It serves the entire data file.
app.get('/', requireInternalApiKey, (req, res) => {
    console.log("Collector: Received authenticated request for game data.");
    if (fs.existsSync(GAME_DATA_PATH)) {
        res.sendFile(GAME_DATA_PATH);
    } else {
        res.status(404).json({ history: [] });
    }
});

// A simple endpoint for uptime monitors
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

app.listen(PORT, () => {
    console.log(`Data Collector Server is running on http://localhost:${PORT}`);
    dataCollectionCycle(); // Run once on startup
});
