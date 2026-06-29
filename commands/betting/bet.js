const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags, ComponentType } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const riotApi = require('../../services/riot');
const { watchMatchEnd } = require('../../util/watchmatch');
const { resolveMatch } = require('../../util/resolveMatch');
const betRepository = require('../../db/betRepository');
const { getChampionName } = require('../../util/championCache');
const userRepository = require('../../db/userRepository');
const { isPremium } = require('../../db/guildRepository');

const FREE_DAILY_LIMIT = 3;
const FREE_SIMULTANEOUS_LIMIT = 1;
const GLOBAL_OPEN_MATCH_LIMIT = 20;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bet')
        .setDescription('Aktif bir LoL maçına bahis aç.')
        .addStringOption(option =>
            option.setName('region')
                .setDescription('Oyuncunun bölgesi.')
                .setRequired(true)
                .addChoices(
                    { name: 'NA', value: 'NA' },
                    { name: 'EUW', value: 'EUW' },
                    { name: 'EUNE', value: 'EUNE' },
                    { name: 'KR', value: 'KR' },
                    { name: 'TR', value: 'TR' },
                    { name: 'JP', value: 'JP' },
                    { name: 'BR', value: 'BR' },
                    { name: 'LAN', value: 'LAN' },
                    { name: 'LAS', value: 'LAS' },
                ))
        .addStringOption(option =>
            option.setName('summonername')
                .setDescription('Oyuncunun Riot ID\'si (İsim#TAG).')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('betamount')
                .setDescription('Minimum bahis miktarı (JP).')
                .setMinValue(50)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('mod')
                .setDescription('Bahis modu: classic (2x sabit) veya pool (pari-mutuel havuz).')
                .setRequired(false)
                .addChoices(
                    { name: 'Classic (2x sabit)', value: 'classic' },
                    { name: 'Pool (Pari-mutuel havuz)', value: 'pool' },
                )),

    async execute(interaction) {
        const t = useT(interaction);
        const summonerName = interaction.options.getString('summonername').split('#')[0];
        const tagline = interaction.options.getString('summonername').split('#')[1];
        const region = interaction.options.getString('region');
        const minBetAmount = interaction.options.getNumber('betamount') || 50;
        const betMode = interaction.options.getString('mod') || 'classic';

        await interaction.deferReply();

        // Global API kapasitesi limiti (herkese uygulanır)
        if (await betRepository.getOpenMatchCount() >= GLOBAL_OPEN_MATCH_LIMIT) {
            return interaction.editReply({ content: t('bet.global_limit'), flags: MessageFlags.Ephemeral });
        }

        // Freemium limit kontrolü (premium sunucular geçer)
        if (!await isPremium(interaction.guildId)) {
            const dailyCount = await betRepository.getDailyMatchCount(interaction.user.id);
            if (dailyCount >= FREE_DAILY_LIMIT) {
                return interaction.editReply({ content: t('bet.daily_limit', { max: FREE_DAILY_LIMIT }), flags: MessageFlags.Ephemeral });
            }
            const openCount = await betRepository.getOpenMatchCountByCreator(interaction.user.id);
            if (openCount >= FREE_SIMULTANEOUS_LIMIT) {
                return interaction.editReply({ content: t('bet.simultaneous_limit', { max: FREE_SIMULTANEOUS_LIMIT }), flags: MessageFlags.Ephemeral });
            }
        }

        await interaction.editReply(t('bet.fetching'));

        try {
            const summoner = await riotApi.getAccountBySummonerName(summonerName, tagline);
            if (!summoner) {
                return interaction.editReply(t('bet.summoner_not_found'));
            }

            const activeGame = await riotApi.getActiveGameBySummonerId(region, summoner.puuid);
            if (!activeGame) {
                return interaction.editReply(t('bet.not_in_game'));
            }
            if (activeGame.gameLength > 300) {
                return interaction.editReply(t('bet.time_expired'));
            }

            const isBlue = activeGame.participants.some(p => p.teamId === 100 && p.puuid === summoner.puuid);

            // Rank + win rate — API hatası embed'i bloklamasın
            let rankText = t('bet.embed.unranked');
            try {
                const rankData = await riotApi.getRankByPuuid(summoner.puuid, region);
                const soloQ = rankData?.find(e => e.queueType === 'RANKED_SOLO_5x5');
                if (soloQ) {
                    const total = soloQ.wins + soloQ.losses;
                    const wr = total > 0 ? Math.round(soloQ.wins / total * 100) : 0;
                    rankText = `${soloQ.tier} ${soloQ.rank} • ${soloQ.leaguePoints} LP\n${soloQ.wins}W / ${soloQ.losses}L • %${wr} WR`;
                }
            } catch (_) {}

            const formatTeam = (teamId) => activeGame.participants
                .filter(p => p.teamId === teamId)
                .map(p => {
                    const name = p.riotId.split('#')[0];
                    const champ = getChampionName(p.championId);
                    const isTracked = p.puuid === summoner.puuid;
                    return isTracked ? `**${name} — ${champ}** ◄` : `${name} — ${champ}`;
                })
                .join('\n');

            const formatBans = (teamId) => {
                const bans = activeGame.bannedChampions
                    .filter(b => b.teamId === teamId && b.championId !== -1)
                    .map(b => getChampionName(b.championId));
                return bans.length > 0 ? bans.join(', ') : t('bet.embed.none');
            };

            const embed = new EmbedBuilder()
                .setAuthor({ name: t('common.bot_name') })
                .setTitle(t('bet.embed.title'))
                .setDescription(`**${summonerName}#${tagline}** ${isBlue ? t('bet.embed.blue_side') : t('bet.embed.red_side')}`)
                .setColor(COLORS.INFO)
                .addFields(
                    { name: t('bet.embed.blue_team'), value: formatTeam(100), inline: true },
                    { name: t('bet.embed.red_team'), value: formatTeam(200), inline: true },
                    { name: t('bet.embed.blue_bans'), value: formatBans(100), inline: true },
                    { name: t('bet.embed.red_bans'), value: formatBans(200), inline: true },
                    { name: t('bet.embed.rank'), value: rankText, inline: true },
                    { name: t('bet.embed.min_bet'), value: `${minBetAmount} JP`, inline: true },
                    { name: t('bet.embed.mode'), value: betMode === 'pool' ? t('bet.embed.mode_pool') : t('bet.embed.mode_classic'), inline: true },
                )
                .setTimestamp();

            let user = await userRepository.getUserById(interaction.user.id);
            if (!user) {
                await userRepository.addUser(interaction.user.id, interaction.user.username);
            }

            const matchId = `${activeGame.platformId}_${activeGame.gameId}`;
            // gameLength = maçın kaç saniyedir devam ettiği; gerçek başlangıç timestamp'i hesaplanır
            const matchStartedAt = Date.now() - activeGame.gameLength * 1000;
            await betRepository.createMatchBet(matchId, interaction.user.id, matchStartedAt, summoner.puuid, region, interaction.channelId, betMode);

            const joinBtn = new ButtonBuilder()
                .setCustomId(`placeBet-${matchId}-${minBetAmount}`)
                .setLabel(t('bet.button.place'))
                .setStyle(ButtonStyle.Success);

            const quitBtn = new ButtonBuilder()
                .setCustomId(`quitBet-${matchId}-${interaction.user.id}`)
                .setLabel(t('bet.button.cancel'))
                .setStyle(ButtonStyle.Danger);

            const rows = [new ActionRowBuilder().addComponents(joinBtn, quitBtn)];

            if (await isPremium(interaction.guildId)) {
                const firstBloodBtn = new ButtonBuilder()
                    .setCustomId(`sideBet-${matchId}-${minBetAmount}-first_blood`)
                    .setLabel(t('bet.button.side_first_blood'))
                    .setStyle(ButtonStyle.Primary);

                const firstTowerBtn = new ButtonBuilder()
                    .setCustomId(`sideBet-${matchId}-${minBetAmount}-first_tower`)
                    .setLabel(t('bet.button.side_first_tower'))
                    .setStyle(ButtonStyle.Primary);

                rows.push(new ActionRowBuilder().addComponents(firstBloodBtn, firstTowerBtn));
            }

            await interaction.editReply({ embeds: [embed], components: rows });

            // Bahis kapanmadan 1 dakika önce kanal uyarısı
            const timeRemaining = (300 - activeGame.gameLength) * 1000;
            if (timeRemaining > 60 * 1000) {
                setTimeout(async () => {
                    try {
                        await interaction.channel.send(t('bet.embed.countdown_warning', { summoner: `${summonerName}#${tagline}` }));
                    } catch (_) {}
                }, timeRemaining - 60 * 1000);
            }

            try {
                const resolveWithClient = (mId, s, r) => resolveMatch(mId, s, r, interaction.client);
                const resultEmbed = await watchMatchEnd(matchId, summoner, region, resolveWithClient, matchStartedAt);
                interaction.channel.send({ embeds: [resultEmbed] });
            } catch (error) {
                console.error('Maç izleme hatası:', error);
                await interaction.editReply(t('bet.error_result'));
            }
        } catch (error) {
            console.error('Bet komutu hatası:', error);
            await interaction.editReply(t('bet.error_fetch'));
        }
    },
};
