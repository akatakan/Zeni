jest.mock('discord.js', () => {
    const embedInstance = {
        setAuthor: jest.fn().mockReturnThis(),
        setTitle: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        setColor: jest.fn().mockReturnThis(),
        addFields: jest.fn().mockReturnThis(),
        setFields: jest.fn().mockReturnThis(),
        setTimestamp: jest.fn().mockReturnThis(),
        setFooter: jest.fn().mockReturnThis(),
        data: { fields: [] },
    };
    const EmbedBuilder = jest.fn(() => embedInstance);
    EmbedBuilder.from = jest.fn(() => embedInstance);
    return {
        Events: { InteractionCreate: 'interactionCreate' },
        MessageFlags: { Ephemeral: 64 },
        EmbedBuilder,
        ModalBuilder: jest.fn(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setTitle: jest.fn().mockReturnThis(),
            addComponents: jest.fn().mockReturnThis(),
        })),
        TextInputBuilder: jest.fn(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setLabel: jest.fn().mockReturnThis(),
            setStyle: jest.fn().mockReturnThis(),
            setPlaceholder: jest.fn().mockReturnThis(),
            setRequired: jest.fn().mockReturnThis(),
        })),
        TextInputStyle: { Short: 1 },
        ActionRowBuilder: jest.fn(() => ({
            addComponents: jest.fn().mockReturnThis(),
        })),
        StringSelectMenuBuilder: jest.fn(() => ({
            setCustomId: jest.fn().mockReturnThis(),
            setPlaceholder: jest.fn().mockReturnThis(),
            addOptions: jest.fn().mockReturnThis(),
        })),
        StringSelectMenuOptionBuilder: jest.fn(() => ({
            setLabel: jest.fn().mockReturnThis(),
            setValue: jest.fn().mockReturnThis(),
        })),
    };
});

jest.mock('../util/i18n',          () => ({ useT: () => (key) => key }));
jest.mock('../util/logger',        () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../util/watchmatch',    () => ({ stopWatchingMatch: jest.fn().mockResolvedValue(), watchMatchEnd: jest.fn() }));
jest.mock('../db/userRepository',  () => ({ getUserById: jest.fn(), addUser: jest.fn(), addUserBalance: jest.fn(), deductBalance: jest.fn() }));
jest.mock('../db/betRepository',   () => ({ getBetsByMatchId: jest.fn(), closeMatchBet: jest.fn(), deleteMatchBets: jest.fn(), deleteBets: jest.fn(), hasActiveBet: jest.fn(), getMatchBetById: jest.fn(), addBet: jest.fn(), getStatsByUserId: jest.fn() }));
jest.mock('../db/sideBetRepository', () => ({ getSideBetsByMatch: jest.fn(), addSideBet: jest.fn(), hasSideBet: jest.fn() }));
jest.mock('../db/followRepository',  () => ({ getFollowers: jest.fn().mockResolvedValue([]) }));
jest.mock('../db/tournamentRepository', () => ({ getActiveTournament: jest.fn().mockResolvedValue(null), isParticipant: jest.fn(), deductTournamentBalance: jest.fn(), getParticipant: jest.fn(), eliminateParticipant: jest.fn(), addTournamentBalance: jest.fn() }));
jest.mock('../db/riskRepository',   () => ({ isRisky: jest.fn() }));

const userRepository    = require('../db/userRepository');
const betRepository     = require('../db/betRepository');
const sideBetRepository = require('../db/sideBetRepository');
const { stopWatchingMatch } = require('../util/watchmatch');
const { isRisky } = require('../db/riskRepository');
const handler = require('../events/interactionCreate');

const MATCH_ID = 'EUW1_42';
const CREATOR  = '123456789012345678'; // numeric Discord snowflake (no hyphens)

function makeInteraction(overrides = {}) {
    return {
        isChatInputCommand: () => false,
        isButton:           () => false,
        isStringSelectMenu: () => false,
        isModalSubmit:      () => false,
        user:    { id: CREATOR, username: 'tester' },
        guildId: 'guild1',
        reply:   jest.fn().mockResolvedValue(),
        message: { id: 'msg-1', delete: jest.fn().mockResolvedValue() },
        client:  { commands: new Map() },
        ...overrides,
    };
}

function makeQuitBet(matchId = MATCH_ID, creatorId = CREATOR, clickerId = CREATOR) {
    return makeInteraction({
        isButton: () => true,
        customId: `quitBet-${matchId}-${creatorId}`,
        user: { id: clickerId, username: 'tester' },
    });
}

function makePlaceBet(matchId = MATCH_ID, minBet = 50, userId = 'u1') {
    return makeInteraction({
        isButton: () => true,
        customId: `placeBet-${matchId}-${minBet}`,
        user: { id: userId, username: 'u1' },
        message: { id: 'msg-bet', delete: jest.fn() },
    });
}

beforeEach(() => {
    betRepository.getBetsByMatchId.mockResolvedValue([]);
    betRepository.closeMatchBet.mockResolvedValue();
    betRepository.deleteMatchBets.mockResolvedValue();
    betRepository.deleteBets.mockResolvedValue();
    sideBetRepository.getSideBetsByMatch.mockResolvedValue([]);
    userRepository.addUserBalance.mockResolvedValue();
});

// ═══════════════════════════════════════════════════════════════════════════════
// quitBet — permission guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('quitBet — permission guard', () => {
    test('rejects when a different user clicks cancel', async () => {
        const ix = makeQuitBet(MATCH_ID, CREATOR, '999999999999999999'); // another user
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.no_permission' }));
        expect(betRepository.deleteMatchBets).not.toHaveBeenCalled();
    });

    test('allows cancel when clicker is the match creator', async () => {
        const ix = makeQuitBet(MATCH_ID, CREATOR, CREATOR);
        await handler.execute(ix);
        expect(betRepository.deleteMatchBets).toHaveBeenCalledWith(MATCH_ID);
    });

    test('rejects malformed customId (only 2 parts instead of 3)', async () => {
        const ix = makeQuitBet();
        ix.customId = 'quitBet-onlyonepart';
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.invalid' }));
        expect(betRepository.deleteMatchBets).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// quitBet — main bet refunds
// ═══════════════════════════════════════════════════════════════════════════════

describe('quitBet — main bet refunds', () => {
    test('refunds each bet amount to the correct user', async () => {
        betRepository.getBetsByMatchId.mockResolvedValue([
            { user_id: 'userA', amount: 150 },
            { user_id: 'userB', amount: 300 },
        ]);
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('userA', 150);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('userB', 300);
    });

    test('does not call addUserBalance when there are no main bets', async () => {
        betRepository.getBetsByMatchId.mockResolvedValue([]);
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([]);
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(userRepository.addUserBalance).not.toHaveBeenCalled();
    });

    test('queries bets for the correct matchId', async () => {
        const ix = makeQuitBet('EUW1_55');
        await handler.execute(ix);
        expect(betRepository.getBetsByMatchId).toHaveBeenCalledWith('EUW1_55');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// quitBet — side bet refunds
// ═══════════════════════════════════════════════════════════════════════════════

describe('quitBet — side bet refunds', () => {
    test('refunds all side bet amounts on cancellation', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'userC', amount: 75 },
            { user_id: 'userD', amount: 50 },
        ]);
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('userC', 75);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('userD', 50);
    });

    test('same user receives both main and side bet refunds', async () => {
        betRepository.getBetsByMatchId.mockResolvedValue([{ user_id: 'userE', amount: 200 }]);
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([{ user_id: 'userE', amount: 100 }]);
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('userE', 200);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('userE', 100);
    });

    test('side bets are fetched for the correct matchId', async () => {
        const ix = makeQuitBet('EUW1_77');
        await handler.execute(ix);
        expect(sideBetRepository.getSideBetsByMatch).toHaveBeenCalledWith('EUW1_77');
    });

    test('side bet refunds happen before match is deleted', async () => {
        const callOrder = [];
        userRepository.addUserBalance.mockImplementation(() => { callOrder.push('refund'); return Promise.resolve(); });
        betRepository.deleteMatchBets.mockImplementation(() => { callOrder.push('delete'); return Promise.resolve(); });
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([{ user_id: 'userF', amount: 50 }]);

        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(callOrder.indexOf('refund')).toBeLessThan(callOrder.indexOf('delete'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// quitBet — cleanup
// ═══════════════════════════════════════════════════════════════════════════════

describe('quitBet — cleanup', () => {
    test('stops the match watcher', async () => {
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(stopWatchingMatch).toHaveBeenCalledWith(MATCH_ID);
    });

    test('closes the match, then deletes it', async () => {
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(betRepository.closeMatchBet).toHaveBeenCalledWith(MATCH_ID);
        expect(betRepository.deleteMatchBets).toHaveBeenCalledWith(MATCH_ID);
        expect(betRepository.deleteBets).toHaveBeenCalledWith(MATCH_ID);
    });

    test('replies with cancellation confirmation', async () => {
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.cancelled' }));
    });

    test('deletes the original bet embed message', async () => {
        const ix = makeQuitBet();
        await handler.execute(ix);
        expect(ix.message.delete).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// placeBet button — validation guards
// ═══════════════════════════════════════════════════════════════════════════════

describe('placeBet button — validation guards', () => {
    beforeEach(() => {
        isRisky.mockResolvedValue(false);
        userRepository.getUserById.mockResolvedValue({ user_id: 'u1', balance: 1000 });
        userRepository.addUser.mockResolvedValue();
        betRepository.hasActiveBet.mockResolvedValue(false);
        betRepository.getMatchBetById.mockResolvedValue({ started_at: Date.now() - 60_000 }); // 1 min ago
    });

    test('blocks users flagged as risky', async () => {
        isRisky.mockResolvedValue(true);
        const ix = makePlaceBet();
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'risk.blocked' }));
    });

    test('blocks when user balance is below the minimum bet', async () => {
        userRepository.getUserById.mockResolvedValue({ user_id: 'u1', balance: 10 });
        const ix = makePlaceBet(MATCH_ID, 50);
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.insufficient_balance' }));
    });

    test('blocks when user already has an active bet on this match', async () => {
        betRepository.hasActiveBet.mockResolvedValue(true);
        const ix = makePlaceBet();
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.already_bet' }));
    });

    test('blocks when bet window has closed (> 5 minutes elapsed)', async () => {
        betRepository.getMatchBetById.mockResolvedValue({ started_at: Date.now() - 6 * 60_000 });
        const ix = makePlaceBet();
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.time_expired' }));
    });

    test('blocks when match no longer exists', async () => {
        betRepository.getMatchBetById.mockResolvedValue(null);
        const ix = makePlaceBet();
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.match_not_found' }));
    });

    test('rejects non-numeric minBetAmount in customId', async () => {
        const ix = makeInteraction({
            isButton: () => true,
            customId: `placeBet-${MATCH_ID}-notanumber`,
            user: { id: 'u1', username: 'u1' },
            message: { id: 'msg', delete: jest.fn() },
        });
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'button.invalid_amount' }));
    });

    test('shows win/lose select menu when all checks pass', async () => {
        const ix = makePlaceBet();
        await handler.execute(ix);
        expect(ix.reply).toHaveBeenCalledWith(
            expect.objectContaining({ components: expect.any(Array) })
        );
    });

    test('accepts a bet at exactly 5 minutes (boundary)', async () => {
        betRepository.getMatchBetById.mockResolvedValue({ started_at: Date.now() - 5 * 60_000 + 100 });
        const ix = makePlaceBet();
        await handler.execute(ix);
        // Should show select menu, not time_expired
        expect(ix.reply).not.toHaveBeenCalledWith(expect.objectContaining({ content: 'button.time_expired' }));
    });
});
