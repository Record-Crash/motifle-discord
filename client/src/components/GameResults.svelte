<script>
    import { slide } from 'svelte/transition';
    import { onMount } from 'svelte';

    export let game;
    export let onReset = () => window.location.reload();
    export let openLink = (url) => window.open(url, '_blank');

    let countdownTime;
    let isCurrentGame;
    let artists = [];
    let copyLabel = 'Copy';

    onMount(() => {
        countdownTime = getHumanReadableUntilMidnightString();
        isCurrentGame = getIsCurrentGame();
        artists = getArtists();
    });

    $: if (game) {
        countdownTime = getHumanReadableUntilMidnightString();
        isCurrentGame = getIsCurrentGame();
        artists = getArtists();
    }

    const RARITY_EMOJI = { 5: '🟣', 4: '🟡', 3: '🟢', 2: '🔵', 1: '🩷' };

    function buildShareText() {
        const icon = game.status === 'won' ? '🎉' : '😔';
        const squares = game.displayedMotifs
            .map((m) => m.isGuessed ? (RARITY_EMOJI[m.rarity] ?? '🟪') : '⬛')
            .join('');
        return [
            `Motifle ${game.dateString} ${icon}`,
            `${game.nLeitmotifsGuessed}/${game.nTotalLeitmotifs} motifs · ${game.points} pts`,
            squares,
            `https://hsmusic.wiki/track/${game.song.slug}`,
        ].join('\n');
    }

    async function copyResults() {
        try {
            await navigator.clipboard.writeText(buildShareText());
            copyLabel = 'Copied!';
            setTimeout(() => (copyLabel = 'Copy'), 2000);
        } catch {
            copyLabel = 'Failed';
            setTimeout(() => (copyLabel = 'Copy'), 2000);
        }
    }

    function getIsCurrentGame() {
        const gameDate = new Date(game.dateString);
        const now = new Date();
        const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return gameDate.getTime() >= utcMidnight.getTime();
    }

    function deSlugify(name) {
        return name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    function getArtists() {
        return game.song.artist.map((artist) => {
            const name = artist.replace('artist:', '');
            return { label: deSlugify(name), url: `https://hsmusic.wiki/artist/${name}` };
        });
    }

    function getMinutesUntilMidnight() {
        const now = new Date();
        const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return Math.floor((utcMidnight.getTime() + 86400000 - now.getTime()) / 60000);
    }

    function getHumanReadableUntilMidnightString() {
        const mins = getMinutesUntilMidnight();
        const hrs = Math.floor(mins / 60);
        const rem = mins - hrs * 60;
        return hrs > 0 ? `in ${hrs} hours, ${rem} minutes` : `in ${mins} minutes`;
    }


</script>

{#if game}
    <div class="results {game.status}" in:slide={{ duration: 400 }}>
        <div class="results-header">
            <span class="result-icon">{game.status === 'won' ? '🎉' : '😔'}</span>
            <div class="result-title">
                <div class="result-headline">{game.status === 'won' ? 'Nice work!' : 'Better luck next time'}</div>
                <div class="result-song">
                    <button class="text-link" on:click={() => openLink(game.song.wikiUrl)}>{game.song.name}</button>
                    <span class="result-artist"> — {#each artists as a, i}<button class="text-link" on:click={() => openLink(a.url)}>{a.label}</button>{#if i < artists.length - 1}, {/if}{/each}</span>
                    <span class="result-album"> ({game.song.albumName})</span>
                </div>
            </div>
            <div class="result-pts">{game.points}<span class="result-pts-max">/{game.maxPoints}</span></div>
        </div>

        {#if isCurrentGame}
            <div class="result-countdown">Next puzzle {countdownTime}</div>
        {/if}

        <div class="result-actions">
            <button class="material-button copy" on:click={copyResults}>{copyLabel}</button>
            <button class="material-button wiki" on:click={() => openLink(game.song.wikiUrl)}>Wiki ↗</button>
            <button class="material-button reset" on:click={onReset}>Reset day</button>
        </div>
    </div>
{/if}

<style>
    .results {
        padding: 14px 16px 16px;
        border-top: 1px solid var(--dc-border);
        flex-shrink: 0;
    }

    .results.won  { background: rgba(45, 125, 70, 0.18); border-top-color: rgba(87, 171, 90, 0.4); }
    .results.lost { background: rgba(161, 40, 40, 0.18); border-top-color: rgba(218, 55, 60, 0.4); }

    .results-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
    }

    .result-icon { font-size: 22px; flex-shrink: 0; }

    .result-title { flex: 1; min-width: 0; }

    .result-headline {
        font-size: 13px;
        font-weight: 700;
        color: var(--dc-text-1);
    }

    .result-song {
        font-size: 12px;
        color: var(--dc-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .text-link {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--dc-text-1);
        font-weight: 600;
        text-decoration: underline;
        cursor: pointer;
    }

    .result-artist, .result-album { color: var(--dc-text-3); }

    .result-pts {
        font-size: 18px;
        font-weight: 700;
        color: var(--dc-text-1);
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
    }

    .result-pts-max { font-size: 12px; font-weight: 400; color: var(--dc-text-3); }

    .result-countdown {
        font-size: 11px;
        color: var(--dc-text-3);
        margin-bottom: 8px;
    }

    .result-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .material-button.reset {
        margin-left: auto;
        color: var(--dc-text-3);
    }
</style>
