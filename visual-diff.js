const chalk = require('chalk');
const expect = require('chai').expect;
const fs = require('fs');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const polyserve = require('polyserve');
const s3Helper = require('./s3-upload.js');

chalk.level = 3;

let _s3Config = {
	bucket: 'visualdiff.gaudi.d2l',
	key: 'S3',
	target: 'visualdiff.gaudi.d2l/screenshots',
	region: 'ca-central-1',
	creds: {
		accessKeyId: process.env['S3ID'],
		secretAccessKey: process.env['S3KEY']
	}
};
let _s3Current = {}, _s3Golden = {};

const visualDiff = {

	compare: async function(name) {
		await this._compare(this._currentDir, this._goldenDir, name);
	},

	initialize: async function(options) {

		this._isCI = process.env['CI'];
		//this._isCI = false;
		this._isGoldenUpdate = process.argv.includes('--golden');
		this._testRoot = `${(options && options.dir) ? options.dir : process.cwd()}/screenshots`;
		this._currentDir = `${this._testRoot}/current`;
		this._goldenDir = `${this._testRoot}/golden`;
		this._port = (options && options.port) ? options.port : 8081;

		if (options.upload) _s3Config = Object.assign(_s3Config, options.upload);
		_s3Current = Object.assign(_s3Current, _s3Config, { target: `${_s3Config.target}/${options.name}/${this._getTimestamp('-', '.')}`});
		if (this._isCI) _s3Golden = Object.assign(_s3Golden, _s3Config, { target: `${_s3Config.target}/${options.name}/golden`});
		//if (this._isCI) _s3Golden = Object.assign(_s3Golden, _s3Config, { target: `${_s3Config.target}/${options.name}/golden.macos`});

		if (!fs.existsSync(this._testRoot)) fs.mkdirSync(this._testRoot);
		if (!fs.existsSync(this._currentDir)) fs.mkdirSync(this._currentDir);
		if (!fs.existsSync(this._goldenDir)) fs.mkdirSync(this._goldenDir);

		const serveOptions = {
			port: this._port,
			npm: true,
			moduleResolution: 'node'
		};

		const server = await polyserve.startServer(serveOptions);
		const url = polyserve.getServerUrls(serveOptions, server).componentUrl;

		this._serverInfo = Object.assign({
			baseUrl: `${url.protocol}://${url.hostname}:${url.port}/${url.pathname.replace(/\/$/, '')}`
		}, url);

		this.baseUrl = this._serverInfo.baseUrl;

		process.stdout.write(`Current target: ${this._isCI ? _s3Current.target : this._currentDir}\n`);
		process.stdout.write(`Golden target: ${this._isCI ? _s3Golden.target : this._goldenDir}\n\n`);
		process.stdout.write(`Started server with base: ${this._serverInfo.baseUrl}\n\n`);

		after(async() => {
			if (this._isGoldenUpdate) {
				await this._deleteOrphanedGoldens();
			}
			await server.close();
			process.stdout.write('Stopped server.\n');
		});

	},

	puppeteer: {

		getRect: async function(page, selector, margin) {
			margin = (margin !== undefined) ? margin : 10;
			return page.$eval(selector, (elem, margin) => {
				return {
					x: elem.offsetLeft - margin,
					y: elem.offsetTop - margin,
					width: elem.offsetWidth + (margin * 2),
					height: elem.offsetHeight + (margin * 2)
				};
			}, margin);
		},

		screenshotAndCompare: async function(page, name, options) {
			const info = Object.assign({path: visualDiff._getScreenshotPath(visualDiff._currentDir, name)}, options);
			await page.screenshot(info);
			await visualDiff._compare(visualDiff._currentDir, visualDiff._goldenDir, name);
		}

	},

	screenshotPath: function(name) {
		return this._getScreenshotPath(this._currentDir, name);
	},

	_compare: async function(currentDir, goldenDir, name) {

		if (this._isGoldenUpdate) {
			return this._updateGolden(currentDir, goldenDir, name);
		}

		const currentPath = this._getScreenshotPath(this._currentDir, name);
		const goldenPath = this._getScreenshotPath(this._goldenDir, name);

		const goldenExists = this._isCI ? await s3Helper.getFile(goldenPath, _s3Golden)
			: fs.existsSync(goldenPath);

		expect(fs.existsSync(goldenPath), 'golden exists').equal(true);

		const currentImage = await this._getImage(currentPath);
		const goldenImage = goldenExists ? await this._getImage(goldenPath) : null;

		expect(currentImage.width, 'image widths are the same').equal(goldenImage.width);
		expect(currentImage.height, 'image heights are the same').equal(goldenImage.height);

		const diff = new PNG({width: currentImage.width, height: currentImage.height});

		const numDiffPixels = pixelmatch(
			currentImage.data, goldenImage.data, diff.data, currentImage.width, currentImage.height, {threshold: 0.1}
		);

		if (numDiffPixels !== 0) {
			const diffPath = this._getScreenshotPath(this._currentDir, `${name}-diff`);
			diff.pack().pipe(fs.createWriteStream(diffPath));
			if (_s3Current) await s3Helper.uploadFile(diffPath, _s3Current);
		}

		expect(numDiffPixels, 'number of different pixels').equal(0);

	},

	_deleteOrphanedGoldens: async function() {

		process.stdout.write('Removed orphaned goldens.\n');

		const currentFiles = fs.readdirSync(this._currentDir);
		const goldenFiles = this._isCI ? await s3Helper.getFileList(_s3Golden)
			: fs.readdirSync(this._goldenDir);

		for (let i = 0; i < goldenFiles.length; i++) {
			const fileName = goldenFiles[i];
			if (!currentFiles.includes(fileName)) {
				if (this._isCI) {
					await s3Helper.deleteFile(`${this._goldenDir}/${this._formatName(fileName)}`, _s3Golden);
				} else {
					fs.unlinkSync(`${this._goldenDir}/${this._formatName(fileName)}`);
				}
				process.stdout.write(`${chalk.gray(fileName)}\n`);
			}
		}

		process.stdout.write('\n');

	},

	_formatName: function(name) {
		return name.replace(/ /g, '-');
	},

	_getImage: function(path) {
		return new Promise((resolve) => {
			const image = fs.createReadStream(path).pipe(new PNG()).on('parsed', () => {
				resolve(image);
			});
		});
	},

	_getScreenshotPath: function(dir, name) {
		return `${dir}/${this._formatName(name)}.png`;
	},

	_getTimestamp: function(dateDelim, timeDelim) {
		dateDelim = dateDelim ? dateDelim : '-';
		timeDelim = timeDelim ? timeDelim : ':';
		const date = new Date();
		const year = date.getUTCFullYear();
		const month = date.getUTCMonth() + 1;
		const day = date.getUTCDate();
		const hours = date.getUTCHours();
		const minutes = date.getUTCMinutes();
		const seconds = date.getUTCSeconds();
		const milliseconds = date.getUTCMilliseconds();
		return year + dateDelim
			+ (month < 10 ? '0' + month : month) + dateDelim
			+ (day < 10 ? '0' + day : day) + ' '
			+ (hours < 10 ? '0' + hours : hours) + timeDelim
			+ (minutes < 10 ? '0' + minutes : minutes) + timeDelim
			+ (seconds < 10 ? '0' + seconds : seconds) + '.'
			+ milliseconds;
	},

	_updateGolden: async function(currentDir, goldenDir, name) {

		const currentPath = this._getScreenshotPath(this._currentDir, name);
		const goldenPath = this._getScreenshotPath(this._goldenDir, name);

		const goldenExists = this._isCI ? await s3Helper.getFile(goldenPath, _s3Golden)
			: fs.existsSync(goldenPath);

		const currentImage = await this._getImage(currentPath);
		const goldenImage = goldenExists ? await this._getImage(goldenPath) : null;

		let updateGolden = false;
		if (!goldenExists) {
			updateGolden = true;
		} else if (currentImage.width !== goldenImage.width || currentImage.height !== goldenImage.height) {
			updateGolden = true;
		} else {
			const diff = new PNG({width: currentImage.width, height: currentImage.height});
			const numDiffPixels = pixelmatch(
				currentImage.data, goldenImage.data, diff.data, currentImage.width, currentImage.height, {threshold: 0.1}
			);
			if (numDiffPixels !== 0) updateGolden = true;
		}

		if (updateGolden) {
			if (this._isCI) {
				await s3Helper.uploadFile(currentPath, _s3Golden);
			} else {
				fs.copyFileSync(currentPath, goldenPath);
			}
		}

		process.stdout.write(`${chalk.gray(updateGolden ? '      golden updated' : '      golden already up to date')}`);

	}

};

module.exports = visualDiff;
