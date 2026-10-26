window.ordersShopee = {
  openTab() {
    if (typeof setOrdersTab === 'function') {
      setOrdersTab('shopee');
    }
  },
  uploadFile() {
    if (typeof triggerMarketplaceUpload === 'function') {
      triggerMarketplaceUpload('shopee');
    }
  },
  exportFile() {
    if (typeof exportOrdersToMarketplace === 'function') {
      exportOrdersToMarketplace('shopee');
    }
  },
};
