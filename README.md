# visual-diff

Visual diff using Mocha, Chai, Puppeteer, and PixelMatch.  Inspired by [Automatic visual diffing with Puppeteer](https://meowni.ca/posts/2017-puppeteer-tests/).

Given...

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <script src="../../node_modules/@webcomponents/webcomponentsjs/webcomponents-bundle.js"></script>
    <script type="module">
      import '../../components/colors/colors.js';
      import '../../components/typography/typography.js';
      import '../../components/button/button-subtle.js';
    </script>
    <title>d2l-button-subtle fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta charset="UTF-8">
    <style>
      body > div {
        margin: 20px;
      }
    </style>
  </head>
  <body style="padding: 30px;" class="d2l-typography">
    <div><d2l-button-subtle id="normal" text="Subtle Button"></d2l-button-subtle></div>
  </body>
</html>

```

Take screenshots and compare...

```javascript
const puppeteer = require('puppeteer');
const visualDiff = require('visual-diff');

visualDiff.run((ctx) => {

  describe('d2l-button-subtle', function() {

    this.timeout(10000);
    let browser, page;

    before(async() => {
      browser = await puppeteer.launch();
      page = await browser.newPage();
    });

    after(() => browser.close());

    describe('wide', function() {

      beforeEach(async function() {
        await page.setViewport({width: 800, height: 800, deviceScaleFactor: 2});
        await page.goto('http://127.0.0.1:8081/components/d2l-core-ui/test/button/button-subtle-fixture.html', {waitUntil: ['networkidle2', 'load']});
      });

      it('normal', async function() {
        const rect = await ctx.puppeteer.getRect(page, '#normal');
        await ctx.puppeteer.screenshotAndCompare(page, this.test.fullTitle(), { clip: rect });
      });

      it('focus', async function() {
        await page.click('#normal');
        const rect = await ctx.puppeteer.getRect(page, '#normal');
        await ctx.puppeteer.screenshotAndCompare(page, this.test.fullTitle(), { clip: rect });
      });

    });

  });

}, {dir: __dirname, port: 8081});
```
