import Service from "./service.mjs";
import Path from 'path';
import { log, run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';

export default class BundleService extends Service {

    async ensureBundleFile(repositorypath, bundleFilepath, req, res) {
        var bundleFile = Path.join(repositorypath, bundleFilepath)
        if (!await fs_exists(bundleFile)) {
            logRequest(req, "CREATE BUNDLE for " + repositorypath)
            await this.server.ensureDirectory(repositorypath, this.server.Config.optionsDir)
            let optionsDir = Path.join(repositorypath, this.server.Config.optionsDir)

            await this.server.ensureDirectory(repositorypath, this.server.Config.transpileDir)
            let transpileDir = Path.join(repositorypath, this.server.Config.transpileDir)

            try {
                var bootlist = (await fs_readFile(repositorypath + "/" + this.server.Config.bootfilelistName)).toString()
            } catch (e) {
                logRequest(req, "WARNING, could not read " + this.server.Config.bootfilelistName + ":" + e)
            }
            var relativeBootFiles = []
            var relativeOptionFiles = []
            var relativeTranspileFiles = []

            if (bootlist) {
                var hashed = new Map()
                for (let file of bootlist.split("\n")) {

                    let filehash = this.server.hashFilepath(file)
                    // logRequest(req, "filehash " + filehash)
                    hashed.set(filehash, file)

                    let filepath = Path.join(repositorypath, file)

                    var stats = await try_fs_stat(filepath)
                    if (!stats) {
                        logRequest(req, "ignore " + filepath)
                        continue;
                    }
                    let optionsFile = Path.join(optionsDir, filehash)
                    let transpileFile = Path.join(transpileDir, filehash)
                    let transpileMapFile = Path.join(transpileDir, filehash + ".json.map")

                    relativeBootFiles.push(file)

                    var optionsStats = await try_fs_stat(optionsFile)
                    if (!optionsStats || stats.mtime > optionsStats.mtime) {
                        var updatedOptions = await this.server.optionsService.readOptions(repositorypath, filepath, stats)
                        logRequest(req, "UPDATE OPTIONS " + optionsFile)
                        await fs_writeFile(optionsFile, JSON.stringify(updatedOptions, null, 2))
                    }
                    relativeOptionFiles.push(Path.join(this.server.Config.optionsDir, filehash))

                    let transpileStats = await try_fs_stat(transpileFile)
                    if (transpileStats) {
                        if (stats.mtime > transpileStats.mtime) {
                            logRequest(req, "DELETE " + transpileFile)
                            await DELETE.deletePath(transpileFile)
                        } else {
                            relativeTranspileFiles.push(Path.join(this.server.Config.transpileDir, filehash))
                        }
                    }
                    let transpileMapStats = await try_fs_stat(transpileMapFile)
                    if (transpileMapStats) {
                        if (stats.mtime > transpileMapStats.mtime) {
                            logRequest(req, "DELETE " + transpileMapFile)
                            await DELETE.deletePath(transpileMapFile)
                        } else {
                            relativeTranspileFiles.push(Path.join(this.server.Config.transpileDir, filehash + ".json.map"))

                        }
                    }
                }
            }

            let quoteList = function (list) {
                return list.map(ea => `"${ea}"`).join(" ")
            }

            var cmd = `cd ${repositorypath}; 
        if [ ! -e ${this.server.Config.bundleName} ]; then
          zip -r ${this.server.Config.bundleName} ${quoteList(relativeBootFiles)} ${quoteList(relativeOptionFiles)} ${quoteList(relativeTranspileFiles)};
        fi`
            // logRequest(req, "ZIP " + cmd)
            var result = await run(cmd)
            // logRequest(req, "stdout: " + result.stdout + "\nstderr: " + result.stderr)
        }
        return this.server.filesService.readFile(repositorypath, bundleFilepath, undefined, res)
    }


    async isInBootfile(repositorypath, filepath) {
        console.log("isInBootfile " + this.Config.bootfilelistName + " in " + repositorypath + " " + filepath)
        if (filepath.match(this.Config.bootfilelistName)) {
            return true // the bootfilelist always invalidates itself...
        }

        // costs... 10ms ... so #Refactor before using it every GET requests
        var result = (await run(`cd ${repositorypath}; 
        echo ${this.Config.bootfilelistName}
        if [ -e ${this.Config.bootfilelistName} ]; then
          grep ${filepath} ${this.Config.bootfilelistName}
        fi`)).stdout
        return result.match(filepath)
    }

    async invalidateBundleFile(repositorypath, filepath) {
        if (filepath.match(this.Config.transpileDir) // all compiled files are bundled?
            || await this.isInBootfile(repositorypath, filepath)) {
            log("INVALIDATE " + this.Config.bundleName + " in " + repositorypath)
            // remove bundle if we uploaded a file that belongs into it
            await this.deleteBundleFile(repositorypath)
        } else {
            log("NOTINBOOTFILE " + repositorypath + " " + filepath)
        }
    }

    async deleteBundleFile(repositorypath) {
        return await run(`cd ${repositorypath}; 
        if [ -e ${this.Config.bundleName} ]; then
          rm ${this.Config.bundleName}
        fi`)
    }

}