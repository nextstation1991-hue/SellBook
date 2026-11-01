(function (global) {
  function getBookImageUrl(source) {
    return typeof source === 'string' ? source : '';
  }

  global.getBookImageUrl = getBookImageUrl;
})(window);
