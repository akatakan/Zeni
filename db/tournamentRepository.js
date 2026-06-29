const { pool } = require('./db');

const createTournament = async (guildId, entryFee, durationDays) => {
    const startedAt = Date.now();
    const endsAt = startedAt + durationDays * 24 * 60 * 60 * 1000;
    const res = await pool.query(
        'INSERT INTO tournaments (guild_id, entry_fee, prize_pool, started_at, ends_at) VALUES ($1,$2,0,$3,$4) RETURNING *',
        [guildId, entryFee, startedAt, endsAt]
    );
    return res.rows[0];
};

const getActiveTournament = async (guildId) => {
    const res = await pool.query(
        "SELECT * FROM tournaments WHERE guild_id = $1 AND status = 'active'",
        [guildId]
    );
    return res.rows[0];
};

const getTournamentById = async (tournamentId) => {
    const res = await pool.query('SELECT * FROM tournaments WHERE tournament_id = $1', [tournamentId]);
    return res.rows[0];
};

const endTournament = async (tournamentId) => {
    await pool.query("UPDATE tournaments SET status = 'ended' WHERE tournament_id = $1", [tournamentId]);
};

const joinTournament = async (tournamentId, userId, entryFee) => {
    await pool.query(
        'UPDATE tournaments SET prize_pool = prize_pool + $1 WHERE tournament_id = $2',
        [entryFee, tournamentId]
    );
    await pool.query(`
        INSERT INTO tournament_participants (tournament_id, user_id, tournament_balance)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
    `, [tournamentId, userId, entryFee * 3]);
};

const isParticipant = async (tournamentId, userId) => {
    const res = await pool.query(
        'SELECT 1 FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2 AND eliminated = 0',
        [tournamentId, userId]
    );
    return res.rows.length > 0;
};

const hasJoined = async (tournamentId, userId) => {
    const res = await pool.query(
        'SELECT 1 FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
        [tournamentId, userId]
    );
    return res.rows.length > 0;
};

const deductTournamentBalance = async (tournamentId, userId, amount) => {
    const res = await pool.query(`
        UPDATE tournament_participants
        SET tournament_balance = tournament_balance - $1
        WHERE tournament_id = $2 AND user_id = $3 AND tournament_balance >= $1 AND eliminated = 0
    `, [amount, tournamentId, userId]);
    return res.rowCount > 0;
};

const addTournamentBalance = async (tournamentId, userId, amount) => {
    await pool.query(
        'UPDATE tournament_participants SET tournament_balance = tournament_balance + $1 WHERE tournament_id = $2 AND user_id = $3',
        [amount, tournamentId, userId]
    );
};

const eliminateParticipant = async (tournamentId, userId) => {
    await pool.query(
        'UPDATE tournament_participants SET eliminated = 1, tournament_balance = 0 WHERE tournament_id = $1 AND user_id = $2',
        [tournamentId, userId]
    );
};

const getLeaderboard = async (tournamentId) => {
    const res = await pool.query(`
        SELECT * FROM tournament_participants
        WHERE tournament_id = $1
        ORDER BY eliminated ASC, tournament_balance DESC
    `, [tournamentId]);
    return res.rows;
};

const getActiveParticipantCount = async (tournamentId) => {
    const res = await pool.query(
        'SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1 AND eliminated = 0',
        [tournamentId]
    );
    return parseInt(res.rows[0].count);
};

const getParticipant = async (tournamentId, userId) => {
    const res = await pool.query(
        'SELECT * FROM tournament_participants WHERE tournament_id = $1 AND user_id = $2',
        [tournamentId, userId]
    );
    return res.rows[0];
};

module.exports = {
    createTournament,
    getActiveTournament,
    getTournamentById,
    endTournament,
    joinTournament,
    isParticipant,
    hasJoined,
    deductTournamentBalance,
    addTournamentBalance,
    eliminateParticipant,
    getLeaderboard,
    getActiveParticipantCount,
    getParticipant,
};
