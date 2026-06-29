const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const { activateLicense } = require('../../services/lemonsqueezy');
const { activatePremium } = require('../../db/guildRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activate')
        .setDescription('Premium lisans anahtarınızı girerek sunucunuzu aktif edin.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('LemonSqueezy lisans anahtarı')
                .setRequired(true)),

    async execute(interaction) {
        const t = useT(interaction);
        const licenseKey = interaction.options.getString('key');
        const guildId = interaction.guildId;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await activateLicense(licenseKey, guildId);

        if (!result || !result.activated) {
            const reason = result?.error || 'Geçersiz veya kullanılmış lisans anahtarı.';
            await interaction.editReply({ content: t('activate.failed', { reason }) });
            return;
        }

        const expiresAt = result.license_key?.expires_at || null;
        await activatePremium(guildId, licenseKey, expiresAt);

        const embed = new EmbedBuilder()
            .setAuthor({ name: t('common.bot_name'), iconURL: interaction.client.user.displayAvatarURL() })
            .setTitle(t('activate.embed.title'))
            .setColor(COLORS.SUCCESS)
            .addFields(
                { name: t('activate.embed.server'), value: interaction.guild.name },
                { name: t('activate.embed.expires'), value: expiresAt ? new Date(expiresAt).toLocaleDateString('tr-TR') : t('activate.embed.never') },
            )
            .setFooter({ text: t('common.bot_name') })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};
