<script>
import { onMount } from 'svelte';
import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';
import { fade, fly } from 'svelte/transition';
import Typeahead from 'svelte-typeahead';

import Game, { GAME_STATUS } from './models/Game.js';
import MediaPlayer from './components/MediaPlayer.svelte';
import MotifCard from './components/MotifCard.svelte';
import ScoreDisplay from './components/ScoreDisplay.svelte';
import GameResults from './components/GameResults.svelte';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let phase = 'init'; // init | error | game
let statusText = 'Initializing…';
let user = null;

let gameSongs = [];
let gameMotifs = [];
let currentGame;
let displayedMotifs;
let forceReveal = false;

// Re-derive gameStatus every time displayedMotifs or currentGame changes.
// Using $: ensures Svelte re-evaluates this even when currentGame is only mutated.
$: gameStatus = (displayedMotifs, currentGame?.status ?? GAME_STATUS.ONGOING);
$: if (DEBUG && gameStatus) dbg('gameStatus reactive =', gameStatus);

let showToast = false;
let toastMessage = '';
let selectedMotif;

let showHelp = false;
let showAbout = false;

let discordSdk = null; // set during boot; null in dev mode

// ---------------------------------------------------------------------------
// Social features state
// ---------------------------------------------------------------------------
let guessersBySlug = {}; // { [motifSlug]: [{userId, username, avatar}] }
let liveParticipants = [];

function avatarUrl(userId, avatarHash) {
    if (avatarHash) return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=32`;
    return `https://cdn.discordapp.com/embed/avatars/0.png`;
}

function addGuesser(motifSlug, guesser) {
    const existing = guessersBySlug[motifSlug] ?? [];
    if (existing.find(g => g.userId === guesser.userId)) return;
    guessersBySlug = { ...guessersBySlug, [motifSlug]: [...existing, guesser] };
}

let ws = null;
function connectWS(channelId, date) {
    if (!channelId || ws) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws?channelId=${encodeURIComponent(channelId)}&date=${encodeURIComponent(date)}`);
    ws.addEventListener('message', (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'guess') addGuesser(msg.motifSlug, { userId: msg.userId, username: msg.username, avatar: msg.avatar });
        } catch {}
    });
    ws.addEventListener('error', (e) => console.warn('[ws]', e));
}

async function submitGuessToServer(motifSlug) {
    if (!discordSdk?.channelId) return;
    try {
        await fetch('/api/guess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channelId: discordSdk.channelId,
                date: currentGame.dateString,
                userId: user.id,
                username: user.global_name ?? user.username,
                avatar: user.avatar,
                motifSlug,
            }),
        });
    } catch (e) { console.warn('[guess api]', e); }
}

function submitErrorCount() {
    if (!discordSdk?.channelId) return;
    fetch('/api/session-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channelId: discordSdk.channelId,
            date: currentGame.dateString,
            userId: user.id,
            errorCount: currentGame.errorCount,
        }),
    }).catch((e) => console.warn('[session-error api]', e));
}

function notifySessionDone() {
    if (!discordSdk?.channelId) return;
    fetch('/api/session-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channelId: discordSdk.channelId,
            date: currentGame.dateString,
            done: true,
        }),
    }).catch((e) => console.warn('[session-update api]', e));
}

async function loadGuesses(channelId, date) {
    if (!channelId) return;
    try {
        const res = await fetch(`/api/guesses?channelId=${encodeURIComponent(channelId)}&date=${encodeURIComponent(date)}`);
        const guesses = await res.json();
        for (const g of guesses) addGuesser(g.motifSlug, { userId: g.userId, username: g.username, avatar: g.avatar });
    } catch (e) { console.warn('[guesses api]', e); }
}


// ---------------------------------------------------------------------------
// Debug logging — set ?debug=1 in the URL to enable
// ---------------------------------------------------------------------------
// Enable debug via URL (?debug=1) or localStorage (localStorage.setItem('motifle-debug','1'))
const DEBUG = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('debug') ||
     localStorage.getItem('motifle-debug') === '1');
function dbg(...args) { if (DEBUG) console.log('[motifle]', ...args); }

function openLink(url) {
    if (discordSdk) {
        discordSdk.commands.openExternalLink({ url }).catch(() => window.open(url, '_blank'));
    } else {
        window.open(url, '_blank');
    }
}

const todayString = new Date().toISOString().slice(0, 10);
const extractMotif = (motif) => motif.name;

// ---------------------------------------------------------------------------
// Storage helpers (keyed by Discord user ID)
// ---------------------------------------------------------------------------

function storageKey(userId) {
    return `motifle-discord-${userId}`;
}

function saveGame() {
    if (!user) return;
    const saved = JSON.parse(localStorage.getItem(storageKey(user.id)) || '{}');
    saved[currentGame.dateString] = currentGame;
    localStorage.setItem(storageKey(user.id), JSON.stringify(saved));
}

function loadOrCreateGame(userId) {
    const saved = JSON.parse(localStorage.getItem(storageKey(userId)) || '{}');
    const game = new Game(todayString, gameSongs, gameMotifs);
    if (saved[todayString]) {
        dbg('loadGame → saved status:', saved[todayString]?.status, '| leitmotifs:', saved[todayString]?.song?.leitmotifs);
        try {
            game.hydrateWithObject(saved[todayString]);
            dbg('loadGame ← hydrated status:', game.status, '| guessed:', game.nLeitmotifsGuessed, '/', game.nTotalLeitmotifs);
        } catch (e) { console.error('Hydration failed:', e); }
    } else {
        dbg('loadGame → no save found for', todayString);
    }
    return game;
}

// ---------------------------------------------------------------------------
// Game logic
// ---------------------------------------------------------------------------

function resetDay() {
    if (!user) return;
    const saved = JSON.parse(localStorage.getItem(storageKey(user.id)) || '{}');
    delete saved[todayString];
    localStorage.setItem(storageKey(user.id), JSON.stringify(saved));
    currentGame = loadOrCreateGame(user.id);
    displayedMotifs = [...currentGame.displayedMotifs];
    forceReveal = false;
}

function updateGame() {
    displayedMotifs = [...currentGame.displayedMotifs];
    forceReveal = currentGame.status === GAME_STATUS.LOST;
    dbg('updateGame → status:', currentGame.status, '| guessed:', currentGame.nLeitmotifsGuessed, '/', currentGame.nTotalLeitmotifs, '| errors:', currentGame.errorCount, '/', currentGame.maxErrors);
    saveGame();
}

function showToastMessage(message) {
    showToast = true;
    toastMessage = message;
    setTimeout(() => { showToast = false; }, 3000);
}

function handleMotifResult(motif, success) {
    if (success === 'same') {
        showToastMessage(`Yes, that's the song — guess its *motifs*, numbnuts!`);
    } else if (success === 'partial') {
        showToastMessage(`"${motif.name}" was close — not counted as an error.`);
    } else if (success === 'sample') {
        showToastMessage(`"${motif.name}" is a sample, not a musical reference — not an error.`);
    } else if (success === 'error') {
        showToastMessage(`"${motif.name}" was wrong!`);
    }
}

function submitMotif(event) {
    const motif = event.detail.original;
    dbg('submitMotif → slug:', motif?.slug, '| name:', motif?.name);
    const success = currentGame.submitMotif(motif);
    dbg('submitMotif ← result:', success);
    handleMotifResult(motif, success);
    if (success === 'success') {
        submitGuessToServer(motif.slug);
        addGuesser(motif.slug, { userId: user.id, username: user.global_name ?? user.username, avatar: user.avatar });
    }
    if (success === 'error') submitErrorCount();
    updateGame();
    if (currentGame.status !== GAME_STATUS.ONGOING) notifySessionDone();
}

function giveUp() {
    currentGame.endGame(GAME_STATUS.LOST);
    updateGame();
    notifySessionDone();
}

function computeClass(result) {
    return `motifTitle rarity${result.original.rarity}`;
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

onMount(async () => {
    const log = (...args) => console.log('[boot]', ...args);
    const logErr = (label, e) => console.error(`[boot] ${label}`, e, JSON.stringify(e));

    async function startGame(userId) {
        log('startGame → userId:', userId);
        statusText = 'Loading game data…';
        log('fetching game_motifs.json + game_songs.json');
        const [motifsRes, songsRes] = await Promise.all([
            fetch('/game_motifs.json'),
            fetch('/game_songs.json'),
        ]);
        log('game data fetched → motifs status:', motifsRes.status, '| songs status:', songsRes.status);
        gameMotifs = await motifsRes.json();
        gameSongs = await songsRes.json();
        log('game data parsed → motifs:', gameMotifs.length, '| songs:', gameSongs.length);

        currentGame = loadOrCreateGame(userId);
        displayedMotifs = [...currentGame.displayedMotifs];
        forceReveal = currentGame.status === GAME_STATUS.LOST;
        log('game loaded → song:', currentGame.song?.name, '| status:', currentGame.status);
        phase = 'game';

        const channelId = discordSdk?.channelId ?? null;
        log('channelId:', channelId, '| loading guesses…');
        await loadGuesses(channelId, todayString);
        log('guesses loaded, connecting WS…');
        connectWS(channelId, todayString);
        log('startGame complete');
    }

    try {
        log('creating DiscordSDK, clientId:', import.meta.env.VITE_DISCORD_CLIENT_ID);
        discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
        statusText = 'Waiting for Discord…';
        await discordSdk.ready();
        log('SDK ready');

        statusText = 'Authorizing…';
        log('calling authorize…');
        const { code } = await discordSdk.commands.authorize({
            client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
            response_type: 'code',
            state: '',
            prompt: 'none',
            scope: ['identify', 'guilds', 'applications.commands'],
        });
        log('authorize done, code length:', code?.length);

        statusText = 'Exchanging token…';
        log('fetching /api/token…');
        const tokenRes = await fetch('/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        log('/api/token status:', tokenRes.status);
        const tokenBody = await tokenRes.json();
        log('/api/token body keys:', Object.keys(tokenBody));
        const { access_token } = tokenBody;
        log('access_token present:', !!access_token, '| length:', access_token?.length);

        statusText = 'Authenticating…';
        log('calling authenticate…');
        const auth = await discordSdk.commands.authenticate({ access_token });
        user = auth.user;
        log('authenticate done → user:', user?.id, user?.username);

        try {
            log('calling patchUrlMappings…');
            patchUrlMappings(
                [{ prefix: '/youtube', target: 'www.youtube-nocookie.com' }],
                { patchFetch: true, patchWebSocket: false, patchXhr: true, patchSrcAttributes: false }
            );
            log('patchUrlMappings done');
        } catch (e) {
            logErr('patchUrlMappings failed (non-fatal):', e);
        }

        await startGame(user.id);

        // Participant tracking — fire-and-forget so a hang/4009 never blocks loading
        log('starting participant tracking (fire-and-forget)…');
        (async () => {
            try {
                log('[participants] calling getInstanceConnectedParticipants…');
                const { participants } = await discordSdk.commands.getInstanceConnectedParticipants();
                log('[participants] got:', participants?.length);
                liveParticipants = participants;
                log('[participants] calling subscribe…');
                await discordSdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', ({ participants: p }) => {
                    log('[participants] update event, count:', p?.length);
                    liveParticipants = p;
                });
                log('[participants] subscribe done');
            } catch (e) { logErr('[participants] failed (non-fatal):', e); }
        })();
    } catch (err) {
        logErr('OUTER CATCH', err);
        if (err.message?.includes('frame_id')) {
            log('dev mode detected, starting without Discord SDK');
            discordSdk = null;
            user = { id: 'dev', global_name: 'Developer', username: 'dev', avatar: null };
            await startGame(user.id);
        } else {
            phase = 'error';
            statusText = `Error: ${err.message ?? JSON.stringify(err)}`;
            console.error('[boot] fatal error:', err);
        }
    }
});
</script>

{#if phase === 'init' || phase === 'error'}
    <div class="loading-screen">
        <img class="loading-logo" src="/logo-white.png" alt="Motifle" />
        <div class="loading-status {phase === 'error' ? 'error' : ''}">{statusText}</div>
    </div>

{:else if phase === 'game' && currentGame}
    <div class="app-shell" transition:fade={{ duration: 250 }}>

        <!-- ── Header ── -->
        <header class="app-header">
            <div class="header-left">
                <span class="header-title">Motifle</span>
                <span class="date-chip">{todayString}</span>
            </div>
            <div class="header-right">
                <button class="nav-btn" on:click={() => (showHelp = true)}>Help</button>
                <button class="nav-btn" on:click={() => (showAbout = true)}>About</button>
                {#if liveParticipants.length > 1}
                    <div class="participant-stack">
                        {#each liveParticipants.filter(p => p.id !== user?.id).slice(0, 4) as p}
                            <img
                                class="participant-avatar"
                                src={avatarUrl(p.id, p.avatar)}
                                alt={p.global_name || p.username}
                                title={p.global_name || p.username}
                            />
                        {/each}
                    </div>
                {/if}
                {#if user && user.avatar}
                    <img
                        class="user-avatar"
                        src="https://cdn.discordapp.com/avatars/{user.id}/{user.avatar}.png?size=32"
                        alt={user.global_name || user.username}
                        title={user.global_name || user.username}
                    />
                {:else if user}
                    <div class="user-avatar-placeholder" title={user.global_name || user.username}>
                        {(user.global_name || user.username || '?')[0].toUpperCase()}
                    </div>
                {/if}
            </div>
        </header>

        <!-- ── Player ── -->
        <div class="player-section">
            <MediaPlayer game={currentGame} />
        </div>

        <!-- ── Score strip ── -->
        <div class="score-section">
            <ScoreDisplay game={currentGame} {displayedMotifs} />
        </div>

        <!-- ── Card list ── -->
        <div class="cards-section">
            {#each displayedMotifs as motif, i (motif.slug)}
                <MotifCard {motif} {forceReveal} currentGame={currentGame} index={i} guessers={guessersBySlug[motif.slug] ?? []} />
            {/each}
        </div>

        <!-- ── Game results ── -->
        {#if gameStatus === GAME_STATUS.WON || gameStatus === GAME_STATUS.LOST}
            <GameResults game={currentGame} onReset={resetDay} {openLink} />
        {/if}

        <!-- ── Search at bottom — dropdown opens upward ── -->
        {#if gameStatus === GAME_STATUS.ONGOING}
            <div class="input-section">
                <div class="search-row">
                    <Typeahead
                        hideLabel
                        focusAfterSelect
                        data={gameMotifs}
                        extract={extractMotif}
                        bind:selected={selectedMotif}
                        inputAfterSelect="clear"
                        on:select={submitMotif}
                        let:result
                        placeholder="Guess a leitmotif…"
                    >
                        <div class="motifResult">
                            <div class={computeClass(result)}>
                                {@html result.string}
                            </div>
                            <div class="motifSlug">
                                {result.original.slug ? result.original.slug.slice(6) : null}
                            </div>
                        </div>
                    </Typeahead>
                    <button on:click={giveUp} class="give-up-btn">Give Up</button>
                </div>
            </div>
        {/if}

        {#if showToast}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="toast"
                on:click={() => (showToast = false)}
                on:keydown={(e) => e.key === 'Escape' && (showToast = false)}
            >
                {toastMessage}
            </div>
        {/if}

        <!-- ── Help modal ── -->
        {#if showHelp}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="modal-overlay" on:click|self={() => (showHelp = false)} on:keydown={(e) => e.key === 'Escape' && (showHelp = false)} transition:fade={{ duration: 150 }}>
                <div class="modal-panel">
                    <div class="modal-header">
                        <h2>How to play</h2>
                        <button class="modal-close" on:click={() => (showHelp = false)}>✕</button>
                    </div>
                    <div class="modal-body">
                        <p>Your goal is to <strong>guess a song's referenced melodies</strong>. For instance, <em>Descend</em> features the drums from <em>Upward Movement</em>. Listen carefully and use the search bar to identify leitmotifs!</p>
                        <h3>Point values by rarity</h3>
                        <ul>
                            <li><span class="rarity5">Core (100 pts)</span> — Melodies every fan has heard: MeGaLoVania, Sburban Jungle…</li>
                            <li><span class="rarity4">Common (125 pts)</span> — Popular fanmusic or slightly less iconic themes: Crystamanthequins…</li>
                            <li><span class="rarity3">Uncommon (175 pts)</span> — Less popular melodies: An Unbreakable Union, Arisen Anew…</li>
                            <li><span class="rarity2">Rare (250 pts)</span> — Obscure references: Blue Atom, CONTACT…</li>
                            <li><span class="rarity1">Singular (500 pts)</span> — Near-impossible: appeared only once or twice in the dataset.</li>
                        </ul>
                        <p>You have a limited number of guesses (3–10, scaling with motif count). The game ends when you run out of guesses, find all motifs, or give up.</p>
                        <p>After the game, song links and wiki pages are revealed.</p>
                    </div>
                </div>
            </div>
        {/if}

        <!-- ── About modal ── -->
        {#if showAbout}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="modal-overlay" on:click|self={() => (showAbout = false)} on:keydown={(e) => e.key === 'Escape' && (showAbout = false)} transition:fade={{ duration: 150 }}>
                <div class="modal-panel">
                    <div class="modal-header">
                        <h2>About Motifle</h2>
                        <button class="modal-close" on:click={() => (showAbout = false)}>✕</button>
                    </div>
                    <div class="modal-body">
                        <p>Motifle is a musical guessing game where you identify a song's referenced melodies, drawing from the world of
                            <button class="text-link" on:click={() => openLink('https://hsmusic.wiki')}>HS music and fanmusic</button>.</p>
                        <p>All audio is licensed under Creative Commons and used with credit.</p>
                        <h3>Credits</h3>
                        <ul>
                            <li><strong>Makin</strong> — Developer and designer.</li>
                            <li><strong><button class="text-link" on:click={() => openLink('https://hsmusic.wiki')}>HS Music Wiki</button></strong> — Data sourcing (thanks to quasarNebula and Niklink).</li>
                            <li><strong>The HS Music Team and fanmusicians</strong> — CANMT, UMSPAF, et al.</li>
                        </ul>
                    </div>
                </div>
            </div>
        {/if}
    </div>
{/if}

<style>
/* ── Loading screen ─────────────────────────────────────────────────── */
.loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100dvh;
    gap: 8px;
    background: var(--dc-bg-0);
}

.loading-logo {
    width: 80px;
    height: auto;
    opacity: 0.9;
}

.loading-status {
    font-size: 12px;
    color: var(--dc-text-3);
}

.loading-status.error {
    color: var(--dc-red-light);
}

/* ── App shell (fixed full height) ─────────────────────────────────── */
.app-shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 560px;
    margin: 0 auto;
    background: var(--dc-bg-0);
    /* no overflow:hidden — would clip the typeahead dropdown */
    position: relative;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--dc-border);
    flex-shrink: 0;
}

.header-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

.header-right {
    display: flex;
    align-items: center;
    gap: 6px;
}

.header-title {
    font-family: ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace;
    font-size: 14px;
    color: var(--dc-text-1);
    letter-spacing: 0.02em;
    line-height: 1;
}

.nav-btn {
    background: none;
    border: none;
    color: var(--dc-text-3);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.nav-btn:hover {
    color: var(--dc-text-1);
    background: var(--dc-bg-3);
}

.date-chip {
    font-size: 11px;
    color: var(--dc-text-3);
    background: var(--dc-bg-3);
    border-radius: 10px;
    padding: 1px 7px;
}

.participant-stack {
    display: flex;
    align-items: center;
}

.participant-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--dc-bg-0);
    margin-left: -6px;
    transition: transform 0.15s;
}

.participant-stack .participant-avatar:first-child { margin-left: 0; }
.participant-avatar:hover { transform: scale(1.15); z-index: 1; }

.user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--dc-bg-3);
}

.user-avatar-placeholder {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--dc-blurple);
    color: white;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* ── Player section ─────────────────────────────────────────────────── */
.player-section {
    padding: 10px 14px 6px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--dc-border);
}

/* ── Score strip ────────────────────────────────────────────────────── */
.score-section {
    padding: 6px 14px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--dc-border);
}

/* ── Cards list ─────────────────────────────────────────────────────── */
.cards-section {
    flex: 1;
    overflow-y: auto;
    padding: 6px 14px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    /* Custom scrollbar */
    scrollbar-width: thin;
    scrollbar-color: var(--dc-bg-4) transparent;
}

.cards-section::-webkit-scrollbar { width: 4px; }
.cards-section::-webkit-scrollbar-track { background: transparent; }
.cards-section::-webkit-scrollbar-thumb {
    background: var(--dc-bg-4);
    border-radius: 2px;
}

/* ── Input section (bottom — dropdown opens upward) ─────────────────── */
.input-section {
    padding: 8px 14px 12px;
    flex-shrink: 0;
    border-top: 1px solid var(--dc-border);
    background: var(--dc-bg-0);
    position: relative;
    z-index: 10; /* Paints above cards so upward dropdown is visible */
}

.search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
}

.give-up-btn {
    padding: 8px 14px;
    background-color: transparent;
    color: var(--dc-text-3);
    border: 1px solid var(--dc-border-strong);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
    transition: all 0.15s;
    letter-spacing: 0.02em;
}

.give-up-btn:hover {
    background-color: var(--dc-red);
    border-color: var(--dc-red);
    color: #fff;
}

/* ── Toast ──────────────────────────────────────────────────────────── */
.toast {
    position: fixed;
    bottom: 72px;
    left: 50%;
    transform: translateX(-50%);
    background-color: var(--dc-bg-3);
    color: var(--dc-text-1);
    border: 1px solid var(--dc-border-strong);
    padding: 10px 18px;
    border-radius: 8px;
    z-index: 100;
    cursor: pointer;
    max-width: 88%;
    text-align: center;
    font-size: 13px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    animation: slideUp 0.2s ease-out both;
}

/* ── Modals ─────────────────────────────────────────────────────────── */
.modal-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 300;
    display: flex;
    align-items: flex-end;
}

.modal-panel {
    width: 100%;
    max-height: 80dvh;
    background: var(--dc-bg-2);
    border-radius: 16px 16px 0 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--dc-border-strong);
}

.modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px 10px;
    border-bottom: 1px solid var(--dc-border);
    flex-shrink: 0;
}

.modal-header h2 {
    font-size: 15px;
    font-weight: 700;
    color: var(--dc-text-1);
}

.modal-close {
    background: none;
    border: none;
    color: var(--dc-text-3);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
    transition: color 0.15s, background 0.15s;
}

.modal-close:hover {
    color: var(--dc-text-1);
    background: var(--dc-bg-3);
}

.modal-body {
    padding: 14px 18px 20px;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.6;
    color: var(--dc-text-2);
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.modal-body h3 {
    font-size: 12px;
    font-weight: 700;
    color: var(--dc-text-1);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 4px;
}

.modal-body ul {
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.text-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--dc-blurple);
    text-decoration: underline;
    cursor: pointer;
}

.modal-body strong { color: var(--dc-text-1); }
</style>
