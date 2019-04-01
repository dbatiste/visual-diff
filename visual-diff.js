const chalk = require('chalk');
const expect = require('chai').expect;
const fs = require('fs');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const polyserve = require('polyserve');
const uploadHandler = require('./s3-upload.js');
const helpers = require('./helpers.js');

const compare = async(currentDir, goldenDir, name, uploadConfig) => {

	if (process.argv.includes('--golden')) {
		fs.copyFileSync(getScreenshotPath(currentDir, name), getScreenshotPath(goldenDir, name));
		// eslint-disable-next-line no-console
		console.log(`${chalk.hex('#DCDCAA')('      golden updated')}`);
	}

	if (upload) await uploadHandler.upload(getScreenshotPath(currentDir, name), uploadConfig);

	expect(fs.existsSync(getScreenshotPath(goldenDir, name)), 'golden exists').equal(true);

	const img1 = await getImage(getScreenshotPath(currentDir, name));
	const img2 = await getImage(getScreenshotPath(goldenDir, name));

	expect(img1.width, 'image widths are the same').equal(img2.width);
	expect(img1.height, 'image heights are the same').equal(img2.height);

	const diff = new PNG({width: img1.width, height: img1.height});

	const numDiffPixels = pixelmatch(
		img1.data, img2.data, diff.data, img1.width, img1.height, {threshold: 0.1}
	);

	if (numDiffPixels !== 0) {
		diff.pack().pipe(fs.createWriteStream(getScreenshotPath(currentDir, `${name}-diff`)));
		if (upload) await uploadHandler.upload(getScreenshotPath(currentDir, `${name}-diff`), uploadConfig);
	}

	expect(numDiffPixels, 'number of different pixels').equal(0);
};

const formatName = (name) => {
	return name.replace(/ /g, '-');
};

const getImage = (path) => {
	return new Promise((resolve) => {
		let image = null;
		const doneReading = () => {
			resolve(image);
		};
		image = fs.createReadStream(path).pipe(new PNG()).on('parsed', doneReading);
	});
};

const getScreenshotPath = (dir, name) => {
	return `${dir}/${formatName(name)}.png`;
};

module.exports = {

	run: (delegate, options) => {

		const testRoot = `${(options && options.dir) ? options.dir : process.cwd()}/screenshots` ;
		const currentDir = `${testRoot}/current`;
		const goldenDir = `${testRoot}/golden`;
		const port = (options && options.port) ? options.port : 8081;
		const uploadConfig = (options.upload ? Object.assign({}, options.upload) : null);
		let server, serverInfo;

		if (uploadConfig) uploadConfig.target = `${uploadConfig.target}/${options.name}/${helpers.getTimestamp('-', '.')}`;

		before(async() => {
			if (!fs.existsSync(testRoot)) fs.mkdirSync(testRoot);
			if (!fs.existsSync(currentDir)) fs.mkdirSync(currentDir);
			if (!fs.existsSync(goldenDir)) fs.mkdirSync(goldenDir);
			const options = {
				port: port,
				npm: true,
				moduleResolution: 'node'
			};
			server = await polyserve.startServer(options);
			const url = polyserve.getServerUrls(options, server).componentUrl;
			serverInfo = Object.assign({
				baseUrl: `${url.protocol}://${url.hostname}:${url.port}/${url.pathname.replace(/\/$/,'')}`
			}, url);
		});

		after(async() => {
			await server.close();
		});

		delegate({

			screenshotPath: (name) => {
				return getScreenshotPath(currentDir, name);
			},

			compare: async(name) => {
				compare(currentDir, goldenDir, name, uploadConfig);
			},

			serverInfo: () => {
				return serverInfo;
			},

			puppeteer: {

				getRect: async(page, selector, margin) => {
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

				screenshotAndCompare: async(page, name, options) => {
					const info = Object.assign({path: getScreenshotPath(currentDir, name)}, options);
					await page.screenshot(info);
					await compare(currentDir, goldenDir, name, uploadConfig);
				}

			}

		});

	}

};
