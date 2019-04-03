const AWS = require('aws-sdk');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

chalk.level = 3;

const helper = {

	deleteFile: (filePath, config) => {
		const promise = new Promise((resolve, reject) => {

			const s3 = new AWS.S3({
				apiVersion: 'latest',
				accessKeyId: config.creds.accessKeyId,
				secretAccessKey: config.creds.secretAccessKey,
				region: config.region
			});

			const params = {Bucket: config.target, Key: path.basename(filePath)};

			s3.deleteObject(params, function(err, data) {
				if (err) {
					if (err.code === 'NoSuchKey') {
						resolve();
					} else {
						process.stdout.write(`\n${chalk.red(err)}`);
						reject(err);
					}
				}
				if (data) {
					resolve();
				}
			});

		});

		return promise;
	},

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
					if (err.code === 'NoSuchKey') {
						resolve(false);
					} else {
						process.stdout.write(`\n${chalk.red(err)}`);
						reject(err);
					}
				}
				if (data) {
					fs.writeFileSync(filePath, data.Body);
					resolve(true);
				}
			});
		});

		return promise;
	},

	getFileList: (config) => {
		const promise = new Promise((resolve, reject) => {

			const s3 = new AWS.S3({
				apiVersion: 'latest',
				accessKeyId: config.creds.accessKeyId,
				secretAccessKey: config.creds.secretAccessKey,
				region: config.region
			});

			const params = {
				Bucket: config.bucket,
				Prefix: `${config.target.replace(`${config.bucket}/`, '')}/`
			};

			s3.listObjectsV2(params, function(err, data) {
				if (err) {
					process.stdout.write(`\n${chalk.red(err)}`);
					reject(err);
				}
				if (data) {
					const files = [];
					for (let i = 0; i < data.Contents.length; i++) {
						const name = data.Contents[i].Key.replace(params.Prefix, '');
						if (name.length > 0) files.push(name);
					}
					resolve(files);
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
