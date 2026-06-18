// CloudFront Function (viewer-request): rewrite extensionless paths to
// /index.html so SPA deep links (e.g. /transactions/2026-06) survive refresh.
// Asset requests (anything with a dot in the last path segment) pass through.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSegment = uri.split('/').pop();
  if (lastSegment && lastSegment.indexOf('.') !== -1) {
    return request;
  }
  request.uri = '/index.html';
  return request;
}
