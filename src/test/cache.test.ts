import * as assert from 'assert';

import {Cache, CacheItem} from '../cache';


suite('Cache', () => {

	test('is correctly storing an item', () => {
		let cache = new Cache(1);
		cache.add(new CacheItem('foo', {foo: 'bar'}));

		let cachedItem = cache.get('foo');
		assert.deepEqual(cachedItem, {foo: 'bar'});
	});

	test('is correctly expiring an item', (done) => {
		let cache = new Cache(1);
		cache.add(new CacheItem('foo', {foo: 'bar'}));

		setTimeout(() => {
			assert.deepEqual(cache.get('foo'), {foo: 'bar'});
		}, 900);

		setTimeout(() => {
			assert.equal(cache.get('foo'), undefined);
		}, 1100);

		setTimeout(done, 1200);
	});
});

suite('CacheItem', () => {

	test('is correctly setting properties', () => {
		let cacheItem = new CacheItem('foo', 'bar');
		assert.equal(cacheItem.key, 'foo');
		assert.equal(cacheItem.value, 'bar');
	});

});
