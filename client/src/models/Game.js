export const GAME_STATUS = {
    ONGOING: 'ongoing',
    WON: 'won',
    LOST: 'lost'
};

export const RARITY_POINTS = {
    1: 500,
    2: 250,
    3: 175,
    4: 125,
    5: 100
};

const EPOCH = new Date('2023-08-09T00:00:00Z');

class Game {
    constructor(dateString, songsArray, motifsArray) {
        this.dateString = dateString;
        this.song = Game.songForDate(songsArray, dateString);
        this.submittedMotifs = [];
        this.displayedMotifs = this.initializeDisplayedMotifs(motifsArray);
        this.status = GAME_STATUS.ONGOING;
        this.errorCount = 0;
        this.maxPoints = this.initializeMaxPoints();
        this.maxErrors = this.initializeMaxErrors();
    }

    static songForDate(songsArray, dateString) {
        const date = new Date(dateString + 'T00:00:00Z');
        const days = Math.round((date - EPOCH) / (1000 * 60 * 60 * 24));
        const index = ((days % songsArray.length) + songsArray.length) % songsArray.length;
        return songsArray[index];
    }

    get submittedMotifSlugs() {
        return this.submittedMotifs.map((motif) => motif.slug);
    }

    get isGuessed() {
        return this.displayedMotifs.length > 0 &&
            this.displayedMotifs.every((motif) => motif.isGuessed);
    }

    get isGameActive() {
        return this.status === GAME_STATUS.ONGOING;
    }

    get points() {
        const pointsSum = this.displayedMotifs.reduce((acc, motif) => {
            if (motif.isGuessed) return acc + motif.points;
            return acc;
        }, 0);
        return Math.max(pointsSum - (this.errorCount * 1), 0);
    }

    get nLeitmotifsGuessed() {
        return this.displayedMotifs.reduce((acc, motif) => {
            if (motif.isGuessed) return acc + 1;
            return acc;
        }, 0);
    }

    get nTotalLeitmotifs() {
        return this.displayedMotifs.length;
    }

    hydrateWithObject(gameObject) {
        this.dateString = gameObject.dateString;
        const newGameObjectSong = gameObject.song;
        const sameSong = this.song.slug === newGameObjectSong.slug;
        const sameLeitmotifs = this.song.leitmotifs.every((leitmotifSlug) => newGameObjectSong.leitmotifs.includes(leitmotifSlug));
        const sameSamples = !this.song.samples || this.song.samples.every((sampleSlug) => newGameObjectSong.samples.includes(sampleSlug));
        if (!sameSong || !sameLeitmotifs || !sameSamples) {
            console.error(`Game.hydrateWithObject: song data ${gameObject.dateString} does not match, ignoring existing data`);
            return;
        }
        this.song = gameObject.song;
        this.submittedMotifs = gameObject.submittedMotifs;
        this.displayedMotifs = gameObject.displayedMotifs;
        this.status = gameObject.status;
        this.errorCount = gameObject.errorCount;
        this.maxPoints = gameObject.maxPoints || this.initializeMaxPoints();
        this.maxErrors = gameObject.maxErrors || this.initializeMaxErrors();
        // Re-check terminal conditions in case the save had an inconsistent status
        // (e.g. saved as 'ongoing' even though all motifs were guessed).
        if (this.status === GAME_STATUS.ONGOING) {
            this.checkGameEnd();
        }
    }

    initializeMaxPoints() {
        return this.displayedMotifs.reduce((acc, motif) => {
            return acc + (RARITY_POINTS[motif.rarity] || 0);
        }, 0);
    }

    initializeMaxErrors() {
        return Math.min(Math.max(this.displayedMotifs.length - 1, 3), 10);
    }

    checkBallpark(motif) {
        const ballparkList = [
            ['doctor', 'doctor-original-loop'],
            ['flare', 'flare-cascade'],
            ['cascade', 'cascade-beta'],
            ['showtime-original-mix', 'showtime-piano-refrain', 'showtime-imp-strife-mix'],
            ['three-in-the-morning', '3-in-the-morning-pianokind', 'three-in-the-morning-rj'],
            ['liquid-negrocity', 'black'],
            ['sunsetter', 'sunslammer'],
            ['MeGaLoVania', 'megalovania-halloween', 'megalovania-undertale'],
            ['dissension-original', 'dissension-remix'],
            ['black-hole-green-sun', 'black-rose-green-sun'],
            ['sburban-jungle', 'sburban-jungle-brief-mix', 'sburban-countdown'],
            ['harlequin', 'harleboss', 'hardlyquin'],
            ['verdancy-bassline', 'kinetic-verdancy'],
            ['beatdown-strider-style', 'strider-showdown-loop'],
            ['chorale-for-jaspers', 'hardchorale'],
            ['the-ballad-of-jack-noir-original', 'the-ballad-of-jack-noir'],
            ['hauntjelly', 'hauntjam'],
            ['carefree-victory', 'carefree-action'],
            ['atomyk-ebonpyre', 'tribal-ebonpyre'],
            ['guardian', 'guardian-v2'],
            ['endless-climb', 'clockwork-melody'],
            ['homestuck', 'elevatorstuck', 'homestuck-anthem'],
            ['skaian-skirmish', 'skaian-skuffle'],
            ['savior-of-the-waking-world', 'savior-of-the-dreaming-dead', 'penumbra-phantasm'],
            ['courser', 'umbral-ultimatum', 'an-unbreakable-union'],
            ['skaian-flight', 'skaian-overdrive', 'skaian-ride', 'skaian-happy-flight'],
            ['pumpkin-cravings', 'this-pumpkin'],
            ['crystamanthequins', 'crystalanthemums', 'crystalanthology'],
            ['lotus-bloom', 'lotus', 'lotus-land-story'],
            ['how-do-i-live', 'how-do-i-live-bunny-back-in-the-box-version'],
            ['ruins', 'ruins-with-strings'],
            ['the-beginning-of-something-really-excellent', 'gardener'],
            ['candles-and-clockwork-alpha-version', 'candles-and-clockwork'],
            ['karkats-theme', 'crustacean'],
            ['terezis-theme', 'the-lemonsnout-turnabout'],
            ['arisen-anew', 'psych0ruins'],
            ['nepetas-theme', 'walls-covered-in-blood'],
            ['virgin-orb', 'darling-kanaya'],
            ['the-la2t-frontiier', 'the-blind-prophet'],
            ['vriskas-theme', 'spiders-claw'],
            ['alternia', 'theme'],
            ['ocean-stars', 'ocean-stars-falling'],
            ['clockwork-apocalypse', 'clockwork-reversal'],
            ['eternity-served-cold', 'english'],
            ['i-dont-want-to-miss-a-thing-aerosmith', 'i-dont-want-to-miss-a-thing'],
            ['wsw-beatdown', 'walk-stab-walk-rande'],
            ['horschestra-STRONG-version', 'horschestra'],
            ['trollcops', 'under-the-hat'],
            ['serenade', 'requited'],
            ['hate-you', 'love-you-feferis-theme'],
            ['im-a-member-of-the-midnight-crew-acapella', 'im-a-member-of-the-midnight-crew'],
            ['stress', 'five-four-stress'],
            ['in-the-beginning', 'contact'],
            ['moshi-moshi', 'stay-in-touch'],
        ];
        let notAlreadyGuessedSlugs = this.displayedMotifs
            .filter((displayedMotif) => !displayedMotif.isGuessed)
            .map((displayedMotif) => displayedMotif.slug.replace('track:', ''));
        const motifSlug = motif.slug.replace('track:', '');
        return ballparkList.some((list) =>
            list.includes(motifSlug) && list.some((slug) => notAlreadyGuessedSlugs.includes(slug))
        );
    }

    checkSamples(motif) {
        if (!this.song.samples) return false;
        return this.song.samples.includes(motif.slug);
    }

    submitMotif(motif) {
        let success = 'error';
        if (motif.slug === `track:${this.song.slug}`) return 'same';

        this.submittedMotifs.push(motif);
        const submittedMotif = this.submittedMotifs.find((m) => m.slug === motif.slug);
        const displayedMotifToUpdate = this.displayedMotifs.find((m) => m.slug === motif.slug);

        if (displayedMotifToUpdate) {
            displayedMotifToUpdate.isGuessed = true;
            submittedMotif.isGuessed = true;
            success = 'success';
        } else {
            if (this.checkSamples(motif)) success = 'sample';
            else if (!this.checkBallpark(motif)) this.errorCount++;
            else success = 'partial';
        }

        this.checkGameEnd();
        return success;
    }

    checkGameEnd() {
        if (this.errorCount >= this.maxErrors) {
            this.endGame(GAME_STATUS.LOST);
        } else if (this.isGuessed) {
            this.endGame(GAME_STATUS.WON);
        }
    }

    endGame(result) {
        this.status = result;
    }

    initializeDisplayedMotifs(motifsArray) {
        let motifObjects = this.song.leitmotifs.map((leitmotifSlug) =>
            motifsArray.find((motif) => motif.slug === leitmotifSlug)
        );
        motifObjects.sort((a, b) => b.rarity - a.rarity);
        motifObjects = motifObjects.filter((motif) => motif);
        return motifObjects.map((motif) => ({
            ...motif,
            points: RARITY_POINTS[motif.rarity],
            isGuessed: false,
        }));
    }
}

export default Game;
