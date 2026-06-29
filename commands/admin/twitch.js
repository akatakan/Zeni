const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const twitchRepository = require('../../db/twitchRepository');
const twitchService = require('../../services/twitch');
const logger = require('../../util/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twitch')
        .setDescription('Twitch yayın takibi yönetimi (yönetici).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName('track')
            .setDescription('Bir Twitch kanalını takibe al ve LoL yayınlarında bahis otomatik açılsın.')
            .addStringOption(opt =>
                opt.setName('kanal').setDescription('Twitch kanal adı (küçük harf).').setRequired(true))
            .addStringOption(opt =>
                opt.setName('summoner').setDescription('Yayıncının Riot ID\'si (İsim#TAG).').setRequired(true))
            .addStringOption(opt =>
                opt.setName('region').setDescription('Yayıncının bölgesi.').setRequired(true)
                    .addChoices(
                        { name: 'TR',  value: 'TR' }, { name: 'EUW', value: 'EUW' },
                        { name: 'EUNE', value: 'EUNE' }, { name: 'NA', value: 'NA' },
                        { name: 'KR',  value: 'KR' }, { name: 'JP',  value: 'JP' },
                    ))
            .addIntegerOption(opt =>
                opt.setName('min_bahis').setDescription('Minimum bahis miktarı (varsayılan: 50).').setMinValue(50).setRequired(false))
            .addChannelOption(opt =>
                opt.setName('kanal_discord').setDescription('Bahisin açılacağı Discord kanalı (boş: mevcut kanal).').setRequired(false)))
        .addSubcommand(sub => sub
            .setName('untrack')
            .setDescription('Bir Twitch kanalının takibini durdur.')
            .addStringOption(opt =>
                opt.setName('kanal').setDescription('Twitch kanal adı.').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Takip edilen Twitch kanallarını listele.')),

    async execute(interaction) {
        const t = useT(interaction);
        const sub = interaction.options.getSubcommand();

        if (sub === 'track') {
            if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET || !process.env.PUBLIC_URL) {
                return interaction.reply({ content: t('twitch.not_configured'), flags: MessageFlags.Ephemeral });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const channelName    = interaction.options.getString('kanal').toLowerCase();
            const summonerInput  = interaction.options.getString('summoner');
            const region         = interaction.options.getString('region');
            const minBet         = interaction.options.getInteger('min_bahis') ?? 50;
            const discordChannel = interaction.options.getChannel('kanal_discord') ?? interaction.channel;

            const [summonerName, tagline] = summonerInput.split('#');
            if (!tagline) {
                return interaction.editReply(t('twitch.invalid_summoner'));
            }

            let channelId;
            try {
                channelId = await twitchService.getChannelId(channelName);
                if (!channelId) return interaction.editReply(t('twitch.channel_not_found'));
            } catch (err) {
                logger.error('Twitch kanal ID alınamadı', { channelName, error: err.message });
                return interaction.editReply(t('twitch.api_error'));
            }

            await twitchRepository.addTracking(
                interaction.guildId, channelName, channelId,
                summonerName, tagline, region, minBet, discordChannel.id,
            );

            // EventSub subscribe
            try {
                const eventsubId = await twitchService.subscribeToStreamOnline(channelId);
                if (eventsubId) {
                    const tracking = await twitchRepository.getTrackingByChannelId(channelId);
                    if (tracking) await twitchRepository.setEventSubId(tracking.id, eventsubId);
                }
            } catch (err) {
                logger.warn('EventSub subscribe başarısız', { channelName, error: err.message });
            }

            return interaction.editReply(t('twitch.tracked', { channel: channelName, summoner: summonerInput, discord: `<#${discordChannel.id}>` }));
        }

        if (sub === 'untrack') {
            const channelName = interaction.options.getString('kanal').toLowerCase();
            const removed = await twitchRepository.removeTracking(interaction.guildId, channelName);

            if (!removed) {
                return interaction.reply({ content: t('twitch.not_found', { channel: channelName }), flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ content: t('twitch.untracked', { channel: channelName }), flags: MessageFlags.Ephemeral });
        }

        if (sub === 'list') {
            const trackings = await twitchRepository.getTrackingsByGuild(interaction.guildId);
            if (trackings.length === 0) {
                return interaction.reply({ content: t('twitch.list_empty'), flags: MessageFlags.Ephemeral });
            }

            const rows = trackings.map(tr =>
                `**${tr.twitch_channel_name}** → ${tr.summoner_name}#${tr.tagline} (${tr.region}) in <#${tr.discord_channel_id}>`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setAuthor({ name: t('common.bot_name'), iconURL: interaction.client.user.displayAvatarURL() })
                .setTitle(t('twitch.embed.list_title'))
                .setDescription(rows)
                .setColor(COLORS.SYSTEM)
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    },
};
