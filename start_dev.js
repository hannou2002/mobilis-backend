const localtunnel = require('localtunnel');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3000;
const APP_FILE_PATH = path.join(__dirname, '../mobile_app/app/index.tsx');

async function start() {
    console.log('🚀 Starting Mobilis Speed Test Development Environment...');

    // 1. Start Backend Server
    console.log('📦 Starting Backend Server...');
    const server = spawn('node', ['server.js'], { stdio: 'inherit' });

    server.on('error', (err) => {
        console.error('Failed to start server:', err);
    });

    server.on('exit', (code) => {
        if (code !== 0) {
            console.error(`❌ Backend Server crashed with code ${code}. Stopping...`);
            // tunnel might not be defined yet if crash happens immediately, but usually it is.
            process.exit(code);
        }
    });

    // 2. Start LocalTunnel
    console.log('glitch Starting Tunnel...');
    // Force IPv4 loopback to avoid 503 errors on Windows
    const tunnel = await localtunnel({ port: PORT, local_host: '127.0.0.1' });

    console.log(`\n✅ Tunnel Open: ${tunnel.url}`);

    // 3. Update Mobile App Config
    console.log('📝 Updating Mobile App Configuration...');
    try {
        let content = fs.readFileSync(APP_FILE_PATH, 'utf8');

        // Regex to replace the DEFAULT_URL constant
        const newContent = content.replace(
            /const DEFAULT_URL = ['"`](.*?)['"`];/,
            `const DEFAULT_URL = '${tunnel.url}';`
        );

        if (content !== newContent) {
            fs.writeFileSync(APP_FILE_PATH, newContent, 'utf8');
            console.log(`✨ App updated with new URL: ${tunnel.url}`);
        } else {
            console.log('⚠️ URL matches existing config, no change needed.');
        }

    } catch (e) {
        console.error('❌ Failed to update mobile app config:', e.message);
    }

    console.log('\n🎉 Ready! Reload your mobile app now to pick up the new URL.');
    console.log('Press Ctrl+C to stop everything.');

    // Handle cleanup
    tunnel.on('close', () => {
        console.log('Tunnel closed');
    });

    process.on('SIGINT', () => {
        console.log('Stopping...');
        tunnel.close();
        server.kill();
        process.exit();
    });
}

start();
