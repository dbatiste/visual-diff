const chalk = require('chalk');
const expect = require('chai').expect;
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

		const currentImage = await _fs.getCurrentImage(name);
		const goldenImage = await _fs.getGoldenImage(name);
		let pixelsDiff = 0;

		if (goldenImage && currentImage.width === goldenImage.width && currentImage.height === goldenImage.height) {
			const diff = new PNG({width: currentImage.width, height: currentImage.height});
			pixelsDiff = pixelmatch(
				currentImage.data, goldenImage.data, diff.data, currentImage.width, currentImage.height, {threshold: 0.1}
			);
			if (pixelsDiff !== 0) await _fs.writeCurrentStream(`${name}-diff`, diff.pack());
		}

		await this._generateHtml(name, {
			current: currentImage,
			golden: goldenImage,
			pixelsDiff: pixelsDiff
		});

		expect(goldenImage !== null, 'golden exists').equal(true);
		expect(currentImage.width, 'image widths are the same').equal(goldenImage.width);
		expect(currentImage.height, 'image heights are the same').equal(goldenImage.height);
		expect(pixelsDiff, 'number of different pixels').equal(0);

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

	_generateHtml: async function(name, info) {
		const currentUrl = _fs.getCurrentUrl(name);
		const diffUrl = _fs.getCurrentUrl(`${name}-diff`);
		let goldenUrl = _fs.getGoldenUrl(name);
		goldenUrl = goldenUrl.startsWith('https://s3.') ? goldenUrl : `../golden/${goldenUrl}`;
		const createArtifactHtml = (info) => {
			return `<div>
					<div class="label">${info.name} (${info.meta})</div>
					<img src="${info.url}" alt="${info.name}" />
				</div>`;
		};
		const html = `
			<html>
				<style>
					html { font-size: 20px; }
					body { font-family: sans-serif; background-color: #333; color: #fff; margin: 18px; }
					h1 { font-size: 1.2rem; font-weight: 400; margin: 24px 0; }
					.compare { display: flex; }
					.compare > div:first-child { margin-right: 9px; }
					.compare > div:last-child { margin-left: 9px; }
					.label { display: flex; font-size: 0.8rem; margin-bottom: 6px; }
				</style>
				<body>
					<h1>Visual Diff: ${name}</h1>
					<div class="compare">
						${createArtifactHtml({name: 'Current', meta: `w:${info.current.width} x h:${info.current.height}`, url: currentUrl})}
						${info.golden ? createArtifactHtml({name: 'Golden', meta: `w:${info.golden.width} x h:${info.golden.height}`, url: goldenUrl}) : 'Missing Golden'}
						${info.pixelsDiff > 0 ? createArtifactHtml({name: 'Difference', meta: `${info.pixelsDiff} pixels`, url: diffUrl}) : ''}
					</div>
				</body>
			</html>`;
		await _fs.writeCurrentFile(`${name}.html`, html);
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
			const pixelsDiff = pixelmatch(
				currentImage.data, goldenImage.data, diff.data, currentImage.width, currentImage.height, {threshold: 0.1}
			);
			if (pixelsDiff !== 0) updateGolden = true;
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
