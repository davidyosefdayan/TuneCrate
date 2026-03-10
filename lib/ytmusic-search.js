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
            artistId: song.artist?.artistId || '',
            album: song.album?.name || '',
            albumId: song.album?.albumId || '',
            duration: song.duration || 0,
            thumbnail: song.thumbnails?.[song.thumbnails.length - 1]?.url || ''
        }));
    }

    async getHomeSections() {
        await this.ensureInit();
        const sections = await this.api.getHomeSections();

        return sections
            .filter(section => !/video/i.test(section.title || ''))
            .map(section => ({
                title: section.title || '',
                items: (section.contents || [])
                    .filter(item => item.type !== 'VIDEO')
                    .map(item => ({
                        type: item.type, // PLAYLIST, ALBUM, SONG
                        id: item.playlistId || item.albumId || item.videoId || '',
                        playlistId: item.playlistId || '',
                        albumId: item.albumId || '',
                        videoId: item.videoId || '',
                        name: item.name || '',
                        artist: item.artist?.name || '',
                        thumbnail: item.thumbnails?.[item.thumbnails.length - 1]?.url || '',
                        thumbnailSmall: item.thumbnails?.[0]?.url || '',
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
            artistId: v.artist?.artistId || '',
            album: v.album?.name || '',
            albumId: v.album?.albumId || '',
            duration: v.duration || 0,
            thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || ''
        }));
    }

    async getArtist(artistId) {
        await this.ensureInit();
        const artist = await this.api.getArtist(artistId);

        return {
            artistId: artist.artistId,
            name: artist.name,
            thumbnail: artist.thumbnails?.[artist.thumbnails.length - 1]?.url || '',
            topSongs: (artist.topSongs || []).map(song => ({
                videoId: song.videoId,
                title: song.name,
                artist: song.artist?.name || artist.name,
                artistId: song.artist?.artistId || artistId,
                album: song.album?.name || '',
                albumId: song.album?.albumId || '',
                duration: song.duration || 0,
                thumbnail: song.thumbnails?.[song.thumbnails.length - 1]?.url || ''
            })),
            topAlbums: (artist.topAlbums || []).map(album => ({
                albumId: album.albumId,
                playlistId: album.playlistId || '',
                name: album.name,
                year: album.year || null,
                thumbnail: album.thumbnails?.[album.thumbnails.length - 1]?.url || ''
            })),
            topSingles: (artist.topSingles || []).map(single => ({
                albumId: single.albumId,
                playlistId: single.playlistId || '',
                name: single.name,
                year: single.year || null,
                thumbnail: single.thumbnails?.[single.thumbnails.length - 1]?.url || ''
            }))
        };
    }

    async getArtistSongs(artistId) {
        await this.ensureInit();
        const songs = await this.api.getArtistSongs(artistId);

        return songs.map(song => ({
            videoId: song.videoId,
            title: song.name,
            artist: song.artist?.name || 'Unknown Artist',
            artistId: song.artist?.artistId || artistId,
            album: song.album?.name || '',
            albumId: song.album?.albumId || '',
            duration: song.duration || 0,
            thumbnail: song.thumbnails?.[song.thumbnails.length - 1]?.url || ''
        }));
    }

    async getAlbum(albumId) {
        await this.ensureInit();
        const album = await this.api.getAlbum(albumId);

        return {
            albumId: album.albumId,
            name: album.name,
            artist: album.artist?.name || 'Unknown Artist',
            artistId: album.artist?.artistId || '',
            year: album.year || null,
            thumbnail: album.thumbnails?.[album.thumbnails.length - 1]?.url || '',
            songs: (album.songs || []).map(song => ({
                videoId: song.videoId,
                title: song.name,
                artist: song.artist?.name || album.artist?.name || 'Unknown Artist',
                artistId: song.artist?.artistId || album.artist?.artistId || '',
                album: song.album?.name || album.name,
                albumId: song.album?.albumId || album.albumId,
                duration: song.duration || 0,
                thumbnail: song.thumbnails?.[song.thumbnails.length - 1]?.url || ''
            }))
        };
    }
}

module.exports = YTMusicSearch;
