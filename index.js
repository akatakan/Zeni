const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('node:path');
require('dotenv').config();

// Kritik env değişkenlerini başlangıçta doğrula
const REQUIRED_ENV = ['TOKEN', 'CLIENT_ID', 'RIOT_API_KEY'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
        console.error(`[HATA] Eksik ortam değişkeni: ${key} — .env dosyasını kontrol et.`);
        process.exit(1);
    }
}

const { initDb } = require('./db/db');
const { startApiServer } = require('./api/server');
const token  = process.env.TOKEN;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

const foldersPath = path.join(__dirname,'commands');
const commandFolder = fs.readdirSync(foldersPath);

for(const folder of commandFolder){
    const commandPath = path.join(foldersPath,folder);
    const commandFiles = fs.readdirSync(commandPath).filter(file => file.endsWith(".js"));
    for(const file of commandFiles){
        const filePath = path.join(commandPath,file);
        const command = require(filePath);

        if('data' in command && 'execute' in command){
            client.commands.set(command.data.name,command);
        }
        else{
            console.log('Komut bulunamadı. Dosya eksik veya data,execute tanımlayıcıları eksik.');
        }
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	} else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}



initDb()
    .then(() => client.login(token))
    .then(() => startApiServer(process.env.API_PORT || 3000, client))
    .catch(err => { console.error('[HATA] Başlatma hatası:', err); process.exit(1); });