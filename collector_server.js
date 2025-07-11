require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001; // Use a different port if running locally with the other server

app.use(cors());
app.use(express.json());

// --- PATHS FOR DATA PERSISTENCE ---
// This uses Render's persistent disk feature.
const DATA_DIR = process.env.RENDER_DISK_PATH || __dirname;
const GAME_DATA_PATH = path.join(DATA_DIR, 'gameData.json');

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory at: ${DATA_DIR}`);
}

// --- API Key Middleware for Internal Server Communication ---
const requireInternalApiKey = (req, res, next) => {
  const apiKey = req.get('X-API-Key');
  // This key should be kept secret and set in your Render environment variables.
  // It's used to ensure only your prediction server can access this data collector.
  const serverApiKey = process.env.INTERNAL_API_KEY || 'a4e8f1b2-9c3d-4a7f-8b1e-6f2c3d4a5b6c-internal';

  if (!serverApiKey) {
      console.error("INTERNAL_API_KEY environment variable is not set on the data collector server.");
      return res.status(500).json({ error: 'Server configuration error.' });
  }

  if (!apiKey || apiKey !== serverApiKey) {
    console.warn(`Failed auth attempt with key: ${apiKey}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing Internal API Key' });
  }
  next();
};

// --- DATA FETCHING FROM SOURCE API ---
async function fetchFromSourceAPI() {
    console.log('Fetching latest game data from source API...');
    try {
        const response = await fetch(
            "https://api.fantasygamesapi.com/api/webapi/GetNoaverageEmerdList",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pageSize: 100, // Fetch more data to build a good history
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
            throw new Error(`Source API responded with status: ${response.status}`);
        }

        const apiData = await response.json();
        
        if (apiData && apiData.data && apiData.data.list && apiData.data.list.length > 0) {
            const gameDataStore = fs.existsSync(GAME_DATA_PATH) 
                ? JSON.parse(fs.readFileSync(GAME_DATA_PATH, 'utf8')) 
                : { history: [] };

            let newEntriesCount = 0;
            // Add new results to the history if they don't already exist
            apiData.data.list.forEach(newResult => {
                if (!gameDataStore.history.some(h => String(h.issueNumber) === String(newResult.issueNumber))) {
                    gameDataStore.history.unshift(newResult);
                    newEntriesCount++;
                }
            });

            if (newEntriesCount > 0) {
                // Sort by issue number descending to be sure
                gameDataStore.history.sort((a, b) => b.issueNumber - a.issueNumber);
                // Limit history size
                gameDataStore.history = gameDataStore.history.slice(0, 5000); 
                fs.writeFileSync(GAME_DATA_PATH, JSON.stringify(gameDataStore, null, 2));
                console.log(`Stored ${newEntriesCount} new game results. Total history: ${gameDataStore.history.length}`);
            } else {
                console.log("No new game results to store.");
            }
        }
    } catch (error) {
        console.error('Failed to fetch data from source API:', error);
    }
}

// --- API ENDPOINT TO SERVE DATA TO YOUR PREDICTION SERVER ---
// This is the endpoint your main server was trying to reach.
app.get('/game-data', requireInternalApiKey, (req, res) => {
    console.log("Request received for /game-data");
    if (fs.existsSync(GAME_DATA_PATH)) {
        res.sendFile(GAME_DATA_PATH);
    } else {
        // If the file doesn't exist yet, return an empty history.
        res.status(404).json({ history: [] });
    }
});

// Run the data fetching cycle every 30 seconds.
setInterval(fetchFromSourceAPI, 30000);

app.listen(PORT, () => {
    console.log(`Data Collector Server is running on http://localhost:${PORT}`);
    // Run once on startup to get data immediately
    fetchFromSourceAPI(); 
});
