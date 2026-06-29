const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const { createGuildSettings, setWebhookUrl } = require('../../db/guildRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apisetup')
        .setDescription('Webhook entegrasyonu için API ayarlarını yönet.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('API key ve webhook secret bilgilerini göster'))
        .addSubcommand(sub =>
            sub.setName('webhook')
                .setDescription('Webhook URL ayarla')
                .addStringOption(opt =>
                    opt.setName('url')
                        .setDescription('Webhook URL')
                        .setRequired(true))),

    async execute(interaction) {
        const t = useT(interaction);
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'info') {
            const settings = await createGuildSettings(guildId);
            const embed = new EmbedBuilder()
                .setTitle(t('apisetup.embed.title'))
                .setColor(COLORS.SYSTEM)
                .addFields(
                    { name: t('apisetup.embed.api_key'), value: `\`${settings.api_key}\`` },
                    { name: t('apisetup.embed.webhook_secret'), value: `\`${settings.webhook_secret}\`` },
                    { name: t('apisetup.embed.webhook_url'), value: settings.webhook_url || t('apisetup.embed.not_set') },
                    { name: t('apisetup.embed.balance_query'), value: '`GET /api/balance/:userId`' },
                    { name: t('apisetup.embed.deduct'), value: '`POST /api/balance/deduct`' },
                )
                .setFooter({ text: t('apisetup.embed.footer') });
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        else if (sub === 'webhook') {
            const url = interaction.options.getString('url');

            // SSRF koruması: yalnızca https genel URL'lere izin ver
            let parsed;
            try {
                parsed = new URL(url);
            } catch {
                parsed = null;
            }
            const isPrivate = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1)/i.test(parsed?.hostname || '');
            if (!parsed || parsed.protocol !== 'https:' || isPrivate) {
                return interaction.reply({ content: t('apisetup.invalid_url'), flags: MessageFlags.Ephemeral });
            }

            await createGuildSettings(guildId);
            await setWebhookUrl(guildId, url);
            await interaction.reply({ content: t('apisetup.webhook_set', { url }), flags: MessageFlags.Ephemeral });
        }
    }
};
