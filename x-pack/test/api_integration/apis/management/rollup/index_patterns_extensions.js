/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import expect from '@kbn/expect';
import { stringify } from 'query-string';
import { registerHelpers } from './rollup.test_helpers';
import { INDEX_TO_ROLLUP_MAPPINGS, INDEX_PATTERNS_EXTENSION_BASE_PATH } from './constants';
import { getRandomString } from './lib';

export default function ({ getService }) {
  const supertest = getService('supertest');
  const es = getService('legacyEs');

  const { createIndexWithMappings, getJobPayload, createJob, cleanUp } = registerHelpers({
    supertest,
    es,
  });

  describe('index patterns extension', () => {
    describe('Fields for wildcards', () => {
      const BASE_URI = `${INDEX_PATTERNS_EXTENSION_BASE_PATH}/_fields_for_wildcard`;

      describe('query params validation', () => {
        let uri;
        let body;
        let params;

        it('"pattern" is required', async () => {
          uri = `${BASE_URI}`;
          ({ body } = await supertest.get(uri).expect(400));
          expect(body.message).to.contain(
            '[request query.pattern]: expected value of type [string]'
          );
        });

        it('"params" is required', async () => {
          params = { pattern: 'foo' };
          uri = `${BASE_URI}?${stringify(params, { sort: false })}`;
          ({ body } = await supertest.get(uri).expect(400));
          expect(body.message).to.contain(
            '[request query.params]: expected value of type [string]'
          );
        });

        it('"params" must be a valid JSON string', async () => {
          params = { pattern: 'foo', params: 'foobarbaz' };
          uri = `${BASE_URI}?${stringify(params, { sort: false })}`;
          ({ body } = await supertest.get(uri).expect(400));
          expect(body.message).to.contain('[request query.params]: expected JSON string');
        });

        it('"params" requires a "rollup_index" property', async () => {
          params = { pattern: 'foo', params: JSON.stringify({}) };
          uri = `${BASE_URI}?${stringify(params, { sort: false })}`;
          ({ body } = await supertest.get(uri).expect(400));
          expect(body.message).to.contain('[request query.params]: "rollup_index" is required');
        });

        it('"params" only accepts a "rollup_index" property', async () => {
          params = {
            pattern: 'foo',
            params: JSON.stringify({ rollup_index: 'my_index', someProp: 'bar' }),
          };
          uri = `${BASE_URI}?${stringify(params, { sort: false })}`;
          ({ body } = await supertest.get(uri).expect(400));
          expect(body.message).to.contain('[request query.params]: someProp is not allowed');
        });

        it('"meta_fields" must be an Array', async () => {
          params = {
            pattern: 'foo',
            params: JSON.stringify({ rollup_index: 'bar' }),
            meta_fields: 'stringValue',
          };
          uri = `${BASE_URI}?${stringify(params, { sort: false })}`;
          ({ body } = await supertest.get(uri).expect(400));
          expect(body.message).to.contain(
            '[request query.meta_fields]: could not parse array value from json input'
          );
        });

        it('should return 404 the rollup index to query does not exist', async () => {
          uri = `${BASE_URI}?${stringify(
            {
              pattern: 'foo',
              params: JSON.stringify({ rollup_index: 'bar' }),
            },
            { sort: false }
          )}`;
          ({ body } = await supertest.get(uri).expect(404));
          expect(body.message).to.contain('[index_not_found_exception] no such index [bar]');
        });
      });

      it('should return the correct fields', async () => {
        // Create a Rollup job on an index with the INDEX_TO_ROLLUP_MAPPINGS
        const indexName = await createIndexWithMappings();
        const rollupIndex = getRandomString();
        const payload = getJobPayload(indexName, undefined, rollupIndex);
        await createJob(payload);

        // Query for wildcard
        const params = {
          pattern: indexName,
          params: JSON.stringify({ rollup_index: rollupIndex }),
        };
        const uri = `${BASE_URI}?${stringify(params, { sort: false })}`;
        const { body } = await supertest.get(uri).expect(200);

        // Verify that the fields for wildcard correspond to our declared mappings
        const propertiesWithMappings = Object.keys(INDEX_TO_ROLLUP_MAPPINGS.properties);
        const fieldsForWildcard = body.fields.map((field) => field.name);
        expect(fieldsForWildcard.sort()).eql(propertiesWithMappings.sort());

        // Cleanup
        await cleanUp();
      });
    });
  });
}
