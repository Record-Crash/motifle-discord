<script>
    import { RARITY_POINTS } from '../models/Game.js';
    export let motif;
    export let forceReveal = false;
    export let currentGame;
    export let index = 0;
    export let guessers = [];

    const unknownImage = '/unknown.gif';
    const errorImage = '/error.gif';

    let imageError = false;

    $: revealed = motif.isGuessed || forceReveal;

    $: if (motif) imageError = false;

    function getUnknownString() {
        const rarityPoints = RARITY_POINTS[motif.rarity];
        switch (motif.rarity) {
            case 5: return `${rarityPoints} pts · Core`;
            case 4: return `${rarityPoints} pts · Common`;
            case 3: return `${rarityPoints} pts · Uncommon`;
            case 2: return `${rarityPoints} pts · Rare`;
            case 1: return `${rarityPoints} pts · Singular`;
            default: return 'Unknown';
        }
    }

    function getAlbumName() {
        const replacementsDict = { 'References Beyond Homestuck': 'Non-HS Reference' };
        let albumName = motif.albumName;
        if (albumName in replacementsDict) albumName = replacementsDict[albumName];
        return albumName;
    }

    $: displayName = currentGame && currentGame.errorCount > currentGame.maxErrors / 2
        ? `${getUnknownString()} (${getAlbumName()})`
        : getUnknownString();

    $: rarityClass = `raritybg${motif.rarity} rarity${motif.rarity}`;
</script>

<div
    class={`card ${rarityClass} ${motif.isGuessed ? 'isGuessed' : ''} ${forceReveal ? 'forceReveal' : ''}`}
    style="animation-delay: {index * 55}ms"
>
    <div class="card-inner">
        <div class="face front">
            <img src={unknownImage} class="card-img" alt="hidden" />
            <div class="card-text">
                <span class="card-label">{displayName}</span>
            </div>
        </div>
        <div class="face back">
            {#if revealed}
                <img
                    src={imageError ? errorImage : motif.imageUrl}
                    class="card-img"
                    alt={motif.name}
                    on:error={() => { imageError = true; }}
                />
            {:else}
                <img src={unknownImage} class="card-img" alt="hidden" />
            {/if}
            <div class="card-text">
                <span class="card-label">{revealed ? motif.name : displayName}</span>
            </div>
            {#if revealed && guessers.length > 0}
                <div class="guessers">
                    {#each guessers.slice(0, 3) as g}
                        <img
                            class="guesser-avatar"
                            src={g.avatar ? `https://cdn.discordapp.com/avatars/${g.userId}/${g.avatar}.png?size=32` : `https://cdn.discordapp.com/embed/avatars/0.png`}
                            alt={g.username}
                            title={g.username}
                        />
                    {/each}
                    {#if guessers.length > 3}
                        <div class="guesser-overflow">+{guessers.length - 3}</div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .card {
        perspective: 1000px;
        height: 76px;
        border-radius: 8px;
        position: relative;
        flex-shrink: 0;
        animation: cardIn 0.3s ease-out both;
        /* border-left comes from raritybg classes in style.css */
    }

    .card-inner {
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
        transition: transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
    }

    .face {
        position: absolute;
        inset: 0;
        backface-visibility: hidden;
        display: flex;
        align-items: center;
        padding: 0 12px;
        border-radius: 8px;
        /* transparent — card's raritybg shows through */
    }

    .front { transform: rotateX(0deg); }
    .back  { transform: rotateX(-180deg); }

    .card.isGuessed .card-inner,
    .card.forceReveal .card-inner {
        transform: rotateX(180deg);
    }

    .card.forceReveal {
        background-color: rgba(180, 40, 40, 0.25) !important;
        border-left-color: #da373c !important;
    }

    /* After flip, show shimmer on guessed cards */
    .card.isGuessed .back {
        background-image: linear-gradient(
            105deg,
            transparent 30%,
            rgba(255, 255, 255, 0.06) 50%,
            transparent 70%
        );
        background-size: 200% 100%;
        animation: shimmer 1.5s ease-out 0.45s both;
    }

    .card-img {
        width: 60px;
        height: 60px;
        object-fit: cover;
        border-radius: 4px;
        flex-shrink: 0;
        margin-right: 12px;
        background: var(--dc-bg-3);
    }

    .card-text {
        flex: 1;
        min-width: 0;
    }

    .card-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--dc-text-1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
    }

    .guessers {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        margin-left: 8px;
    }

    .guesser-avatar {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1.5px solid var(--dc-bg-2);
        margin-left: -6px;
        flex-shrink: 0;
    }

    .guessers .guesser-avatar:first-child { margin-left: 0; }

    .guesser-overflow {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--dc-bg-4);
        color: var(--dc-text-2);
        font-size: 9px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-left: -6px;
        border: 1.5px solid var(--dc-bg-2);
        flex-shrink: 0;
    }

    @keyframes cardIn {
        from { opacity: 0; transform: translateX(-12px); }
        to   { opacity: 1; transform: translateX(0); }
    }

    @keyframes shimmer {
        from { background-position: 200% center; }
        to   { background-position: -200% center; }
    }
</style>
