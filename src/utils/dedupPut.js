/**
 * Write a DynamoDB item only if it doesn't already exist (attribute_not_exists(SK)).
 * Returns true  → item was new and written.
 * Returns false → item already existed (duplicate, ConditionalCheckFailed).
 * Throws        → unexpected DynamoDB error (caller must handle).
 */
async function dedupPut(dynamodb, TableName, item) {
  try {
    await dynamodb.put({
      TableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(SK)',
    }).promise();
    return true;
  } catch (e) {
    if (e.code === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

module.exports = { dedupPut };
