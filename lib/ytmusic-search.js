const YTMusic = require('ytmusic-api');

class YTMusicSearch {
    constructor() {
        this.api = new YTMusic();
        this.initialized = false;
    }

    async ensureInit() {
        if (!this.initialized) {
            await this.api.initialize();
            this.initialized = true;
        }
    }

    async search(query) {
        await this.ensureInit();
        const results = await this.api.searchSongs(query);

        return results.map(song => ({
            videoId: song.videoId,
            title: song.name,
            artist: song.artist?.name || 'Unknown Artist',
            album: song.album?.name || '',
            duration: song.duration || 0,
            thumbnail: song.thumbnails?.[song.thumbnails.length - 1]?.url || ''
        }));
    }
}

module.exports = YTMusicSearch;
