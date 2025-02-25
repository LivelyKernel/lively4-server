import Service from "./service.mjs";
import Path from 'path';
import { run, respondWithCMD, fs_stat, logRequest, try_fs_stat, fs_exists, fs_readFile, fs_writeFile } from '../utils.js';

export default class FilesService extends Service {


    async getLastModified(repositorypath, filepath) {
        return (await run(
            `cd "${repositorypath}"; find "${filepath}" -not -path '*/.git/*' -printf "%TY-%Tm-%Td %TH:%TM:%.2TS"`
        )).stdout;
    }
}