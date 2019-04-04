const fs = require('fs');
const PNG = require('pngjs').PNG;
const S3Helper = require('./s3helper.js');

class FileHelper {

	constructor(name, rootDir, s3Config, isCI) {
		this.s3 = new S3Helper(name, s3Config, isCI);
		this.isCI = isCI;
		this.rootDir = rootDir;
		this.currentDir = `${rootDir}/current`;
		this.goldenDir = `${rootDir}/golden`;

		if (!fs.existsSync(this.rootDir)) fs.mkdirSync(this.rootDir);
		if (this.isCI) this.cleanDir(this.goldenDir);
		if (!fs.existsSync(this.goldenDir)) fs.mkdirSync(this.goldenDir);
		this.cleanDir(this.currentDir);
		if (!fs.existsSync(this.currentDir)) fs.mkdirSync(this.currentDir);
	}

	cleanDir(path, remove) {
		if (fs.existsSync(path)) {
			const files = fs.readdirSync(path);
			files.forEach((file) => {
				const currentPath = `${path}/${file}`;
				if (fs.lstatSync(currentPath).isDirectory()) {
					this.cleanDir(currentPath, true);
				} else {
					fs.unlinkSync(currentPath);
				}
			});
			if (remove) fs.rmdirSync(path);
		}
	}

	formatName(name) {
		return name.replace(/ /g, '-');
	}

	getCurrentFiles() {
		return fs.readdirSync(this.currentDir);
	}

	async getGoldenFiles() {
		if (this.isCI) {
			return await this.s3.getGoldenFileList();
		} else {
			return fs.readdirSync(this.goldenDir);
		}
	}

	getCurrentPath(name) {
		return `${this.currentDir}/${this.formatName(name)}${name.endsWith('.png') ? '' : '.png'}`;
	}

	getGoldenPath(name) {
		return `${this.goldenDir}/${this.formatName(name)}${name.endsWith('.png') ? '' : '.png'}`;
	}

	getCurrentTarget() {
		return this.isCI ? this.s3.currentConfig.target : this.currentDir;
	}

	getGoldenTarget() {
		return this.isCI ? this.s3.goldenConfig.target : this.goldenDir;
	}

	getCurrentImage(name) {
		return this.getImage(this.getCurrentPath(name));
	}

	async getGoldenImage(name) {
		const hasGoldenFile = await this.hasGoldenFile(name);
		if (!hasGoldenFile) return null;
		return await this.getImage(this.getGoldenPath(name));
	}

	getImage(path) {
		return new Promise((resolve) => {
			const image = fs.createReadStream(path).pipe(new PNG()).on('parsed', () => {
				resolve(image);
			});
		});
	}

	async hasGoldenFile(name) {
		const goldenPath = this.getGoldenPath(name);
		if (this.isCI) {
			await this.s3.getGoldenFile(goldenPath);
		}
		return fs.existsSync(goldenPath);
	}

	async putCurrentFile(name) {
		if (!this.isCI) return;
		await this.s3.uploadCurrentFile(this.getCurrentPath(name));
	}

	async putGoldenFile(name) {
		if (!this.isCI) return;
		await this.s3.uploadGoldenFile(this.getGoldenPath(name));
	}

	async removeGoldenFile(name) {
		const path = this.getGoldenPath(name);
		if (this.isCI) await this.s3.deleteGoldenFile(path);
		if (fs.existsSync(path)) fs.unlinkSync(path);
	}

	async updateGolden(name) {
		if (!fs.existsSync(this.getCurrentPath(name))) return false;
		fs.copyFileSync(this.getCurrentPath(name), this.getGoldenPath(name));
		await this.putGoldenFile(name);
		return true;
	}

}

module.exports = FileHelper;
