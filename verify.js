async function testBackend() {
    const API_URL = 'http://localhost:3000';
    try {
        console.log('1. Testing Root endpoint...');
        const resRoot = await fetch(`${API_URL}/`);
        const textRoot = await resRoot.text();
        console.log('   Status:', resRoot.status, 'Data:', textRoot);

        console.log('2. Testing Download endpoint (1MB)...');
        const startDl = Date.now();
        const resDl = await fetch(`${API_URL}/api/download?size=1`);
        const bufferDl = await resDl.arrayBuffer();
        const duration = Date.now() - startDl;
        console.log('   Status:', resDl.status, 'Size:', bufferDl.byteLength, 'bytes', 'Duration:', duration, 'ms');

        console.log('3. Testing Upload endpoint...');
        const resUl = await fetch(`${API_URL}/api/upload`, {
            method: 'POST',
            body: JSON.stringify({ data: 'test datatest data' }),
            headers: { 'Content-Type': 'application/json' }
        });
        console.log('   Status:', resUl.status);

        console.log('4. Testing Speed Test Submission (Mock Data)...');
        const mockData = {
            test_id: 'test-uuid-123',
            download_mbps: 50.5,
            upload_mbps: 20.2,
            latency_ms: 15,
            jitter_ms: 2,
            network_type: '4G',
            signal_strength_dbm: -85,
            device_type: 'VerificationScript',
            latitude: 36.7525,
            longitude: 3.0420
        };
        const resSubmit = await fetch(`${API_URL}/api/speedtest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mockData)
        });
        const jsonSubmit = await resSubmit.json();
        console.log('   Status:', resSubmit.status, 'Response:', jsonSubmit);

        console.log('VERIFICATION SUCCESSFUL');
    } catch (err) {
        console.error('VERIFICATION FAILED:', err.message);
    }
}

testBackend();
