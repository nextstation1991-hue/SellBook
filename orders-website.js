window.ordersWebsite = {
  init() {
    if (typeof setupOrdersTableHeaders === 'function') {
      setupOrdersTableHeaders();
    }
    if (typeof setOrdersTab === 'function') {
      setOrdersTab('website');
    }
  },
  openTab() {
    if (typeof setOrdersTab === 'function') {
      setOrdersTab('website');
    }
  },
  refresh() {
    if (typeof loadOrders === 'function') {
      loadOrders();
    }
  },
};
