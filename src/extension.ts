import * as vscode from 'vscode';
import {Cache, CacheItem} from './cache';

import * as GitHubApi from 'github';
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as fs from 'fs';
import * as https from 'https';
import * as url from 'url';


class CancellationError extends Error {

}

enum OperationType {
	Append,
	Overwrite
}

interface GitHubRepositoryItem {
	name: string;
	path: string;
	download_url: string;
	type: string;
}

interface GitignoreOperation {
	type: OperationType;
	path: string;
	file: GitignoreFile;
}

export interface GitignoreFile extends vscode.QuickPickItem {
	url: string;
}

export class GitignoreRepository {
	private cache: Cache;

	constructor(private client: any) {
		let config = vscode.workspace.getConfiguration('gitignore');
		this.cache = new Cache(config.get('cacheExpirationInterval', 3600));
	}

	/**
	 * Get all .gitignore files
	 */
	public getFiles(path: string = ''): Thenable<GitignoreFile[]> {
		return new Promise((resolve, reject) => {
			// If cached, return cached content
			let item = this.cache.get('gitignore/' + path);
			if(typeof item !== 'undefined') {
				resolve(item);
				return;
			}

			// Download .gitignore files from github
			this.client.repos.getContent({
				owner: 'github',
				repo: 'scraly',
				path: path
			}, (err: any, response: any) => {
				if(err) {
					reject(`${err.code}: ${err.message}`);
					return;
				}

				console.log(`vscode-gitignore: Github API ratelimit remaining: ${response.meta['x-ratelimit-remaining']}`);

				let files = (response.data as GitHubRepositoryItem[])
					.filter(file => {
						return (file.type === 'file' && file.name.endsWith('.helmignore'));
					})
					.map(file => {
						return {
							label: file.name.replace(/\.helmignore/, ''),
							description: file.path,
							url: file.download_url
						};
					});

				// Cache the retrieved gitignore files
				this.cache.add(new CacheItem('gitignore/' + path, files));

				resolve(files);
			});
		});
	}

	/**
	 * Downloads a .helmignore from the repository to the path passed
	 */
	public download(operation: GitignoreOperation): Thenable<GitignoreOperation> {
		return new Promise((resolve, reject) => {
			let flags = operation.type === OperationType.Overwrite ? 'w' : 'a';
			let file = fs.createWriteStream(operation.path, { flags: flags });

			// If appending to the existing .gitignore file, write a NEWLINE as separator
			if(flags === 'a') {
				file.write('\n');
			}

			let options: https.RequestOptions = url.parse(operation.file.url);
			options.agent = getAgent(); // Proxy
			options.headers = {
				'User-Agent': userAgent
			};

			https.get(options, response => {
				response.pipe(file);

				file.on('finish', () => {
					file.close();
					resolve(operation);
				});
			}).on('error', (err) => {
				// Delete the .gitignore file if we created it
				if(flags === 'w') {
					fs.unlink(operation.path, err => console.error(err.message));
				}
				reject(err.message);
			});
		});
	}
}


const userAgent = 'vscode-helmignore-extension';

// Read proxy configuration
let httpConfig = vscode.workspace.getConfiguration('http');
let proxy = httpConfig.get<string | undefined>('proxy', undefined);

console.log(`vscode-helmignore: using proxy ${proxy}`);

// Create a Github API client
let client = new GitHubApi({
	protocol: 'https',
	host: 'api.github.com',
	//debug: true,
	pathPrefix: '',
	timeout: 5000,
	headers: {
		'User-Agent': userAgent
	},
	proxy: proxy
});

// Create gitignore repository
let gitignoreRepository = new GitignoreRepository(client);


let agent: any;

function getAgent() {
	if(agent) {
		return agent;
	}

	// Read proxy url in following order: vscode settings, environment variables
	proxy = proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

	if(proxy) {
		agent = new HttpsProxyAgent(proxy);
	}

	return agent;
}

function getGitignoreFiles() {
	// Get lists of .gitignore files from Github
	return Promise.all([
		gitignoreRepository.getFiles()
	])
		// Merge the two result sets
		.then((result) => {
			let files: GitignoreFile[] = Array.prototype.concat.apply([], result)
				.sort((a: GitignoreFile, b: GitignoreFile) => a.label.localeCompare(b.label));
			return files;
		});
}

function promptForOperation() {
	return vscode.window.showQuickPick([
		{
			label: 'Append',
			description: 'Append to existing .gitignore file'
		},
		{
			label: 'Overwrite',
			description: 'Overwrite existing .gitignore file'
		}
	]);
}

function showSuccessMessage(operation: GitignoreOperation) {
	switch(operation.type) {
		case OperationType.Append:
			return vscode.window.showInformationMessage(`Appended ${operation.file.description} to the existing .gitignore in the project root`);
		case OperationType.Overwrite:
			return vscode.window.showInformationMessage(`Created .gitignore file in the project root based on ${operation.file.description}`);
		default:
			throw new Error('Unsupported operation');
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('vscode-gitignore: extension is now active!');

	let disposable = vscode.commands.registerCommand('addgitignore', () => {
		// Check if workspace open
		if(!vscode.workspace.rootPath) {
			vscode.window.showErrorMessage('No workspace directory open');
			return;
		}

		Promise.resolve()
			.then(() => {
				return vscode.window.showQuickPick(getGitignoreFiles());
			})
			// Check if a .gitignore file exists
			.then(file => {
				if(!file) {
					// Cancel
					throw new CancellationError();
				}

				var path = vscode.workspace.rootPath + '/.gitignore';

				return new Promise<GitignoreOperation>((resolve, reject) => {
					// Check if file exists
					fs.stat(path, (err) => {
						if(err) {
							// File does not exists -> we are fine to create it
							resolve({ path: path, file: file, type: OperationType.Overwrite });
						}
						else {
							promptForOperation()
								.then(operation => {
									if(!operation) {
										// Cancel
										reject(new CancellationError());
										return;
									}
									let typedString = <keyof typeof OperationType> operation.label;
									let type = OperationType[typedString];

									resolve({ path: path, file: file, type: type });
								});
						}
					});
				});
			})
			// Store the file on file system
			.then((operation: GitignoreOperation) => {
				return gitignoreRepository.download(operation);
			})
			// Show success message
			.then((operation) => {
				return showSuccessMessage(operation);
			})
			.catch(reason => {
				if(reason instanceof CancellationError) {
					return;
				}

				vscode.window.showErrorMessage(reason);
			});
	});

	context.subscriptions.push(disposable);
}


// this method is called when your extension is deactivated
export function deactivate() {
	console.log('vscode-helmignore: extension is now deactivated!');
}
