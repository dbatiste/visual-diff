const AWS = require('aws-sdk');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

chalk.level = 3;

const helper = {

	getFile: (filePath, config) => {
		const promise = new Promise((resolve, reject) => {

			const s3 = new AWS.S3({
				apiVersion: 'latest',
				accessKeyId: config.creds.accessKeyId,
				secretAccessKey: config.creds.secretAccessKey,
				region: config.region
			});

			const params = {Bucket: config.target, Key: path.basename(filePath)};

			s3.getObject(params, function(err, data) {
				if (err) {
					process.stdout.write(`\n${chalk.red(err)}`);
					reject(err);
				}
				if (data) {
					fs.writeFileSync(filePath, data.Body);
					resolve();
				}
			});
		});

		return promise;
	},

	uploadFile: (filePath, config) => {

		const promise = new Promise((resolve, reject) => {

			const s3 = new AWS.S3({
				apiVersion: 'latest',
				accessKeyId: config.creds.accessKeyId,
				secretAccessKey: config.creds.secretAccessKey,
				region: config.region
			});

			const params = {Bucket: config.target, Key: '', Body: ''};
			const fileStream = fs.createReadStream(filePath);

			fileStream.on('error', function(err) {
				process.stdout.write(`\n${chalk.red(err)}`);
				reject(err);
			});
			params.Body = fileStream;
			params.Key = path.basename(filePath);

			s3.upload(params, function(err, data) {
				if (err) {
					process.stdout.write(`\n${chalk.red(err)}`);
					reject(err);
				}
				if (data) {
					resolve(data);
				}
			});

		});

		return promise;
	}

};

module.exports = helper;
