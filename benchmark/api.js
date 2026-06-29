'use strict';
/**
 * API Yük Testi — Zeni Express REST API
 *
 * Gerçek DB olmadan çalışır: middleware zincirini (rate limiter, auth, JSON)
 * birebir taklit eden mock server üzerinde autocannon çalıştırır.
 * Production'daki asıl bottleneck PG sorguları olduğundan, bu test
 * "middleware overhead olmadan DB ne kadar yavaşlatır" sorusunu yanıtlar.
 *
 * Çalıştır: node benchmark/api.js
 */

const express    = require('express');
const autocannon = require('autocannon');
const http       = require('http');

// ─── Prodüksiyon rate limiter — birebir kopyası ─────────────────────────────

const rateLimitWindows = new Map();
function rateLimit(windowMs, max) {
    return (req, res, next) => {
        const key  = req.ip;
        const now  = Date.now();
        const hits = (rateLimitWindows.get(key) || []).filter(t => now - t < windowMs);
        if (hits.length >= max) return res.status(429).json({ error: 'Too many requests.' });
        hits.push(now);
        rateLimitWindows.set(key, hits);
        next();
    };
}

const apiLimiter    = rateLimit(60_000, 60);
const deductLimiter = rateLimit(60_000, 10);

// ─── Mock server ─────────────────────────────────────────────────────────────

function buildServer({ withRateLimit, withDbDelay = 0 }) {
    const app = express();
    app.use(express.json());

    // Mock auth — DB sorgusu simüle etmek için opsiyonel gecikme
    const auth = async (req, res, next) => {
        const header = req.headers['authorization'];
        if (!header || !header.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (withDbDelay) await new Promise(r => setTimeout(r, withDbDelay));
        req.guild = { guild_id: 'bench-guild' };
        next();
    };

    app.get('/api/balance/:userId',
        ...(withRateLimit ? [apiLimiter] : []),
        auth,
        async (req, res) => {
            if (withDbDelay) await new Promise(r => setTimeout(r, withDbDelay));
            res.json({ userId: req.params.userId, balance: 1000 });
        }
    );

    app.post('/api/balance/deduct',
        ...(withRateLimit ? [deductLimiter] : []),
        auth,
        async (req, res) => {
            if (withDbDelay) await new Promise(r => setTimeout(r, withDbDelay));
            const { userId, amount } = req.body || {};
            if (!userId || !amount || amount <= 0) {
                return res.status(400).json({ error: 'userId and amount required' });
            }
            res.json({ success: true, newBalance: 900 });
        }
    );

    return http.createServer(app);
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function fmt(n, unit = '') {
    return `${Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}${unit}`;
}

function printResult(label, result) {
    const { requests, latency, throughput, errors } = result;
    console.log(`\n  📊 ${label}`);
    console.log(`  ┌─────────────────────────────────────────┐`);
    console.log(`  │ Req/s (ort)      : ${fmt(requests.mean).padEnd(20)} │`);
    console.log(`  │ Req/s (max)      : ${fmt(requests.max).padEnd(20)} │`);
    console.log(`  │ Latency p50      : ${fmt(latency.p50, ' ms').padEnd(20)} │`);
    console.log(`  │ Latency p99      : ${fmt(latency.p99, ' ms').padEnd(20)} │`);
    console.log(`  │ Throughput (ort) : ${fmt(throughput.mean / 1024, ' KB/s').padEnd(20)} │`);
    console.log(`  │ Toplam istek     : ${fmt(requests.total).padEnd(20)} │`);
    console.log(`  │ Hatalar          : ${fmt(errors || 0).padEnd(20)} │`);
    console.log(`  └─────────────────────────────────────────┘`);
}

function run(opts) {
    return new Promise((resolve, reject) => {
        const instance = autocannon(opts, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
        autocannon.track(instance, { renderProgressBar: false });
    });
}

// ─── Test senaryoları ─────────────────────────────────────────────────────────

async function runScenario(label, serverOpts, cannonOpts, port) {
    const server = buildServer(serverOpts);
    await new Promise(r => server.listen(port, r));

    try {
        const result = await run({
            url: `http://localhost:${port}`,
            connections: cannonOpts.connections,
            duration:    cannonOpts.duration,
            ...cannonOpts,
        });
        printResult(label, result);
        return result;
    } finally {
        await new Promise(r => server.close(r));
        rateLimitWindows.clear();
    }
}

// ─── Ana akış ─────────────────────────────────────────────────────────────────

(async () => {
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  Zeni API Benchmark');
    console.log('  Her senaryo 10 saniye çalışır');
    console.log('══════════════════════════════════════════════════════\n');

    // 1. Raw Express: rate limit ve DB gecikmesi yok — tavan değer
    await runScenario(
        'GET /balance — rate limit YOK, DB gecikmesi YOK (tavan)',
        { withRateLimit: false, withDbDelay: 0 },
        {
            connections: 100,
            duration: 10,
            method: 'GET',
            path: '/api/balance/user123',
            headers: { authorization: 'Bearer test-key' },
        },
        3011
    );

    // 2. Rate limit aktif — gerçek 60 req/dk sınırı altında ne olur
    await runScenario(
        'GET /balance — rate limit AKTİF (60/dk), 10 connection',
        { withRateLimit: true, withDbDelay: 0 },
        {
            connections: 10,
            duration: 10,
            method: 'GET',
            path: '/api/balance/user123',
            headers: { authorization: 'Bearer test-key' },
        },
        3012
    );

    // 3. DB gecikmesi simülasyonu — tipik PostgreSQL query: ~3ms
    await runScenario(
        'GET /balance — DB gecikmesi 3ms (prodüksiyon simülasyonu)',
        { withRateLimit: false, withDbDelay: 3 },
        {
            connections: 100,
            duration: 10,
            method: 'GET',
            path: '/api/balance/user123',
            headers: { authorization: 'Bearer test-key' },
        },
        3013
    );

    // 4. DB gecikmesi 10ms — yüksek yük altında tipik PG sorgu süresi
    await runScenario(
        'GET /balance — DB gecikmesi 10ms (yüksek yük)',
        { withRateLimit: false, withDbDelay: 10 },
        {
            connections: 100,
            duration: 10,
            method: 'GET',
            path: '/api/balance/user123',
            headers: { authorization: 'Bearer test-key' },
        },
        3014
    );

    // 5. POST /deduct — strict rate limit (10/dk), body parsing dahil
    await runScenario(
        'POST /deduct — rate limit AKTİF (10/dk), 5 connection',
        { withRateLimit: true, withDbDelay: 0 },
        {
            connections: 5,
            duration: 10,
            method: 'POST',
            path: '/api/balance/deduct',
            headers: {
                authorization: 'Bearer test-key',
                'content-type': 'application/json',
            },
            body: JSON.stringify({ userId: 'user123', amount: 100 }),
        },
        3015
    );

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  Benchmark tamamlandı');
    console.log('══════════════════════════════════════════════════════\n');
})().catch(console.error);
