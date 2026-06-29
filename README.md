# Zeni — Discord LoL Bahis Botu

Discord sunucularında canlı League of Legends maçlarına sanal para (JP) ile bahis yapılmasını sağlayan Discord.js v14 botu.

---

## Özellikler

- Aktif LoL maçlarına **Win/Lose tahmini** ile bahis aç
- **Pari-mutuel (havuz) modu** — kazananlar havuzu paylaşır, dinamik oran
- Maç sonucu embed'i: katılımcı sayısı, toplam havuz, doğruluk oranı
- **Rank & Win Rate** gösterimi (Riot League API'den canlı çekilir)
- Bahis kapanmadan **1 dakika önce kanal uyarısı**
- **Bahis serisi bonusu** — 3/5/10 üst üste doğru tahmin → bonus JP
- **Maç sonu DM** — kazandın/kaybettin bildirimi
- **Copy-bet** — başka bir kullanıcının bahislerini otomatik kopyala
- **Haftalık turnuva** — ayrı turnuva bakiyesi, eleme sistemi, ödül havuzu
- **Twitch entegrasyonu** — yayın başlayınca otomatik bahis embed'i
- `/stats` — kişisel bahis istatistikleri (kazanma oranı, net kâr, seri)
- Günlük JP bonusu, JP transferi, sıralama tablosu
- **Freemium model** — ücretsiz: günlük 3 maç / 1 eş zamanlı; Premium: sınırsız
- **REST API** — harici servisler için bakiye sorgulama / JP düşme
- **LemonSqueezy** webhook ile premium otomatik aktivasyon
- Anomali tespiti — %85+ win rate → kanal uyarısı

---

## Kurulum

### 1. Bağımlılıkları yükle

```bash
yarn install
```

### 2. `.env` dosyasını oluştur

```env
# Zorunlu
TOKEN=                        # Discord bot token
CLIENT_ID=                    # Discord uygulama client ID
RIOT_API_KEY=                 # Riot Games API anahtarı

# Opsiyonel
GUILD_ID=                     # Slash komut kaydı için sunucu ID (geliştirme)
API_PORT=3000                 # REST API portu (varsayılan: 3000)
LOG_LEVEL=info                # debug | info | warn | error

# Premium (LemonSqueezy)
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_WEBHOOK_SECRET=

# Twitch entegrasyonu
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_EVENTSUB_SECRET=
PUBLIC_URL=                   # HTTPS URL (örn: https://zeni.example.com)
```

`TOKEN`, `CLIENT_ID`, `RIOT_API_KEY` eksikse bot başlamaz.

### 3. Slash komutlarını Discord'a kaydet

```bash
node deploy-commands.js
```

### 4. Botu başlat

```bash
node index.js
```

---

## Komutlar

### Bahis

| Komut | Açıklama |
|-------|----------|
| `/bet region summoner [betamount] [mod]` | Aktif maça bahis aç. `mod`: `classic` (2x sabit) veya `pool` (pari-mutuel) |
| `/tournament start [giris_ucreti] [sure]` | Yeni haftalık turnuva başlat (yönetici) |
| `/tournament join` | Aktif turnuvaya katıl |
| `/tournament status` | Turnuva sıralaması |
| `/tournament end` | Turnuvayı bitir ve ödülleri dağıt (yönetici) |

### Ekonomi

| Komut | Açıklama |
|-------|----------|
| `/lb` | En yüksek bakiyeli 10 kullanıcı |
| `/stats [@kullanici]` | Bahis istatistikleri (kazanma oranı, net kâr, seri) |
| `/daily` | Her 24 saatte bir 200 JP bonus |
| `/give @kullanici miktar` | Başka kullanıcıya JP gönder |
| `/follow @kullanici miktar` | Bahislerini otomatik kopyala |
| `/unfollow @kullanici` | Bahis takibini durdur |

### Yönetici

| Komut | Açıklama |
|-------|----------|
| `/activate lisans_anahtari` | Premium lisansı aktif et |
| `/apisetup [webhook_url]` | API entegrasyon bilgileri / webhook URL ayarla |
| `/twitch track kanal summoner region [min_bahis] [kanal_discord]` | Twitch kanalını takibe al |
| `/twitch untrack kanal` | Twitch takibini durdur |
| `/twitch list` | Takip edilen kanallar |

---

## Bahis Akışı

```
/bet → Riot API'den aktif maç çekilir → Embed gönderilir (takımlar, ban, rank, WR)
  ↓
Kullanıcı "Bahis Yap" butonuna basar → Bakiye + zaman kontrolü → Modal açılır
  ↓
Miktar + Win/Lose tahmini girilir → Turnuva kontrolü → Atomik JP düşme → Bahis kaydedilir
  ↓ (Copy-bet tetikler: takipçilerin bahisleri otomatik kopyalanır)
  ↓
Maç 30 sn'de bir kontrol edilir → Maç bitince 30 sn beklenir (Riot verisi için)
  ↓
Sonuç: Kazananlara ödeme (2x veya pari-mutuel) + seri bonusu + DM bildirimi
  ↓ (Anomali kontrolü: %85+ win rate → kanal uyarısı)
```

---

## Proje Yapısı

```
commands/
  admin/    — activate.js, apisetup.js, twitch.js
  betting/  — bet.js, tournament.js
  economy/  — daily.js, give.js, leaderboard.js, stats.js, follow.js, unfollow.js
  general/  — help.js, ping.js
db/
  db.js                 — SQLite bağlantısı + schema + migration'lar
  userRepository.js     — bakiye, streak, atomik işlemler
  betRepository.js      — maç/bahis CRUD, istatistikler
  guildRepository.js    — premium, locale, API key
  followRepository.js   — copy-bet takip tablosu
  tournamentRepository.js — turnuva yönetimi
  twitchRepository.js   — Twitch takip kayıtları
events/
  interactionCreate.js  — tek handler: komut, buton, modal + copy-bet tetikleyici
  ready.js              — şampiyon cache, açık maç kurtarma, Twitch resubscribe
  guildCreate.js        — yeni sunucuya katılınca guild_settings oluştur
services/
  riot.js           — Riot API client (rate-limit, bölge yönlendirme, rank)
  lemonsqueezy.js   — lisans doğrulama + HMAC webhook
  twitch.js         — Twitch OAuth, EventSub subscribe/verify
  webhookEmitter.js — imzalı webhook POST
util/
  watchmatch.js     — 30 sn'de bir polling (Map-tabanlı timer'lar)
  resolveMatch.js   — ödeme, iade, pari-mutuel, turnuva, streak, DM, anomali
  championCache.js  — Data Dragon (6 saatte bir güncellenir)
  i18n.js           — t(key, vars, locale) + useT(interaction)
  logger.js         — LOG_LEVEL destekli zaman damgalı logger
  colors.js         — embed renk sabitleri
  premiumGuard.js   — requirePremium(interaction) yardımcısı
api/
  server.js         — Express REST API + LemonSqueezy webhook + Twitch EventSub
locales/
  tr.json           — tüm kullanıcıya yönelik metinler
```

---

## REST API

Tüm endpoint'ler `Authorization: Bearer <api_key>` gerektirir. API anahtarı `/apisetup` ile alınır.

```
GET  /api/balance/:userId           → JP bakiyesi sorgula
POST /api/balance/deduct            → JP atomik düş { user_id, amount, reason? }
POST /api/lemonsqueezy/webhook      → Premium yaşam döngüsü (HMAC doğrulamalı)
POST /api/twitch/eventsub           → Twitch EventSub bildirimleri
```

Rate limit: 60 istek/dk genel, 10 istek/dk `/deduct`.

---

## Freemium & Premium

| | Ücretsiz | Premium |
|--|---------|---------|
| Günlük maç limiti | 3 | Sınırsız |
| Eş zamanlı açık bahis | 1 | Sınırsız |
| Tüm özellikler | ✓ | ✓ |

Premium aktivasyonu: `/activate <lisans_anahtari>` — LemonSqueezy üzerinden satın alınır.

---

## Turnuva Sistemi

1. Yönetici `/tournament start giris_ucreti:500 sure:7` ile turnuva açar
2. Kullanıcılar `/tournament join` ile katılır (500 JP → 1500 JP turnuva bakiyesi)
3. Turnuva katılımcıları normal bahislerde turnuva bakiyesi kullanır
4. Bakiyesi biten kullanıcı elenir
5. `/tournament end` ile ödüller dağıtılır: 1. %50 · 2. %30 · 3. %20

---

## Twitch Entegrasyonu

Gerekli env: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`, `PUBLIC_URL`

```
/twitch track kanal:faker summoner:Faker#KR1 region:KR kanal_discord:#genel
```

Faker yayın açtığında bot Riot API'den aktif maç kontrol eder. Maç varsa `#genel` kanalına otomatik bahis embed'i gönderir.

---

## Teknolojiler

- [discord.js v14](https://discord.js.org/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — senkron SQLite
- [axios](https://axios-http.com/) — Riot API & Twitch API
- [express](https://expressjs.com/) — REST API
- [dotenv](https://github.com/motdotla/dotenv)
