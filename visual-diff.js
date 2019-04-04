const chalk = require('chalk');
const expect = require('chai').expect;
const fs = require('fs');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const polyserve = require('polyserve');
const FileHelper = require('./filehelper.js');
const S3Helper = require('./s3helper.js');

let _fs, _s3;

const visualDiff = {

	compare: async function(name) {
		await this._compare(_fs.currentDir, _fs.goldenDir, name);
	},

	initialize: async function(options) {

		this._isGoldenUpdate = process.argv.includes('--golden');
		this._isCI = process.env['CI'];
		//this._isCI = true;

		_fs = new FileHelper(`${(options && options.dir) ? options.dir : process.cwd()}/screenshots`);
		_s3 = new S3Helper(options.name, options.upload, this._isCI);

		this._port = (options && options.port) ? options.port : 8081;

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

		process.stdout.write(`Current target: ${this._isCI ? _s3.currentConfig.target : _fs.currentDir}\n`);
		process.stdout.write(`Golden target: ${this._isCI ? _s3.goldenConfig.target : _fs.goldenDir}\n\n`);
		process.stdout.write(`Started server with base: ${this._serverInfo.baseUrl}\n\n`);

		after(async() => {
			if (this._isGoldenUpdate) {
				await this._deleteGoldenOrphans();
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
			const info = Object.assign({path: _fs.getCurrentPath(name)}, options);
			await page.screenshot(info);
			await visualDiff._compare(_fs.currentDir, _fs.goldenDir, name);
		}

	},

	screenshotPath: function(name) {
		return _fs.getCurrentPath(name);
	},

	_compare: async function(currentDir, goldenDir, name) {

		if (this._isGoldenUpdate) {
			return this._updateGolden(currentDir, goldenDir, name);
		}

		const currentPath = _fs.getCurrentPath(name);
		const goldenPath = _fs.getGoldenPath(name);

		const goldenExists = this._isCI ? await _s3.getGoldenFile(goldenPath)
			: fs.existsSync(goldenPath);

		if (this._isCI) await _s3.uploadCurrentFile(currentPath);

		expect(goldenExists, 'golden exists').equal(true);

		const currentImage = await _fs.getImage(currentPath);
		const goldenImage = goldenExists ? await _fs.getImage(goldenPath) : null;

		expect(currentImage.width, 'image widths are the same').equal(goldenImage.width);
		expect(currentImage.height, 'image heights are the same').equal(goldenImage.height);

		const diff = new PNG({width: currentImage.width, height: currentImage.height});

		const numDiffPixels = pixelmatch(
			currentImage.data, goldenImage.data, diff.data, currentImage.width, currentImage.height, {threshold: 0.1}
		);

		if (numDiffPixels !== 0) {
			const diffPath = _fs.getCurrentPath(`${name}-diff`);
			diff.pack().pipe(fs.createWriteStream(diffPath));
			if (this._isCI) await _s3.uploadCurrentFile(diffPath);
		}

		expect(numDiffPixels, 'number of different pixels').equal(0);

	},

	_deleteGoldenOrphans: async function() {

		process.stdout.write('Removed orphaned goldens.\n');

		const currentFiles = _fs.getCurrentFiles();
		const goldenFiles = this._isCI ? await _s3.getGoldenFileList() : _fs.getGoldenFiles();

		for (let i = 0; i < goldenFiles.length; i++) {
			const fileName = goldenFiles[i];
			if (!currentFiles.includes(fileName)) {
				if (this._isCI) {
					await _s3.deleteGoldenFile(_fs.getGoldenPath(fileName));
				} else {
					fs.unlinkSync(_fs.getGoldenPath(fileName));
				}
				process.stdout.write(`${chalk.gray(fileName)}\n`);
			}
		}

		process.stdout.write('\n');

	},

	_updateGolden: async function(currentDir, goldenDir, name) {

		const currentPath = _fs.getCurrentPath(name);
		const goldenPath = _fs.getGoldenPath(name);

		const goldenExists = this._isCI ? await _s3.getGoldenFile(goldenPath)
			: fs.existsSync(goldenPath);

		const currentImage = await _fs.getImage(currentPath);
		const goldenImage = goldenExists ? await _fs.getImage(goldenPath) : null;

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
				await _s3.uploadGoldenFile(currentPath);
			} else {
				fs.copyFileSync(currentPath, goldenPath);
			}
		}

		process.stdout.write(`${chalk.gray(updateGolden ? '      golden updated' : '      golden already up to date')}`);

	}

};

module.exports = visualDiff;
