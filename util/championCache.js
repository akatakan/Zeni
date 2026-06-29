const axios = require('axios');

let cache = {};
let currentVersion = null;

async function loadChampions() {
    const versionsRes = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json');
    const latestVersion = versionsRes.data[0];

    if (latestVersion === currentVersion) return;

    const champRes = await axios.get(
        `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
    );

    const data = champRes.data.data;
    cache = {};
    for (const champ of Object.values(data)) {
        cache[parseInt(champ.key)] = champ.name;
    }

    currentVersion = latestVersion;
    console.log(`Champion cache güncellendi: ${Object.keys(cache).length} champion (patch ${latestVersion})`);
}

function scheduleChampionRefresh(intervalHours = 6) {
    setInterval(async () => {
        try {
            await loadChampions();
        } catch (err) {
            console.error('Champion cache güncellenemedi:', err.message);
        }
    }, intervalHours * 60 * 60 * 1000);
}

function getChampionName(championId) {
    return cache[championId] || 'Unknown Champion';
}

module.exports = { loadChampions, scheduleChampionRefresh, getChampionName };
