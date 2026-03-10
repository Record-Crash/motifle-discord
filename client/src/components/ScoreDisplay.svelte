<script>
    import { onMount } from 'svelte';

    export let game, displayedMotifs;

    let mounted = false;
    onMount(() => { mounted = true; });

    let points = 0;
    let maxPoints = 0;
    let nLeitmotifsGuessed = 0;
    let nTotalLeitmotifs = 0;
    let errorCount = 0;
    let shakeKey = 0;

    $: if (game || displayedMotifs) {
        if (mounted && game.errorCount > errorCount) shakeKey++;
        points = game.points;
        maxPoints = game.maxPoints;
        nLeitmotifsGuessed = game.nLeitmotifsGuessed;
        nTotalLeitmotifs = game.nTotalLeitmotifs;
        errorCount = game.errorCount;
    }
</script>

{#key shakeKey}
<div class={shakeKey > 0 ? 'strip shake' : 'strip'}>
    <!-- Error dots -->
    <div class="errors">
        {#each Array(game.maxErrors) as _, i}
            <div class="dot {i < errorCount ? 'filled' : ''}"></div>
        {/each}
    </div>

    <!-- Progress bar -->
    <div class="bar-wrap">
        <div
            class="bar-fill {nLeitmotifsGuessed === nTotalLeitmotifs ? 'complete' : ''}"
            style="width: calc(100% * {nLeitmotifsGuessed} / {nTotalLeitmotifs})"
        ></div>
        <span class="bar-label">{nLeitmotifsGuessed}/{nTotalLeitmotifs} motifs</span>
    </div>

    <!-- Points -->
    <div class="pts">{points}<span class="pts-max">/{maxPoints}</span></div>
</div>
{/key}

<style>
.strip {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 22px;
}

/* Error dots */
.errors {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}

.dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--dc-bg-4);
    transition: background 0.2s, transform 0.2s;
}

.dot.filled {
    background: var(--dc-red-light);
    animation: errorPop 0.35s ease-out both;
}

/* Progress bar */
.bar-wrap {
    flex: 1;
    position: relative;
    height: 20px;
    background: var(--dc-bg-3);
    border-radius: 4px;
    overflow: hidden;
}

.bar-fill {
    position: absolute;
    inset: 0;
    width: 0; /* overridden inline */
    background: var(--dc-blurple);
    border-radius: 4px;
    transition: width 0.5s ease-out;
}

.bar-fill.complete { background: var(--dc-green-light); }

.bar-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0,0,0,0.7);
    pointer-events: none;
    letter-spacing: 0.02em;
}

/* Points */
.pts {
    font-size: 14px;
    font-weight: 700;
    color: var(--dc-text-1);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
}

.pts-max {
    font-size: 11px;
    font-weight: 400;
    color: var(--dc-text-3);
}

/* Shake on error */
.shake { animation: shake 0.4s; }

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    15%  { transform: translateX(-5px); }
    30%  { transform: translateX(5px); }
    45%  { transform: translateX(-3px); }
    60%  { transform: translateX(3px); }
}

@keyframes errorPop {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.7); }
    70%  { transform: scale(0.8); }
    100% { transform: scale(1); }
}
</style>
