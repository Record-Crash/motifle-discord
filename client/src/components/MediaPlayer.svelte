<script>
import { onDestroy } from 'svelte';
import { audioUrl } from '../assets.js';

export let game;

let audio;
let isPlaying = false;
let currentProgress = 0;
let currentTime = '00:00';
let duration = '00:00';
let hasStarted = false;

// Reload audio when song changes
let _lastSlug = null;
$: if (audio && game) {
    const slug = game.song.slug;
    console.log('[player] reactive game block fired', { slug, _lastSlug, sameSlug: slug === _lastSlug });
    if (slug !== _lastSlug) {
        _lastSlug = slug;
        audio.pause();
        audio.src = audioUrl(slug);
        audio.load();
        isPlaying = false;
        currentProgress = 0;
        currentTime = '00:00';
        duration = '00:00';
        hasStarted = false;
    }
}

onDestroy(() => {
    if (audio) audio.pause();
});

function togglePlay() {
    if (!audio) return;
    hasStarted = true;
    if (isPlaying) {
        audio.pause();
    } else {
        audio.play();
    }
    isPlaying = !isPlaying;
}

function stopSong() {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    isPlaying = false;
    currentProgress = 0;
    currentTime = '00:00';
    hasStarted = false;
}

let isSeeking = false;

function handleTimeUpdate() {
    if (!audio || !audio.duration || isSeeking) return;
    currentProgress = (audio.currentTime / audio.duration) * 100;
    currentTime = formatTime(audio.currentTime);
}

function handleLoaded() {
    if (audio && audio.duration) duration = formatTime(audio.duration);
}

function handleSeeking() {
    isSeeking = true;
    console.log('[player] audio seeking event', { audioTime: audio?.currentTime });
}

function handleSeeked() {
    isSeeking = false;
    console.log('[player] audio seeked event', { audioTime: audio?.currentTime });
    if (audio && audio.duration) {
        currentProgress = (audio.currentTime / audio.duration) * 100;
        currentTime = formatTime(audio.currentTime);
    }
}

function handleSeek(event) {
    if (!audio || !audio.duration || !hasStarted) {
        console.log('[player] handleSeek blocked', { hasAudio: !!audio, hasDuration: !!audio?.duration, hasStarted });
        return;
    }
    const pct = parseFloat(event.target.value);
    console.log('[player] handleSeek', { pct, isPlaying, audioTime: audio.currentTime.toFixed(2) });
    audio.currentTime = (pct / 100) * audio.duration;
    currentProgress = pct;
    currentTime = formatTime(audio.currentTime);
}

function handleEnded() {
    console.log('[player] ended');
    isPlaying = false;
    currentProgress = 0;
    currentTime = '00:00';
    hasStarted = false;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
</script>

<!-- svelte-ignore a11y-media-has-caption -->
<audio
    bind:this={audio}
    src={audioUrl(game.song.slug)}
    on:timeupdate={handleTimeUpdate}
    on:loadedmetadata={handleLoaded}
    on:ended={handleEnded}
    on:seeking={handleSeeking}
    on:seeked={handleSeeked}
></audio>

<div class="player">
    <button class="btn-play {isPlaying ? 'playing' : ''}" on:click={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {#if isPlaying}
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        {:else}
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5,3 19,12 5,21"/></svg>
        {/if}
    </button>

    <div class="track">
        <div class="track-bar-wrap">
            <div class="track-fill" style="width: {currentProgress}%"></div>
            <input
                type="range"
                class="track-input"
                min="0" max="100"
                value={currentProgress}
                disabled={!hasStarted}
                on:input={handleSeek}
                aria-label="Seek"
            />
        </div>
        <div class="track-time">
            <span>{currentTime}</span>
            <span class="track-duration">{duration}</span>
        </div>
    </div>

    <button class="btn-stop" on:click={stopSong} aria-label="Stop">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
    </button>
</div>

<style>
.player {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
}

.btn-play {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: var(--dc-blurple);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
}

.btn-play:hover { background: var(--dc-blurple-hover); transform: scale(1.06); }
.btn-play:active { transform: scale(0.96); }

.btn-play.playing {
    animation: pulse-ring 2s ease-in-out infinite;
}

.btn-stop {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: var(--dc-bg-3);
    color: var(--dc-text-3);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
}

.btn-stop:hover { background: var(--dc-bg-4); color: var(--dc-text-1); }

.track {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.track-bar-wrap {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--dc-bg-3);
    overflow: visible;
}

.track-fill {
    position: absolute;
    left: 0; top: 0;
    height: 100%;
    background: var(--dc-blurple);
    border-radius: 3px;
    pointer-events: none;
    transition: width 0.1s linear;
}

.track-input {
    position: absolute;
    inset: -6px 0;
    width: 100%;
    height: calc(100% + 12px);
    opacity: 0;
    cursor: pointer;
    margin: 0;
}

.track-input:disabled { cursor: default; }

/* Show a thumb knob on the fill end */
.track-bar-wrap:hover .track-fill::after {
    content: '';
    position: absolute;
    right: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 4px rgba(0,0,0,0.4);
}

.track-time {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--dc-text-3);
    font-variant-numeric: tabular-nums;
}

.track-duration { color: var(--dc-text-3); }
</style>
