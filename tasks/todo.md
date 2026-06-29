# Mimari İyileştirme Planı

## 1. Mevcut Yapı

```
/
├── index.js
├── riot-api.js              ← root'ta kaybolmuş
├── deploy-commands.js
├── api/
│   └── server.js            ← routes + middleware + bootstrap hepsi tek dosya
├── commands/
│   └── utility/             ← TÜM komutlar tek kategoride
│       ├── createBet.js     ← adı komutla eşleşmiyor (komut: "bet")
│       ├── withdraw.js      ← adı yanlış, içi /give komutu; i18n/colors yok
│       ├── leaderboard.js
│       ├── daily.js
│       ├── ping.js
│       ├── activate.js
│       ├── apisetup.js
│       └── help.js
├── db/
│   ├── db.js
│   ├── userController.js    ← naming yanlış: "controller" ≠ data access layer
│   ├── betController.js
│   ├── guildController.js
│   └── champions.json       ← artık kullanılmıyor (dinamik Data Dragon'a geçildi)
├── events/
│   └── ...
├── locales/
│   └── tr.json
└── util/                    ← karmaşık: dış servisler + utility + business logic karışık
    ├── lemonsqueezy.js      ← dış servis istemcisi
    ├── webhookEmitter.js    ← dış servis
    ├── watchmatch.js        ← business logic
    ├── resolveMatch.js      ← business logic
    ├── championCache.js     ← servis entegrasyonu
    ├── i18n.js
    ├── colors.js
    └── premiumGuard.js
```

---

## 2. Hedef Yapı (Best Practice)

```
/
├── index.js
├── deploy-commands.js
├── commands/
│   ├── betting/             ← LoL bahis akışı
│   │   └── bet.js
│   ├── economy/             ← JP para sistemi
│   │   ├── daily.js
│   │   ├── give.js
│   │   └── leaderboard.js
│   ├── general/             ← genel kullanıcı komutları
│   │   ├── help.js
│   │   └── ping.js
│   └── admin/               ← sunucu admin komutları
│       ├── activate.js
│       └── apisetup.js
├── events/                  ← değişmez
├── services/                ← dış API istemcileri
│   ├── riot.js
│   ├── lemonsqueezy.js
│   └── webhookEmitter.js
├── db/                      ← veri katmanı (klasör adı aynı, dosya adları düzelir)
│   ├── db.js
│   ├── userRepository.js
│   ├── betRepository.js
│   └── guildRepository.js
├── api/                     ← değişmez (boyutu küçük, bölmeye gerek yok)
│   └── server.js
├── locales/
│   └── tr.json
└── util/                    ← sadece gerçek utility kalır
    ├── watchmatch.js
    ├── resolveMatch.js
    ├── championCache.js
    ├── i18n.js
    ├── colors.js
    └── premiumGuard.js
```

---

## 3. Değişiklik Listesi ve Analiz

### GRUP A — Yüksek öncelik, düşük risk

| # | Değişiklik | Getiri | Risk |
|---|---|---|---|
| A1 | `commands/utility/createBet.js` → `commands/betting/bet.js` | Dosya adı komut adıyla eşleşir | Düşük — 1 dosya, sadece içindeki relative import'lar değişir |
| A2 | `commands/utility/withdraw.js` → `commands/economy/give.js` | Bug fix (ad yanlış), i18n + colors entegre edilir | Düşük |
| A3 | `commands/utility/daily.js` → `commands/economy/daily.js` | Kategori netleşir | Düşük |
| A4 | `commands/utility/leaderboard.js` → `commands/economy/leaderboard.js` | Kategori netleşir | Düşük |
| A5 | `commands/utility/help.js` → `commands/general/help.js` | Kategori netleşir | Düşük |
| A6 | `commands/utility/ping.js` → `commands/general/ping.js` | Kategori netleşir | Düşük |
| A7 | `commands/utility/activate.js` → `commands/admin/activate.js` | Kategori netleşir | Düşük |
| A8 | `commands/utility/apisetup.js` → `commands/admin/apisetup.js` | Kategori netleşir | Düşük |

> A1-A8 sonunda `commands/utility/` klasörü boşalır ve silinir.
> `index.js` subdirectory'leri otomatik tarar → deploy-commands.js de aynı şekilde → **her ikisi de değişmez**.

### GRUP B — Orta öncelik, orta risk

| # | Değişiklik | Getiri | Risk |
|---|---|---|---|
| B1 | `riot-api.js` → `services/riot.js` | "Servis katmanı" kavramı netleşir, root temizlenir | Orta — import'lar: util/watchmatch.js, util/championCache.js, util/resolveMatch.js, commands/betting/bet.js, events/interactionButton.js |
| B2 | `util/lemonsqueezy.js` → `services/lemonsqueezy.js` | `util/` sadeleşir | Düşük — import'lar: commands/admin/activate.js, api/server.js |
| B3 | `util/webhookEmitter.js` → `services/webhookEmitter.js` | `util/` sadeleşir | Düşük — import: api/server.js |

### GRUP C — Orta öncelik, düşük risk

| # | Değişiklik | Getiri | Risk |
|---|---|---|---|
| C1 | `db/userController.js` → `db/userRepository.js` | Naming standardize olur (controller ≠ data access layer) | Orta — import'lar: events/interactionButton.js, interactionModal.js, commands/economy/daily.js, give.js, api/server.js, util/resolveMatch.js |
| C2 | `db/betController.js` → `db/betRepository.js` | Aynı sebep | Orta — import'lar: events/interactionButton.js, interactionModal.js, commands/betting/bet.js, util/resolveMatch.js |
| C3 | `db/guildController.js` → `db/guildRepository.js` | Aynı sebep | Orta — import'lar: api/server.js, commands/admin/activate.js, apisetup.js, util/i18n.js, util/premiumGuard.js |

### GRUP D — Temizlik, sıfır risk

| # | Değişiklik | Getiri | Risk |
|---|---|---|---|
| D1 | `db/champions.json` sil | Ölü dosya kaldırılır | Neredeyse sıfır |

---

## 4. Kesinlikle YAPILMAYACAKLAR (şimdilik)

| Ne | Neden |
|---|---|
| `util/` → `utils/` rename | Tüm import'lar değişir, getiri sadece 1 harf — değmez |
| `db/` → `database/` rename | Aynı sebep |
| `db/db.js` → `connection.js` + `schema.js` split | Dosya zaten küçük |
| `api/server.js` → routes/middleware split | 97 satır, hâlâ okunabilir; büyüyünce yapılır |
| `util/watchmatch.js` → `services/` | Business logic, servis değil |
| Logger (winston/pino) ekle | Ayrı bir görev, mimariyle alakasız |

---

## 5. Görev Listesi (Onay Sonrası)

- [ ] A: `commands/` kategorilere ayır (betting/economy/general/admin)
  - [ ] A1: `createBet.js` → `commands/betting/bet.js`
  - [ ] A2: `withdraw.js` → `commands/economy/give.js` + i18n/colors fix
  - [ ] A3: `daily.js` → `commands/economy/daily.js`
  - [ ] A4: `leaderboard.js` → `commands/economy/leaderboard.js`
  - [ ] A5: `help.js` → `commands/general/help.js`
  - [ ] A6: `ping.js` → `commands/general/ping.js`
  - [ ] A7: `activate.js` → `commands/admin/activate.js`
  - [ ] A8: `apisetup.js` → `commands/admin/apisetup.js`
  - [ ] `commands/utility/` klasörünü sil
- [ ] B: `services/` klasörü oluştur
  - [ ] B1: `riot-api.js` → `services/riot.js` + tüm import'ları güncelle
  - [ ] B2: `util/lemonsqueezy.js` → `services/lemonsqueezy.js` + import'ları güncelle
  - [ ] B3: `util/webhookEmitter.js` → `services/webhookEmitter.js` + import'ları güncelle
- [ ] C: `db/` naming düzelt
  - [ ] C1: `userController.js` → `userRepository.js` + tüm import'ları güncelle
  - [ ] C2: `betController.js` → `betRepository.js` + tüm import'ları güncelle
  - [ ] C3: `guildController.js` → `guildRepository.js` + tüm import'ları güncelle
- [ ] D: Temizlik
  - [ ] D1: `db/champions.json` sil

---

## 6. İmport Değişikliği Özeti (Grup B+C sonrası)

Bu dosyaların içindeki import'ları güncellemek gerekir:

| Dosya | Ne değişir |
|---|---|
| `util/watchmatch.js` | `../../riot-api` → `../services/riot` |
| `util/championCache.js` | `../../riot-api` → `../services/riot` (varsa) |
| `util/resolveMatch.js` | `riot-api`, `betController`, `userController` |
| `util/i18n.js` | `guildController` → `guildRepository` |
| `util/premiumGuard.js` | `guildController` → `guildRepository` |
| `events/interactionButton.js` | `riot-api`, `betController`, `userController` |
| `events/interactionModal.js` | `betController`, `userController` |
| `events/ready.js` | path'ler değişirse |
| `api/server.js` | `guildController`, `userController`, `lemonsqueezy`, `webhookEmitter` |
| `commands/betting/bet.js` | `riot-api`, `betController`, `userController` |
| `commands/economy/daily.js` | `userController` |
| `commands/economy/give.js` | `userController` |
| `commands/admin/activate.js` | `lemonsqueezy`, `guildController` |
| `commands/admin/apisetup.js` | `guildController` |
