﻿import * as fs from "fs";
import * as path from "path";
import * as FtpClient from "ftp";
import * as JSZip from "jszip";
import * as mkdirp from "mkdirp";

const cisjr = "ftp.cisjr.cz";
//const cisjr = "10.0.1.138";
const jdfPath = "JDF";
const jdfFileName = "JDF.zip";
const localDataPath = "data";
const localJdfPath = path.join(localDataPath, jdfFileName);
const remoteJdfPath = path.posix.join(jdfPath, jdfFileName);
const linePrefix = "100";
const myLines = ["103", "348", "368", "369", "514"];

const mkdir = (dir: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        mkdirp(dir, function (err, made) {
            if (err) {
                reject(err);
            }
            else {
                resolve(made);
            }
        });
    });
};

const indexOfJdf = (list: FtpClient.ListingElement[]): number => {
    for (let i = 0; i < list.length; i++) {
        if (list[i].name === jdfFileName) {
            return i;
        }
    }
    return -1;
};

const getFileStat = (thepath: string): Promise<fs.Stats> => {
    return new Promise((resolve) => {
        fs.stat(thepath, (err, stats) => {
            if (err) {
                resolve(null);
            } else {
                resolve(stats);
            }
        });
    });
};

const getJdf = (localStat: fs.Stats): Promise<fs.Stats> => {
    return new Promise((resolve) => {
        const ftp = new FtpClient();

        ftp.on("error", (err) => {
            ftp.end();
            console.log(err);
            resolve(localStat);
        });

        ftp.on("ready", () => {
            ftp.list(jdfPath, (err, list) => {
                if (err) {
                    ftp.end();
                    console.log(err);
                    resolve(localStat);
                } else {
                    const index = indexOfJdf(list);
                    if (index >= 0) {
                        const remoteStat = list[indexOfJdf(list)];
                        if (localStat
                            && (localStat.size === parseInt(remoteStat.size)
                                && localStat.mtime.getTime() == remoteStat.date.getTime())) {
                            ftp.end();
                            resolve(localStat);
                        } else {
                            ftp.get(remoteJdfPath, (err, stream) => {
                                if (err) {
                                    ftp.end();
                                    console.log(err);
                                    resolve(localStat);
                                } else {
                                    stream.once("close", () => {
                                        ftp.end();
                                    });
                                    stream.pipe(fs.createWriteStream(localJdfPath).once("close", () => {
                                        fs.utimesSync(localJdfPath, new Date, remoteStat.date);
                                        resolve(getFileStat(localJdfPath));
                                    }));
                                }
                            });
                        }
                    } else {
                        ftp.end();
                        resolve(localStat);
                    }
                }
            });
        });

        ftp.connect({
            // secure: true,
            // secureOptions: {
            //     rejectUnauthorized: false
            // },
            // user: "",
            // password: "",
            host: cisjr
        });
    });
};

const unzipJdf = (stats: fs.Stats): Promise<JSZip> => {
    return new Promise((resolve, reject) => {
        if (stats) {
            const jszip = new JSZip();
            fs.readFile(localJdfPath, function (err, data) {
                if (err) {
                    reject(err);
                };
                resolve(jszip.loadAsync(data));
            });
        } else {
            reject("Error: The system cannot find the file specified.");
        }
    });
};

const unzipFile = (file: JSZipObject): Promise<string> => {
    return new Promise((resolve, reject) => {
        file.async("nodebuffer").then(function success(content) {
            const jszip = new JSZip();
            jszip.loadAsync(content).then((zip) => {
                const files = zip.files;
                files["Linky.txt"].async("string").then((line: string) => {
                    const lines = myLines.map((el) => linePrefix + el);
                    line = line.split(",")[0].replace(/"/g, "");

                    if (lines.indexOf(line) >= 0) {
                        const folder = path.basename(file.name, path.extname(file.name));
                        const destination = path.join(localDataPath, jdfPath, folder);
                        //todo: delete old folders!
                        mkdir(destination).then(() => {
                            const promises: Promise<string>[] = [];
                            for (let key in files) {
                                if (files.hasOwnProperty(key)) {
                                    const f = files[key];
                                    const promise = new Promise((resolve, reject) => {
                                        f["nodeStream"]()
                                            .pipe(fs.createWriteStream(path.join(destination, f.name)))
                                            .on("finish", () => {
                                                resolve(f.name);
                                            })
                                            .on("error", (e) => {
                                                reject(e);
                                            });
                                    });
                                    promises.push(promise);
                                }
                            }

                            Promise.all(promises).then(() => {
                                resolve(file.name);
                            });
                        }).catch((e) => {
                            reject(e);
                        });
                    } else {
                        resolve(null);
                    }
                });
            });
        }, function error(e) {
            reject(e);
        });
    });
};

const unzipFiles = (zip: JSZip): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const files = zip.files;
        const promises: Promise<string>[] = [];
        for (let key in files) {
            if (files.hasOwnProperty(key)) {
                const file = files[key];
                promises.push(unzipFile(file));
            }
        }

        resolve(Promise.all(promises));
    });
};

mkdir(localDataPath).then(() => localJdfPath).then(getFileStat).then(getJdf).then(unzipJdf).then(unzipFiles).then((lines) => {
    lines.filter((el) => !!el).forEach(el => {
        console.log(el);
    });
}).catch((e) => {
    setTimeout(() => {
        throw e;
    });
});
