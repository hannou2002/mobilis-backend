require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cors = require('cors');
const geolib = require('geolib');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mobilis_dashboard'
};

// Create a connection pool
const pool = mysql.createPool(dbConfig);

// Helper function to calculate bearing (azimuth) between two points
function getBearing(startLat, startLng, destLat, destLng) {
    startLat = toRadians(startLat);
    startLng = toRadians(startLng);
    destLat = toRadians(destLat);
    destLng = toRadians(destLng);

    const y = Math.sin(destLng - startLng) * Math.cos(destLat);
    const x = Math.cos(startLat) * Math.sin(destLat) -
        Math.sin(startLat) * Math.cos(destLat) * Math.cos(destLng - startLng);
    const brng = Math.atan2(y, x);
    return (toDegrees(brng) + 360) % 360;
}

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function toDegrees(radians) {
    return radians * 180 / Math.PI;
}

// Function to find the nearest BTS
async function findNearestBTS(userLat, userLon) {
    // Optimization: Filter by a bounding box first (e.g., +/- 0.5 degrees ~ 55km)
    const range = 0.5;
    const [rows] = await pool.execute(
        `SELECT * FROM bts_antennas 
         WHERE latitude BETWEEN ? AND ? 
         AND longitude BETWEEN ? AND ?`,
        [userLat - range, userLat + range, userLon - range, userLon + range]
    );

    if (rows.length === 0) {
        // Fallback: search closest in whole DB if none in range (optional, usually unlikely if coverage is good) or return null
        // For now, let's try a wider query if needed, or just return null
        const [allRows] = await pool.execute('SELECT * FROM bts_antennas LIMIT 1000'); // Safety limit
        if (allRows.length === 0) return null;
        return getClosestFromList(userLat, userLon, allRows);
    }

    return getClosestFromList(userLat, userLon, rows);
}

function getClosestFromList(lat, lon, btsList) {
    let nearest = null;
    let minDist = Infinity;

    btsList.forEach(bts => {
        const dist = geolib.getDistance(
            { latitude: lat, longitude: lon },
            { latitude: bts.latitude, longitude: bts.longitude }
        );
        if (dist < minDist) {
            minDist = dist;
            nearest = bts;
        }
    });

    return { bts: nearest, distance: minDist };
}

// Endpoint to receive speed test results
app.post('/api/speedtest', async (req, res) => {
    try {
        const {
            test_id,
            download_mbps,
            upload_mbps,
            latency_ms,
            jitter_ms,
            network_type,
            signal_strength_dbm,
            device_type,
            latitude,
            longitude,
            timestamp
        } = req.body;

        console.log('Received test:', { test_id, latitude, longitude });

        let wilaya = req.body.wilaya || null;
        let commune = req.body.commune || null;
        let cell_id = null;
        let operator = req.body.operator || 'Unknown';

        // 1. Logic to find Nearest BTS and determine Cell ID
        if (latitude && longitude) {
            const result = await findNearestBTS(parseFloat(latitude), parseFloat(longitude));

            if (result && result.bts) {
                const bts = result.bts;
                // Only fallback to BTS location if App didn't provide it (Reverse Geocoding)
                if (!wilaya) wilaya = bts.wilaya;
                if (!commune) commune = bts.commune;

                console.log(`Nearest BTS found: ${bts.nom} (${result.distance}m)`);

                // 2. Calculate Bearing to determine Sector
                const bearing = getBearing(bts.latitude, bts.longitude, latitude, longitude);
                console.log(`Bearing from BTS to User: ${bearing}°`);

                // Sector A: 0-120, B: 120-240, C: 240-360
                if (bearing >= 0 && bearing < 120) {
                    cell_id = bts.cell_id_A;
                } else if (bearing >= 120 && bearing < 240) {
                    cell_id = bts.cell_id_B;
                } else {
                    cell_id = bts.cell_id_C;
                }
            } else {
                console.log('No nearby BTS found.');
            }
        }

        // 3. Insert into Database
        const query = `
            INSERT INTO speed_tests 
            (test_id, cell_id, download_mbps, upload_mbps, latency_ms, jitter_ms, 
             network_type, signal_strength_dbm, operator, device_type, 
             wilaya, commune, latitude, longitude, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            test_id, cell_id, download_mbps, upload_mbps, latency_ms, jitter_ms,
            network_type, signal_strength_dbm, operator, device_type,
            wilaya, commune, latitude, longitude, timestamp || new Date()
        ];

        await pool.execute(query, values);

        res.status(201).json({
            message: 'Speed test saved successfully',
            details: { wilaya, commune, cell_id, operator }
        });

    } catch (error) {
        console.error('Error saving speed test:', error);
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// Simple status endpoint
app.get('/', (req, res) => {
    res.send('Speed Test API is running');
});

// Endpoint for generating dummy data (download)
// Returns a specific size of data for speed testing
app.get('/api/download', (req, res) => {
    const sizeInMB = req.query.size || 1; // Default 1MB
    const sizeInBytes = sizeInMB * 1024 * 1024;

    // Create a buffer of 'A's
    const buffer = Buffer.alloc(Math.min(sizeInBytes, 50 * 1024 * 1024)); // Cap at 50MB for safety

    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
});

// Endpoint to accept upload data (doesn't save it, just measures reception)
app.post('/api/upload', (req, res) => {
    // Data is read by body-parser (or streamed if very large, but body-parser handles basic buffering)
    // We just acknowledge receipt immediately.
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}).setTimeout(300000); // 5 minutes timeout for slow 4G connections
