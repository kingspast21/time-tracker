const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (arg) => ipcRenderer.invoke(ch, arg);

contextBridge.exposeInMainWorld('api', {
  getSettings: call('settings:get'),
  saveSettings: call('settings:save'),
  pickFolder: call('settings:pickFolder'),

  getClients: call('db:getClients'),
  saveClient: call('db:saveClient'),
  deleteClient: call('db:deleteClient'),

  getRange: call('db:getRange'),
  saveDay: call('db:saveDay'),

  invoiceInfo: call('invoice:info'),
  invoiceHistory: call('invoice:history'),
  generate: call('invoice:generate'),

  openPath: call('shell:open'),
  reveal: call('shell:reveal'),
});
