import Service from "./service.mjs";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile} from '../utils.js';

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
            var updatedOptions = await this.server.readOptions(repositorypath, filepath, stats)
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

        // DELETE not unused options/transpiled caches
        // should not be needed, because.... it will not end up in zip anyway...

        // for (let optionfile of fs.readdirSync(optionsDir)) {
        //   if (!hashed.get(optionfile)) {
        //     let filePath =  optionsDir + "/" +optionfile
        //     logRequest(req, "delete " + filePath)
        //     await DELETE.deletePath(filePath)
        //   } 
        // }
        // for (let transpiledfile of fs.readdirSync(transpileDir)) {
        //   let filePath =  transpileDir + "/" +transpiledfile
        //   if (!hashed.get(transpiledfile)) {
        //     logRequest(req, "delete " + transpileDir + "/" + transpiledfile)
        //     await DELETE.deletePath(filePath)
        //   }
        //   if (!hashed.get(transpiledfile.replace(/\.json.map$/,""))) {
        //     logRequest(req, "delete " + transpileDir + "/" + transpiledfile)
        //     await DELETE.deletePath(filePath)
        //   }
        // }

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


}