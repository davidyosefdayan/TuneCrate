class ResolveBridge {
    constructor(resolveObj, workflowIntegration) {
        this.resolve = resolveObj;
        this.wi = workflowIntegration;
    }

    async getProject() {
        const pm = await this.resolve.GetProjectManager();
        if (!pm) return null;
        return await pm.GetCurrentProject();
    }

    async getMediaPool() {
        const project = await this.getProject();
        if (!project) return null;
        return await project.GetMediaPool();
    }

    async ensureBin(binName) {
        const mediaPool = await this.getMediaPool();
        if (!mediaPool) return null;

        const rootFolder = await mediaPool.GetRootFolder();
        if (!rootFolder) return null;

        // Check if bin exists
        const folders = await rootFolder.GetSubFolderList();
        if (folders) {
            for (const folder of folders) {
                const name = await folder.GetName();
                if (name === binName) {
                    await mediaPool.SetCurrentFolder(folder);
                    return folder;
                }
            }
        }

        // Create bin
        const newFolder = await mediaPool.AddSubFolder(rootFolder, binName);
        if (newFolder) {
            await mediaPool.SetCurrentFolder(newFolder);
        }
        return newFolder;
    }

    async importToMediaPool(filePath) {
        try {
            await this.ensureBin('YouTube Music');
            const mediaPool = await this.getMediaPool();
            if (!mediaPool) return null;
            const items = await mediaPool.ImportMedia([filePath]);
            if (!items || items.length === 0) return null;
            return items;
        } catch (e) {
            console.error('[Resolve] Import to Media Pool failed:', e);
            return null;
        }
    }

    async addToTimeline(filePath) {
        try {
            const mediaPoolItems = await this.importToMediaPool(filePath);
            if (!mediaPoolItems) return false;

            const mediaPool = await this.getMediaPool();
            if (!mediaPool) return false;

            const project = await this.getProject();
            if (!project) return false;

            // Ensure a timeline exists
            let timeline = await project.GetCurrentTimeline();
            if (!timeline) {
                const count = await project.GetTimelineCount();
                if (count > 0) {
                    timeline = await project.GetTimelineByIndex(1);
                    await project.SetCurrentTimeline(timeline);
                } else {
                    // Create a new timeline from the imported clips
                    timeline = await mediaPool.CreateTimelineFromClips('YouTube Music', mediaPoolItems);
                    return !!timeline;
                }
            }

            // Append as audio-only (mediaType 2)
            const result = await mediaPool.AppendToTimeline(mediaPoolItems.map(item => ({
                mediaPoolItem: item,
                mediaType: 2
            })));
            return !!(result && result.length > 0);
        } catch (e) {
            console.error('[Resolve] Add to Timeline failed:', e);
            return false;
        }
    }
}

module.exports = ResolveBridge;
