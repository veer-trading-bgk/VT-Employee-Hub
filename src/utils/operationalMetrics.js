'use strict';

/**
 * Operational metrics foundation for APForce V2.
 *
 * Writes CloudWatch Embedded Metrics Format (EMF) JSON to stdout.
 * AWS Lambda captures stdout into CloudWatch Logs; the Logs service
 * automatically materializes EMF lines as CloudWatch Metrics — no agent,
 * no SDK calls, no added latency on the hot path.
 *
 * Metrics land under the "APForce/<namespace>" CloudWatch namespace.
 *
 * Usage:
 *   const { emitMetric } = require('../utils/operationalMetrics');
 *   emitMetric('WhatsApp', 'InboundWebhook', 1, 'Count', { companyId });
 *   emitMetric('CRM',      'LeadCreated',    1, 'Count', { companyId, source: 'manual' });
 *   emitMetric('Auth',     'TokenRefresh',   1, 'Count', {});
 *
 * Supported units (CloudWatch):
 *   'Count' | 'Milliseconds' | 'Bytes' | 'Kilobytes' | 'Megabytes' |
 *   'Percent' | 'None'
 *
 * Dimension keys must be strings; values must be strings.
 * Maximum 9 dimensions per metric (CloudWatch limit).
 */

/**
 * @param {string} namespace   e.g. 'WhatsApp', 'CRM', 'Auth', 'WS'
 * @param {string} name        metric name e.g. 'InboundWebhook', 'LeadCreated'
 * @param {number} value
 * @param {string} [unit]      CloudWatch unit string (default: 'Count')
 * @param {Record<string, string>} [dimensions]  up to 9 string key-value pairs
 */
function emitMetric(namespace, name, value, unit = 'Count', dimensions = {}) {
  try {
    const emf = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [{
          Namespace:  `APForce/${namespace}`,
          Dimensions: [Object.keys(dimensions)],
          Metrics:    [{ Name: name, Unit: unit }],
        }],
      },
      ...dimensions,
      [name]: value,
    };
    process.stdout.write(JSON.stringify(emf) + '\n');
  } catch {
    // Metrics are always best-effort — never throw, never block the caller
  }
}

module.exports = { emitMetric };
