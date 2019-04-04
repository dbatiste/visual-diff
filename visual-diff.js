const chalk = require('chalk');
const expect = require('chai').expect;
const fs = require('fs');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const polyserve = require('polyserve');
const FileHelper = require('./filehelper.js');

let _fs;

const visualDiff = {

	initialize: async function(options) {

		this._isGoldenUpdate = process.argv.includes('--golden');
		this._isCI = process.env['CI'];
		//this._isCI = true;

		_fs = new FileHelper(
			options.name,
			`${(options && options.dir) ? options.dir : process.cwd()}/screenshots`,
			options.upload,
			this._isCI
		);

		const serveOptions = {
			port: (options && options.port) ? options.port : 8081,
			npm: true,
			moduleResolution: 'node'
		};

		const server = await polyserve.startServer(serveOptions);
		const url = polyserve.getServerUrls(serveOptions, server).componentUrl;

		const baseUrl = `${url.protocol}://${url.hostname}:${url.port}/${url.pathname.replace(/\/$/, '')}`;
		this._serverInfo = Object.assign({baseUrl: baseUrl}, url);

		this.baseUrl = this._serverInfo.baseUrl;

		process.stdout.write(`Current target: ${_fs.getCurrentTarget()}\n`);
		process.stdout.write(`Golden target: ${_fs.getGoldenTarget()}\n\n`);
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
			await _fs.putCurrentFile(name);

			if (visualDiff._isGoldenUpdate) return visualDiff._updateGolden(name);
			else await visualDiff._compare(name);
		}

	},

	_compare: async function(name) {

		const goldenExists = await _fs.hasGoldenFile(name);
		expect(goldenExists, 'golden exists').equal(true);

		const currentImage = await _fs.getCurrentImage(name);
		const goldenImage = await _fs.getGoldenImage(name);

		expect(currentImage.width, 'image widths are the same').equal(goldenImage.width);
		expect(currentImage.height, 'image heights are the same').equal(goldenImage.height);

		const diff = new PNG({width: currentImage.width, height: currentImage.height});

		const numDiffPixels = pixelmatch(
			currentImage.data, goldenImage.data, diff.data, currentImage.width, currentImage.height, {threshold: 0.1}
		);

		if (numDiffPixels !== 0) {
			const diffName = `${name}-diff`;
			const diffPath = _fs.getCurrentPath(diffName);
			diff.pack().pipe(fs.createWriteStream(diffPath));
			_fs.putCurrentFile(diffName);
		}

		expect(numDiffPixels, 'number of different pixels').equal(0);

	},

	_deleteGoldenOrphans: async function() {

		process.stdout.write('Removed orphaned goldens.\n');

		const currentFiles = _fs.getCurrentFiles();
		const goldenFiles = await _fs.getGoldenFiles();

		for (let i = 0; i < goldenFiles.length; i++) {
			const fileName = goldenFiles[i];
			if (!currentFiles.includes(fileName)) {
				await _fs.removeGoldenFile(fileName);
				process.stdout.write(`${chalk.gray(fileName)}\n`);
			}
		}

		process.stdout.write('\n');

	},

	_updateGolden: async function(name) {

		const currentImage = await _fs.getCurrentImage(name);
		const goldenImage = await _fs.getGoldenImage(name);

		let updateGolden = false;
		if (!goldenImage) {
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

		process.stdout.write('      ');
		if (updateGolden) {
			const result = await _fs.updateGolden(name);
			if (result) process.stdout.write(chalk.gray('golden updated'));
			else process.stdout.write(chalk.gray('golden update failed'));
		} else {
			process.stdout.write(chalk.gray('golden already up to date'));
		}

	}

};

module.exports = visualDiff;
