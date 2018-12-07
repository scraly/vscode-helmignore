import * as assert from 'assert';
import * as GitHubApi from 'github';

import * as gitignoreExtension from '../extension';


suite('GitignoreRepository', () => {

	test('is getting all .helmignore files', () => {

		// Create a Github API client
		let client = new GitHubApi({
			protocol: 'https',
			host: 'api.github.com',
			//debug: true,
			pathPrefix: '',
			timeout: 5000,
			headers: {
				'user-agent': 'vscode-helmignore-extension'
			}
		});

		// Create gitignore repository
		let gitignoreRepository = new gitignoreExtension.GitignoreRepository(client);

		return Promise.all([
			gitignoreRepository.getFiles()
		])
		.then((result) => {
			let files: gitignoreExtension.GitignoreFile[] = Array.prototype.concat.apply([], result);

			// From .
			let rootItem = files.find(f => f.label === 'Helm');
			assert.deepEqual(rootItem, {
				description: 'Helm.helmignore',
				label: 'Helm',
				url: 'https://raw.githubusercontent.com/scraly/helmignore/master/Helm.helmignore',
			});

		});
	});
});
