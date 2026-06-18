// Local development entrypoint. AWS Lambda uses src/handler.js instead,
// which wraps the same Express app (src/app.js) with serverless-http.
const app = require('./src/app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
