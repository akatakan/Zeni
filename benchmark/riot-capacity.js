'use strict';
/**
 * Riot API Kapasite Analizi — Zeni
 *
 * Gerçek Riot API'ye bağlanmaz; watchmatch.js'deki getInterval() fonksiyonunu
 * kullanarak N eşzamanlı maçın yarattığı istek yükünü matematiksel olarak
 * hesaplar ve Riot'un rate limit'leriyle karşılaştırır.
 *
 * Riot Limitleri:
 *   - Burst : 20 istek / 1 saniye
 *   - Sabit : 100 istek / 2 dakika (= 50 istek/dk)
 *
 * Çalıştır: node benchmark/riot-capacity.js
 */

// ─── Sabitler (watchmatch.js ile aynı) ───────────────────────────────────────

const BURST_LIMIT     = 20;           // istek / saniye
const SUSTAINED_LIMIT = 100;          // istek / 2 dakika
const SUSTAINED_WIN   = 2 * 60_000;  // 120 000 ms
const GLOBAL_OPEN_MATCH_LIMIT = 20;  // index.js: Map tabanlı yazılım sınırı

// Maç sonu çözümleme için ek API çağrıları
const RESOLVE_CALLS   = 3; // getMatchEndResult + getSideBetResults (2x)

// ─── Polling aralığı (watchmatch.js kopyası) ─────────────────────────────────

function getInterval(elapsedMs) {
    const min = elapsedMs / 60_000;
    if (min <  3) return 3 * 60_000;
    if (min < 15) return 2 * 60_000;
    if (min < 25) return     60_000;
    if (min < 40) return  40_000;
    return 25_000;
}

// ─── Faz tanımları ───────────────────────────────────────────────────────────

const PHASES = [
    { label: 'Erken oyun  (0–3 dk)',   from:  0, to:  3, intervalMs: getInterval(0) },
    { label: 'Erken oyun  (3–15 dk)',  from:  3, to: 15, intervalMs: getInterval(3 * 60_000) },
    { label: 'Orta oyun   (15–25 dk)', from: 15, to: 25, intervalMs: getInterval(15 * 60_000) },
    { label: 'Geç oyun    (25–40 dk)', from: 25, to: 40, intervalMs: getInterval(25 * 60_000) },
    { label: 'Uzun oyun   (40+ dk)',   from: 40, to: 60, intervalMs: getInterval(40 * 60_000) },
];

// ─── Hesaplama yardımcıları ───────────────────────────────────────────────────

/**
 * Tek maçın belirli bir faz sırasındaki polling oranı (istek/dk).
 */
function pollRatePerMatchPerMin(intervalMs) {
    return 60_000 / intervalMs;
}

/**
 * Tek bir maçın ömrü boyunca toplam polling sayısı.
 * Tipik maç süresi = durationMin.
 */
function totalPollsForMatch(durationMin) {
    let calls = 0;
    let elapsed = 0; // dakika
    while (elapsed < durationMin) {
        const intervalMin = getInterval(elapsed * 60_000) / 60_000;
        calls++;
        elapsed += intervalMin;
    }
    return calls;
}

/**
 * N eşzamanlı maç için anlık istek oranı (istek/dk), tüm maçlar aynı fazda.
 */
function instantRateForPhase(matchCount, intervalMs) {
    return matchCount * pollRatePerMatchPerMin(intervalMs);
}

// ─── Analiz fonksiyonları ─────────────────────────────────────────────────────

function analyzePhases() {
    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│  FAZ BAZLI POLLİNG ORANLARI (tek maç)                              │');
    console.log('├────────────────────────────┬───────────────┬─────────────────────────┤');
    console.log('│ Faz                        │ Aralık        │ Rate (istek/dk)         │');
    console.log('├────────────────────────────┼───────────────┼─────────────────────────┤');

    for (const p of PHASES) {
        if (p.from === 0) {
            // 0-3 dk arası poll yok, bekleniyor
            console.log(`│ ${p.label.padEnd(26)} │ ${fmtMs(p.intervalMs).padEnd(13)} │ ${'0 (bekleme süresi)'.padEnd(23)} │`);
            continue;
        }
        const rate = pollRatePerMatchPerMin(p.intervalMs);
        console.log(`│ ${p.label.padEnd(26)} │ ${fmtMs(p.intervalMs).padEnd(13)} │ ${rate.toFixed(2).padEnd(23)} │`);
    }
    console.log('└────────────────────────────┴───────────────┴─────────────────────────┘');
}

function analyzeCapacity() {
    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│  EŞ ZAMANLI MAÇ KAPASITESI (sürekli limit: 50 istek/dk)            │');
    console.log('├────────┬─────────────────────────────────────────────────────────────┤');
    console.log('│ Maç #  │ En yoğun fazda istek/dk   │ Limit %  │ Durum              │');
    console.log('├────────┼───────────────────────────┼──────────┼────────────────────┤');

    const peakPhase = PHASES.find(p => p.from === 25); // 25-40 dk en yoğun faz
    const sustainedPerMin = SUSTAINED_LIMIT / (SUSTAINED_WIN / 60_000); // 50

    for (const n of [1, 5, 10, 15, 20, 25, 30, 33, 34, 40, 50]) {
        const rate = instantRateForPhase(n, peakPhase.intervalMs);
        const pct  = Math.round((rate / sustainedPerMin) * 100);
        const ok   = rate <= sustainedPerMin;
        const status = ok
            ? (pct > 80 ? '⚠️  Limit yakın' : '✅ OK')
            : '❌ Limit aşıldı';
        const nStr = String(n).padEnd(6);
        const rStr = `${rate.toFixed(1)} istek/dk`.padEnd(25);
        const pStr = `%${pct}`.padEnd(8);
        console.log(`│ ${nStr} │ ${rStr} │ ${pStr} │ ${status.padEnd(18)} │`);
    }
    console.log('└────────┴───────────────────────────┴──────────┴────────────────────┘');
}

function analyzeBurstRisk() {
    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│  BURST RİSKİ (20 istek/saniye limiti)                              │');
    console.log('└─────────────────────────────────────────────────────────────────────┘');

    console.log('\n  watchmatch.js her maçı bağımsız bir setInterval/setTimeout üzerinde');
    console.log('  çalıştırır. JavaScript single-threaded olduğundan aynı tick\'te N');
    console.log('  callback tetiklenebilir ve N eşzamanlı Riot isteği atılır.');
    console.log('');

    for (const n of [5, 10, 15, 20]) {
        const burstOk = n <= BURST_LIMIT;
        const icon = burstOk ? '✅' : '❌';
        console.log(`  ${icon} ${n} maç → worst-case burst: ${n} istek/saniye (limit: ${BURST_LIMIT})`);
    }

    console.log('\n  ⚠️  20 maçta tam burst limittesiniz. Gerçek prodüksiyonda timer');
    console.log('  jitter\'ı sayesinde aynı anda tetiklenme olasılığı düşük ama sıfır değil.');
}

function analyzeTypicalMatch(durationMin = 30) {
    const polls   = totalPollsForMatch(durationMin);
    const resolve = RESOLVE_CALLS;
    const total   = polls + resolve;

    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log(`│  TEK MAÇ ANALİZİ (${durationMin} dakikalık tipik maç)                         │`);
    console.log('├─────────────────────────────────────────────────────────────────────┤');
    console.log(`│  isActiveGame polling çağrısı : ${String(polls).padEnd(35)} │`);
    console.log(`│  Çözümleme API çağrıları      : ${String(resolve).padEnd(35)} │`);
    console.log(`│  Toplam Riot API çağrısı      : ${String(total).padEnd(35)} │`);
    console.log(`│  Riot 2dk penceresine katkı   : ${String(total).padEnd(35)} │`);
    console.log('└─────────────────────────────────────────────────────────────────────┘');

    console.log('\n  Faz dağılımı:');
    let elapsed = 0;
    const phaseCounts = {};
    while (elapsed < durationMin) {
        const intervalMin = getInterval(elapsed * 60_000) / 60_000;
        const key = elapsed < 3  ? '0-3 dk   (bekleme)'
                  : elapsed < 15 ? '3-15 dk  (2dk aralık)'
                  : elapsed < 25 ? '15-25 dk (1dk aralık)'
                  : elapsed < 40 ? '25-40 dk (40s aralık)'
                  : '40+ dk   (25s aralık)';
        phaseCounts[key] = (phaseCounts[key] || 0) + 1;
        elapsed += intervalMin;
    }
    for (const [phase, count] of Object.entries(phaseCounts)) {
        console.log(`    ${phase}: ${count} poll`);
    }
}

function analyzeMaxSafeMatches() {
    const sustainedPerMin = SUSTAINED_LIMIT / (SUSTAINED_WIN / 60_000);
    const peakPhase = PHASES.find(p => p.from === 25);
    const ratePerMatch = pollRatePerMatchPerMin(peakPhase.intervalMs);
    const theoretical  = Math.floor(sustainedPerMin / ratePerMatch);

    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│  SONUÇ — MAX GÜVENLİ EŞ ZAMANLI MAÇ                               │');
    console.log('├─────────────────────────────────────────────────────────────────────┤');
    console.log(`│  Riot sürekli limit      : ${String(sustainedPerMin + ' istek/dk').padEnd(42)} │`);
    console.log(`│  En yoğun fazda 1 maç   : ${String(ratePerMatch.toFixed(2) + ' istek/dk').padEnd(42)} │`);
    console.log(`│  Teorik maksimum         : ${String(theoretical + ' eşzamanlı maç').padEnd(42)} │`);
    console.log(`│  Yazılım limiti (global) : ${String(GLOBAL_OPEN_MATCH_LIMIT + ' eşzamanlı maç').padEnd(42)} │`);
    console.log('├─────────────────────────────────────────────────────────────────────┤');
    console.log('│  Öneri: GLOBAL_OPEN_MATCH_LIMIT = 20 sınırı güvenli.               │');
    console.log('│  Burst (timer jitter) riski için 15-18 tercih edilebilir.           │');
    console.log('└─────────────────────────────────────────────────────────────────────┘');
}

// ─── Yardımcı ─────────────────────────────────────────────────────────────────

function fmtMs(ms) {
    if (ms >= 60_000) return `${ms / 60_000} dk`;
    return `${ms / 1000} sn`;
}

// ─── Ana akış ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log('  Zeni — Riot API Kapasite Analizi');
console.log('  Gerçek API çağrısı yapılmaz, polling matematiği simüle edilir');
console.log('══════════════════════════════════════════════════════════════════════════');

analyzePhases();
analyzeCapacity();
analyzeBurstRisk();
analyzeTypicalMatch(30);
analyzeMaxSafeMatches();

console.log('\n══════════════════════════════════════════════════════════════════════════\n');
