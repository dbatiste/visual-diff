const chalk = require('chalk');
const expect = require('chai').expect;
const fs = require('fs');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const polyserve = require('polyserve');
const s3Helper = require('./s3-upload.js');

chalk.level = 3;

let _s3Config = {
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

		this._testRoot = `${(options && options.dir) ? options.dir : process.cwd()}/screenshots`;
		this._currentDir = `${this._testRoot}/current`;
		this._goldenDir = `${this._testRoot}/golden`;
		this._port = (options && options.port) ? options.port : 8081;

		if (options.upload) _s3Config = Object.assign(_s3Config, options.upload);
		_s3Current = Object.assign(_s3Current, _s3Config, { target: `${_s3Config.target}/${options.name}/${this._getTimestamp('-', '.')}`});
		//_s3Golden = Object.assign(_s3Golden, _s3Config, { target: `${_s3Config.target}/${options.name}/golden`});
		_s3Golden = Object.assign(_s3Golden, _s3Config, { target: `${_s3Config.target}/${options.name}/golden.macos`});

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

		process.stdout.write(`Started server with base: ${this._serverInfo.baseUrl}\n`);

		after(async() => {
			await server.close();
			process.stdout.write('Stopped server.');
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

		const currentPath = this._getScreenshotPath(this._currentDir, name);
		const goldenPath = this._getScreenshotPath(this._goldenDir, name);

		if (process.argv.includes('--golden')) {
			fs.copyFileSync(currentPath, goldenPath);
			process.stdout.write(`${chalk.hex('#DCDCAA')('      golden updated')}`);
		}

		if (_s3Current) await s3Helper.uploadFile(currentPath, _s3Current);
		if (_s3Golden) {
			await s3Helper.getFile(goldenPath, _s3Golden);
		}

		expect(fs.existsSync(goldenPath), 'golden exists').equal(true);

		const img1 = await this._getImage(currentPath);
		const img2 = await this._getImage(goldenPath);

		expect(img1.width, 'image widths are the same').equal(img2.width);
		expect(img1.height, 'image heights are the same').equal(img2.height);

		const diff = new PNG({width: img1.width, height: img1.height});

		const numDiffPixels = pixelmatch(
			img1.data, img2.data, diff.data, img1.width, img1.height, {threshold: 0.1}
		);

		if (numDiffPixels !== 0) {
			const diffPath = this._getScreenshotPath(this._currentDir, `${name}-diff`);
			diff.pack().pipe(fs.createWriteStream(diffPath));
			if (_s3Current) await s3Helper.uploadFile(diffPath, _s3Current);
		}

		expect(numDiffPixels, 'number of different pixels').equal(0);

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
	}

};

module.exports = visualDiff;
