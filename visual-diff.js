const chalk = require('chalk');
const expect = require('chai').expect;
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const polyserve = require('polyserve');
const FileHelper = require('./filehelper.js');

const _isGoldenUpdate = process.argv.includes('--golden') ? process.argv.includes('--golden') : false;
const _isCI = process.env['CI'] ? true : false;
//const _isCI = true;
const _serverOptions = {npm: true, moduleResolution: 'node'};

let _server;
let _serverInfo;

before(async() => {
	_server = await polyserve.startServer(_serverOptions);
	const url = polyserve.getServerUrls(_serverOptions, _server).componentUrl;

	const baseUrl = `${url.protocol}://${url.hostname}:${url.port}/${url.pathname.replace(/\/$/, '')}`;
	_serverInfo = Object.assign({baseUrl: baseUrl}, url);
	process.stdout.write(`Started server with base: ${_serverInfo.baseUrl}\n\n`);
});

after(async() => {
	if (_server) {
		await _server.close();
		process.stdout.write('Stopped server.\n');
	}
});

class VisualDiff {

	constructor(name, dir, options) {

		this._fs = new FileHelper(name, `${dir ? dir : process.cwd()}/screenshots`, options ? options.upload : null, _isCI);

		before(() => {
			let currentTarget = this._fs.getCurrentTarget();
			let goldenTarget = this._fs.getGoldenTarget();
			if (!_isCI) {
				currentTarget = currentTarget.replace(process.cwd(), '');
				goldenTarget = goldenTarget.replace(process.cwd(), '');
			}
			process.stdout.write(`\n${chalk.green('    Current:')} ${currentTarget}`);
			process.stdout.write(`\n${chalk.hex('#DCDCAA')('    Golden:')} ${goldenTarget}\n\n`);
		});

		after(async() => {
			if (_isGoldenUpdate) {
				await this._deleteGoldenOrphans();
			}
			if (!_isGoldenUpdate && _isCI) process.stdout.write(`\nResults: ${this._fs.getCurrentBaseUrl()}\n`);
		});

	}

	getBaseUrl() {
		return _serverInfo.baseUrl;
	}

	async getRect(page, selector, margin) {
		margin = (margin !== undefined) ? margin : 10;
		return page.$eval(selector, (elem, margin) => {
			return {
				x: elem.offsetLeft - margin,
				y: elem.offsetTop - margin,
				width: elem.offsetWidth + (margin * 2),
				height: elem.offsetHeight + (margin * 2)
			};
		}, margin);
	}

	async screenshotAndCompare(page, name, options) {
		const info = Object.assign({path: this._fs.getCurrentPath(name)}, options);

		await page.screenshot(info);
		await this._fs.putCurrentFile(name);

		if (_isGoldenUpdate) return this._updateGolden(name);
		else await this._compare(name);
	}

	async _compare(name) {

		const currentImage = await this._fs.getCurrentImage(name);
		const goldenImage = await this._fs.getGoldenImage(name);
		let pixelsDiff;

		if (goldenImage && currentImage.width === goldenImage.width && currentImage.height === goldenImage.height) {
			const diff = new PNG({width: currentImage.width, height: currentImage.height});
			pixelsDiff = pixelmatch(
				currentImage.data, goldenImage.data, diff.data, currentImage.width, currentImage.height, {threshold: 0.1}
			);
			if (pixelsDiff !== 0) await this._fs.writeCurrentStream(`${name}-diff`, diff.pack());
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

	}

	async _deleteGoldenOrphans() {

		process.stdout.write('\n      Removed orphaned goldens.\n');

		const currentFiles = this._fs.getCurrentFiles();
		const goldenFiles = await this._fs.getGoldenFiles();

		for (let i = 0; i < goldenFiles.length; i++) {
			const fileName = goldenFiles[i];
			if (!currentFiles.includes(fileName)) {
				await this._fs.removeGoldenFile(fileName);
				process.stdout.write(`      ${chalk.gray(fileName)}\n`);
			}
		}

		process.stdout.write('\n');

	}

	async _updateGolden(name) {

		const currentImage = await this._fs.getCurrentImage(name);
		const goldenImage = await this._fs.getGoldenImage(name);

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
			const result = await this._fs.updateGolden(name);
			if (result) process.stdout.write(chalk.gray('golden updated'));
			else process.stdout.write(chalk.gray('golden update failed'));
		} else {
			process.stdout.write(chalk.gray('golden already up to date'));
		}

	}

	async _generateHtml(name, info) {

		let goldenUrl = this._fs.getGoldenUrl(name);
		goldenUrl = goldenUrl.startsWith('https://s3.') ? goldenUrl : `../golden/${goldenUrl}`;

		const createMetaHtml = () => {
			if (!_isCI) return '';
			const branch = process.env['TRAVIS_BRANCH'];
			const sha = process.env['TRAVIS_COMMIT'];
			const message = process.env['TRAVIS_COMMIT_MESSAGE'];
			const url = process.env['TRAVIS_BUILD_WEB_URL'];
			const build = process.env['TRAVIS_BUILD_NUMBER'];
			return `<div class="meta">
				<div><a href="${url}">Build #${build}</a></div>
				<div>${branch} (${sha})</div>
				<div>${message}</div>
			</div>`;
		};

		const createArtifactHtml = (name, image, url) => {
			if (image) {
				return `<div>
					<div class="label">${name} (w:${image.width} x h:${image.height})</div>
					<img src="${url}" alt="${name}" />
				</div>`;
			} else {
				return `<div>
					<div class="label">${name}</div>
					<div class="label" style="width: ${info.current.width}px;">No image.</div>
				</div>`;
			}
		};
		const createDiffHtml = (name, pixelsDiff, url) => {
			if (pixelsDiff === 0) {
				return `<div>
					<div class="label">${name} (0 pixels)</div>
					<div class="label" style="width: ${info.current.width}px;">Images match.</div>
				</div>`;
			} else if (pixelsDiff > 0) {
				return `<div>
					<div class="label">${name} (${pixelsDiff} pixels)</div>
					<img src="${url}" alt="${name}" />
				</div>`;
			} else {
				return `<div>
					<div class="label">${name}</div>
					<div class="label" style="width: ${info.current.width}px;">No image.</div>
				</div>`;
			}
		};

		const html = `
			<html>
				<head>
					<title>visual-diff: ${name}</title>
					<style>
						html { font-size: 20px; }
						body { font-family: sans-serif; background-color: #333; color: #fff; margin: 18px; }
						h1 { font-size: 1.2rem; font-weight: 400; margin: 24px 0; }
						a { color: #006fbf; }
						.compare { display: flex; }
						.compare > div { margin: 0 9px; }
						.compare > div:first-child { margin: 0 9px 0 0; }
						.compare > div:last-child { margin: 0 0 0 9px; }
						.label { display: flex; font-size: 0.8rem; margin-bottom: 6px; }
						.meta { font-size: 0.6rem; margin-top: 24px; }
						.meta > div { margin-bottom: 3px; }
					</style>
				</head>
				<body>
					<h1>${name}</h1>
					<div class="compare">
						${createArtifactHtml('Current', info.current, this._fs.getCurrentUrl(name))}
						${createArtifactHtml('Golden', info.golden, goldenUrl)}
						${createDiffHtml('Difference', info.pixelsDiff, this._fs.getCurrentUrl(`${name}-diff`))}
					</div>
					${createMetaHtml()}
				</body>
			</html>`;
		await this._fs.writeCurrentFile(`${name}.html`, html);
	}

}

module.exports = VisualDiff;
