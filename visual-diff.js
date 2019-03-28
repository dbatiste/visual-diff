const { startServer } = require('polyserve');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const expect = require('chai').expect;

const compare = async(currentDir, goldenDir, name) => {

	if (process.argv.includes('--golden')) {
		fs.copyFileSync(getScreenshotPath(currentDir, name), getScreenshotPath(goldenDir, name));
		// eslint-disable-next-line no-console
		console.log('      golden updated');
	}

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
		let polyserve;

		before(async() => {
			if (!fs.existsSync(testRoot)) fs.mkdirSync(testRoot);
			if (!fs.existsSync(currentDir)) fs.mkdirSync(currentDir);
			if (!fs.existsSync(goldenDir)) fs.mkdirSync(goldenDir);
			polyserve = await startServer({
				port: (options && options.port) ? options.port : 8081,
				npm: true,
				moduleResolution: 'node'}
			);
		});

		after(async() => {
			await polyserve.close();
		});

		delegate({

			screenshotPath: (name) => {
				return getScreenshotPath(currentDir, name);
			},

			compare: async(name) => {
				compare(currentDir, goldenDir, name);
			},

			puppeteer: {

				getRect: async(page, selector, margin) => {
					margin = (margin !== undefined) ? margin : 10;
					return page.$eval(selector, (elem, margin) => {
						const rect = elem.getBoundingClientRect();
						return {
							x: rect.left - margin,
							y: rect.top - margin,
							width: rect.width + (margin * 2),
							height: rect.height + (margin * 2)
						};
					}, margin);
				},

				screenshotAndCompare: async(page, name, options) => {
					const info = Object.assign({path: getScreenshotPath(currentDir, name)}, options);
					await page.screenshot(info);
					await compare(currentDir, goldenDir, name);
				}

			}

		});

	}

};
