let _baseUrl = null;
function setBaseUrl(url) {
  _baseUrl = url ? url.replace(/\/+$/, '') : null;
}
function setAuthTokenGetter(getter) {}
module.exports = { setBaseUrl, setAuthTokenGetter };
