const fs = require('fs');
const path = require('path');

class Profile {
    constructor(baseDir) {
        const profilePath = path.join(baseDir, 'app-profile.json');
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
        } catch {
            raw = { mode: 'open' };
        }

        this.mode = raw.mode || 'open';
        this.filterFemale = raw.filterFemale || false;
        this.allowedSet = null;
        this.artistList = [];

        if (this.mode === 'curated' && raw.artistList) {
            const listPath = path.join(baseDir, 'data', raw.artistList);
            try {
                const artists = JSON.parse(fs.readFileSync(listPath, 'utf8'));
                this.artistList = artists.filter(a => {
                    if (this.filterFemale && a.female) return false;
                    return true;
                });
                this.allowedSet = new Set(this.artistList.map(a => a.artistId));
            } catch (err) {
                console.warn('[Profile] Failed to load artist list:', err.message);
                this.artistList = [];
                this.allowedSet = new Set();
            }
        }
    }

    getMode() {
        return this.mode;
    }

    isArtistAllowed(artistId) {
        if (this.mode === 'open') return true;
        if (!artistId) return false;
        return this.allowedSet.has(artistId);
    }

    getRandomArtists(count) {
        if (this.artistList.length === 0) return [];
        const shuffled = [...this.artistList].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, shuffled.length));
    }

    getProfile() {
        return { mode: this.mode };
    }
}

module.exports = Profile;
