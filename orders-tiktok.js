window.ordersTiktok = {
  openTab() {
    if (typeof setOrdersTab === 'function') {
      setOrdersTab('tiktok');
    }
  },
  uploadFile() {
    if (typeof triggerMarketplaceUpload === 'function') {
      triggerMarketplaceUpload('tiktok');
    }
  },
  exportFile() {
    if (typeof exportOrdersToMarketplace === 'function') {
      exportOrdersToMarketplace('tiktok');
    }
  },
};
