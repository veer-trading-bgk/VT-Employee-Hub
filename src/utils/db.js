const dynamodb = require('../config/dynamodb');

// Collect all pages from a DynamoDB Query into a single Items array.
async function queryAll(params) {
  const items = [];
  let lastKey;
  do {
    const res = await dynamodb
      .query({ ...params, ...(lastKey && { ExclusiveStartKey: lastKey }) })
      .promise();
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

module.exports = { queryAll };
