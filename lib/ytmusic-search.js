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

    async getHomeSections() {
        await this.ensureInit();
        const sections = await this.api.getHomeSections();

        return sections.map(section => ({
            title: section.title || '',
            items: (section.contents || []).map(item => ({
                type: item.type, // PLAYLIST, ALBUM, SONG
                id: item.playlistId || item.albumId || item.videoId || '',
                playlistId: item.playlistId || '',
                albumId: item.albumId || '',
                videoId: item.videoId || '',
                name: item.name || '',
                artist: item.artist?.name || '',
                artistId: item.artist?.artistId || '',
                thumbnail: item.thumbnails?.[item.thumbnails.length - 1]?.url || '',
                thumbnailSmall: item.thumbnails?.[0]?.url || '',
                year: item.year || null,
                duration: item.duration || null
            }))
        })).filter(s => s.items.length > 0);
    }

    async getPlaylistTracks(playlistId) {
        await this.ensureInit();
        const videos = await this.api.getPlaylistVideos(playlistId);

        return videos.map(v => ({
            videoId: v.videoId,
            title: v.name,
            artist: v.artist?.name || 'Unknown Artist',
            album: v.album?.name || '',
            duration: v.duration || 0,
            thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || ''
        }));
    }
}

module.exports = YTMusicSearch;
