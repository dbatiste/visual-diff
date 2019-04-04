const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;

class FileHelper {

	constructor(rootDir) {
		this.rootDir = rootDir;
		this.currentDir = `${rootDir}/current`;
		this.goldenDir = `${rootDir}/golden`;

		if (!fs.existsSync(this.rootDir)) fs.mkdirSync(this.rootDir);
		if (!fs.existsSync(this.goldenDir)) fs.mkdirSync(this.goldenDir);
		this.removeDir(this.currentDir);
		if (!fs.existsSync(this.currentDir)) fs.mkdirSync(this.currentDir);
	}

	getCurrentFiles() {
		return fs.readdirSync(this.currentDir);
	}

	getGoldenFiles() {
		return fs.readdirSync(this.goldenDir);
	}

	getCurrentPath(name) {
		return `${this.currentDir}/${this.formatName(name)}${name.endsWith('.png') ? '' : '.png'}`;
	}

	getGoldenPath(name) {
		return `${this.goldenDir}/${this.formatName(name)}${name.endsWith('.png') ? '' : '.png'}`;
	}

	getImage(path) {
		return new Promise((resolve) => {
			const image = fs.createReadStream(path).pipe(new PNG()).on('parsed', () => {
				resolve(image);
			});
		});
	}

	formatName(name) {
		return name.replace(/ /g, '-');
	}

	removeDir(path) {
		let files = [];
		if(fs.existsSync(path) ) {
			files = fs.readdirSync(path);
			files.forEach((file,index) => {
				const curPath = path + "/" + file;
				if(fs.lstatSync(curPath).isDirectory()) {
					this.removeDir(curPath);
				} else {
					fs.unlinkSync(curPath);
				}
			});
			fs.rmdirSync(path);
		}
	}

};

module.exports = FileHelper;
