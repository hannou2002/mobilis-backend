require('dotenv').config();
const mysql = require('mysql2/promise');
const geolib = require('geolib');

// --- 1. CONFIGURATION ---

// LOCAL Database (Your PC / PhpMyAdmin)
const localConfig = {
    host: 'localhost',
    user: 'root',
    password: '', // Put your local password if you have one
    database: 'mobilis_dashboard'
};

// REMOTE Database (TiDB Cloud)
const remoteConfig = {
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
    user: 'iQSRgzp6fN3fmiz.root',
    password: 'R7y94FAitGVY1umR',
    port: 4000,
    database: 'test',
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
};

// --- 2. HELPER FUNCTIONS ---

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function toDegrees(radians) {
    return radians * 180 / Math.PI;
}

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

// --- 3. MAIN SYNC LOGIC ---

async function syncData() {
    console.log('🔄 Starting Synchronization...');
    let localConn, remoteConn;

    try {
        // Connect to Databases
        localConn = await mysql.createConnection(localConfig);
        console.log('✅ Connected to Local DB');

        remoteConn = await mysql.createConnection(remoteConfig);
        console.log('✅ Connected to Remote TiDB');

        // 1. Get latest timestamp from Local
        const [rows] = await localConn.execute('SELECT MAX(timestamp) as last_sync FROM speed_tests');
        const lastSync = rows[0].last_sync || new Date(0);
        console.log(`⏰ Last Local Record: ${lastSync}`);

        // 2. Fetch NEW records from Remote TiDB
        const [newRecords] = await remoteConn.execute(
            'SELECT * FROM speed_tests WHERE timestamp > ? ORDER BY timestamp ASC',
            [lastSync]
        );

        console.log(`📥 Found ${newRecords.length} new records in Cloud.`);

        if (newRecords.length === 0) {
            console.log('🎉 Everything is up to date.');
            return;
        }

        // 3. Process and Insert each record
        for (const record of newRecords) {
            let finalCellId = record.cell_id;

            // Log raw record data for debug
            // console.log(`   Processing Test ID: ${record.test_id}, Lat: ${record.latitude}, Lon: ${record.longitude}`);

            // --- USER REQUIREMENT: IF CELL_ID IS EMPTY, OR NULL, CALCULATE IT ---
            if (!finalCellId && record.latitude && record.longitude) {
                // Ensure coordinates are Numbers, not Strings
                const lat = parseFloat(record.latitude);
                const lon = parseFloat(record.longitude);

                if (!isNaN(lat) && !isNaN(lon)) {
                    console.log(`   🔍 Missing Cell ID. Searching nearest BTS for Lat: ${lat}, Lon: ${lon}...`);

                    // LOAD ALL BTS ANTENNAS (No filtering by distance, as requested)
                    const [btsList] = await localConn.execute('SELECT * FROM bts_antennas');

                    // console.log(`   📡 Loaded ${btsList.length} antennas from local DB for comparison.`);

                    if (btsList.length > 0) {
                        let nearest = null;
                        let minDist = Infinity;

                        // Brute-force distance check
                        btsList.forEach(bts => {
                            const btsLat = parseFloat(bts.latitude);
                            const btsLon = parseFloat(bts.longitude);

                            if (!isNaN(btsLat) && !isNaN(btsLon)) {
                                const dist = geolib.getDistance(
                                    { latitude: lat, longitude: lon },
                                    { latitude: btsLat, longitude: btsLon }
                                );
                                if (dist < minDist) {
                                    minDist = dist;
                                    nearest = bts;
                                }
                            }
                        });

                        if (nearest) {
                            console.log(`      🎯 Found Nearest BTS: "${nearest.nom}" (Distance: ${minDist}m)`);

                            // Calculate Bearing
                            const bearing = getBearing(nearest.latitude, nearest.longitude, lat, lon);

                            // Determine Sector
                            if (bearing >= 0 && bearing < 120) finalCellId = nearest.cell_id_A;
                            else if (bearing >= 120 && bearing < 240) finalCellId = nearest.cell_id_B;
                            else finalCellId = nearest.cell_id_C;

                            console.log(`      🔧 Calculated Cell ID: ${finalCellId}`);
                        }
                    } else {
                        console.log('      ⚠️ WARNING: Local bts_antennas table is EMPTY!');
                    }
                }
            }

            // Insert into Local DB
            await localConn.execute(
                `INSERT INTO speed_tests 
                (test_id, cell_id, download_mbps, upload_mbps, latency_ms, jitter_ms, 
                 network_type, signal_strength_dbm, operator, device_type, 
                 wilaya, commune, latitude, longitude, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    record.test_id, finalCellId, record.download_mbps, record.upload_mbps, record.latency_ms, record.jitter_ms,
                    record.network_type, record.signal_strength_dbm, record.operator, record.device_type,
                    record.wilaya, record.commune, record.latitude, record.longitude, record.timestamp
                ]
            );
        }

        console.log('✅ Synchronization Complete!');

    } catch (e) {
        console.error('❌ Error during sync:', e.message);
    } finally {
        if (localConn) await localConn.end();
        if (remoteConn) await remoteConn.end();
    }
}

syncData();
