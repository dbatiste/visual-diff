# visual-diff

Visual diff using Mocha, Chai, Puppeteer, and PixelMatch.  Inspired by [Automatic visual diffing with Puppeteer](https://meowni.ca/posts/2017-puppeteer-tests/).

Given...

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <script src="../../node_modules/@webcomponents/webcomponentsjs/webcomponents-loader.js"></script>
    <script type="module">
      import '../../components/colors/colors.js';
      import '../../components/typography/typography.js';
      import '../../components/button/button-subtle.js';
    </script>
    <title>d2l-button-subtle fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta charset="UTF-8">
    <style>
      body { padding: 30px; }
      body > div { margin: 20px; }
    </style>
  </head>
  <body class="d2l-typography">
    <div><d2l-button-subtle id="normal" text="Subtle Button"></d2l-button-subtle></div>
  </body>
</html>

```

Take screenshots and compare...

```javascript
const puppeteer = require('puppeteer');
const visualDiff = require('visual-diff');

before(async() => {
	await visualDiff.initialize({
		name: 'button', dir: __dirname, port: 8081
	});
});

describe('d2l-button-subtle', function() {

	let browser, page;

	before(async() => {
		browser = await puppeteer.launch();
		page = await browser.newPage();
	});

	after(() => browser.close());

	describe('wide', function() {

		beforeEach(async function() {
			await page.setViewport({width: 800, height: 800, deviceScaleFactor: 2});
			await page.goto(`${visualDiff.baseUrl}/demo/button/button-subtle.html`, {waitUntil: ['networkidle2', 'load']});
		});

		it('normal', async function() {
			const rect = await visualDiff.puppeteer.getRect(page, '#normal');
			await visualDiff.puppeteer.screenshotAndCompare(page, this.test.fullTitle(), { clip: rect });
		});

		it('mouse', async function() {
			await page.hover('#normal');
			const rect = await visualDiff.puppeteer.getRect(page, '#normal');
			await visualDiff.puppeteer.screenshotAndCompare(page, this.test.fullTitle(), { clip: rect });
		});

	});

});
```
