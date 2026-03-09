class ResolveBridge {
    constructor(resolveObj, workflowIntegration) {
        this.resolve = resolveObj;
        this.wi = workflowIntegration;
    }

    async getMediaPool() {
        const project = await this.resolve.GetProjectManager()
            .then(pm => pm.GetCurrentProject());
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
            const mediaStorage = await this.resolve.GetMediaStorage();
            if (!mediaStorage) return false;
            const result = await mediaStorage.AddItemListToMediaPool([filePath]);
            return !!result;
        } catch (e) {
            console.error('Import to Media Pool failed:', e);
            return false;
        }
    }

    async addToTimeline(filePath) {
        try {
            const imported = await this.importToMediaPool(filePath);
            if (!imported) return false;

            const mediaPool = await this.getMediaPool();
            if (!mediaPool) return false;

            const currentFolder = await mediaPool.GetCurrentFolder();
            if (!currentFolder) return false;

            const clips = await currentFolder.GetClipList();
            if (!clips || clips.length === 0) return false;

            // Get the last added clip and append to timeline
            const lastClip = clips[clips.length - 1];
            const pm = await this.resolve.GetProjectManager();
            const project = await pm.GetCurrentProject();
            const timeline = await project.GetCurrentTimeline();

            if (timeline) {
                await mediaPool.AppendToTimeline([lastClip]);
            }
            return true;
        } catch (e) {
            console.error('Add to Timeline failed:', e);
            return false;
        }
    }
}

module.exports = ResolveBridge;
